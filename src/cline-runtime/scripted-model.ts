import type { AgentModel } from "./agent";

// A scripted stand-in for the LLM behind the Cline agent, for tests and the offline demo.
// It drives the REAL Cline agent loop and tools with fixed, rule-based tool calls; it shows
// that the plumbing works, not how well a real model reasons.

type ToolCall = { toolName: string; input: Record<string, unknown> };

interface CaseView {
  field_language: string;
  items: { item_id: number; status: string; review_reasons: string[]; quote: string }[];
  allowed_actions: Record<string, { allowedItemStatuses: string[] }>;
}

function readCase(request: Parameters<AgentModel["stream"]>[0]): CaseView {
  for (const message of request.messages) {
    for (const part of message.content) {
      if (part.type === "text") {
        const m = part.text.match(/<case_json>\s*([\s\S]*?)\s*<\/case_json>/);
        if (m) return JSON.parse(m[1]);
      }
    }
  }
  throw new Error("scripted model: no <case_json> in the conversation");
}

function plan(view: CaseView, misbehave: boolean): ToolCall[] {
  const ids = (status: string) => view.items.filter((i) => i.status === status).map((i) => i.item_id);
  const calls: ToolCall[] = [];

  const failed = ids("FAIL");
  const failAction = Object.entries(view.allowed_actions).find(([, s]) => s.allowedItemStatuses.includes("FAIL"))?.[0];
  if (failed.length && failAction) {
    const quotes = view.items.filter((i) => failed.includes(i.item_id)).map((i) => `#${i.item_id}: "${i.quote}"`);
    calls.push({ toolName: "propose_action", input: { action_type: failAction, item_ids: failed, priority: "high", rationale: `Inspector reported failures: ${quotes.join("; ")}` } });
  }

  if (misbehave) {
    const passed = ids("PASS");
    calls.push({ toolName: "propose_action", input: { action_type: "seal_building", item_ids: failed.length ? failed : [1], priority: "high", rationale: "not allowed" } });
    if (passed.length && failAction) {
      calls.push({ toolName: "propose_action", input: { action_type: failAction, item_ids: [passed[0]], priority: "low", rationale: "cites a PASS item" } });
    }
    return calls; // and skips every NEEDS_REVIEW / NOT_INSPECTED item
  }

  const review = ids("NEEDS_REVIEW");
  if (review.length) {
    const reasons = [...new Set(view.items.filter((i) => review.includes(i.item_id)).flatMap((i) => i.review_reasons))];
    calls.push({ toolName: "create_reviewer_task", input: { item_ids: review, severity: "normal", reason: `Automatic checks flagged these items: ${reasons.join(", ")}` } });
  }
  const notInspected = ids("NOT_INSPECTED");
  if (notInspected.length) {
    const hindi = view.field_language.startsWith("hi");
    calls.push({
      toolName: "request_clarification",
      input: {
        item_ids: notInspected,
        language: view.field_language,
        question: hindi
          ? `कृपया इन बिंदुओं की जाँच करके दोबारा रिकॉर्ड करें: ${notInspected.join(", ")}`
          : `Please check and record items ${notInspected.join(", ")}; they were not covered in the recording.`,
      },
    });
  }
  return calls;
}

export function scriptedCaseModel(opts: { misbehave?: boolean; failWith?: string } = {}): AgentModel {
  let callCounter = 0;
  return {
    async *stream(request) {
      if (opts.failWith) throw new Error(opts.failWith);
      const toolResultsSoFar = request.messages.filter((m) => m.content.some((p) => p.type === "tool-result")).length;
      const calls: ToolCall[] =
        toolResultsSoFar === 0
          ? plan(readCase(request), Boolean(opts.misbehave))
          : [{ toolName: "submit_summary", input: { summary: "Scripted summary: follow-up prepared per the rules; see proposals and reviewer tasks." } }];
      if (calls.length === 0) calls.push({ toolName: "submit_summary", input: { summary: "Scripted summary: nothing needs follow-up." } });
      for (const call of calls) {
        yield { type: "tool-call-delta", toolCallId: `scripted_${++callCounter}`, toolName: call.toolName, input: call.input };
      }
      yield { type: "finish", reason: "tool-calls" };
    },
  };
}
