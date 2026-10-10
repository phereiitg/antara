"""Contract serialization: TypeScript-shaped JSON output and generated JSON schemas."""

from __future__ import annotations

from antara_core.schemas import (
    CaseRecord,
    Checklist,
    ExtractionResult,
    ItemResult,
    VerificationResult,
    VisualCheck,
    case_to_json,
)


def test_new_case_serializes_like_typescript_optional_fields():
    record = CaseRecord(
        id="c1", domain_id="d", adapter_version="1", checklist_id="k", state="DRAFT", language="hi-IN",
        created_at="t", updated_at="t", media=[], results=[ItemResult(
            item_id=1, question="q", status="NEEDS_REVIEW", reasons=["EXTRACTION_MISSING_ITEM"], quote="", frames=[])],
        has_contradictions=False, proposals=[], reviewer_tasks=[], clarifications=[], events=[],
    )
    data = case_to_json(record)
    assert set(data) == {"id", "domainId", "adapterVersion", "checklistId", "state", "language", "createdAt",
                         "updatedAt", "media", "results", "hasContradictions", "proposals", "reviewerTasks",
                         "clarifications", "models", "events"}
    assert data["results"][0] == {"itemId": 1, "question": "q", "status": "NEEDS_REVIEW",
                                  "reasons": ["EXTRACTION_MISSING_ITEM"], "quote": "", "frames": []}


def test_event_detail_keeps_nested_nulls():
    record = CaseRecord.model_validate({
        "id": "c", "domainId": "d", "adapterVersion": "1", "checklistId": "k", "state": "DRAFT",
        "language": "hi-IN", "createdAt": "t", "updatedAt": "t", "media": [], "results": [],
        "hasContradictions": False, "proposals": [], "reviewerTasks": [], "clarifications": [],
        "models": {}, "events": [{"at": "t", "actor": "agent", "type": "AGENT_FINISHED",
                                  "detail": {"status": "completed", "error": None}}],
    })
    assert case_to_json(record)["events"][0]["detail"] == {"status": "completed", "error": None}


def test_json_schemas_generate():
    for model in (CaseRecord, ExtractionResult, VerificationResult, VisualCheck, Checklist):
        schema = model.model_json_schema(by_alias=True)
        assert schema["type"] == "object" and schema["properties"]
    item = ExtractionResult.model_json_schema()["$defs"]["ItemFinding"]
    assert set(item["required"]) == {"item_id", "finding", "conflicting_statements", "quote", "date",
                                     "numeric_value", "note"}
    assert "hasContradictions" in CaseRecord.model_json_schema(by_alias=True)["properties"]
