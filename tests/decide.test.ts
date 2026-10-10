import { describe, expect, it } from "vitest";
import type { ChecklistItem, ItemFinding } from "../src/contracts";
import { decideItem, parseNumber } from "../src/engine/decide";
import type { QuoteMatch } from "../src/engine/grounding";

const passFail: ChecklistItem = { id: 1, question: "Is the seal unbroken?", passCondition: "The seal is unbroken", responseType: "pass_fail_na" };
const dated: ChecklistItem = { ...passFail, id: 2, responseType: "pass_fail_na_date" };
const numeric: ChecklistItem = { id: 3, question: "Reading?", passCondition: "Reading at or below limit", responseType: "numeric", max: 1.0 };
const recordOnly: ChecklistItem = { id: 4, question: "Distance?", passCondition: "Distance stated", responseType: "numeric", unit: "ft" };

const grounded: QuoteMatch = { grounded: true, approximate: false, score: 1, clipId: "video-1", start: 3, end: 6 };
const finding = (over: Partial<ItemFinding>): ItemFinding => ({
  item_id: 1, finding: "meets", conflicting_statements: false, quote: "the seal is fine", date: "", numeric_value: "", note: "", ...over,
});
const ok = { supported: true, note: "" };

describe("decideItem: fixes for pipeline.py robust_decision()", () => {
  it("ambiguous answer -> NEEDS_REVIEW, not N/A", () => {
    const r = decideItem({ item: passFail, finding: finding({ finding: "unclear" }), match: grounded });
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(r.reasons).toContain("UNCLEAR_ANSWER");
  });

  it("never mentioned -> NOT_INSPECTED, not N/A", () => {
    const r = decideItem({ item: passFail, finding: finding({ finding: "not_mentioned", quote: "" }) });
    expect(r.status).toBe("NOT_INSPECTED");
  });

  it("item missing from extraction output -> NEEDS_REVIEW", () => {
    expect(decideItem({ item: passFail }).reasons).toEqual(["EXTRACTION_MISSING_ITEM"]);
  });

  it("contradictions now change the item status", () => {
    const r = decideItem({ item: passFail, finding: finding({ finding: "does_not_meet", conflicting_statements: true }), match: grounded, verification: ok });
    expect(r).toMatchObject({ status: "NEEDS_REVIEW", proposedStatus: "FAIL", reasons: ["CONFLICTING_STATEMENTS"] });
  });
});

describe("decideItem: evidence checks", () => {
  it("clean grounded and verified finding keeps its status and time window", () => {
    const r = decideItem({ item: passFail, finding: finding({}), match: grounded, verification: ok });
    expect(r).toMatchObject({ status: "PASS", reasons: [], quoteWindow: { clipId: "video-1", start: 3, end: 6 } });
  });

  it("quote not found in transcript -> review", () => {
    const r = decideItem({ item: passFail, finding: finding({}), match: { grounded: false, approximate: false, score: 0 }, verification: ok });
    expect(r.reasons).toEqual(["QUOTE_NOT_IN_TRANSCRIPT"]);
  });

  it("verifier disagreement or outage -> review", () => {
    expect(decideItem({ item: passFail, finding: finding({}), match: grounded, verification: { supported: false, note: "" } }).reasons).toEqual(["VERIFIER_DISAGREES"]);
    expect(decideItem({ item: passFail, finding: finding({}), match: grounded, verification: "unavailable" }).reasons).toEqual(["VERIFIER_UNAVAILABLE"]);
  });

  it("vision contradicting the spoken finding -> review; cannot_tell does not", () => {
    const visual = (assessment: "inconsistent" | "cannot_tell") => ({ item_visible: true, assessment, observations: [] });
    expect(decideItem({ item: passFail, finding: finding({}), match: grounded, verification: ok, visual: visual("inconsistent") }).reasons).toEqual(["VISUAL_DISAGREES"]);
    expect(decideItem({ item: passFail, finding: finding({}), match: grounded, verification: ok, visual: visual("cannot_tell") }).status).toBe("PASS");
  });

  it("PASS on a dated item needs the date", () => {
    expect(decideItem({ item: dated, finding: finding({ item_id: 2 }), match: grounded, verification: ok }).reasons).toEqual(["MISSING_DATE"]);
    expect(decideItem({ item: dated, finding: finding({ item_id: 2, date: "March 2026" }), match: grounded, verification: ok }).status).toBe("PASS");
  });
});

describe("decideItem: numeric items", () => {
  const value = (v: string, item = numeric) =>
    decideItem({ item, finding: finding({ item_id: item.id, finding: "value_reported", numeric_value: v }), match: grounded, verification: ok });

  it("applies configured limits", () => {
    expect(value("0.8 units").status).toBe("PASS");
    expect(value("1.5").status).toBe("FAIL");
  });

  it("reads Devanagari digits", () => {
    expect(parseNumber("१.५ यूनिट")).toBe(1.5);
    expect(value("१.५").status).toBe("FAIL");
  });

  it("records the value when no limit is configured (the hydrant 'Distance' item)", () => {
    expect(value("about fifty feet", recordOnly)).toMatchObject({ status: "RECORDED", value: "about fifty feet" });
  });

  it("missing or unparseable values go to review", () => {
    expect(value("").reasons).toEqual(["MISSING_VALUE"]);
    expect(value("roughly one").reasons).toEqual(["UNPARSEABLE_VALUE"]);
  });

  it("pass/fail finding on a numeric item is a type mismatch", () => {
    const r = decideItem({ item: numeric, finding: finding({ item_id: 3, finding: "meets" }), match: grounded, verification: ok });
    expect(r.reasons).toEqual(["FINDING_TYPE_MISMATCH"]);
  });
});
