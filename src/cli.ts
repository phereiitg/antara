import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { listAdapters } from "./adapters";
import { Transcript, VerificationResult, type CaseRecord, type ItemStatus } from "./contracts";
import { VERIFICATION_JSON_SCHEMA } from "./engine/verify";
import { scriptedCaseModel } from "./cline-runtime/scripted-model";
import { loadDemo } from "./demo";
import { runCase, type CaseInput, type PipelineDeps } from "./engine/pipeline";
import { approveProposal, closeCase, rejectProposal, resolveTask } from "./engine/review";
import { GeminiClient } from "./integrations/gemini";
import { GeminiStt, GnaniStt } from "./integrations/stt";
import { FileCaseStore } from "./store";

if (existsSync(".env")) process.loadEnvFile(".env");
const env = (k: string) => process.env[k]?.trim() || undefined;
const store = new FileCaseStore(env("ANTARA_DATA_DIR") ?? "data");

const USAGE = `ANTARA inspection pipeline

  antara domains                                   list domains and checklists
  antara demo                                      offline demo (scripted model responses, no API keys)
  antara smoke                                     check live Gemini + Cline agent with your .env keys
  antara run --domain <id> [--checklist <id>] [--language hi-IN]
             [--video clip.mp4 ...] [--audio a.wav ...] [--photo p.jpg[:1,2] ...]
             [--transcript t.json] [--no-agent]
  antara list
  antara show <caseId> [--json]
  antara approve <caseId> <proposalId> --reviewer <name> --reason <text>
  antara reject  <caseId> <proposalId> --reviewer <name> --reason <text>
  antara resolve <caseId> <taskId> --status <PASS|FAIL|NOT_APPLICABLE|NOT_INSPECTED|RECORDED> --reviewer <name> --reason <text>
  antara close   <caseId> --reviewer <name>
`;

const short = (id: string) => id.slice(0, 8);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function printCase(r: CaseRecord) {
  console.log(`\nCase ${r.id}  [${r.state}]`);
  console.log(`Domain ${r.domainId} v${r.adapterVersion} / ${r.checklistId}   language ${r.language}`);
  console.log(`Models: ${Object.entries(r.models).map(([k, v]) => `${k}=${v}`).join(", ")}`);
  if (r.hasContradictions) console.log("Transcript contains contradictory statements (see CONFLICTING_STATEMENTS).");
  console.log("\n #  Status          Proposed        Reasons / quote");
  for (const it of r.results) {
    const reasons = it.reasons.length ? it.reasons.join(",") : "";
    const extra = [it.date && `date: ${it.date}`, it.value && `value: ${it.value}`, it.frames.length && `${it.frames.length} frame(s)`]
      .filter(Boolean).join("  ");
    console.log(`${String(it.itemId).padStart(2)}  ${it.status.padEnd(15)} ${(it.proposedStatus ?? "-").padEnd(15)} ${reasons}`);
    console.log(`    ${clip(it.question, 70)}`);
    if (it.quote) console.log(`    "${clip(it.quote, 90)}"${extra ? `  (${extra})` : ""}`);
    if (it.visual) console.log(`    vision: ${it.visual.assessment}; ${it.visual.observations.join("; ")}`);
  }
  const run = r.agentRun;
  if (run) {
    console.log(`\nAgent: ${run.mode} / ${run.status}${run.iterations ? ` in ${run.iterations} iteration(s)` : ""}${run.error ? ` / error: ${run.error}` : ""}`);
    for (const rej of run.rejectedToolCalls) console.log(`  rejected ${rej.tool}: ${rej.reason}`);
    if (run.summary) console.log(`  Summary: ${run.summary}`);
  }
  console.log("\nProposed actions (nothing happens until a reviewer approves):");
  if (!r.proposals.length) console.log("  none");
  for (const p of r.proposals) {
    console.log(`  ${short(p.id)}  ${p.actionType}  items ${p.itemIds.join(",")}  [${p.status}]  by ${p.proposedBy}${p.mockReference ? `  -> ${p.mockReference}` : ""}`);
    console.log(`            ${clip(p.rationale, 110)}`);
  }
  console.log("\nReviewer tasks:");
  if (!r.reviewerTasks.length) console.log("  none");
  for (const t of r.reviewerTasks) {
    console.log(`  ${short(t.id)}  items ${t.itemIds.join(",")}  ${t.severity}  [${t.status}${t.resolution ? ` -> ${t.resolution.finalStatus}` : ""}]  by ${t.createdBy}`);
    console.log(`            ${clip(t.reason, 110)}`);
  }
  if (r.clarifications.length) {
    console.log("\nDraft clarification questions for the field worker:");
    for (const c of r.clarifications) console.log(`  items ${c.itemIds.join(",")} [${c.language}]: ${c.question}`);
  }
  console.log("");
}

