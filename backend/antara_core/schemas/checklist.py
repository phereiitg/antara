"""Checklist contracts (``src/contracts.ts``: ResponseType, ChecklistItem, Checklist).

Domain-independent: a checklist is configuration. Numeric limits (``min``/``max``) come only from
the adapter configuration; the engine never infers thresholds.
"""

from __future__ import annotations

from enum import StrEnum

from pydantic import Field

from antara_core.schemas.base import AntaraModel, JsNumber, PositiveJsInt


class ResponseType(StrEnum):
    PASS_FAIL_NA = "pass_fail_na"
    PASS_FAIL_NA_DATE = "pass_fail_na_date"
    NUMERIC = "numeric"


class ChecklistItem(AntaraModel):
    id: PositiveJsInt
    question: str = Field(min_length=1)
    # Explicit pass condition, so PASS/FAIL never depends on the question's polarity.
    pass_condition: str = Field(min_length=1)
    code: str | None = None
    response_type: ResponseType
    # Numeric items: optional deterministic limits. With no limits the value is only RECORDED.
    unit: str | None = None
    max: JsNumber | None = None
    min: JsNumber | None = None


class Checklist(AntaraModel):
    id: str
    name: str
    standard: str
    items: list[ChecklistItem] = Field(min_length=1)
