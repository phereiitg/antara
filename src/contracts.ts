import { z } from "zod";

// ---------------------------------------------------------------------------
// Checklists (ported from the Meta-glasses repo's checklist_schema.py).
// Each item carries an explicit `passCondition`, so PASS/FAIL never depends on
// the model guessing whether a question is phrased positively or negatively
// ("Is the FDC blocked?" -> passCondition "The FDC is NOT blocked").
// ---------------------------------------------------------------------------
export const ResponseType = z.enum(["pass_fail_na", "pass_fail_na_date", "numeric"]);
export type ResponseType = z.infer<typeof ResponseType>;

export const ChecklistItem = z.object({
  id: z.number().int().positive(),
  question: z.string().min(1),
  passCondition: z.string().min(1),
  code: z.string().optional(),
  responseType: ResponseType,
  // numeric items: optional deterministic limits; with no limits the value is only RECORDED
  unit: z.string().optional(),
  max: z.number().optional(),
  min: z.number().optional(),
  // Something that must be visible in a still photo IF the item passes (a necessary, not
  // sufficient, condition). Lets an independently uploaded photo corroborate or question the
  // spoken finding. Items without it are never checked against photos.
  visualCheck: z.string().min(1).optional(),
});
export type ChecklistItem = z.infer<typeof ChecklistItem>;

export const Checklist = z.object({
  id: z.string(),
  name: z.string(),
  standard: z.string(),
  items: z.array(ChecklistItem).min(1),
});
export type Checklist = z.infer<typeof Checklist>;

// ---------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------
// start/end are provider-supplied seconds. They are absent for providers that return no timing
// (Gnani REST): never fill them with guesses. Untimed segments still ground by text; they just
// produce no quoteWindow and no evidence frames.
export const Segment = z.object({
  start: z.number().nonnegative().optional(),
  end: z.number().nonnegative().optional(),
  text: z.string(),
  clipId: z.string().optional(), // which media clip the times are relative to
});
export type Segment = z.infer<typeof Segment>;

export const Transcript = z.object({
  language: z.string(),
  provider: z.string(),
  segments: z.array(Segment),
  timestampsApproximate: z.boolean().default(false),
});
export type Transcript = z.infer<typeof Transcript>;

