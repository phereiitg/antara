"""Transcript contracts (``src/contracts.ts`` Segment/Transcript, merged with the Phase 1 model).

One model serves both sources:

* TypeScript/Gemini transcripts: timed segments (``start``/``end`` required in TS), optional
  ``clipId``, ``timestampsApproximate``.
* Gnani REST transcripts: one untimed segment, ``timestamps_available=False``.

``start``/``end`` are therefore optional here (TS requires them). They are never estimated:
``timestamps_available`` is True only when every segment carries real timings.
"""

from __future__ import annotations

from typing import Any

from pydantic import Field, model_validator

from antara_core.jscompat import js_trim
from antara_core.schemas.base import AntaraModel, JsBool, NonNegativeJsNumber


class Segment(AntaraModel):
    """A piece of transcript. Times are seconds relative to clip ``clip_id``, provider-supplied only."""

    text: str
    start: NonNegativeJsNumber | None = None
    end: NonNegativeJsNumber | None = None
    clip_id: str | None = None  # which media clip the times are relative to

    @property
    def timed(self) -> bool:
        return self.start is not None and self.end is not None


# Phase 1 name, kept so existing imports keep working.
TranscriptSegment = Segment


def _raw_has_timing(segment: Any) -> bool:
    if isinstance(segment, Segment):
        return segment.timed
    if isinstance(segment, dict):
        return segment.get("start") is not None and segment.get("end") is not None
    return False


def _raw_text(segment: Any) -> str:
    if isinstance(segment, Segment):
        return segment.text
    if isinstance(segment, dict) and isinstance(segment.get("text"), str):
        return segment["text"]
    return ""


class Transcript(AntaraModel):
    """Provider-independent speech-to-text result."""

    language: str
    provider: str
    segments: list[Segment] = Field(default_factory=list)
    # TS field: timings exist but are model-estimated (e.g. Gemini STT); default false as in Zod.
    timestamps_approximate: JsBool = False
    # Python field: every segment has provider-supplied start/end. Derived when absent.
    timestamps_available: JsBool = False
    # Python field: full text. Derived as TS transcriptText() when absent.
    text: str = ""
    request_id: str | None = None
    model: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _derive_fields(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data
        data = dict(data)
        segments = data.get("segments") or []
        if not isinstance(segments, list):
            return data  # let field validation report it
        if "timestamps_available" not in data and "timestampsAvailable" not in data:
            data["timestamps_available"] = bool(segments) and all(_raw_has_timing(s) for s in segments)
        if "text" not in data:
            data["text"] = " ".join(js_trim(_raw_text(s)) for s in segments)
        return data

    @model_validator(mode="after")
    def _timings_are_real(self) -> Transcript:
        if self.timestamps_available and not all(s.timed for s in self.segments):
            raise ValueError("timestamps_available is true but a segment has no start/end")
        return self


def transcript_text(transcript: Transcript) -> str:
    """Port of ``transcriptText()``: trimmed segment texts joined with single spaces."""
    return " ".join(js_trim(s.text) for s in transcript.segments)