function buildLiveDeps(noAgent: boolean): PipelineDeps {
  const apiKey = env("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set (copy .env.example to .env). Try `antara demo` for an offline run.");
  const llm = new GeminiClient(apiKey, env("GEMINI_MODEL") ?? "gemini-3.8-flash");
  const stt = env("STT_PROVIDER") === "gnani" ? new GnaniStt() : new GeminiStt(llm);
  const providerId = env("CLINE_PROVIDER_ID") ?? "gemini";
  const modelId = env("CLINE_MODEL_ID") ?? llm.model;
  const agentKey = env("CLINE_PROVIDER_API_KEY") ?? (providerId === "gemini" ? apiKey : undefined);
  return {
    llm, stt, store,
    agent: noAgent ? undefined : { backend: { kind: "provider", providerId, modelId, apiKey: agentKey }, label: `cline:${providerId}/${modelId}` },
  };
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      domain: { type: "string" }, checklist: { type: "string" }, language: { type: "string" },
      video: { type: "string", multiple: true }, audio: { type: "string", multiple: true },
      photo: { type: "string", multiple: true }, transcript: { type: "string" },
      "no-agent": { type: "boolean" }, json: { type: "boolean" },
      reviewer: { type: "string" }, reason: { type: "string" }, status: { type: "string" },
    },
  });
  const [command, ...args] = positionals;
  const need = (v: string | undefined, name: string) => {
    if (!v) throw new Error(`Missing ${name}\n\n${USAGE}`);
    return v;
  };

  switch (command) {
    case "domains":
      for (const a of listAdapters()) {
        console.log(`${a.id} (v${a.version}) - ${a.name}; actions: ${Object.keys(a.actions).join(", ")}; video frames ${a.allowVideoFrames ? "allowed" : "OFF (privacy)"}`);
        for (const c of a.checklists) console.log(`  ${c.id}: ${c.name} (${c.items.length} items)`);
      }
      return;

    case "demo": {
      console.log("OFFLINE DEMO: synthetic transcript + scripted model responses + scripted agent model.");
      console.log("The pipeline, grounding checks, Cline agent loop, tools and guardrails are real code; the 'model' answers are not.\n");
      const { transcript, llm } = await loadDemo();
      const record = await runCase(
        { domainId: "fire_safety", checklistId: "fire_extinguisher", language: "hi-IN", transcript },
        { llm, store, agent: { backend: { kind: "model", model: scriptedCaseModel(), label: "scripted" }, label: "cline:scripted-model" } },
      );
      printCase(record);
      const proposal = record.proposals[0];
      const task = record.reviewerTasks[0];
      console.log("Next, act as the reviewer:");
      if (proposal) console.log(`  npm run antara -- approve ${short(record.id)} ${short(proposal.id)} --reviewer "Fire Officer" --reason "Corrosion and faded nameplate confirmed"`);
      if (task) console.log(`  npm run antara -- resolve ${short(record.id)} ${short(task.id)} --status NOT_INSPECTED --reviewer "Fire Officer" --reason "Re-inspect"`);
      return;
    }

    case "smoke": {
      // Blueprint M0: prove the live integrations respond with your credentials.
      const deps = buildLiveDeps(false);
      let failed = false;
      const check = async (name: string, fn: () => Promise<string>) => {
        const t0 = Date.now();
        try {
          const detail = await fn();
          console.log(`PASS  ${name} [${Date.now() - t0} ms] ${detail}`);
        } catch (err) {
          failed = true;
          console.log(`FAIL  ${name} [${Date.now() - t0} ms]: ${err instanceof Error ? err.message : String(err)}`);
        }
      };
      await check(`Gemini structured output (${deps.llm.model})`, async () => {
        const raw = await deps.llm.generateJson({
          step: "verification",
          prompt: 'Return {"items": [{"item_id": 1, "supported": true, "note": "smoke test"}]}',
          schema: VERIFICATION_JSON_SCHEMA,
        });
        return JSON.stringify(VerificationResult.parse(raw));
      });
      await check(`Cline agent with tools (${deps.agent!.label})`, async () => {
        const { transcript, llm } = await loadDemo(); // scripted extraction, REAL agent model
        const r = await runCase({ domainId: "fire_safety", checklistId: "fire_extinguisher", language: "hi-IN", transcript }, { ...deps, llm });
        const run = r.agentRun!;
        if (run.status !== "completed") throw new Error(`agent ${run.status}: ${run.error ?? "no error message"}`);
        const byAgent = r.proposals.filter((p) => p.proposedBy === "agent").length + r.reviewerTasks.filter((t) => t.createdBy === "agent").length;
        const fallback = r.reviewerTasks.filter((t) => t.createdBy === "system").length;
        return `case ${short(r.id)}: ${byAgent} agent follow-ups, ${fallback} guardrail fallbacks, ${run.rejectedToolCalls.length} rejected calls`;
      });
      if (failed) process.exitCode = 1;
      return;
    }

    case "run": {
      const input: CaseInput = {
        domainId: need(values.domain, "--domain"),
        checklistId: values.checklist,
        language: values.language,
        videos: values.video,
        audio: values.audio,
        photos: values.photo?.map((p) => {
          const m = p.match(/^(.*?)(?::([\d,]+))?$/)!;
          return { path: m[1], itemIds: m[2]?.split(",").map(Number) };
        }),
        transcript: values.transcript ? Transcript.parse(JSON.parse(readFileSync(values.transcript, "utf8"))) : undefined,
      };
      printCase(await runCase(input, buildLiveDeps(Boolean(values["no-agent"]))));
      return;
    }

    case "list":
      for (const id of await store.list()) {
        const r = await store.load(id);
        console.log(`${r.id}  ${r.state.padEnd(24)} ${r.domainId}/${r.checklistId}  ${r.createdAt}`);
      }
      return;

    case "show": {
      const r = await store.load(need(args[0], "caseId"));
      if (values.json) console.log(JSON.stringify(r, null, 2));
      else printCase(r);
      return;
    }

    case "approve":
    case "reject":
    case "resolve":
    case "close": {
      const r = await store.load(need(args[0], "caseId"));
      const reviewer = need(values.reviewer, "--reviewer");
      if (command === "close") closeCase(r, reviewer);
      else if (command === "resolve") resolveTask(r, need(args[1], "taskId"), need(values.status, "--status") as ItemStatus, reviewer, need(values.reason, "--reason"));
      else (command === "approve" ? approveProposal : rejectProposal)(r, need(args[1], "proposalId"), reviewer, need(values.reason, "--reason"));
      await store.save(r);
      printCase(r);
      return;
    }

    default:
      console.log(USAGE);
  }
}

main().catch((err) => {
  console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
