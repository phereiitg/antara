"""Internal speech-to-text endpoint for the TypeScript engine (hackathon architecture).

    POST /internal/stt/transcribe   multipart: audio (file), language (optional, default GNANI_LANGUAGE)

The TypeScript ``GnaniStt`` adapter calls this; the Gnani API key never leaves this process.
Access is restricted to loopback clients: the service is meant to run on 127.0.0.1 next to the
TypeScript engine and has no authentication of its own.

Gnani REST limits apply: at most 60 s of audio per request, and no speech timestamps are
returned, so the transcript is one untimed segment (``timestamps_available=false``).
"""

from __future__ import annotations

import ipaddress
import logging
import tempfile
from collections.abc import Callable
from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from antara_core.config import ConfigError, Settings, get_settings
from antara_core.integrations.gnani_client import (
    AUDIO_MIME_TYPES,
    GnaniAuthError,
    GnaniEmptyTranscriptError,
    GnaniError,
    GnaniRateLimitError,
    GnaniRequestError,
    GnaniSTTClient,
    GnaniTimeoutError,
    GnaniTranscriptionOptions,
    GnaniUnsupportedAudioError,
    GnaniUnsupportedLanguageError,
)
from antara_core.schemas import Transcript

logger = logging.getLogger(__name__)

# 60 s of uncompressed 44.1 kHz 16-bit stereo WAV is ~10.6 MB; 15 MB covers every accepted format.
MAX_UPLOAD_BYTES = 15 * 1024 * 1024


class SttErrorBody(BaseModel):
    error: str
    message: str


def require_loopback(request: Request) -> None:
    """Reject non-local callers. ``testclient`` is Starlette's in-process test transport."""
    host = request.client.host if request.client else ""
    if host == "testclient":
        return
    try:
        if ipaddress.ip_address(host).is_loopback:
            return
    except ValueError:
        pass
    raise HTTPException(status_code=403, detail={"error": "forbidden", "message": "Internal endpoint: loopback clients only."})


def default_client_factory(settings: Settings) -> GnaniSTTClient:
    return GnaniSTTClient.from_settings(settings)


def get_client_factory() -> Callable[[Settings], GnaniSTTClient]:
    """Dependency hook so tests can substitute a client backed by a mocked transport."""
    return default_client_factory


def _fail(status: int, error: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"error": error, "message": message})


# (exception type, HTTP status, error code). Order matters: subclasses before GnaniError.
_ERROR_MAP: list[tuple[type[GnaniError], int, str]] = [
    (GnaniUnsupportedAudioError, 422, "unsupported_audio"),
    (GnaniUnsupportedLanguageError, 422, "unsupported_language"),
    (GnaniEmptyTranscriptError, 422, "empty_transcript"),
    (GnaniRequestError, 422, "provider_rejected_request"),
    (GnaniAuthError, 502, "provider_auth_failed"),
    (GnaniRateLimitError, 503, "provider_rate_limited"),
    (GnaniTimeoutError, 504, "provider_timeout"),
    (GnaniError, 502, "provider_error"),
]

router = APIRouter(prefix="/internal/stt", tags=["internal"], dependencies=[Depends(require_loopback)])


@router.post(
    "/transcribe",
    response_model=Transcript,
    responses={code: {"model": SttErrorBody} for code in (400, 403, 413, 422, 502, 503, 504)},
)
async def transcribe(
    audio: UploadFile | None = File(default=None),
    language: str | None = Form(default=None),
    settings: Settings = Depends(get_settings),
    client_factory: Callable[[Settings], GnaniSTTClient] = Depends(get_client_factory),
) -> Transcript:
    if audio is None or not audio.filename:
        raise _fail(400, "missing_audio", "Send the recording as multipart field 'audio'.")
    suffix = Path(audio.filename).suffix.lower()
    if suffix not in AUDIO_MIME_TYPES:
        supported = ", ".join(sorted(AUDIO_MIME_TYPES))
        raise _fail(422, "unsupported_audio", f"Unsupported audio format '{suffix or audio.filename}'. Supported: {supported}")

    data = await audio.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise _fail(413, "audio_too_large", f"Upload exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    if not data:
        raise _fail(422, "unsupported_audio", "Audio file is empty.")

    try:
        client = client_factory(settings)
    except ConfigError as exc:
        raise _fail(503, "stt_not_configured", str(exc)) from None

    # Gnani's client validates by path (extension, WAV duration); write to a private temp file.
    with tempfile.TemporaryDirectory(prefix="antara-stt-") as tmp:
        path = Path(tmp) / f"upload{suffix}"
        path.write_bytes(data)
        try:
            # The Gnani client is synchronous (blocking httpx); keep it off the event loop.
            return await run_in_threadpool(
                client.transcribe, path, language or None, GnaniTranscriptionOptions()
            )
        except GnaniError as exc:
            for exc_type, status, code in _ERROR_MAP:
                if isinstance(exc, exc_type):
                    logger.warning("STT request failed: %s (%s)", code, type(exc).__name__)
                    raise _fail(status, code, str(exc)) from None
            raise
        finally:
            client.close()
