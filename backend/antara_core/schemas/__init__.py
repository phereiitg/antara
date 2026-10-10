"""Shared Pydantic data contracts for the Python backend.

Engine contracts are ported from ``src/contracts.ts`` (Phase 2A) and live in submodules:
``transcript``, ``checklist``, ``findings``, ``case``, ``adapter``. They are re-exported here.
Provider/health response models from Phase 1 are defined below.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from antara_core.schemas.adapter import ActionTypeSpec, DomainAdapter, get_checklist
from antara_core.schemas.case import (
    ActionProposal,
    AgentRunRecord,
    CaseEvent,
    CaseRecord,
    CaseState,
    ClarificationRequest,
    EvidenceFrame,
    ItemResult,
    ItemStatus,
    MediaKind,
    MediaRef,
    Priority,
    ProposalReview,
    ProposalStatus,
    QuoteWindow,
    RejectedToolCall,
    ReviewerTask,
    ReviewReason,
    TaskResolution,
    case_to_json,
)
from antara_core.schemas.checklist import Checklist, ChecklistItem, ResponseType
from antara_core.schemas.findings import (
    ExtractionResult,
    Finding,
    ItemFinding,
    VerificationItem,
    VerificationResult,
    VisualAssessment,
    VisualCheck,
)
from antara_core.schemas.transcript import Segment, Transcript, TranscriptSegment, transcript_text

__all__ = [
    "ActionProposal", "ActionTypeSpec", "AgentRunRecord", "CaseEvent", "CaseRecord", "CaseState",
    "Checklist", "ChecklistItem", "ClarificationRequest", "DomainAdapter", "EvidenceFrame",
    "ExtractionResult", "Finding", "HealthResponse", "ItemFinding", "ItemResult", "ItemStatus",
    "MediaKind", "MediaRef", "Priority", "ProposalReview", "ProposalStatus", "ProviderStatus",
    "ProvidersHealthResponse", "QuoteWindow", "RejectedToolCall", "ResponseType", "ReviewReason",
    "ReviewerTask", "Segment", "TaskResolution", "Transcript", "TranscriptSegment",
    "VerificationItem", "VerificationResult", "VisionObservation", "VisualAssessment",
    "VisualCheck", "case_to_json", "get_checklist", "transcript_text",
]


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
