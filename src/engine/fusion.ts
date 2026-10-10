import type { ChecklistItem, ImageAnalysis, ImageEvidence, ItemStatus, VisualCheck } from "../contracts";

// Controlled fusion of independent voice and photo evidence. Provenance stays separate:
// the voice finding (grounded quote) drives the proposed status; the photo can only
// corroborate it or, through VISUAL_DISAGREES in decideItem, force human review.

// Phrases that would mean the model drew conclusions a photo cannot support. Screened in code
// regardless of the prompt; matching analyses are kept but flagged for review.
const UNSUPPORTED_CLAIMS =
  /\b(safe|unsafe|potable|drinkable|contaminat\w*|ppm|mg\/l|mg per lit\w*|compliant|non-compliant|within (the )?limits?|exceeds?)\b/i;

export function unsupportedClaims(a: ImageAnalysis): string[] {
  return [a.summary, ...a.observations, ...a.items.map((i) => i.observation)].filter((s) => UNSUPPORTED_CLAIMS.test(s));
}

export function assessImage(mediaId: string, sha256: string, model: string, analysis: ImageAnalysis): ImageEvidence {
  const ev: ImageEvidence = { mediaId, sha256, status: "analysed", model, analysis, reviewRequired: false };
  const claims = unsupportedClaims(analysis);
  if (analysis.image_quality === "unusable") {
    ev.reviewRequired = true;
    ev.reviewReason = `Photo unusable: ${analysis.quality_issues.join("; ") || "subject not visible"}. Request a new photo.`;
  } else if (claims.length) {
    ev.reviewRequired = true;
    ev.reviewReason = "Photo analysis contained claims a photo cannot support (e.g. safety or concentration); disregard those statements.";
  } else if (analysis.image_quality === "limited") {
    ev.reviewRequired = true;
    ev.reviewReason = `Photo quality limited: ${analysis.quality_issues.join("; ") || "partial view"}. Observations are uncertain.`;
  }
  return ev;
}

// One item's photo check. Undefined when the photo says nothing usable about the item, so the
// voice-based decision stands alone.
// A visual check is a NECESSARY condition: seeing it does not prove a PASS, but its clear absence
// questions one. A reported FAIL cannot be confirmed by a photo, so it is only noted.
export function photoCheckFor(item: ChecklistItem, proposed: ItemStatus | undefined, evidence: ImageEvidence[]): VisualCheck | undefined {
  if (!item.visualCheck || !proposed) return undefined;
  const usable = evidence.filter((e) => e.status === "analysed" && e.analysis && e.analysis.image_quality !== "unusable");
  const obs = usable.flatMap((e) => e.analysis!.items.filter((i) => i.item_id === item.id).map((i) => ({ ...i, mediaId: e.mediaId })));
  if (!obs.length) return undefined;
  const present = obs.some((o) => o.presence === "present");
  const absent = !present && obs.some((o) => o.presence === "absent");
  let assessment: VisualCheck["assessment"] = "cannot_tell";
  if (proposed === "PASS") assessment = present ? "consistent" : absent ? "inconsistent" : "cannot_tell";
  return {
    source: "photo",
    item_visible: present,
    assessment,
    observations: obs.map((o) => `[${o.mediaId}] ${o.presence}: ${o.observation}`),
  };
}