export function transcriptText(t: Transcript): string {
  return t.segments.map((s) => s.text.trim()).join(" ");
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------
export const MediaKind = z.enum(["video", "audio", "photo"]);
export const MediaRef = z.object({
  id: z.string(),
  kind: MediaKind,
  path: z.string(),
  sha256: z.string(),
  mime: z.string(),
  itemIds: z.array(z.number()).optional(), // photos the user tagged to specific items
  // "evidence_photo": independently uploaded still, analysed once and fused per item (image.ts)
  role: z.literal("evidence_photo").optional(),
});
export type MediaRef = z.infer<typeof MediaRef>;

// ---------------------------------------------------------------------------
// Extraction output (what the LLM is allowed to say about each item)
// ---------------------------------------------------------------------------
export const Finding = z.enum([
  "meets",
  "does_not_meet",
  "not_applicable",
  "value_reported",
  "unclear",
  "not_mentioned",
]);
export type Finding = z.infer<typeof Finding>;

export const ItemFinding = z.object({
  item_id: z.number().int(),
  finding: Finding,
  conflicting_statements: z.boolean(),
  quote: z.string(), // "" when nothing was said
  date: z.string(), // "" when none
  numeric_value: z.string(), // "" when none
  note: z.string(),
});
export type ItemFinding = z.infer<typeof ItemFinding>;

export const ExtractionResult = z.object({ items: z.array(ItemFinding) });

export const VerificationResult = z.object({
  items: z.array(z.object({ item_id: z.number().int(), supported: z.boolean(), note: z.string() })),
});
export type VerificationResult = z.infer<typeof VerificationResult>;

export const VisualAssessment = z.enum(["consistent", "inconsistent", "cannot_tell"]);
export const VisualCheck = z.object({
  item_visible: z.boolean(),
  assessment: VisualAssessment,
  observations: z.array(z.string()),
  // provenance: frames grabbed from video at the quote's time, or an independently uploaded photo
  source: z.enum(["frames", "photo"]).optional(),
});
export type VisualCheck = z.infer<typeof VisualCheck>;

// ---------------------------------------------------------------------------
// Independent still-photo analysis (model output) and its case-level record
// ---------------------------------------------------------------------------
export const ImageQuality = z.enum(["good", "limited", "unusable"]);
export type ImageQuality = z.infer<typeof ImageQuality>;

export const ImageItemObservation = z.object({
  item_id: z.number().int(),
  presence: z.enum(["present", "absent", "cannot_tell"]),
  observation: z.string(),
});
export type ImageItemObservation = z.infer<typeof ImageItemObservation>;

export const ImageAnalysis = z.object({
  image_quality: ImageQuality,
  quality_issues: z.array(z.string()),
  summary: z.string(),
  observations: z.array(z.string()),
  visible_text: z.array(z.string()),
  uncertainties: z.array(z.string()),
  items: z.array(ImageItemObservation),
});
export type ImageAnalysis = z.infer<typeof ImageAnalysis>;

export interface ImageEvidence {
  mediaId: string;
  sha256: string;
  status: "analysed" | "failed";
  model?: string;
  analysis?: ImageAnalysis;
  error?: string;
  reviewRequired: boolean;
  reviewReason?: string;
}

// Reviewer-facing digest of a case, with provenance kept separate. Derived from the item
// results; it never changes a status.
export interface EvidenceSummary {
  disclaimer?: string;
  voice?: {
    provider: string;
    timings: "provider" | "approximate" | "none";
    statements: { itemId: number; quote: string; grounded: boolean }[]; // worker-reported
  };
  images: { mediaId: string; status: "analysed" | "failed"; quality?: ImageQuality; summary?: string; reviewReason?: string }[];
  confirmed: number[]; // grounded voice finding, verifier agreed, no review flags
  imageCorroborated: number[]; // photo shows what a PASS requires
  missing: number[]; // not inspected, dropped by extraction, or missing value/date
  conflicting: number[]; // contradictory statements, verifier or photo disagreement
  needsHumanVerification: number[]; // NEEDS_REVIEW or covered by an open reviewer task
}

// ---------------------------------------------------------------------------
// Final per-item result
// ---------------------------------------------------------------------------
export const ItemStatus = z.enum([
  "PASS",
  "FAIL",
  "NOT_APPLICABLE",
  "NOT_INSPECTED", // never discussed: not the same as "not applicable"
  "RECORDED", // numeric value captured, no limit configured
  "NEEDS_REVIEW",
]);
export type ItemStatus = z.infer<typeof ItemStatus>;

export const ReviewReason = z.enum([
  "EXTRACTION_MISSING_ITEM",
  "UNCLEAR_ANSWER",
  "CONFLICTING_STATEMENTS",
  "QUOTE_NOT_IN_TRANSCRIPT",
  "VERIFIER_DISAGREES",
  "VERIFIER_UNAVAILABLE",
  "MISSING_DATE",
  "MISSING_VALUE",
  "UNPARSEABLE_VALUE",
  "FINDING_TYPE_MISMATCH",
  "VISUAL_DISAGREES",
]);
export type ReviewReason = z.infer<typeof ReviewReason>;

export interface EvidenceFrame {
  path: string;
  clipId?: string;
  timestamp: number;
  sha256: string;
}

export interface ItemResult {
  itemId: number;
  question: string;
  status: ItemStatus;
  proposedStatus?: ItemStatus; // what extraction suggested before review flags
  reasons: ReviewReason[];
  quote: string;
  quoteWindow?: { clipId?: string; start: number; end: number };
  date?: string;
  value?: string;
  note?: string;
  frames: EvidenceFrame[];
  visual?: VisualCheck;
}

// ---------------------------------------------------------------------------
// Case, proposals and review
// ---------------------------------------------------------------------------
export const CaseState = z.enum([
  "DRAFT",
  "PROCESSING",
  "AGENT_RUNNING",
  "PENDING_REVIEW",
  "REVIEWED",
  "SUBMITTED_TO_MOCK_SYSTEM",
  "CLOSED",
  "ERROR",
]);
export type CaseState = z.infer<typeof CaseState>;

export type ProposalStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ActionProposal {
  id: string;
  actionType: string;
  itemIds: number[];
  rationale: string;
  priority: "low" | "normal" | "high";
  proposedBy: "agent" | "system";
  status: ProposalStatus;
  review?: { reviewer: string; reason: string; at: string };
  mockReference?: string;
}

export interface ReviewerTask {
  id: string;
  itemIds: number[];
  reason: string;
  severity: "low" | "normal" | "high";
  createdBy: "agent" | "system";
  status: "OPEN" | "RESOLVED";
  resolution?: { reviewer: string; finalStatus: ItemStatus; reason: string; at: string };
}

export interface ClarificationRequest {
  id: string;
  itemIds: number[];
  question: string;
  language: string;
  createdBy: "agent";
}

export interface CaseEvent {
  at: string;
  actor: string;
  type: string;
  detail?: unknown;
}

export interface AgentRunRecord {
  mode: "cline" | "skipped";
  // live = Cline agent on a real model provider; scripted = Cline agent loop driven by a
  // hand-written model (demo/tests); skipped = no agent, guardrail tasks only.
  execution?: "live" | "scripted" | "skipped";
  status: string;
  iterations?: number;
  error?: string;
  summary?: string;
  rejectedToolCalls: { tool: string; reason: string }[];
}

export interface CaseRecord {
  id: string;
  domainId: string;
  adapterVersion: string;
  checklistId: string;
  state: CaseState;
  language: string;
  createdAt: string;
  updatedAt: string;
  media: MediaRef[];
  metadata?: Record<string, string>; // operator-entered case details (e.g. sample source, location)
  transcript?: Transcript;
  imageEvidence?: ImageEvidence[]; // independent photo analysis, separate provenance from voice
  results: ItemResult[];
  evidenceSummary?: EvidenceSummary;
  hasContradictions: boolean;
  proposals: ActionProposal[];
  reviewerTasks: ReviewerTask[];
  clarifications: ClarificationRequest[];
  agentRun?: AgentRunRecord;
  models: Record<string, string>; // which model produced which step
  events: CaseEvent[];
}
