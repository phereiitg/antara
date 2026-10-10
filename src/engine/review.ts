import type { CaseRecord, ItemStatus } from "../contracts";
import { logEvent, transition } from "./state";

// The human approval gate. Only these functions change proposal/task status or final item
// statuses, and each records who decided and why.

const FINAL_STATUSES: ItemStatus[] = ["PASS", "FAIL", "NOT_APPLICABLE", "NOT_INSPECTED", "RECORDED"];

function requireReviewing(record: CaseRecord, reviewer: string, reason: string) {
  if (record.state !== "PENDING_REVIEW") throw new Error(`Case is ${record.state}, not PENDING_REVIEW`);
  if (!reviewer.trim()) throw new Error("Reviewer identity is required");
  if (!reason.trim()) throw new Error("A reason is required");
}

function decideProposal(record: CaseRecord, proposalId: string, decision: "APPROVED" | "REJECTED", reviewer: string, reason: string) {
  requireReviewing(record, reviewer, reason);
  const proposal = record.proposals.find((p) => p.id === proposalId || p.id.startsWith(proposalId));
  if (!proposal) throw new Error(`Proposal ${proposalId} not found`);
  if (proposal.status !== "PENDING") throw new Error(`Proposal is already ${proposal.status}`);
  proposal.status = decision;
  proposal.review = { reviewer, reason, at: new Date().toISOString() };
  logEvent(record, `reviewer:${reviewer}`, `PROPOSAL_${decision}`, { id: proposal.id, actionType: proposal.actionType, reason });
  advanceIfDone(record);
}

export const approveProposal = (record: CaseRecord, id: string, reviewer: string, reason: string) =>
  decideProposal(record, id, "APPROVED", reviewer, reason);
export const rejectProposal = (record: CaseRecord, id: string, reviewer: string, reason: string) =>
  decideProposal(record, id, "REJECTED", reviewer, reason);

export function resolveTask(record: CaseRecord, taskId: string, finalStatus: ItemStatus, reviewer: string, reason: string) {
  requireReviewing(record, reviewer, reason);
  if (!FINAL_STATUSES.includes(finalStatus)) throw new Error(`Final status must be one of ${FINAL_STATUSES.join(", ")}`);
  const task = record.reviewerTasks.find((t) => t.id === taskId || t.id.startsWith(taskId));
  if (!task) throw new Error(`Reviewer task ${taskId} not found`);
  if (task.status !== "OPEN") throw new Error("Task is already resolved");
  task.status = "RESOLVED";
  task.resolution = { reviewer, finalStatus, reason, at: new Date().toISOString() };
  for (const r of record.results) {
    if (task.itemIds.includes(r.itemId)) r.status = finalStatus;
  }
  logEvent(record, `reviewer:${reviewer}`, "TASK_RESOLVED", { id: task.id, itemIds: task.itemIds, finalStatus, reason });
  advanceIfDone(record);
}

function advanceIfDone(record: CaseRecord) {
  const open = record.proposals.some((p) => p.status === "PENDING") || record.reviewerTasks.some((t) => t.status === "OPEN");
  if (open) return;
  transition(record, "REVIEWED", "system");
  const approved = record.proposals.filter((p) => p.status === "APPROVED");
  if (approved.length === 0) {
    transition(record, "CLOSED", "system");
    return;
  }
  // Mock connector only: no real department system is called (blueprint: WQMIS integration boundary).
  for (const p of approved) {
    p.mockReference = `MOCK-${p.actionType.toUpperCase()}-${p.id.slice(0, 8)}`;
    logEvent(record, "mock-connector", "MOCK_SUBMITTED", { id: p.id, reference: p.mockReference });
  }
  transition(record, "SUBMITTED_TO_MOCK_SYSTEM", "system");
}

export function closeCase(record: CaseRecord, reviewer: string) {
  if (record.state !== "SUBMITTED_TO_MOCK_SYSTEM") throw new Error(`Only submitted cases can be closed (case is ${record.state})`);
  transition(record, "CLOSED", `reviewer:${reviewer}`);
}
