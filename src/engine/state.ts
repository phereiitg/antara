import type { CaseRecord, CaseState } from "../contracts";

// Smaller than the blueprint's lifecycle: PROPOSED_ACTION and PENDING_REVIEW are one state,
// and media/STT/extraction/validation run as one PROCESSING step.
const TRANSITIONS: Record<CaseState, CaseState[]> = {
  DRAFT: ["PROCESSING"],
  PROCESSING: ["AGENT_RUNNING", "ERROR"],
  AGENT_RUNNING: ["PENDING_REVIEW"], // agent failure falls back to system reviewer tasks, never blocks review
  PENDING_REVIEW: ["REVIEWED"],
  REVIEWED: ["SUBMITTED_TO_MOCK_SYSTEM", "CLOSED"],
  SUBMITTED_TO_MOCK_SYSTEM: ["CLOSED"],
  CLOSED: [],
  ERROR: ["PROCESSING"],
};

export function transition(record: CaseRecord, to: CaseState, actor: string, detail?: unknown): void {
  if (!TRANSITIONS[record.state].includes(to)) {
    throw new Error(`Illegal case transition ${record.state} -> ${to}`);
  }
  const at = new Date().toISOString();
  record.events.push({ at, actor, type: `STATE_${to}`, detail: { from: record.state, ...(detail as object) } });
  record.state = to;
  record.updatedAt = at;
}

export function logEvent(record: CaseRecord, actor: string, type: string, detail?: unknown): void {
  const at = new Date().toISOString();
  record.events.push({ at, actor, type, detail });
  record.updatedAt = at;
}
