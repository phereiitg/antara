"""Gnani client: request format and response normalisation (offline, mocked HTTP)."""

from __future__ import annotations

import json
from pathlib import Path

import httpx
import pytest

from antara_core.config import ConfigError, load_settings
from antara_core.integrations.gnani_client import (
    GnaniEmptyTranscriptError,
    GnaniProviderError,
    GnaniSTTClient,
    GnaniTranscriptionOptions,
    GnaniUnsupportedAudioError,
    GnaniUnsupportedLanguageError,
    wav_duration_seconds,
)
from tests.gnani_helpers import HINDI, SECRET, Recorder, make, make_wav, ok


@pytest.fixture
def wav(tmp_path: Path) -> Path:
    return make_wav(tmp_path / "clip.wav")


def test_requires_api_key():
    with pytest.raises(ConfigError, match="GNANI_API_KEY"):
        GnaniSTTClient("  ")
    with pytest.raises(ConfigError, match="GNANI_API_KEY is not set"):
        GnaniSTTClient.from_settings(load_settings())


def test_repr_hides_key():
    client, _, _ = make([])
    assert SECRET not in repr(client)


def test_request_matches_documented_protocol(wav: Path):
    client, rec, _ = make([ok({"success": True, "request_id": "req_1", "transcript": HINDI})])
    client.transcribe(wav, "hi-IN", GnaniTranscriptionOptions(request_id="trace-1"))
    req = rec.requests[0]
    assert req.method == "POST"
    assert str(req.url) == "https://api.vachana.ai/stt/v3"
    assert req.headers["X-API-Key-ID"] == SECRET
    assert req.headers["X-API-Request-ID"] == "trace-1"
    assert req.headers["content-type"].startswith("multipart/form-data")
    body = req.read()
    assert b'name="audio_file"; filename="clip.wav"' in body
    assert b'name="language_code"\r\n\r\nhi-IN' in body
    assert b'name="format"\r\n\r\nverbatim' in body
    assert b"itn_native_numerals" not in body


def test_itn_options_are_sent(wav: Path):
    client, rec, _ = make([ok({"success": True, "transcript": "₹५,०००"})])
    client.transcribe(wav, "hi-IN", GnaniTranscriptionOptions(format="transcribe", itn_native_numerals=True))
    body = rec.requests[0].read()
    assert b'name="format"\r\n\r\ntranscribe' in body
    assert b'name="itn_native_numerals"\r\n\r\ntrue' in body


def test_default_language_comes_from_settings(monkeypatch, wav: Path):
    monkeypatch.setenv("GNANI_API_KEY", SECRET)
    monkeypatch.setenv("GNANI_LANGUAGE", "ta-IN")
    rec = Recorder([ok({"success": True, "transcript": "வணக்கம்"})])
    client = GnaniSTTClient.from_settings(load_settings(), http_client=httpx.Client(transport=httpx.MockTransport(rec)))
    assert client.transcribe(wav).language == "ta-IN"
    assert b'name="language_code"\r\n\r\nta-IN' in rec.requests[0].read()


def test_normalized_response_has_no_fabricated_timestamps(wav: Path):
    body = {"success": True, "request_id": "req_abc123", "timestamp": "20251226_143052.123",
            "transcript": f"  {HINDI} ", "model": "gnani-prisma-v2.5"}
    client, _, _ = make([ok(body)])
    result = client.transcribe(wav, "hi-IN")
    # Phase 2A merged Transcript with src/contracts.ts: clip_id and timestamps_approximate were
    # added (both empty/false here). All Phase 1 fields and values are unchanged.
    assert result.model_dump() == {
        "provider": "gnani",
        "language": "hi-IN",
        "text": HINDI,
        "segments": [{"text": HINDI, "start": None, "end": None, "clip_id": None}],
        "timestamps_approximate": False,
        "timestamps_available": False,
        "request_id": "req_abc123",
        "model": "gnani-prisma-v2.5",
    }
    assert HINDI in json.dumps(result.model_dump(), ensure_ascii=False)


def test_empty_transcript_raises_or_is_allowed(wav: Path):
    client, _, _ = make([ok({"success": True, "transcript": "  "})])
    with pytest.raises(GnaniEmptyTranscriptError):
        client.transcribe(wav)
    client, _, _ = make([ok({"success": True, "transcript": ""})])
    result = client.transcribe(wav, options=GnaniTranscriptionOptions(allow_empty=True))
    assert result.text == "" and result.segments == []


def test_success_false_in_200_body_is_provider_error(wav: Path):
    client, _, _ = make([ok({"success": False, "error": {"type": "API_ERROR", "message": "oops"}})])
    with pytest.raises(GnaniProviderError, match="API_ERROR: oops"):
        client.transcribe(wav)


@pytest.mark.parametrize("bad", [
    httpx.Response(200, text="<html>"),
    httpx.Response(200, json=["x"]),
    httpx.Response(200, json={"success": True, "transcript": 5}),
])
def test_malformed_success_responses(wav: Path, bad):
    client, _, _ = make([bad])
    with pytest.raises(GnaniProviderError):
        client.transcribe(wav)


def test_unsupported_language_rejected_locally(wav: Path):
    client, rec, _ = make([])
    with pytest.raises(GnaniUnsupportedLanguageError, match="hi-IN"):
        client.transcribe(wav, "fr-FR")
    with pytest.raises(GnaniUnsupportedLanguageError, match="verbatim"):
        client.transcribe(wav, "ta-IN", GnaniTranscriptionOptions(format="transcribe"))
    assert rec.requests == []


def test_streamed_wav_with_placeholder_frame_count_is_accepted(tmp_path: Path):
    # Streamed WAV writers (including Gnani TTS) put 0xFFFFFFFF in the size fields.
    path = make_wav(tmp_path / "streamed.wav", seconds=2)
    raw = bytearray(path.read_bytes())
    raw[4:8] = b"\xff\xff\xff\xff"  # RIFF chunk size
    raw[40:44] = b"\xff\xff\xff\xff"  # data chunk size
    path.write_bytes(bytes(raw))
    assert wav_duration_seconds(path) == pytest.approx(2.0, abs=0.01)
    client, rec, _ = make([ok({"success": True, "transcript": HINDI})])
    assert client.transcribe(path).text == HINDI
    assert len(rec.requests) == 1


def test_unsupported_audio_rejected_locally(tmp_path: Path):
    client, rec, _ = make([])
    (tmp_path / "clip.mp4").write_bytes(b"x")
    (tmp_path / "empty.wav").write_bytes(b"")
    long_wav = make_wav(tmp_path / "long.wav", seconds=61, rate=8000)
    cases = [
        (tmp_path / "nope.wav", "not found"),
        (tmp_path / "clip.mp4", "Unsupported audio format"),
        (tmp_path / "empty.wav", "empty"),
        (long_wav, "at most 60s"),
    ]
    for path, match in cases:
        with pytest.raises(GnaniUnsupportedAudioError, match=match):
            client.transcribe(path)
    assert rec.requests == []
