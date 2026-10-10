import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { getAdapter, getChecklist, type DomainAdapter } from "../adapters";
import {
  Transcript,
  VerificationResult,
  VisualCheck,
  type CaseRecord,
  type EvidenceFrame,
  type ItemFinding,
  type ItemResult,
  type MediaRef,
} from "../contracts";
import { runCaseAgent, type AgentBackend } from "../cline-runtime/agent";
import type { JsonLlm } from "../integrations/llm";
import { extractAudio, grabFrame, mimeFor, sha256File } from "../integrations/media";
import type { SpeechToText } from "../integrations/stt";
import type { FileCaseStore } from "../store";
import { decideItem, type Verification } from "./decide";
import { buildExtractionPrompt, EXTRACTION_JSON_SCHEMA, parseExtraction } from "./extraction";
import { locateQuote, type QuoteMatch } from "./grounding";
import { applyFallbackTasks } from "./guardrails";
import { logEvent, transition } from "./state";
import { buildVerificationPrompt, VERIFIABLE_FINDINGS, VERIFICATION_JSON_SCHEMA } from "./verify";
import { buildVisionPrompt, VISION_JSON_SCHEMA } from "./vision";

// The Meta-glasses pipeline (pipeline.py) re-cut into ANTARA's stages:
//   glasses clips / phone audio+photos -> speech-to-text -> checklist extraction -> quote grounding
//   -> verification -> evidence frames at the quote's timestamp -> vision cross-check -> per-item decision
//   -> Cline agent proposes follow-up (PENDING only) -> guardrail fallback -> human review.

export interface PipelineDeps {
  llm: JsonLlm;
  stt?: SpeechToText;
  agent?: { backend: AgentBackend; label: string; timeoutMs?: number };
  store: FileCaseStore;
}

