import type { DomainAdapter } from "../adapters";
import type { CaseRecord, EvidenceSummary, ReviewReason } from "../contracts";
import { locateQuote } from "./grounding";

// Reviewer-facing evidence digest. Pure function of the decided case: it classifies, it never
// changes a status. Voice and photo provenance are reported separately.

const MISSING: ReviewReason[] = ["EXTRACTION_MISSING_ITEM", "MISSING_VALUE", "MISSING_DATE"];
const CONFLICT: ReviewReason[] = ["CONFLICTING_STATEMENTS", "VERIFIER_DISAGREES", "VISUAL_DISAGREES"];

export function summarizeEvidence(record: CaseRecord, adapter: DomainAdapter): EvidenceSummary {
  const ids = (pred: (r: CaseRecord["results"][number]) => boolean) => record.results.filter(pred).map((r) => r.itemId);
  const openTaskItems = new Set(record.reviewerTasks.filter((t) => t.status === "OPEN").flatMap((t) => t.itemIds));
  const t = record.transcript;
  const timings = !t || t.segments.some((s) => s.start === undefined || s.end === undefined)
    ? "none"
    : t.timestampsApproximate ? "approximate" : "provider";

  return {
    disclaimer: adapter.reportDisclaimer,
    voice: t && {
      provider: t.provider,
      timings,
      statements: record.results
        .filter((r) => r.quote)
        .map((r) => ({ itemId: r.itemId, quote: r.quote, grounded: locateQuote(r.quote, t.segments).grounded })),
    },
    images: (record.imageEvidence ?? []).map((e) => ({
      mediaId: e.mediaId, status: e.status, quality: e.analysis?.image_quality, summary: e.analysis?.summary, reviewReason: e.reviewReason,
    })),
    confirmed: ids((r) => r.reasons.length === 0 && ["PASS", "FAIL", "NOT_APPLICABLE", "RECORDED"].includes(r.status) && !openTaskItems.has(r.itemId)),
    imageCorroborated: ids((r) => r.visual?.source === "photo" && r.visual.assessment === "consistent"),
    missing: ids((r) => r.status === "NOT_INSPECTED" || r.reasons.some((x) => MISSING.includes(x))),
    conflicting: ids((r) => r.reasons.some((x) => CONFLICT.includes(x))),
    needsHumanVerification: ids((r) => r.status === "NEEDS_REVIEW" || openTaskItems.has(r.itemId)),
  };
}
