"""Contracts vs TypeScript-generated data (src/contracts.ts parity).

``fixtures/ts_demo_case_reviewed.json`` was written by the TypeScript engine
(``npx tsx src/cli.ts demo`` then ``approve`` + ``resolve``), not by Python.
"""

from __future__ import annotations

import json
from pathlib import Path

from antara_core.schemas import (
    CaseRecord,
    CaseState,
    ExtractionResult,
    Finding,
    ItemStatus,
    ResponseType,
    ReviewReason,
    Segment,
    Transcript,
    VerificationResult,
    case_to_json,
    transcript_text,
)

FIXTURES = Path(__file__).parent / "fixtures"
REPO = Path(__file__).resolve().parents[2]


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_enum_values_match_typescript():
    assert [e.value for e in ResponseType] == ["pass_fail_na", "pass_fail_na_date", "numeric"]
    assert [e.value for e in Finding] == [
        "meets", "does_not_meet", "not_applicable", "value_reported", "unclear", "not_mentioned"]
    assert [e.value for e in ItemStatus] == [
        "PASS", "FAIL", "NOT_APPLICABLE", "NOT_INSPECTED", "RECORDED", "NEEDS_REVIEW"]
    assert [e.value for e in ReviewReason] == [
        "EXTRACTION_MISSING_ITEM", "UNCLEAR_ANSWER", "CONFLICTING_STATEMENTS", "QUOTE_NOT_IN_TRANSCRIPT",
        "VERIFIER_DISAGREES", "VERIFIER_UNAVAILABLE", "MISSING_DATE", "MISSING_VALUE",
        "UNPARSEABLE_VALUE", "FINDING_TYPE_MISMATCH", "VISUAL_DISAGREES"]
    assert [e.value for e in CaseState] == [
        "DRAFT", "PROCESSING", "AGENT_RUNNING", "PENDING_REVIEW", "REVIEWED",
        "SUBMITTED_TO_MOCK_SYSTEM", "CLOSED", "ERROR"]


def test_typescript_case_json_round_trips_without_loss():
    raw = load(FIXTURES / "ts_demo_case_reviewed.json")
    record = CaseRecord.model_validate(raw)
    assert record.state is CaseState.SUBMITTED_TO_MOCK_SYSTEM
    assert [(r.item_id, r.status.value) for r in record.results] == [
        (1, "PASS"), (2, "PASS"), (3, "NOT_INSPECTED"), (4, "NOT_INSPECTED"),
        (5, "NOT_INSPECTED"), (6, "FAIL"), (7, "FAIL"), (8, "NOT_INSPECTED")]
    assert record.results[3].reasons == [ReviewReason.CONFLICTING_STATEMENTS]
    assert record.results[3].proposed_status is ItemStatus.FAIL
    assert record.proposals[0].status == "APPROVED"
    assert record.proposals[0].review is not None and record.proposals[0].review.reviewer == "Fire Officer"
    assert record.proposals[0].mock_reference.startswith("MOCK-RECTIFICATION_NOTICE_DRAFT-")
    assert record.reviewer_tasks[0].resolution.final_status is ItemStatus.NOT_INSPECTED
    assert record.agent_run is not None and record.agent_run.status == "completed"
    assert record.transcript is not None and record.transcript.timestamps_approximate is False
    # Every TypeScript key and value is preserved (camelCase, optional fields omitted). The only
    # additions are the two derived Python transcript fields; Zod strips unknown keys when the
    # TypeScript engine reads the file back, so the output stays TypeScript-readable.
    out = case_to_json(record)
    added = out["transcript"].pop("timestampsAvailable"), out["transcript"].pop("text")
    assert added == (True, transcript_text(record.transcript))
    assert out == raw


def test_typescript_transcript_fixture_loads_with_real_timings():
    t = Transcript.model_validate(load(REPO / "fixtures/demo/fire-extinguisher.transcript.json"))
    assert len(t.segments) == 9 and t.segments[6].clip_id == "video-2"
    assert t.segments[6].start == 6.4 and t.segments[6].end == 12.9
    assert t.timestamps_available is True
    assert t.text == transcript_text(t) and t.text.startswith("Starting the extinguisher check")


def test_scripted_llm_fixture_matches_model_contracts():
    raw = load(REPO / "fixtures/demo/fire-extinguisher.scripted-llm.json")
    extraction = ExtractionResult.model_validate(raw["extraction"])
    assert [f.finding for f in extraction.items][:3] == [Finding.MEETS, Finding.MEETS, Finding.NOT_MENTIONED]
    assert extraction.items[5].quote.startswith("नेमप्लेट")
    assert len(VerificationResult.model_validate(raw["verification"]).items) == 6


def test_gnani_untimed_transcript_never_gets_timestamps():
    t = Transcript(provider="gnani", language="hi-IN", text="नमस्ते", segments=[Segment(text="नमस्ते")])
    assert t.timestamps_available is False
    assert t.segments[0].start is None and t.segments[0].end is None and not t.segments[0].timed


def test_phase1_transcript_dump_is_unchanged():
    # Phase 1 Gnani tests compare model_dump() output; the fields they set must dump as before.
    t = Transcript(provider="gnani", language="hi-IN", text="t", segments=[Segment(text="t")], request_id="r1")
    dumped = t.model_dump()
    assert dumped["request_id"] == "r1" and dumped["timestamps_available"] is False
    assert "timestampsApproximate" in t.model_dump(by_alias=True)
