"""Shared Pydantic data contracts for the Python backend.

Phase 1 holds only the provider-facing contracts. The engine contracts from
``src/contracts.ts`` (checklists, findings, item results, cases) move here in Phase 2.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class TranscriptSegment(BaseModel):
    """A piece of transcript. ``start``/``end`` are seconds and are only set when the provider
    actually returned timings; they are never estimated."""

    text: str
    start: float | None = None
    end: float | None = None


class Transcript(BaseModel):
    """Provider-independent speech-to-text result."""

    provider: str
    language: str
    text: str
    segments: list[TranscriptSegment] = Field(default_factory=list)
    timestamps_available: bool = False
    request_id: str | None = None
    model: str | None = None


class VisionObservation(BaseModel):
    """General, grounded description of one image. No domain verdicts in Phase 1."""

    summary: str
    observations: list[str] = Field(default_factory=list)
    visible_text: list[str] = Field(default_factory=list)
    image_quality: Literal["good", "limited", "unusable"]
    model: str | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    version: str
    environment: str


class ProviderStatus(BaseModel):
    provider: str
    role: str
    selected: bool
    configured: bool
    details: dict[str, str | bool | list[str]] = Field(default_factory=dict)


class ProvidersHealthResponse(BaseModel):
    status: Literal["ok", "degraded"]
    missing_configuration: list[str]
    providers: list[ProviderStatus]
    note: str
