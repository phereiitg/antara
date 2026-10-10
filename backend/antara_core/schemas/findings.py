"""Model-produced contracts (``src/contracts.ts``: Finding, ItemFinding, ExtractionResult,
VerificationResult, VisualAssessment, VisualCheck).

Wire keys are snake_case in TypeScript too, so these models use no aliases. A finding is an
*unverified LLM claim* until grounding and the deterministic decision rules accept it.
"""

from __future__ import annotations

from enum import StrEnum

from antara_core.schemas.base import JsBool, JsInt, LlmModel


class Finding(StrEnum):
    MEETS = "meets"
    DOES_NOT_MEET = "does_not_meet"
    NOT_APPLICABLE = "not_applicable"
    VALUE_REPORTED = "value_reported"
    UNCLEAR = "unclear"
    NOT_MENTIONED = "not_mentioned"


class ItemFinding(LlmModel):
    item_id: JsInt
    finding: Finding
    conflicting_statements: JsBool
    quote: str  # "" when nothing was said
    date: str  # "" when none
    numeric_value: str  # "" when none
    note: str


class ExtractionResult(LlmModel):
    items: list[ItemFinding]


class VerificationItem(LlmModel):
    item_id: JsInt
    supported: JsBool
    note: str


class VerificationResult(LlmModel):
    items: list[VerificationItem]


class VisualAssessment(StrEnum):
    CONSISTENT = "consistent"
    INCONSISTENT = "inconsistent"
    CANNOT_TELL = "cannot_tell"


class VisualCheck(LlmModel):
    item_visible: JsBool
    assessment: VisualAssessment
    observations: list[str]
