"""Contract validation rules: required fields, enums, Zod-equivalent strictness."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from antara_core.schemas import (
    ActionProposal,
    Checklist,
    ChecklistItem,
    ExtractionResult,
    Finding,
    ItemFinding,
    ItemResult,
    ItemStatus,
    ResponseType,
    Transcript,
    VerificationResult,
    VisualCheck,
)


def finding(**over) -> dict:
    base = {"item_id": 1, "finding": "meets", "conflicting_statements": False, "quote": "q",
            "date": "", "numeric_value": "", "note": ""}
    return base | over


def test_checklist_item_rules():
    item = ChecklistItem.model_validate({"id": 3, "question": "Reading?", "passCondition": "At or below limit",
                                         "responseType": "numeric", "max": 1.0})
    assert item.response_type is ResponseType.NUMERIC and item.max == 1.0 and item.min is None
    assert ChecklistItem(id=1, question="q", pass_condition="p", response_type="pass_fail_na").code is None
    for bad in ({"id": 0}, {"id": 1.5}, {"id": "1"}, {"question": ""}, {"passCondition": ""},
                {"responseType": "yes_no"}, {"max": "1.0"}):
        payload = {"id": 1, "question": "q", "passCondition": "p", "responseType": "pass_fail_na"} | bad
        with pytest.raises(ValidationError):
            ChecklistItem.model_validate(payload)
    with pytest.raises(ValidationError):
        Checklist(id="c", name="n", standard="s", items=[])  # z.array(...).min(1)


def test_item_finding_requires_every_field():
    assert ItemFinding.model_validate(finding()).finding is Finding.MEETS
    with pytest.raises(ValidationError):
        ItemFinding.model_validate({k: v for k, v in finding().items() if k != "note"})
    with pytest.raises(ValidationError):
        ItemFinding.model_validate(finding(finding="probably"))
    with pytest.raises(ValidationError):
        ExtractionResult.model_validate({"items": [{"item_id": 1, "finding": "probably"}]})


@pytest.mark.parametrize("bad", [
    {"conflicting_statements": "false"},  # lax Pydantic would read "false" as False
    {"conflicting_statements": 0},
    {"item_id": "1"},
    {"item_id": True},
    {"item_id": 1.5},
    {"item_id": 2**53},  # outside the JS safe-integer range, rejected by Zod 4 .int()
])
def test_llm_output_is_not_coerced(bad):
    # Zod rejects these values; silently coercing an LLM's boolean could flip a decision.
    with pytest.raises(ValidationError):
        ItemFinding.model_validate(finding(**bad))


def test_integral_float_is_the_same_js_number():
    assert ItemFinding.model_validate(finding(item_id=2.0)).item_id == 2


def test_visual_check_and_verification():
    v = VisualCheck.model_validate({"item_visible": True, "assessment": "cannot_tell", "observations": []})
    assert v.assessment.value == "cannot_tell"
    with pytest.raises(ValidationError):
        VisualCheck.model_validate({"item_visible": True, "assessment": "unsure", "observations": []})
    with pytest.raises(ValidationError):
        VerificationResult.model_validate({"items": [{"item_id": 1, "supported": "yes", "note": ""}]})


def test_transcript_cannot_claim_timestamps_without_timings():
    with pytest.raises(ValidationError, match="timestamps_available"):
        Transcript(provider="x", language="hi-IN", segments=[{"text": "a"}], timestamps_available=True)
    with pytest.raises(ValidationError):
        Transcript(provider="x", language="hi-IN", segments=[{"text": "a", "start": -1, "end": 2}])


def test_item_result_and_proposal_literals():
    with pytest.raises(ValidationError):
        ItemResult(item_id=1, question="q", status="MAYBE", reasons=[], quote="", frames=[])
    with pytest.raises(ValidationError):
        ItemResult(item_id=1, question="q", status="PASS", reasons=["NOT_A_REASON"], quote="", frames=[])
    with pytest.raises(ValidationError):
        ActionProposal(id="p", action_type="a", item_ids=[1], rationale="r", priority="urgent",
                       proposed_by="agent", status="PENDING")


def test_assignment_is_validated():
    result = ItemResult(item_id=1, question="q", status="NEEDS_REVIEW", reasons=[], quote="", frames=[])
    result.status = ItemStatus.PASS
    with pytest.raises(ValidationError):
        result.status = "PASSED"
