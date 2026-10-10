import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadDemo } from "../src/demo";
import { runCase, type PipelineDeps } from "../src/engine/pipeline";
import { FileCaseStore } from "../src/store";
import { extraction, fakeGnani, goodImage, StepLlm, verification, writeImages } from "./helpers/multimodal";

let dir: string;
let store: FileCaseStore;
let audio: string;
let img: Awaited<ReturnType<typeof writeImages>>;
const base = { domainId: "jal_shakti", checklistId: "field_sample_capture", language: "hi-IN" };
const ALL_CLEAN = [[1, "PASS", []], [2, "PASS", []], [3, "PASS", []], [4, "RECORDED", []]];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "antara-mmf-"));
  store = new FileCaseStore(join(dir, "data"));
  audio = join(dir, "report.wav");
  await writeFile(audio, Buffer.from("RIFF....WAVE synthetic"));
  img = await writeImages(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const deps = (llm: StepLlm): PipelineDeps => ({ llm, stt: fakeGnani(), store });

describe("photo failures never block or alter voice decisions", () => {
  it("4. Gemini image-analysis failure: case completes, photo flagged for manual review", async () => {
    const r = await runCase({ ...base, audio: [audio], images: [img.jpg] }, deps(new StepLlm({ extraction, verification, image_analysis: new Error("Gemini HTTP 503") })));
    expect(r.state).toBe("PENDING_REVIEW");
    expect(r.results.map((x) => [x.itemId, x.status, x.reasons])).toEqual(ALL_CLEAN);
    expect(r.imageEvidence![0]).toMatchObject({ status: "failed", reviewRequired: true, error: "Gemini HTTP 503" });
    expect(r.reviewerTasks).toEqual([expect.objectContaining({ itemIds: [2, 3], createdBy: "system", reason: expect.stringMatching(/could not be analysed/) })]);
    expect(r.events.map((e) => e.type)).toContain("IMAGE_ANALYSIS_FAILED");
    expect(r.evidenceSummary!.needsHumanVerification).toEqual([2, 3]);
  });

  it("5. poor-quality image: not used for fusion, review task, voice decision unchanged", async () => {
    const unusable = { ...goodImage(), image_quality: "unusable" as const, quality_issues: ["severe blur"] };
    const r = await runCase({ ...base, audio: [audio], images: [img.jpg] }, deps(new StepLlm({ extraction, verification, image_analysis: unusable })));
    expect(r.results[1]).toMatchObject({ status: "PASS" });
    expect(r.results[1].visual).toBeUndefined();
    expect(r.imageEvidence![0]).toMatchObject({ reviewRequired: true, reviewReason: expect.stringMatching(/unusable: severe blur/) });
    expect(r.reviewerTasks[0].reason).toMatch(/Photo evidence needs human review/);
  });

  it("missing evidence is reported as missing, never filled from the photo", async () => {
    const partial = { items: [extraction.items[0], { ...extraction.items[1], finding: "not_mentioned", quote: "" }, extraction.items[2]] };
    const r = await runCase({ ...base, audio: [audio], images: [img.jpg] }, deps(new StepLlm({ extraction: partial, verification, image_analysis: goodImage() })));
    expect(r.results[1]).toMatchObject({ status: "NOT_INSPECTED" }); // bottle visible, but nobody said a sample was collected
    expect(r.results[3]).toMatchObject({ status: "NEEDS_REVIEW", reasons: ["EXTRACTION_MISSING_ITEM"] });
    expect(r.evidenceSummary).toMatchObject({ missing: [2, 4], imageCorroborated: [3] });
  });
});

describe("9. backward compatibility: timed transcripts are unaffected by the photo path", () => {
  it("the fire-safety demo with a timed transcript gives the same results as before", async () => {
    const { transcript, llm } = await loadDemo();
    const r = await runCase({ domainId: "fire_safety", checklistId: "fire_extinguisher", language: "hi-IN", transcript }, { llm, store });
    expect(r.results.map((x) => [x.itemId, x.status, x.reasons])).toEqual([
      [1, "PASS", []], [2, "PASS", []], [3, "NOT_INSPECTED", []], [4, "NEEDS_REVIEW", ["CONFLICTING_STATEMENTS"]],
      [5, "NEEDS_REVIEW", ["QUOTE_NOT_IN_TRANSCRIPT"]], [6, "FAIL", []], [7, "FAIL", []], [8, "NEEDS_REVIEW", ["UNCLEAR_ANSWER"]],
    ]);
    expect(r.results[0].quoteWindow).toEqual({ clipId: "video-1", start: 4.2, end: 9.8 }); // timings still used
    expect(r.imageEvidence).toBeUndefined();
    expect(r.evidenceSummary!.voice!.timings).toBe("provider");
    expect(r.agentRun).toMatchObject({ mode: "skipped", execution: "skipped" });
  });

  it("the original ftk_screening checklist and its demo limit are unchanged", async () => {
    const { getAdapter, getChecklist } = await import("../src/adapters");
    const ftk = getChecklist(getAdapter("jal_shakti"), "ftk_screening");
    expect(ftk.items.find((i) => i.id === 5)).toMatchObject({ max: 1.0, unit: "demo units" });
    expect(getChecklist(getAdapter("jal_shakti")).id).toBe("ftk_screening"); // still the default checklist
  });
});
