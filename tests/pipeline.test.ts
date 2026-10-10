import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Transcript } from "../src/contracts";
import { scriptedCaseModel } from "../src/cline-runtime/scripted-model";
import { loadDemo, ScriptedLlm } from "../src/demo";
import { runCase, type PipelineDeps } from "../src/engine/pipeline";
import { approveProposal, closeCase, resolveTask } from "../src/engine/review";
import { ffmpegPath, sha256File } from "../src/integrations/media";
import type { SpeechToText } from "../src/integrations/stt";
import { FileCaseStore } from "../src/store";

let dir: string;
let store: FileCaseStore;
const clips: string[] = [];

// Two synthetic "glasses clips" (test pattern + tone), like one inspection split across recordings.
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "antara-test-"));
  store = new FileCaseStore(join(dir, "data"));
  for (const n of [1, 2]) {
    const out = join(dir, `clip${n}.mp4`);
    await promisify(execFile)(ffmpegPath(), [
      "-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=26:size=320x240:rate=10",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=26", "-shortest", "-c:v", "mpeg4", "-c:a", "aac", out,
    ]);
    clips.push(out);
  }
}, 120_000);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const scriptedAgent: PipelineDeps["agent"] = { backend: { kind: "model", model: scriptedCaseModel(), label: "scripted" }, label: "scripted" };

describe("full pipeline, offline demo fixture", () => {
  it("decides items, runs the Cline agent, and goes through review to the mock connector", async () => {
    const { transcript, llm } = await loadDemo();
    const record = await runCase({ domainId: "fire_safety", checklistId: "fire_extinguisher", language: "hi-IN", transcript }, { llm, store, agent: scriptedAgent });

    expect(record.state).toBe("PENDING_REVIEW");
    expect(record.results.map((r) => [r.itemId, r.status, r.reasons])).toEqual([
      [1, "PASS", []],
      [2, "PASS", []],
      [3, "NOT_INSPECTED", []],
      [4, "NEEDS_REVIEW", ["CONFLICTING_STATEMENTS"]],
      [5, "NEEDS_REVIEW", ["QUOTE_NOT_IN_TRANSCRIPT"]],
      [6, "FAIL", []],
      [7, "FAIL", []],
      [8, "NEEDS_REVIEW", ["UNCLEAR_ANSWER"]],
    ]);
    expect(record.hasContradictions).toBe(true);
    expect(record.agentRun).toMatchObject({ mode: "cline", status: "completed" });

    const saved = await store.load(record.id.slice(0, 8));
    approveProposal(saved, saved.proposals[0].id.slice(0, 8), "Fire Officer", "Confirmed on site");
    expect(saved.state).toBe("PENDING_REVIEW"); // reviewer task still open
    resolveTask(saved, saved.reviewerTasks[0].id, "NOT_INSPECTED", "Fire Officer", "Re-inspect next visit");
    expect(saved.state).toBe("SUBMITTED_TO_MOCK_SYSTEM");
    expect(saved.proposals[0].mockReference).toMatch(/^MOCK-RECTIFICATION_NOTICE_DRAFT-/);
    closeCase(saved, "Fire Officer");
    expect(saved.state).toBe("CLOSED");
    expect(saved.events.map((e) => e.type)).toEqual(expect.arrayContaining(["PROPOSAL_APPROVED", "TASK_RESOLVED", "MOCK_SUBMITTED", "STATE_CLOSED"]));
  });

  it("review rules: reason and reviewer required, no double decisions", async () => {
    const { transcript, llm } = await loadDemo();
    const record = await runCase({ domainId: "fire_safety", checklistId: "fire_extinguisher", transcript }, { llm, store, agent: scriptedAgent });
    const id = record.proposals[0].id;
    expect(() => approveProposal(record, id, "", "ok")).toThrow(/Reviewer identity/);
    expect(() => approveProposal(record, id, "A", " ")).toThrow(/reason/);
    approveProposal(record, id, "A", "ok");
    expect(() => approveProposal(record, id, "A", "again")).toThrow(/already APPROVED/);
    expect(() => resolveTask(record, record.reviewerTasks[0].id, "NEEDS_REVIEW", "A", "x")).toThrow(/Final status/);
  });

  it("a failed extraction call degrades to manual review instead of crashing", async () => {
    const { transcript } = await loadDemo();
    const record = await runCase({ domainId: "fire_safety", checklistId: "fire_extinguisher", transcript }, { llm: new ScriptedLlm({}), store });
    expect(new Set(record.results.map((r) => r.status))).toEqual(new Set(["NEEDS_REVIEW"]));
    expect(record.events.map((e) => e.type)).toContain("EXTRACTION_FAILED");
    expect(record.reviewerTasks).toEqual([expect.objectContaining({ itemIds: [1, 2, 3, 4, 5, 6, 7, 8], createdBy: "system" })]);
    expect(record.state).toBe("PENDING_REVIEW");
  });
});

