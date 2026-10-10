import { Agent, createTool } from "@cline/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { getAdapter, getChecklist } from "../src/adapters";
import type { CaseRecord, ItemResult, ItemStatus } from "../src/contracts";
import { runCaseAgent, type AgentModel } from "../src/cline-runtime/agent";
import { scriptedCaseModel } from "../src/cline-runtime/scripted-model";
import { applyFallbackTasks, uncoveredItems } from "../src/engine/guardrails";

const adapter = getAdapter("fire_safety");
const checklist = getChecklist(adapter, "fire_extinguisher");

function makeCase(statuses: ItemStatus[]): CaseRecord {
  const results: ItemResult[] = statuses.map((status, i) => ({
    itemId: i + 1, question: checklist.items[i].question, status, reasons: status === "NEEDS_REVIEW" ? ["UNCLEAR_ANSWER"] : [],
    quote: `quote ${i + 1}`, frames: [],
  }));
  return {
    id: "case-1", domainId: adapter.id, adapterVersion: adapter.version, checklistId: checklist.id, state: "AGENT_RUNNING",
    language: "hi-IN", createdAt: "", updatedAt: "", media: [], results, hasContradictions: false,
    proposals: [], reviewerTasks: [], clarifications: [], models: {}, events: [],
  };
}

const run = (record: CaseRecord, model: AgentModel) =>
  runCaseAgent(record, adapter, checklist, { backend: { kind: "model", model, label: "scripted" }, timeoutMs: 20_000 });

describe("Cline agent with case tools (real @cline/sdk runtime, scripted model)", () => {
  it("creates only PENDING records and covers every item needing follow-up", async () => {
    const record = makeCase(["PASS", "FAIL", "NEEDS_REVIEW", "NOT_INSPECTED", "FAIL", "PASS", "PASS", "PASS"]);
    const out = await run(record, scriptedCaseModel());

    expect(out).toMatchObject({ mode: "cline", status: "completed", rejectedToolCalls: [] });
    expect(out.summary).toMatch(/Scripted summary/);
    expect(record.proposals).toEqual([expect.objectContaining({ actionType: "rectification_notice_draft", itemIds: [2, 5], status: "PENDING" })]);
    expect(record.reviewerTasks).toEqual([expect.objectContaining({ itemIds: [3], status: "OPEN", createdBy: "agent" })]);
    expect(record.clarifications).toEqual([expect.objectContaining({ itemIds: [4], language: "hi-IN" })]);
    expect(record.results.map((r) => r.status)).toEqual(["PASS", "FAIL", "NEEDS_REVIEW", "NOT_INSPECTED", "FAIL", "PASS", "PASS", "PASS"]);
    expect(uncoveredItems(record, adapter)).toEqual([]);
  });

  it("rejects disallowed action types and PASS citations in code, and guardrails fill the gaps", async () => {
    const record = makeCase(["PASS", "FAIL", "NEEDS_REVIEW", "NOT_INSPECTED", "PASS", "PASS", "PASS", "PASS"]);
    const out = await run(record, scriptedCaseModel({ misbehave: true }));

    expect(out.rejectedToolCalls.map((r) => r.reason)).toEqual([
      expect.stringMatching(/Unknown action type "seal_building"/),
      expect.stringMatching(/cannot cite item 1 \(status PASS\)/),
    ]);
    expect(record.proposals.map((p) => p.actionType)).toEqual(["rectification_notice_draft"]);
    expect(uncoveredItems(record, adapter)).toEqual([3, 4]);
    applyFallbackTasks(record, adapter);
    expect(record.reviewerTasks).toEqual([expect.objectContaining({ itemIds: [3, 4], createdBy: "system" })]);
  });

  it("a crashing model leaves the case reviewable through fallback tasks", async () => {
    const record = makeCase(["FAIL", "NEEDS_REVIEW", "PASS", "PASS", "PASS", "PASS", "PASS", "PASS"]);
    const out = await run(record, scriptedCaseModel({ failWith: "provider down" }));
    expect(out.status).not.toBe("completed");
    applyFallbackTasks(record, adapter);
    expect(record.reviewerTasks).toEqual([
      expect.objectContaining({ itemIds: [1], severity: "high", createdBy: "system" }),
      expect.objectContaining({ itemIds: [2], createdBy: "system" }),
    ]);
  });
});

describe("blueprint's toolPolicies { autoApprove: false } without an approval callback", () => {
  it("makes Cline refuse the tool call (the proposal is never created)", async () => {
    let executed = false;
    const proposeAction = createTool({
      name: "propose_action",
      description: "create a pending proposal",
      inputSchema: z.object({ note: z.string() }),
      async execute() {
        executed = true;
        return { ok: true };
      },
    });
    let turn = 0;
    const model: AgentModel = {
      async *stream() {
        if (turn++ === 0) {
          yield { type: "tool-call-delta", toolCallId: "c1", toolName: "propose_action", input: { note: "x" } };
          yield { type: "finish", reason: "tool-calls" };
        } else {
          yield { type: "text-delta", text: "done" };
          yield { type: "finish", reason: "stop" };
        }
      },
    };
    const agent = new Agent({ model, tools: [proposeAction], toolPolicies: { propose_action: { autoApprove: false } } });
    const result = await agent.run("go");

    expect(executed).toBe(false);
    const toolResult = result.messages.flatMap((m) => m.content).find((p) => p.type === "tool-result");
    expect(JSON.stringify(toolResult)).toMatch(/requires approval but no approval callback is configured/);
  });
});