export interface CaseInput {
  domainId: string;
  checklistId?: string;
  language?: string;
  videos?: string[]; // e.g. several <= 3-minute glasses clips from one inspection
  audio?: string[];
  photos?: { path: string; itemIds?: number[] }[];
  transcript?: Transcript; // pre-made transcript (tests, demo); skips speech-to-text
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function ingestMedia(record: CaseRecord, input: CaseInput, dir: string): Promise<void> {
  const mediaDir = join(dir, "media");
  await mkdir(mediaDir, { recursive: true });
  const add = async (kind: MediaRef["kind"], path: string, itemIds?: number[]) => {
    const id = `${kind}-${record.media.length + 1}`;
    const stored = join(mediaDir, `${id}${extname(path).toLowerCase()}`);
    await copyFile(path, stored); // keep an immutable copy with the case
    record.media.push({ id, kind, path: stored, sha256: await sha256File(stored), mime: mimeFor(path), itemIds });
  };
  for (const p of input.videos ?? []) await add("video", p);
  for (const p of input.audio ?? []) await add("audio", p);
  for (const p of input.photos ?? []) await add("photo", p.path, p.itemIds);
  logEvent(record, "system", "MEDIA_INGESTED", record.media.map(({ id, kind, sha256 }) => ({ id, kind, sha256 })));
}

async function buildTranscript(record: CaseRecord, input: CaseInput, deps: PipelineDeps, dir: string): Promise<Transcript> {
  if (input.transcript) return Transcript.parse(input.transcript);
  const speech = record.media.filter((m) => m.kind === "video" || m.kind === "audio");
  if (speech.length === 0) throw new Error("No speech input: pass --video, --audio or --transcript");
  if (!deps.stt) throw new Error("No speech-to-text provider configured");
  await mkdir(join(dir, "audio"), { recursive: true });
  const parts: Transcript[] = [];
  for (const m of speech) {
    let audioPath = m.path;
    if (m.kind === "video") {
      audioPath = join(dir, "audio", `${m.id}.wav`);
      await extractAudio(m.path, audioPath);
    }
    parts.push(await deps.stt.transcribe(audioPath, { language: record.language, clipId: m.id }));
  }
  return {
    language: parts[0].language,
    provider: parts[0].provider,
    timestampsApproximate: parts.some((p) => p.timestampsApproximate),
    segments: parts.flatMap((p) => p.segments),
  };
}

async function extract(record: CaseRecord, deps: PipelineDeps, adapter: DomainAdapter): Promise<Map<number, ItemFinding>> {
  const checklist = getChecklist(adapter, record.checklistId);
  try {
    const raw = await deps.llm.generateJson({
      step: "extraction",
      prompt: buildExtractionPrompt(checklist, record.transcript!),
      schema: EXTRACTION_JSON_SCHEMA,
    });
    return parseExtraction(raw, checklist);
  } catch (err) {
    // Degrade to manual review instead of crashing the run (pipeline.py exited here).
    logEvent(record, "system", "EXTRACTION_FAILED", { error: errorText(err) });
    return new Map();
  }
}

async function verify(record: CaseRecord, deps: PipelineDeps, adapter: DomainAdapter, findings: ItemFinding[]) {
  const out = new Map<number, Verification>();
  const toVerify = findings.filter((f) => VERIFIABLE_FINDINGS.has(f.finding));
  if (toVerify.length === 0) return out;
  try {
    const raw = await deps.llm.generateJson({
      step: "verification",
      prompt: buildVerificationPrompt(getChecklist(adapter, record.checklistId), record.transcript!, toVerify),
      schema: VERIFICATION_JSON_SCHEMA,
    });
    for (const v of VerificationResult.parse(raw).items) out.set(v.item_id, { supported: v.supported, note: v.note });
  } catch (err) {
    logEvent(record, "system", "VERIFICATION_FAILED", { error: errorText(err) });
  }
  for (const f of toVerify) if (!out.has(f.item_id)) out.set(f.item_id, "unavailable");
  return out;
}

async function collectFrames(record: CaseRecord, adapter: DomainAdapter, result: ItemResult, dir: string): Promise<EvidenceFrame[]> {
  const frames: EvidenceFrame[] = record.media
    .filter((m) => m.kind === "photo" && m.itemIds?.includes(result.itemId))
    .map((m) => ({ path: m.path, timestamp: 0, sha256: m.sha256 }));

  const window = result.quoteWindow;
  const video = window?.clipId ? record.media.find((m) => m.id === window.clipId && m.kind === "video") : undefined;
  if (!window || !video || !adapter.allowVideoFrames) return frames;

  // Frames from when the inspector was talking about this item (CLIP search over every frame is gone).
  const pad = record.transcript?.timestampsApproximate ? 2 : 1;
  const times = [...new Set([window.start - pad, (window.start + window.end) / 2, window.end + pad].map((t) => Math.max(0, Number(t.toFixed(1)))))];
  await mkdir(join(dir, "frames"), { recursive: true });
  for (const [k, t] of times.entries()) {
    const path = join(dir, "frames", `item${result.itemId}_${k + 1}_${String(t).replace(".", "_")}s.jpg`);
    try {
      if (await grabFrame(video.path, t, path)) frames.push({ path, clipId: video.id, timestamp: t, sha256: await sha256File(path) });
    } catch (err) {
      logEvent(record, "system", "FRAME_GRAB_FAILED", { itemId: result.itemId, t, error: errorText(err) });
    }
  }
  return frames;
}

export async function runCase(input: CaseInput, deps: PipelineDeps): Promise<CaseRecord> {
  const adapter = getAdapter(input.domainId);
  const checklist = getChecklist(adapter, input.checklistId);
  const now = new Date().toISOString();
  const record: CaseRecord = {
    id: randomUUID(), domainId: adapter.id, adapterVersion: adapter.version, checklistId: checklist.id,
    state: "DRAFT", language: input.language ?? adapter.defaultLanguage, createdAt: now, updatedAt: now,
    media: [], results: [], hasContradictions: false, proposals: [], reviewerTasks: [], clarifications: [],
    models: { extraction: deps.llm.model, verification: deps.llm.model, vision: deps.llm.model }, events: [],
  };
  const dir = deps.store.caseDir(record.id);
  logEvent(record, "system", "CASE_CREATED", { domain: adapter.id, checklist: checklist.id });
  transition(record, "PROCESSING", "system");

  try {
    await ingestMedia(record, input, dir);
    record.transcript = await buildTranscript(record, input, deps, dir);
    record.models.stt = record.transcript.provider;
  } catch (err) {
    transition(record, "ERROR", "system", { error: errorText(err) });
    await deps.store.save(record);
    throw err;
  }

  const findings = await extract(record, deps, adapter);
  const matches = new Map<number, QuoteMatch>();
  for (const f of findings.values()) matches.set(f.item_id, locateQuote(f.quote, record.transcript.segments));
  const verifications = await verify(record, deps, adapter, [...findings.values()]);

  if (record.media.some((m) => m.kind === "video") && !adapter.allowVideoFrames) {
    logEvent(record, "system", "VIDEO_FRAMES_DISABLED", { reason: `${adapter.id} adapter does not allow frames from wearable video` });
  }
  for (const item of checklist.items) {
    const inputs = { item, finding: findings.get(item.id), match: matches.get(item.id), verification: verifications.get(item.id) };
    let result = decideItem(inputs);
    const frames = await collectFrames(record, adapter, result, dir);
    if (frames.length && (result.proposedStatus === "PASS" || result.proposedStatus === "FAIL")) {
      try {
        const media = await Promise.all(frames.map(async (f) => ({ mimeType: mimeFor(f.path), data: await readFile(f.path) })));
        const raw = await deps.llm.generateJson({
          step: "vision", prompt: buildVisionPrompt(item, result.proposedStatus, result.quote), schema: VISION_JSON_SCHEMA, media,
        });
        result = decideItem({ ...inputs, visual: VisualCheck.parse(raw) });
      } catch (err) {
        logEvent(record, "system", "VISION_CHECK_FAILED", { itemId: item.id, error: errorText(err) });
      }
    }
    result.frames = frames;
    record.results.push(result);
  }
  record.hasContradictions = record.results.some((r) => r.reasons.includes("CONFLICTING_STATEMENTS"));
  const counts = Object.fromEntries(
    [...new Set(record.results.map((r) => r.status))].map((s) => [s, record.results.filter((r) => r.status === s).length]),
  );
  logEvent(record, "system", "ITEMS_DECIDED", counts);

  transition(record, "AGENT_RUNNING", "system");
  if (deps.agent) {
    record.models.agent = deps.agent.label;
    record.agentRun = await runCaseAgent(record, adapter, checklist, { backend: deps.agent.backend, timeoutMs: deps.agent.timeoutMs });
    logEvent(record, "agent", "AGENT_FINISHED", { status: record.agentRun.status, error: record.agentRun.error });
  } else {
    record.agentRun = { mode: "skipped", status: "skipped", rejectedToolCalls: [] };
  }
  applyFallbackTasks(record, adapter);
  transition(record, "PENDING_REVIEW", "system");
  await deps.store.save(record);
  return record;
}
