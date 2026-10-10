import { randomUUID } from "node:crypto";
import type { DomainAdapter } from "../adapters";
import type { CaseRecord, ItemStatus } from "../contracts";
import { logEvent } from "./state";

// Deterministic check after the agent: the agent is useful but never trusted to be complete.
// Any item that needs follow-up and was not covered gets a system reviewer task.

const NEEDS_FOLLOW_UP: ItemStatus[] = ["FAIL", "NEEDS_REVIEW", "NOT_INSPECTED"];

export function uncoveredItems(record: CaseRecord, adapter: DomainAdapter): number[] {
  const covered = new Set<number>();
  for (const p of record.proposals) {
    const allowed = adapter.actions[p.actionType]?.allowedItemStatuses ?? [];
    for (const id of p.itemIds) {
      const status = record.results.find((r) => r.itemId === id)?.status;
      if (status && allowed.includes(status)) covered.add(id);
    }
  }
  for (const t of record.reviewerTasks) t.itemIds.forEach((id) => covered.add(id));
  for (const c of record.clarifications) {
    for (const id of c.itemIds) {
      // a question to the field worker covers missing/unclear evidence, not a confirmed FAIL
      if (record.results.find((r) => r.itemId === id)?.status !== "FAIL") covered.add(id);
    }
  }
  return record.results
    .filter((r) => NEEDS_FOLLOW_UP.includes(r.status) && !covered.has(r.itemId))
    .map((r) => r.itemId);
}

export function applyFallbackTasks(record: CaseRecord, adapter: DomainAdapter): number[] {
  const missing = uncoveredItems(record, adapter);
  if (missing.length === 0) return [];
  const failed = missing.filter((id) => record.results.find((r) => r.itemId === id)?.status === "FAIL");
  const other = missing.filter((id) => !failed.includes(id));
  if (failed.length) {
    record.reviewerTasks.push({
      id: randomUUID(), itemIds: failed, severity: "high", createdBy: "system", status: "OPEN",
      reason: "Failed items with no follow-up proposed by the agent. Decide the follow-up manually.",
    });
  }
  if (other.length) {
    record.reviewerTasks.push({
      id: randomUUID(), itemIds: other, severity: "normal", createdBy: "system", status: "OPEN",
      reason: "Items needing review or not inspected, with no follow-up from the agent. Confirm the final status.",
    });
  }
  logEvent(record, "system", "GUARDRAIL_FALLBACK_TASKS", { itemIds: missing });
  return missing;
}
