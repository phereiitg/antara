import { randomUUID } from "node:crypto";
import { createTool } from "@cline/sdk";
import { z } from "zod";
import type { DomainAdapter } from "../adapters";
import type { CaseRecord, ItemStatus } from "../contracts";
import { logEvent } from "../engine/state";

// The agent's only tools. Each one writes a PENDING record into the case; none of them can
// change an item status, contact anyone or call an external system. Every rule is enforced
// here, in code, regardless of what the prompt says.

export interface ToolLog {
  rejected: { tool: string; reason: string }[];
  summary?: string;
}

const CLARIFIABLE: ItemStatus[] = ["NEEDS_REVIEW", "NOT_INSPECTED", "FAIL"];

export function createCaseTools(record: CaseRecord, adapter: DomainAdapter, log: ToolLog) {
  const statusOf = (id: number) => record.results.find((r) => r.itemId === id)?.status;
  const reject = (tool: string, reason: string) => {
    log.rejected.push({ tool, reason });
    logEvent(record, "agent", "TOOL_CALL_REJECTED", { tool, reason });
    return { ok: false, error: reason };
  };
  const unknownItem = (ids: number[]) => ids.find((id) => statusOf(id) === undefined);
  const sortedUnique = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b);

  const actionList = Object.entries(adapter.actions)
    .map(([type, spec]) => `${type} (may cite items with status ${spec.allowedItemStatuses.join("/")}): ${spec.description}`)
    .join("; ");

  const proposeAction = createTool({
    name: "propose_action",
    description: `Create a PENDING action proposal for a human reviewer to approve or reject. This never performs the action. Allowed action types: ${actionList}`,
    inputSchema: z.object({
      action_type: z.string(),
      item_ids: z.array(z.number().int()).min(1),
      rationale: z.string().min(1).max(2000),
      priority: z.enum(["low", "normal", "high"]),
    }),
    async execute(input) {
      const spec = adapter.actions[input.action_type];
      if (!spec) return reject("propose_action", `Unknown action type "${input.action_type}". Allowed: ${Object.keys(adapter.actions).join(", ")}`);
      const missing = unknownItem(input.item_ids);
      if (missing !== undefined) return reject("propose_action", `Item ${missing} does not exist in this case`);
      for (const id of input.item_ids) {
        const status = statusOf(id)!;
        if (!spec.allowedItemStatuses.includes(status)) {
          return reject("propose_action", `${input.action_type} cannot cite item ${id} (status ${status}); allowed statuses: ${spec.allowedItemStatuses.join(", ")}`);
        }
      }
      const itemIds = sortedUnique(input.item_ids);
      const existing = record.proposals.find(
        (p) => p.actionType === input.action_type && p.itemIds.join(",") === itemIds.join(","),
      );
      if (existing) return { ok: true, proposal_id: existing.id, status: existing.status, note: "Already proposed; not duplicated" };
      const proposal = {
        id: randomUUID(), actionType: input.action_type, itemIds, rationale: input.rationale,
        priority: input.priority, proposedBy: "agent" as const, status: "PENDING" as const,
      };
      record.proposals.push(proposal);
      logEvent(record, "agent", "ACTION_PROPOSED", { id: proposal.id, actionType: proposal.actionType, itemIds });
      return { ok: true, proposal_id: proposal.id, status: "PENDING" };
    },
  });

  const createReviewerTask = createTool({
    name: "create_reviewer_task",
    description: "Ask the human reviewer to decide the final status of items that need judgement (NEEDS_REVIEW, NOT_INSPECTED, or FAIL with no suitable action).",
    inputSchema: z.object({
      item_ids: z.array(z.number().int()).min(1),
      reason: z.string().min(1).max(1000),
      severity: z.enum(["low", "normal", "high"]),
    }),
    async execute(input) {
      const missing = unknownItem(input.item_ids);
      if (missing !== undefined) return reject("create_reviewer_task", `Item ${missing} does not exist in this case`);
      const task = {
        id: randomUUID(), itemIds: sortedUnique(input.item_ids), reason: input.reason,
        severity: input.severity, createdBy: "agent" as const, status: "OPEN" as const,
      };
      record.reviewerTasks.push(task);
      logEvent(record, "agent", "REVIEWER_TASK_CREATED", { id: task.id, itemIds: task.itemIds });
      return { ok: true, task_id: task.id };
    },
  });

  const requestClarification = createTool({
    name: "request_clarification",
    description: `Draft one short question for the field worker to re-check or re-record something, in their language (case language: ${record.language}). The reviewer decides whether to send it.`,
    inputSchema: z.object({
      item_ids: z.array(z.number().int()).min(1),
      question: z.string().min(1).max(500),
      language: z.string().min(2),
    }),
    async execute(input) {
      const missing = unknownItem(input.item_ids);
      if (missing !== undefined) return reject("request_clarification", `Item ${missing} does not exist in this case`);
      const notClarifiable = input.item_ids.find((id) => !CLARIFIABLE.includes(statusOf(id)!));
      if (notClarifiable !== undefined) {
        return reject("request_clarification", `Item ${notClarifiable} has status ${statusOf(notClarifiable)}; nothing to clarify`);
      }
      const req = { id: randomUUID(), itemIds: sortedUnique(input.item_ids), question: input.question, language: input.language, createdBy: "agent" as const };
      record.clarifications.push(req);
      logEvent(record, "agent", "CLARIFICATION_DRAFTED", { id: req.id, itemIds: req.itemIds });
      return { ok: true, clarification_id: req.id };
    },
  });

  const submitSummary = createTool({
    name: "submit_summary",
    description: "Finish: submit a 3-5 sentence English summary of the case for the reviewer. Call once, last.",
    inputSchema: z.object({ summary: z.string().min(1).max(3000) }),
    lifecycle: { completesRun: true },
    async execute(input) {
      log.summary = input.summary;
      return { ok: true };
    },
  });

  return [proposeAction, createReviewerTask, requestClarification, submitSummary];
}