describe("glasses video path", () => {
  it("extracts 16 kHz mono audio from each clip and hands it to speech-to-text", async () => {
    const { transcript, llm } = await loadDemo();
    const seen: string[] = [];
    const stt: SpeechToText = {
      provider: "fake-stt",
      async transcribe(audioPath, { clipId }): Promise<Transcript> {
        seen.push(audioPath);
        return { ...transcript, provider: "fake-stt", segments: transcript.segments.filter((s) => s.clipId === clipId) };
      },
    };
    const record = await runCase({ domainId: "fire_safety", checklistId: "fire_extinguisher", videos: clips }, { llm: wrapVision(llm, "consistent"), stt, store });

    expect(seen).toHaveLength(2);
    const wav = await readFile(seen[0]);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.readUInt16LE(22)).toBe(1); // channels
    expect(wav.readUInt32LE(24)).toBe(16000); // sample rate
    expect(record.transcript!.segments).toHaveLength(9);
    expect(record.media.map((m) => m.sha256)).toEqual([await sha256File(clips[0]), await sha256File(clips[1])]);
  }, 60_000);

  it("takes frames at the quote's timestamps and lets vision disagreement force review", async () => {
    const { transcript, llm } = await loadDemo();
    const record = await runCase(
      { domainId: "fire_safety", checklistId: "fire_extinguisher", videos: clips, transcript },
      { llm: wrapVision(llm, "inconsistent"), store },
    );
    const item6 = record.results.find((r) => r.itemId === 6)!; // Hindi quote, clip 2, 6.4-12.9 s
    expect(item6.frames.map((f) => [f.clipId, f.timestamp])).toEqual([["video-2", 5.4], ["video-2", 9.7], ["video-2", 13.9]]);
    expect(item6.frames.every((f) => existsSync(f.path) && f.sha256.length === 64)).toBe(true);
    expect(item6).toMatchObject({ status: "NEEDS_REVIEW", proposedStatus: "FAIL", reasons: ["VISUAL_DISAGREES"] });
    // no vision check for items with no proposed PASS/FAIL
    expect(record.results.find((r) => r.itemId === 8)!.visual).toBeUndefined();
  }, 60_000);

  it("does not save or analyse wearable frames for the education domain (minors in view)", async () => {
    const t: Transcript = {
      language: "hi-IN", provider: "fixture", timestampsApproximate: false,
      segments: [{ clipId: "video-1", start: 2, end: 6, text: "लड़कियों के शौचालय में पानी नहीं है और दरवाज़ा टूटा है।" }],
    };
    const llm = new ScriptedLlm({
      extraction: { items: [{ item_id: 1, finding: "does_not_meet", conflicting_statements: false, quote: "लड़कियों के शौचालय में पानी नहीं है", date: "", numeric_value: "", note: "No water, broken door" }] },
      verification: { items: [{ item_id: 1, supported: true, note: "" }] },
      vision: { item_visible: true, assessment: "consistent", observations: [] },
    });
    const record = await runCase({ domainId: "education", videos: [clips[0]], transcript: t }, { llm, store, agent: scriptedAgent });
    expect(record.results[0]).toMatchObject({ status: "FAIL", frames: [] });
    expect(record.events.map((e) => e.type)).toContain("VIDEO_FRAMES_DISABLED");
    expect(record.proposals).toEqual([expect.objectContaining({ actionType: "repair_inspection", itemIds: [1] })]);
  }, 60_000);
});

function wrapVision(base: ScriptedLlm, assessment: "consistent" | "inconsistent") {
  return {
    model: base.model,
    generateJson: (req: Parameters<ScriptedLlm["generateJson"]>[0]) =>
      req.step === "vision"
        ? Promise.resolve({ item_visible: true, assessment, observations: ["synthetic test pattern"] })
        : base.generateJson(req),
  };
}
