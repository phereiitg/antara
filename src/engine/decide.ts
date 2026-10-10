import type { ChecklistItem, ItemFinding, ItemResult, ItemStatus, ReviewReason, VisualCheck } from "../contracts";
import type { QuoteMatch } from "./grounding";

// Replaces pipeline.py robust_decision(). Fixes:
// - ambiguous (null) answers became "N/A" with no flag      -> UNCLEAR_ANSWER, NEEDS_REVIEW
// - items never mentioned became "N/A"                        -> NOT_INSPECTED
// - items the model dropped became "N/A"                      -> EXTRACTION_MISSING_ITEM, NEEDS_REVIEW
// - contradictions were printed and ignored                   -> CONFLICTING_STATEMENTS, NEEDS_REVIEW
// - routing used the model's self-reported confidence (0.85)  -> checkable signals only

export type Verification = { supported: boolean; note: string } | "unavailable";

export interface DecisionInput {
  item: ChecklistItem;
  finding?: ItemFinding;
  match?: QuoteMatch;
  verification?: Verification;
  visual?: VisualCheck;
}

const DEVANAGARI_DIGITS = /[०-९]/g;

export function parseNumber(value: string): number | undefined {
  const ascii = value.replace(DEVANAGARI_DIGITS, (d) => String(d.charCodeAt(0) - 0x0966));
  const m = ascii.match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : undefined;
}

function numericStatus(item: ChecklistItem, value: string, reasons: ReviewReason[]): ItemStatus | undefined {
  if (!value.trim()) {
    reasons.push("MISSING_VALUE");
    return undefined;
  }
  const hasLimits = item.max !== undefined || item.min !== undefined;
  if (!hasLimits) return "RECORDED";
  const n = parseNumber(value);
  if (n === undefined) {
    reasons.push("UNPARSEABLE_VALUE");
    return undefined;
  }
  if ((item.max !== undefined && n > item.max) || (item.min !== undefined && n < item.min)) return "FAIL";
  return "PASS";
}

export function decideItem({ item, finding, match, verification, visual }: DecisionInput): ItemResult {
  const result: ItemResult = {
    itemId: item.id,
    question: item.question,
    status: "NEEDS_REVIEW",
    reasons: [],
    quote: finding?.quote ?? "",
    frames: [],
  };
  if (!finding) {
    result.reasons.push("EXTRACTION_MISSING_ITEM");
    return result;
  }
  result.note = finding.note || undefined;
  if (finding.finding === "not_mentioned") {
    result.status = "NOT_INSPECTED";
    return result;
  }

  const reasons = result.reasons;
  const numeric = item.responseType === "numeric";
  let proposed: ItemStatus | undefined;
  switch (finding.finding) {
    case "unclear":
      reasons.push("UNCLEAR_ANSWER");
      break;
    case "meets":
    case "does_not_meet":
      if (numeric) reasons.push("FINDING_TYPE_MISMATCH");
      else proposed = finding.finding === "meets" ? "PASS" : "FAIL";
      break;
    case "not_applicable":
      proposed = "NOT_APPLICABLE";
      break;
    case "value_reported":
      if (!numeric) reasons.push("FINDING_TYPE_MISMATCH");
      else proposed = numericStatus(item, finding.numeric_value, reasons);
      break;
  }

  if (numeric && finding.numeric_value) result.value = finding.numeric_value;
  if (finding.date) result.date = finding.date;
  if (item.responseType === "pass_fail_na_date" && proposed === "PASS" && !finding.date.trim()) {
    reasons.push("MISSING_DATE");
  }
  if (finding.conflicting_statements) reasons.push("CONFLICTING_STATEMENTS");

  if (match?.grounded) {
    // Only a timed transcript yields a window; an untimed quote is grounded by text alone.
    if (match.start !== undefined && match.end !== undefined) {
      result.quoteWindow = { clipId: match.clipId, start: match.start, end: match.end };
    }
  } else {
    reasons.push("QUOTE_NOT_IN_TRANSCRIPT");
  }

  if (proposed && verification !== undefined) {
    if (verification === "unavailable") reasons.push("VERIFIER_UNAVAILABLE");
    else if (!verification.supported) reasons.push("VERIFIER_DISAGREES");
  }

  if (visual) {
    result.visual = visual;
    if (visual.assessment === "inconsistent") reasons.push("VISUAL_DISAGREES");
  }

  result.proposedStatus = proposed;
  result.status = reasons.length > 0 || !proposed ? "NEEDS_REVIEW" : proposed;
  return result;
}
