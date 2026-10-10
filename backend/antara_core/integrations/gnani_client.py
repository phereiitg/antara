"""Gnani speech-to-text client (Gnani Speech APIs, REST ``POST /stt/v3``).

Protocol verified against the official documentation and the official Python SDK
(``gnani-vachana`` 0.8.1, ``gnani/stt/client.py``):

* Base URL ``https://api.vachana.ai``; endpoint ``POST /stt/v3`` (multipart/form-data).
* Auth: a single API key in the ``X-API-Key-ID`` header (no organisation/user id).
* Form fields: ``audio_file`` (file), ``language_code`` (required), ``format``
  (``verbatim`` | ``transcribe``), ``itn_native_numerals`` (bool).
* Optional ``X-API-Request-ID`` header for tracing.
* Audio: WAV, MP3, OGG, FLAC, AAC, M4A; 8-44.1 kHz; max 60 s per request (ideal 30 s).
* Response: ``{"success": true, "request_id", "transcript", "timestamp", "model"}``.
  ``timestamp`` is the *request* time, not word/segment timing, so the REST API provides no
  timestamps and none are produced here.

Longer recordings need the Batch API (``/stt/v3/batch/jobs``), which is out of scope for Phase 1.
"""

from __future__ import annotations

import logging
import time
import uuid
import wave
from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

import httpx
from pydantic import BaseModel, Field

from antara_core.config import ConfigError, Settings, redact
from antara_core.schemas import Transcript, TranscriptSegment

logger = logging.getLogger(__name__)

STT_PATH = "/stt/v3"
MAX_DURATION_SECONDS = 60.0
SUPPORTED_LANGUAGES: dict[str, str] = {
    "bn-IN": "Bengali",
    "en-IN": "English (India)",
    "gu-IN": "Gujarati",
    "hi-IN": "Hindi",
    "kn-IN": "Kannada",
    "ml-IN": "Malayalam",
    "mr-IN": "Marathi",
    "pa-IN": "Punjabi",
    "ta-IN": "Tamil",
    "te-IN": "Telugu",
}
AUDIO_MIME_TYPES: dict[str, str] = {
    ".wav": "audio/wav",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
}
# ITN (format="transcribe") is documented for these languages only.
ITN_LANGUAGES = frozenset({"hi-IN", "en-IN"})
RETRYABLE_STATUS = frozenset({429, 500, 502, 503, 504})


class GnaniError(RuntimeError):
    retryable = False


class GnaniAuthError(GnaniError):
    """401/403: invalid key, inactive organisation or no credits."""


class GnaniUnsupportedLanguageError(GnaniError):
    pass


class GnaniUnsupportedAudioError(GnaniError):
    """Missing/empty file, unsupported extension, or audio longer than the REST limit."""


class GnaniRequestError(GnaniError):
    """400/422: the provider rejected the request."""


class GnaniRateLimitError(GnaniError):
    retryable = True


class GnaniProviderError(GnaniError):
    """5xx or a malformed provider response."""

    retryable = True


class GnaniTimeoutError(GnaniError):
    retryable = True


class GnaniEmptyTranscriptError(GnaniError):
    """The provider succeeded but returned no text (silence, noise, or wrong language)."""


class GnaniTranscriptionOptions(BaseModel):
    """Optional per-request settings exposed by the documented REST API."""

    format: Literal["verbatim", "transcribe"] = "verbatim"
    itn_native_numerals: bool = False
    request_id: str | None = Field(default=None, max_length=128)
    allow_empty: bool = False  # return an empty transcript instead of raising


def wav_duration_seconds(path: Path) -> float | None:
    """Duration of a PCM WAV file, or None if it cannot be read by the stdlib ``wave`` module.

    Streamed WAVs often carry a placeholder frame count (0xFFFFFFFF) in the header, so the
    header value is capped by the number of frames the file can actually hold.
    """
    try:
        with wave.open(str(path), "rb") as w:
            rate = w.getframerate()
            frame_bytes = w.getsampwidth() * w.getnchannels()
            if not rate or not frame_bytes:
                return None
            frames_in_file = path.stat().st_size // frame_bytes
            return min(w.getnframes(), frames_in_file) / rate
    except (wave.Error, EOFError, OSError):
        return None


