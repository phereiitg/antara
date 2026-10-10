from __future__ import annotations

import logging
from pathlib import Path

import httpx
import pytest

from antara_core.integrations.gemini_client import (
    GeminiAuthError,
    GeminiRateLimitError,
    GeminiRequestError,
    GeminiTimeoutError,
    GeminiUnavailableError,
)
from tests.test_gemini_client import PNG_1PX, SECRET, api_error, make, response


# ---------------------------------------------------------------- images
def test_describe_image_sends_inline_bytes(tmp_path: Path):
    img = tmp_path / "sample.png"
    img.write_bytes(PNG_1PX)
    body = '{"summary": "A white pixel.", "observations": ["tiny"], "visible_text": [], "image_quality": "limited"}'
    client, sdk, _ = make([response(body)])
    obs = client.describe_image(img)
    assert obs.summary == "A white pixel." and obs.image_quality == "limited" and obs.model == "gemini-test"
    contents = sdk.models.calls[0]["contents"]
    assert "Do not infer chemical composition" in contents[0]
    assert contents[1].inline_data.mime_type == "image/png"
    assert contents[1].inline_data.data == PNG_1PX


@pytest.mark.parametrize(
    ("name", "data", "message"),
    [("missing.jpg", None, "not found"), ("doc.gif", b"GIF89a", "Unsupported image type"), ("empty.jpg", b"", "empty")],
)
def test_image_validation(tmp_path: Path, name: str, data: bytes | None, message: str):
    path = tmp_path / name
    if data is not None:
        path.write_bytes(data)
    client, sdk, _ = make([])
    with pytest.raises(GeminiRequestError, match=message):
        client.describe_image(path)
    assert sdk.models.calls == []


def test_oversized_images_rejected(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("antara_core.integrations.gemini_client.MAX_INLINE_BYTES", 10)
    img = tmp_path / "big.jpg"
    img.write_bytes(b"x" * 11)
    client, _, _ = make([])
    with pytest.raises(GeminiRequestError, match="inline limit"):
        client.describe_image(img)


# ---------------------------------------------------------------- errors and retries
def test_retries_transient_errors_then_succeeds():
    client, sdk, sleeps = make([api_error(503, "UNAVAILABLE"), api_error(429, "RESOURCE_EXHAUSTED"), response("ok")])
    assert client.generate_text("p") == "ok"
    assert len(sdk.models.calls) == 3
    assert sleeps == [1.0, 2.0]


def test_gives_up_after_max_attempts():
    client, sdk, _ = make([api_error(500, "INTERNAL")] * 2, attempts=2)
    with pytest.raises(GeminiUnavailableError, match="HTTP 500"):
        client.generate_text("p")
    assert len(sdk.models.calls) == 2


def test_timeouts_are_retried_and_reported():
    client, sdk, _ = make([httpx.ReadTimeout("slow")] * 2, attempts=2)
    with pytest.raises(GeminiTimeoutError, match="timed out"):
        client.generate_text("p")
    assert len(sdk.models.calls) == 2


def test_network_error_is_retryable():
    client, _, _ = make([httpx.ConnectError("dns"), response("ok")])
    assert client.generate_text("p") == "ok"


@pytest.mark.parametrize(
    ("error", "expected", "match"),
    [
        (api_error(400, "INVALID_ARGUMENT", "API key not valid. Please pass a valid API key."), GeminiAuthError, "GEMINI_API_KEY"),
        (api_error(403, "PERMISSION_DENIED"), GeminiAuthError, "GEMINI_API_KEY"),
        (api_error(404, "NOT_FOUND", "models/x is not found"), GeminiRequestError, "GEMINI_MODEL"),
        (api_error(400, "INVALID_ARGUMENT", "bad schema"), GeminiRequestError, "HTTP 400"),
    ],
)
def test_non_retryable_errors_fail_fast(error, expected, match):
    client, sdk, sleeps = make([error, response("never")])
    with pytest.raises(expected, match=match):
        client.generate_text("p")
    assert len(sdk.models.calls) == 1 and sleeps == []


def test_rate_limit_error_type():
    client, _, _ = make([api_error(429, "RESOURCE_EXHAUSTED")], attempts=1)
    with pytest.raises(GeminiRateLimitError):
        client.generate_text("p")


def test_api_key_never_appears_in_errors_or_logs(caplog):
    leaky = api_error(400, "INVALID_ARGUMENT", f"bad request for key {SECRET}")
    client, _, _ = make([api_error(503, "UNAVAILABLE"), leaky])
    with caplog.at_level(logging.DEBUG), pytest.raises(GeminiRequestError) as info:
        client.generate_text("p")
    assert SECRET not in str(info.value)
    assert SECRET not in caplog.text
