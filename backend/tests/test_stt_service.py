"""POST /internal/stt/transcribe (offline: Gnani HTTP is mocked, no keys or network)."""

from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from antara_core.integrations.gnani_client import GnaniSTTClient
from antara_core.main import create_app
from antara_core.stt_service import MAX_UPLOAD_BYTES, get_client_factory
from tests.gnani_helpers import HINDI, SECRET, Recorder, err, make_wav, ok


def client_with(outcomes, monkeypatch, attempts: int = 1) -> tuple[TestClient, Recorder]:
    monkeypatch.setenv("GNANI_API_KEY", SECRET)
    rec = Recorder(outcomes)
    app = create_app()

    def factory(settings):
        return GnaniSTTClient(SECRET, default_language=settings.gnani_language, max_attempts=attempts,
                              http_client=httpx.Client(transport=httpx.MockTransport(rec)), sleep=lambda _: None)

    app.dependency_overrides[get_client_factory] = lambda: factory
    return TestClient(app), rec


def wav_bytes(tmp_path: Path, seconds: float = 1.0) -> bytes:
    return make_wav(tmp_path / "c.wav", seconds=seconds, rate=8000).read_bytes()


def test_transcribes_and_returns_untimed_transcript(tmp_path, monkeypatch):
    tc, rec = client_with([ok({"success": True, "request_id": "r1", "transcript": HINDI, "model": "m"})], monkeypatch)
    r = tc.post("/internal/stt/transcribe", files={"audio": ("clip.wav", wav_bytes(tmp_path), "audio/wav")},
                data={"language": "hi-IN"})
    assert r.status_code == 200, r.text
    # camelCase wire format, the same as the TypeScript Transcript contract. No timings exist,
    # so start/end are null rather than invented.
    assert r.json() == {
        "language": "hi-IN", "provider": "gnani",
        "segments": [{"text": HINDI, "start": None, "end": None, "clipId": None}],
        "timestampsApproximate": False, "timestampsAvailable": False, "text": HINDI,
        "requestId": "r1", "model": "m",
    }
    assert rec.requests[0].headers["X-API-Key-ID"] == SECRET  # key added server-side only
    assert SECRET not in r.text


def test_default_language_comes_from_settings(tmp_path, monkeypatch):
    monkeypatch.setenv("GNANI_LANGUAGE", "ta-IN")
    tc, rec = client_with([ok({"success": True, "transcript": "வணக்கம்"})], monkeypatch)
    r = tc.post("/internal/stt/transcribe", files={"audio": ("clip.wav", wav_bytes(tmp_path), "audio/wav")})
    assert r.status_code == 200 and r.json()["language"] == "ta-IN"
    assert b'name="language_code"\r\n\r\nta-IN' in rec.requests[0].read()


@pytest.mark.parametrize(("files", "status", "code"), [
    (None, 400, "missing_audio"),
    ({"audio": ("clip.mp4", b"x", "video/mp4")}, 422, "unsupported_audio"),
    ({"audio": ("clip.wav", b"", "audio/wav")}, 422, "unsupported_audio"),
])
def test_input_validation_without_calling_gnani(files, status, code, monkeypatch):
    tc, rec = client_with([], monkeypatch)
    r = tc.post("/internal/stt/transcribe", files=files, data={"language": "hi-IN"} if files is None else None)
    assert r.status_code == status and r.json()["error"] == code
    assert rec.requests == []


def test_recording_over_60_seconds_is_rejected_locally(tmp_path, monkeypatch):
    tc, rec = client_with([], monkeypatch)
    r = tc.post("/internal/stt/transcribe", files={"audio": ("long.wav", wav_bytes(tmp_path, 61), "audio/wav")})
    assert r.status_code == 422 and r.json()["error"] == "unsupported_audio"
    assert "at most 60s" in r.json()["message"] and rec.requests == []


def test_upload_size_limit(monkeypatch):
    tc, _ = client_with([], monkeypatch)
    big = b"\x00" * (MAX_UPLOAD_BYTES + 1)
    r = tc.post("/internal/stt/transcribe", files={"audio": ("big.wav", big, "audio/wav")})
    assert r.status_code == 413 and r.json()["error"] == "audio_too_large"


def test_unsupported_language(tmp_path, monkeypatch):
    tc, rec = client_with([], monkeypatch)
    r = tc.post("/internal/stt/transcribe", files={"audio": ("c.wav", wav_bytes(tmp_path), "audio/wav")},
                data={"language": "fr-FR"})
    assert r.status_code == 422 and r.json()["error"] == "unsupported_language" and rec.requests == []


@pytest.mark.parametrize(("response", "status", "code"), [
    (err(401, "AUTHENTICATION_ERROR", "Invalid API key"), 502, "provider_auth_failed"),
    (err(403, "FORBIDDEN", "no credits"), 502, "provider_auth_failed"),
    (err(429, "RATE_LIMIT_ERROR", "slow down"), 503, "provider_rate_limited"),
    (err(500, "API_ERROR", "boom"), 502, "provider_error"),
    (ok({"success": True, "transcript": ""}), 422, "empty_transcript"),
])
def test_provider_errors_are_mapped(tmp_path, monkeypatch, response, status, code):
    tc, _ = client_with([response], monkeypatch)
    r = tc.post("/internal/stt/transcribe", files={"audio": ("c.wav", wav_bytes(tmp_path), "audio/wav")})
    assert r.status_code == status and r.json()["error"] == code
    assert SECRET not in r.text


def test_provider_timeout(tmp_path, monkeypatch):
    tc, _ = client_with([httpx.ReadTimeout("slow")], monkeypatch)
    r = tc.post("/internal/stt/transcribe", files={"audio": ("c.wav", wav_bytes(tmp_path), "audio/wav")})
    assert r.status_code == 504 and r.json()["error"] == "provider_timeout"


def test_missing_gnani_key_is_503(tmp_path):
    tc = TestClient(create_app())  # real factory, no GNANI_API_KEY in the isolated test env
    r = tc.post("/internal/stt/transcribe", files={"audio": ("c.wav", wav_bytes(tmp_path), "audio/wav")})
    assert r.status_code == 503 and r.json()["error"] == "stt_not_configured"


def test_non_loopback_clients_are_refused(tmp_path, monkeypatch):
    monkeypatch.setenv("GNANI_API_KEY", SECRET)
    remote = TestClient(create_app(), client=("203.0.113.7", 50000))
    r = remote.post("/internal/stt/transcribe", files={"audio": ("c.wav", wav_bytes(tmp_path), "audio/wav")})
    assert r.status_code == 403 and r.json()["error"] == "forbidden"
    local = TestClient(create_app(), client=("127.0.0.1", 50000))
    assert local.get("/health").status_code == 200