class GnaniSTTClient:
    provider = "gnani"

    def __init__(
        self,
        api_key: str,
        *,
        base_url: str = "https://api.vachana.ai",
        default_language: str = "hi-IN",
        timeout_seconds: float = 60.0,
        max_attempts: int = 3,
        backoff_seconds: float = 1.0,
        http_client: httpx.Client | None = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        if not api_key or not api_key.strip():
            raise ConfigError("GNANI_API_KEY is not set.")
        if max_attempts < 1:
            raise ValueError("max_attempts must be >= 1")
        self._api_key = api_key.strip()
        self.base_url = base_url.rstrip("/")
        self.default_language = default_language
        self.max_attempts = max_attempts
        self._backoff = backoff_seconds
        self._sleep = sleep
        self._http = http_client or httpx.Client(timeout=httpx.Timeout(timeout_seconds, connect=10.0))

    @classmethod
    def from_settings(cls, settings: Settings, **kwargs: Any) -> GnaniSTTClient:
        return cls(
            settings.require_gnani_key(),
            base_url=settings.gnani_base_url,
            default_language=settings.gnani_language,
            timeout_seconds=settings.gnani_timeout_seconds,
            max_attempts=settings.gnani_max_attempts,
            **kwargs,
        )

    def __repr__(self) -> str:  # never include the key
        return f"GnaniSTTClient(base_url={self.base_url!r}, default_language={self.default_language!r})"

    def close(self) -> None:
        self._http.close()

    # ------------------------------------------------------------------ public API
    def transcribe(
        self,
        audio_path: str | Path,
        language: str | None = None,
        options: GnaniTranscriptionOptions | None = None,
    ) -> Transcript:
        opts = options or GnaniTranscriptionOptions()
        lang = (language or self.default_language).strip()
        self._validate_language(lang, opts)
        path, mime = self._validate_audio(Path(audio_path))

        request_id = opts.request_id or f"antara-{uuid.uuid4()}"
        data: dict[str, str] = {"language_code": lang, "format": opts.format}
        if opts.itn_native_numerals:
            data["itn_native_numerals"] = "true"
        headers = {"X-API-Key-ID": self._api_key, "X-API-Request-ID": request_id}
        audio_bytes = path.read_bytes()

        logger.info("Gnani STT request %s: %s (%d bytes, %s)", request_id, path.name, len(audio_bytes), lang)
        body = self._post(headers, data, (path.name, audio_bytes, mime))
        return self._normalize(body, lang, request_id, opts.allow_empty)


    # ------------------------------------------------------------------ validation
    @staticmethod
    def _validate_language(lang: str, opts: GnaniTranscriptionOptions) -> None:
        if lang not in SUPPORTED_LANGUAGES:
            raise GnaniUnsupportedLanguageError(
                f"Language '{lang}' is not supported by Gnani STT REST. "
                f"Supported: {', '.join(sorted(SUPPORTED_LANGUAGES))}"
            )
        if opts.format == "transcribe" and lang not in ITN_LANGUAGES:
            raise GnaniUnsupportedLanguageError(
                f"format='transcribe' (ITN) is only documented for {', '.join(sorted(ITN_LANGUAGES))}; "
                f"use format='verbatim' for {lang}."
            )

    @staticmethod
    def _validate_audio(path: Path) -> tuple[Path, str]:
        if not path.is_file():
            raise GnaniUnsupportedAudioError(f"Audio file not found: {path}")
        mime = AUDIO_MIME_TYPES.get(path.suffix.lower())
        if mime is None:
            supported = ", ".join(sorted(AUDIO_MIME_TYPES))
            raise GnaniUnsupportedAudioError(f"Unsupported audio format '{path.suffix}'. Supported: {supported}")
        if path.stat().st_size == 0:
            raise GnaniUnsupportedAudioError(f"Audio file is empty: {path}")
        if path.suffix.lower() == ".wav":
            duration = wav_duration_seconds(path)
            if duration is not None and duration > MAX_DURATION_SECONDS:
                raise GnaniUnsupportedAudioError(
                    f"Audio is {duration:.1f}s; Gnani STT REST accepts at most {MAX_DURATION_SECONDS:.0f}s "
                    "(ideal 30s). Split the recording or use the Batch API."
                )
        return path, mime

    # ------------------------------------------------------------------ transport
    def _post(self, headers: dict[str, str], data: dict[str, str], file: tuple[str, bytes, str]) -> dict[str, Any]:
        url = f"{self.base_url}{STT_PATH}"
        last: GnaniError | None = None
        for attempt in range(1, self.max_attempts + 1):
            if attempt > 1:
                delay = self._backoff * 2 ** (attempt - 2)
                logger.warning(
                    "Gnani attempt %d/%d after %s; retrying in %.1fs",
                    attempt, self.max_attempts, type(last).__name__, delay,
                )
                self._sleep(delay)
            try:
                response = self._http.post(url, headers=headers, data=data, files={"audio_file": file})
            except httpx.TimeoutException:
                last = GnaniTimeoutError("Gnani STT request timed out (raise GNANI_TIMEOUT_SECONDS if needed).")
                continue
            except httpx.TransportError as exc:
                last = GnaniProviderError(f"Network error reaching Gnani: {type(exc).__name__}")
                continue
            if response.status_code == 200:
                try:
                    body = response.json()
                except ValueError:
                    raise GnaniProviderError("Gnani returned a non-JSON response.") from None
                if not isinstance(body, dict):
                    raise GnaniProviderError("Gnani returned an unexpected response shape.")
                return body
            last = self._map_status(response)
            if not last.retryable:
                raise last
        assert last is not None
        raise last

    def _map_status(self, response: httpx.Response) -> GnaniError:
        status = response.status_code
        message = redact(_error_message(response), [self._api_key])
        text = f"Gnani HTTP {status}: {message}"
        if status in (401, 403):
            return GnaniAuthError(f"{text}. Check GNANI_API_KEY, organisation status and credits.")
        if status == 429:
            return GnaniRateLimitError(text)
        if status >= 500:
            return GnaniProviderError(text)
        lowered = message.lower()
        if "language" in lowered:
            return GnaniUnsupportedLanguageError(text)
        if any(k in lowered for k in ("audio", "format", "duration", "sample rate")):
            return GnaniUnsupportedAudioError(text)
        return GnaniRequestError(text)


    # ------------------------------------------------------------------ normalisation
    def _normalize(self, body: dict[str, Any], lang: str, request_id: str, allow_empty: bool) -> Transcript:
        if body.get("success") is False:
            raise GnaniProviderError(f"Gnani reported failure: {redact(_body_message(body), [self._api_key])}")
        transcript = body.get("transcript")
        if transcript is not None and not isinstance(transcript, str):
            raise GnaniProviderError("Gnani response 'transcript' is not a string.")
        text = (transcript or "").strip()
        if not text and not allow_empty:
            raise GnaniEmptyTranscriptError(
                "Gnani returned an empty transcript (silence, noise, or a language mismatch?)."
            )
        model = body.get("model")
        return Transcript(
            provider=self.provider,
            language=lang,
            text=text,
            # The REST API returns one transcript with no timing: a single untimed segment.
            segments=[TranscriptSegment(text=text)] if text else [],
            timestamps_available=False,
            request_id=str(body.get("request_id") or request_id),
            model=model if isinstance(model, str) else None,
        )


def _body_message(body: dict[str, Any]) -> str:
    error = body.get("error")
    if isinstance(error, dict):
        return f"{error.get('type', 'ERROR')}: {error.get('message', '')}".strip()
    if isinstance(error, str):
        return error
    if body.get("detail"):
        return str(body["detail"])[:300]
    return str(body.get("message", "unknown error"))[:300]


def _error_message(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return response.text[:300] or response.reason_phrase
    return _body_message(body) if isinstance(body, dict) else str(body)[:300]

