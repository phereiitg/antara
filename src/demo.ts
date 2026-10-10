import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Transcript } from "./contracts";
import type { JsonLlm, JsonRequest } from "./integrations/llm";

// Offline demo: a synthetic transcript plus hand-written ("scripted") model responses, so the
// whole flow (grounding, decisions, real Cline agent loop, guardrails, review) can run without
// API keys. Nothing here is real model output.

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/demo/${name}`, import.meta.url));

export class ScriptedLlm implements JsonLlm {
  readonly model = "scripted (no model)";
  constructor(private readonly responses: Partial<Record<JsonRequest["step"], unknown>>) {}
  async generateJson({ step }: JsonRequest): Promise<unknown> {
    if (!(step in this.responses)) throw new Error(`scripted LLM has no response for step "${step}"`);
    return structuredClone(this.responses[step]);
  }
}

export async function loadDemo() {
  const transcript = Transcript.parse(JSON.parse(await readFile(fixture("fire-extinguisher.transcript.json"), "utf8")));
  const scripted = JSON.parse(await readFile(fixture("fire-extinguisher.scripted-llm.json"), "utf8"));
  return { transcript, llm: new ScriptedLlm({ extraction: scripted.extraction, verification: scripted.verification }) };
}
