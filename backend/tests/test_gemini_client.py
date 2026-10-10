from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
from google.genai import errors as genai_errors
from google.genai import types
from pydantic import BaseModel

from antara_core.config import ConfigError, load_settings
from antara_core.integrations.gemini_client import (
    GeminiClient,
    GeminiRequestError,
    GeminiResponseError,
)

SECRET = "AIzaSyTEST-gemini-secret-0123456789"
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082"
)


def response(text: str, finish: str = "STOP") -> types.GenerateContentResponse:
    return types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(role="model", parts=[types.Part(text=text)]), finish_reason=finish,
    )])


class FakeModels:
    def __init__(self, outcomes: list[Any]) -> None:
        self.outcomes = list(outcomes)
        self.calls: list[dict[str, Any]] = []

    def generate_content(self, **kwargs: Any) -> Any:
        self.calls.append(kwargs)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


class FakeSdk:
    def __init__(self, outcomes: list[Any]) -> None:
        self.models = FakeModels(outcomes)


def make(outcomes: list[Any], attempts: int = 3) -> tuple[GeminiClient, FakeSdk, list[float]]:
    sdk = FakeSdk(outcomes)
    sleeps: list[float] = []
    client = GeminiClient(SECRET, "gemini-test", max_attempts=attempts, sdk_client=sdk, sleep=sleeps.append)
    return client, sdk, sleeps


def api_error(code: int, status: str, message: str = "x") -> genai_errors.APIError:
    cls = genai_errors.ServerError if code >= 500 else genai_errors.ClientError
    return cls(code, {"error": {"code": code, "status": status, "message": message}})


# ---------------------------------------------------------------- construction
def test_requires_api_key_and_model():
    with pytest.raises(ConfigError, match="GEMINI_API_KEY"):
        GeminiClient("", "m", sdk_client=FakeSdk([]))
    with pytest.raises(ConfigError, match="GEMINI_MODEL"):
        GeminiClient(SECRET, " ", sdk_client=FakeSdk([]))


def test_from_settings_without_key_raises_config_error():
    with pytest.raises(ConfigError, match="GEMINI_API_KEY is not set"):
        GeminiClient.from_settings(load_settings())


def test_real_sdk_client_builds_offline(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", SECRET)
    monkeypatch.setenv("GEMINI_TIMEOUT_SECONDS", "12.5")
    client = GeminiClient.from_settings(load_settings())  # no network call at construction
    assert client.model == "gemini-3.8-flash"
    assert SECRET not in repr(client)


# ---------------------------------------------------------------- requests and responses
def test_generate_text_sends_model_and_prompt():
    client, sdk, _ = make([response("ANTARA_OK")])
    assert client.generate_text("say it") == "ANTARA_OK"
    call = sdk.models.calls[0]
    assert call["model"] == "gemini-test"
    assert call["contents"] == ["say it"]
    assert call["config"].response_mime_type is None


def test_generate_text_ignores_thought_parts():
    resp = types.GenerateContentResponse(candidates=[types.Candidate(
        content=types.Content(parts=[types.Part(text="thinking...", thought=True), types.Part(text="answer")]),
        finish_reason="STOP",
    )])
    client, _, _ = make([resp])
    assert client.generate_text("q") == "answer"


def test_generate_json_with_dict_schema():
    schema = {"type": "object", "properties": {"a": {"type": "integer"}}, "required": ["a"]}
    client, sdk, _ = make([response('{"a": 1}')])
    assert client.generate_json("p", schema) == {"a": 1}
    config = sdk.models.calls[0]["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_json_schema == schema


class Item(BaseModel):
    name: str
    count: int


def test_generate_json_with_pydantic_model_validates():
    client, sdk, _ = make([response('{"name": "kit", "count": 2}')])
    assert client.generate_json("p", Item) == Item(name="kit", count=2)
    assert sdk.models.calls[0]["config"].response_json_schema["required"] == ["name", "count"]


def test_generate_json_schema_mismatch_raises():
    client, _, _ = make([response('{"name": "kit"}')])
    with pytest.raises(GeminiResponseError, match="does not match Item"):
        client.generate_json("p", Item)


def test_invalid_json_raises():
    client, _, _ = make([response("not json")])
    with pytest.raises(GeminiResponseError, match="invalid JSON"):
        client.generate_json("p", {"type": "object"})


def test_truncated_blocked_and_empty_responses_raise():
    client, _, _ = make([response('{"a":', finish="MAX_TOKENS")])
    with pytest.raises(GeminiResponseError, match="MAX_TOKENS"):
        client.generate_json("p", {"type": "object"})
    blocked = types.GenerateContentResponse(
        candidates=[], prompt_feedback=types.GenerateContentResponsePromptFeedback(block_reason="SAFETY")
    )
    client, _, _ = make([blocked])
    with pytest.raises(GeminiResponseError, match="SAFETY"):
        client.generate_text("p")
    client, _, _ = make([response("   ")])
    with pytest.raises(GeminiResponseError, match="empty"):
        client.generate_text("p")


def test_empty_prompt_rejected_without_calling_api():
    client, sdk, _ = make([])
    with pytest.raises(GeminiRequestError, match="non-empty"):
        client.generate_text("  ")
    assert sdk.models.calls == []
