import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { getAdapter, getChecklist, type DomainAdapter } from "../adapters";
import {
  ImageAnalysis,
  Transcript,
  VerificationResult,
  VisualCheck,
  type CaseRecord,
  type Checklist,
  type EvidenceFrame,
  type ImageEvidence,
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
import { assessImage, photoCheckFor } from "./fusion";
import { buildImageAnalysisPrompt, IMAGE_ANALYSIS_JSON_SCHEMA, readImage } from "./image";
import { summarizeEvidence } from "./report";
import { buildVerificationPrompt, VERIFIABLE_FINDINGS, VERIFICATION_JSON_SCHEMA } from "./verify";
import { buildVisionPrompt, VISION_JSON_SCHEMA } from "./vision";

// The Meta-glasses pipeline (pipeline.py) re-cut into ANTARA's stages:
//   glasses clips / phone audio+photos -> speech-to-text -> checklist extraction -> quote grounding
//   -> verification -> evidence frames at the quote's timestamp -> vision cross-check -> per-item decision
//   -> Cline agent proposes follow-up (PENDING only) -> guardrail fallback -> human review.

export interface PipelineDeps {
  llm: JsonLlm;
  stt?: SpeechToText;
  // execution labels how the agent runs so a scripted run is never reported as live.
  agent?: { backend: AgentBackend; label: string; timeoutMs?: number; execution?: "live" | "scripted" };
  store: FileCaseStore;
}

export interface CaseInput {
  domainId: string;
  checklistId?: string;
  language?: string;
  videos?: string[]; // e.g. several <= 3-minute glasses clips from one inspection
  audio?: string[];
  photos?: { path: string; itemIds?: number[] }[];
  // Independent still photos (JPEG/PNG), analysed once per case and fused per item. Unlike
  // video frames they need no transcript timings, so they work with Gnani transcripts.
  images?: string[];
  metadata?: Record<string, string>; // operator-entered case details (sample source, location...)
  transcript?: Transcript; // pre-made transcript (tests, demo); skips speech-to-text
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function ingestMedia(record: CaseRecord, input: CaseInput, dir: string): Promise<void> {
  const mediaDir = join(dir, "media");
  await mkdir(mediaDir, { recursive: true });
  const add = async (kind: MediaRef["kind"], path: string, itemIds?: number[], role?: MediaRef["role"]) => {
    const id = `${kind}-${record.media.length + 1}`;
    const stored = join(mediaDir, `${id}${extname(path).toLowerCase()}`);
    await copyFile(path, stored); // keep an immutable copy with the case
    const ref: MediaRef = { id, kind, path: stored, sha256: await sha256File(stored), mime: mimeFor(path), itemIds };
    if (role) ref.role = role;
    record.media.push(ref);
  };
  for (const p of input.images ?? []) await readImage(p); // validate type, size and signature before storing anything
  for (const p of input.videos ?? []) await add("video", p);
  for (const p of input.audio ?? []) await add("audio", p);
  for (const p of input.photos ?? []) await add("photo", p.path, p.itemIds);
  for (const p of input.images ?? []) await add("photo", p, undefined, "evidence_photo");
  logEvent(record, "system", "MEDIA_INGESTED", record.media.map(({ id, kind, sha256 }) => ({ id, kind, sha256 })));
}

// Analyse each independent photo once. A failed or unusable analysis is recorded and flagged
// for review; it never blocks the case and never stands in for missing voice evidence.
async function analyseImages(record: CaseRecord, deps: PipelineDeps, adapter: DomainAdapter, checklist: Checklist) {
  const photos = record.media.filter((m) => m.role === "evidence_photo");
  const items = checklist.items.filter((i) => i.visualCheck);
  const out: ImageEvidence[] = [];
  for (const m of photos) {
    try {
      const { mimeType, data } = await readImage(m.path);
      const raw = await deps.llm.generateJson({
        step: "image_analysis", prompt: buildImageAnalysisPrompt(items, adapter.imageGuidance), schema: IMAGE_ANALYSIS_JSON_SCHEMA,
        media: [{ mimeType, data }],
      });
      const ev = assessImage(m.id, m.sha256, deps.llm.model, ImageAnalysis.parse(raw));
      out.push(ev);
      logEvent(record, "system", "IMAGE_ANALYSED", { mediaId: m.id, quality: ev.analysis!.image_quality, reviewRequired: ev.reviewRequired });
    } catch (err) {
      out.push({ mediaId: m.id, sha256: m.sha256, status: "failed", error: errorText(err), reviewRequired: true,
        reviewReason: "Photo could not be analysed automatically; review it manually." });
      logEvent(record, "system", "IMAGE_ANALYSIS_FAILED", { mediaId: m.id, error: errorText(err) });
    }
  }
  return out;
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
  if (input.metadata && Object.keys(input.metadata).length) record.metadata = { ...input.metadata };
  const dir = deps.store.caseDir(record.id);
  logEvent(record, "system", "CASE_CREATED", { domain: adapter.id, checklist: checklist.id, metadata: record.metadata });
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

  // Voice and photo are processed independently and only meet in the per-item decision below.
  if (record.media.some((m) => m.role === "evidence_photo")) {
    record.imageEvidence = await analyseImages(record, deps, adapter, checklist);
    record.models.image_analysis = deps.llm.model;
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
        result = decideItem({ ...inputs, visual: { ...VisualCheck.parse(raw), source: "frames" } });
      } catch (err) {
        logEvent(record, "system", "VISION_CHECK_FAILED", { itemId: item.id, error: errorText(err) });
      }
    } else if (record.imageEvidence?.length) {
      // No timed frames for this item (e.g. untimed Gnani transcript): use the independent photo.
      const visual = photoCheckFor(item, result.proposedStatus, record.imageEvidence);
      if (visual) result = decideItem({ ...inputs, visual });
    }
    result.frames = frames;
    record.results.push(result);
  }
  record.hasContradictions = record.results.some((r) => r.reasons.includes("CONFLICTING_STATEMENTS"));
  const counts = Object.fromEntries(
    [...new Set(record.results.map((r) => r.status))].map((s) => [s, record.results.filter((r) => r.status === s).length]),
  );
  logEvent(record, "system", "ITEMS_DECIDED", counts);

  // Photos that could not be used are a review item in their own right.
  const badPhotos = (record.imageEvidence ?? []).filter((e) => e.reviewRequired);
  if (badPhotos.length) {
    record.reviewerTasks.push({
      id: randomUUID(), itemIds: checklist.items.filter((i) => i.visualCheck).map((i) => i.id), severity: "normal",
      createdBy: "system", status: "OPEN",
      reason: `Photo evidence needs human review: ${badPhotos.map((e) => `${e.mediaId}: ${e.reviewReason}`).join(" | ")}`,
    });
    logEvent(record, "system", "IMAGE_REVIEW_TASK", { mediaIds: badPhotos.map((e) => e.mediaId) });
  }

  transition(record, "AGENT_RUNNING", "system");
  if (deps.agent) {
    const execution = deps.agent.execution ?? (deps.agent.backend.kind === "provider" ? "live" : "scripted");
    record.models.agent = deps.agent.label;
    record.agentRun = { ...(await runCaseAgent(record, adapter, checklist, { backend: deps.agent.backend, timeoutMs: deps.agent.timeoutMs })), execution };
    logEvent(record, "agent", "AGENT_FINISHED", { execution, status: record.agentRun.status, error: record.agentRun.error });
  } else {
    record.agentRun = { mode: "skipped", execution: "skipped", status: "skipped", rejectedToolCalls: [] };
  }
  applyFallbackTasks(record, adapter);
  record.evidenceSummary = summarizeEvidence(record, adapter);
  transition(record, "PENDING_REVIEW", "system");
  await deps.store.save(record);
  return record;
}
