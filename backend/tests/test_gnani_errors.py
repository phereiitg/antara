"""Gnani client: provider error mapping, retries, timeouts and secret hygiene (offline)."""

from __future__ import annotations

import logging
from pathlib import Path

import httpx
import pytest

from antara_core.integrations.gnani_client import (
    GnaniAuthError,
    GnaniProviderError,
    GnaniRateLimitError,
    GnaniRequestError,
    GnaniTimeoutError,
    GnaniUnsupportedAudioError,
    GnaniUnsupportedLanguageError,
)
from tests.gnani_helpers import HINDI, SECRET, err, make, make_wav, ok


@pytest.fixture
def wav(tmp_path: Path) -> Path:
    return make_wav(tmp_path / "clip.wav")


@pytest.mark.parametrize(
    ("response", "expected", "match"),
    [
        (err(401, "AUTHENTICATION_ERROR", "Invalid API key"), GnaniAuthError, "GNANI_API_KEY"),
        (err(403, "FORBIDDEN", "Check your API key, organization status, or available credits."), GnaniAuthError, "credits"),
        (err(400, "INVALID_REQUEST_ERROR", "Audio duration exceeds maximum limit of 60 seconds"), GnaniUnsupportedAudioError, "duration"),
        (err(400, "INVALID_REQUEST_ERROR", "Unsupported language_code"), GnaniUnsupportedLanguageError, "language"),
        (err(422, "VALIDATION_ERROR", "missing field"), GnaniRequestError, "HTTP 422"),
    ],
)
def test_non_retryable_errors_fail_fast(wav: Path, response, expected, match):
    client, rec, sleeps = make([response, ok({"success": True, "transcript": "never"})])
    with pytest.raises(expected, match=match):
        client.transcribe(wav)
    assert len(rec.requests) == 1 and sleeps == []


def test_retries_rate_limit_and_server_errors(wav: Path):
    client, rec, sleeps = make([
        err(429, "RATE_LIMIT_ERROR", "Rate limit exceeded"),
        err(503, "SERVICE_UNAVAILABLE", "temporarily unavailable"),
        ok({"success": True, "transcript": HINDI}),
    ])
    assert client.transcribe(wav).text == HINDI
    assert len(rec.requests) == 3 and sleeps == [1.0, 2.0]


def test_gives_up_with_last_error(wav: Path):
    client, rec, _ = make([err(429, "RATE_LIMIT_ERROR", "slow down")] * 2, attempts=2)
    with pytest.raises(GnaniRateLimitError, match="429"):
        client.transcribe(wav)
    assert len(rec.requests) == 2
    client, _, _ = make([err(500, "API_ERROR", "unexpected")], attempts=1)
    with pytest.raises(GnaniProviderError, match="500"):
        client.transcribe(wav)


def test_timeouts_and_network_errors(wav: Path):
    client, rec, _ = make([httpx.ReadTimeout("slow")] * 3)
    with pytest.raises(GnaniTimeoutError, match="timed out"):
        client.transcribe(wav)
    assert len(rec.requests) == 3
    client, _, _ = make([httpx.ConnectError("dns"), ok({"success": True, "transcript": HINDI})])
    assert client.transcribe(wav).text == HINDI


def test_api_key_never_in_errors_or_logs(wav: Path, caplog):
    client, _, _ = make([httpx.Response(400, text=f"bad key {SECRET}")])
    with caplog.at_level(logging.DEBUG), pytest.raises(GnaniRequestError) as info:
        client.transcribe(wav)
    assert SECRET not in str(info.value)
    assert SECRET not in caplog.text
