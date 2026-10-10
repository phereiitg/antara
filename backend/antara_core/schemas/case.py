"""Case-level contracts (``src/contracts.ts``: MediaRef, ItemStatus, ReviewReason, EvidenceFrame,
ItemResult, CaseState, ActionProposal, ReviewerTask, ClarificationRequest, CaseEvent,
AgentRunRecord, CaseRecord).

Wire format is camelCase (the TypeScript ``case.json``); Python attributes are snake_case.
Serialize with ``case_to_json`` / ``model_dump(mode="json", by_alias=True, exclude_none=True)``:
``exclude_none`` reproduces TypeScript optional fields, which are omitted rather than null.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, Literal

from pydantic import Field

from antara_core.schemas.base import AntaraModel, JsInt, JsNumber
from antara_core.schemas.findings import VisualCheck
from antara_core.schemas.transcript import Transcript


class MediaKind(StrEnum):
    VIDEO = "video"
    AUDIO = "audio"
    PHOTO = "photo"


class MediaRef(AntaraModel):
    id: str
    kind: MediaKind
    path: str
    sha256: str
    mime: str
    item_ids: list[JsInt] | None = None  # photos the user tagged to specific items


class ItemStatus(StrEnum):
    PASS = "PASS"
    FAIL = "FAIL"
    NOT_APPLICABLE = "NOT_APPLICABLE"
    NOT_INSPECTED = "NOT_INSPECTED"  # never discussed: not the same as "not applicable"
    RECORDED = "RECORDED"  # numeric value captured, no limit configured
    NEEDS_REVIEW = "NEEDS_REVIEW"


class ReviewReason(StrEnum):
    EXTRACTION_MISSING_ITEM = "EXTRACTION_MISSING_ITEM"
    UNCLEAR_ANSWER = "UNCLEAR_ANSWER"
    CONFLICTING_STATEMENTS = "CONFLICTING_STATEMENTS"
    QUOTE_NOT_IN_TRANSCRIPT = "QUOTE_NOT_IN_TRANSCRIPT"
    VERIFIER_DISAGREES = "VERIFIER_DISAGREES"
    VERIFIER_UNAVAILABLE = "VERIFIER_UNAVAILABLE"
    MISSING_DATE = "MISSING_DATE"
    MISSING_VALUE = "MISSING_VALUE"
    UNPARSEABLE_VALUE = "UNPARSEABLE_VALUE"
    FINDING_TYPE_MISMATCH = "FINDING_TYPE_MISMATCH"
    VISUAL_DISAGREES = "VISUAL_DISAGREES"


class EvidenceFrame(AntaraModel):
    path: str
    clip_id: str | None = None
    timestamp: JsNumber
    sha256: str


class QuoteWindow(AntaraModel):
    """Where a grounded quote sits in the transcript. Only built from provider timings."""

    clip_id: str | None = None
    start: JsNumber
    end: JsNumber


class ItemResult(AntaraModel):
    item_id: JsInt
    question: str
    status: ItemStatus
    proposed_status: ItemStatus | None = None  # what extraction suggested before review flags
    reasons: list[ReviewReason]
    quote: str
    quote_window: QuoteWindow | None = None
    date: str | None = None
    value: str | None = None
    note: str | None = None
    frames: list[EvidenceFrame]
    visual: VisualCheck | None = None


class CaseState(StrEnum):
    DRAFT = "DRAFT"
    PROCESSING = "PROCESSING"
    AGENT_RUNNING = "AGENT_RUNNING"
    PENDING_REVIEW = "PENDING_REVIEW"
    REVIEWED = "REVIEWED"
    SUBMITTED_TO_MOCK_SYSTEM = "SUBMITTED_TO_MOCK_SYSTEM"
    CLOSED = "CLOSED"
    ERROR = "ERROR"


ProposalStatus = Literal["PENDING", "APPROVED", "REJECTED"]
Priority = Literal["low", "normal", "high"]


class ProposalReview(AntaraModel):
    reviewer: str
    reason: str
    at: str


class ActionProposal(AntaraModel):
    id: str
    action_type: str
    item_ids: list[JsInt]
    rationale: str
    priority: Priority
    proposed_by: Literal["agent", "system"]
    status: ProposalStatus
    review: ProposalReview | None = None
    mock_reference: str | None = None


class TaskResolution(AntaraModel):
    reviewer: str
    final_status: ItemStatus
    reason: str
    at: str


class ReviewerTask(AntaraModel):
    id: str
    item_ids: list[JsInt]
    reason: str
    severity: Priority
    created_by: Literal["agent", "system"]
    status: Literal["OPEN", "RESOLVED"]
    resolution: TaskResolution | None = None


class ClarificationRequest(AntaraModel):
    id: str
    item_ids: list[JsInt]
    question: str
    language: str
    created_by: Literal["agent"]


class CaseEvent(AntaraModel):
    at: str
    actor: str
    type: str
    detail: Any = None


class RejectedToolCall(AntaraModel):
    tool: str
    reason: str


class AgentRunRecord(AntaraModel):
    mode: Literal["cline", "skipped"]
    status: str
    iterations: JsInt | None = None
    error: str | None = None
    summary: str | None = None
    rejected_tool_calls: list[RejectedToolCall]


class CaseRecord(AntaraModel):
    id: str
    domain_id: str
    adapter_version: str
    checklist_id: str
    state: CaseState
    language: str
    created_at: str
    updated_at: str
    media: list[MediaRef]
    transcript: Transcript | None = None
    results: list[ItemResult]
    has_contradictions: bool
    proposals: list[ActionProposal]
    reviewer_tasks: list[ReviewerTask]
    clarifications: list[ClarificationRequest]
    agent_run: AgentRunRecord | None = None
    models: dict[str, str] = Field(default_factory=dict)  # which model produced which step
    events: list[CaseEvent]


def case_to_json(record: CaseRecord) -> dict[str, Any]:
    """TypeScript-compatible JSON: camelCase keys, optional fields omitted rather than null.

    ``CaseEvent.detail`` is free-form and is serialized as-is (nulls inside it are kept).
    """
    data = record.model_dump(mode="json", by_alias=True, exclude_none=True)
    for event, raw in zip(data["events"], record.events, strict=True):
        if raw.detail is not None:
            event["detail"] = _jsonable(raw.detail)
    return data


def _jsonable(value: Any) -> Any:
    from pydantic import TypeAdapter

    return TypeAdapter(Any).dump_python(value, mode="json")
