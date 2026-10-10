import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runCase, type PipelineDeps } from "../src/engine/pipeline";
import { FileCaseStore } from "../src/store";
import { extraction, fakeGnani, goodImage, StepLlm, verification, writeImages } from "./helpers/multimodal";

// Jal Shakti voice + independent photo pipeline (Milestone 2). All model calls are scripted.

let dir: string;
let store: FileCaseStore;
let audio: string;
let img: Awaited<ReturnType<typeof writeImages>>;
const base = { domainId: "jal_shakti", checklistId: "field_sample_capture", language: "hi-IN" };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "antara-mm-"));
  store = new FileCaseStore(join(dir, "data"));
  audio = join(dir, "report.wav");
  await writeFile(audio, Buffer.from("RIFF....WAVE synthetic"));
  img = await writeImages(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const deps = (llm: StepLlm): PipelineDeps => ({ llm, stt: fakeGnani(), store });
const statuses = (r: Awaited<ReturnType<typeof runCase>>) => r.results.map((x) => [x.itemId, x.status, x.reasons]);
const ALL_CLEAN = [[1, "PASS", []], [2, "PASS", []], [3, "PASS", []], [4, "RECORDED", []]];

describe("Jal Shakti: voice + independent photo", () => {
  it("1+7. audio + image processed independently, photo corroborates, case record saved", async () => {
    const llm = new StepLlm({ extraction, verification, image_analysis: goodImage() });
    const r = await runCase({ ...base, audio: [audio], images: [img.jpg], metadata: { source: "Handpump", location: "Demo Village A" } }, deps(llm));

    expect(r.state).toBe("PENDING_REVIEW");
    expect(r.metadata).toEqual({ source: "Handpump", location: "Demo Village A" });
    expect(r.media.map((m) => [m.kind, m.role])).toEqual([["audio", undefined], ["photo", "evidence_photo"]]);
    expect(statuses(r)).toEqual(ALL_CLEAN);
    expect(r.results[1].visual).toMatchObject({ source: "photo", assessment: "consistent", item_visible: true });
    expect(r.results[0].visual).toBeUndefined(); // item 1 has no visualCheck: photo never consulted
    expect(r.results.every((x) => x.quoteWindow === undefined && x.frames.length === 0)).toBe(true); // untimed
    expect(r.imageEvidence).toEqual([expect.objectContaining({ mediaId: "photo-2", status: "analysed", reviewRequired: false })]);
    expect(r.evidenceSummary).toMatchObject({
      voice: { provider: "gnani:test", timings: "none" }, confirmed: [1, 2, 3, 4], imageCorroborated: [2, 3],
      missing: [], conflicting: [], needsHumanVerification: [],
    });
    expect(r.evidenceSummary!.disclaimer).toMatch(/not a laboratory result/);
    expect(llm.steps.map((s) => s.step)).toEqual(["image_analysis", "extraction", "verification"]);
    expect(llm.steps[0].media![0].mimeType).toBe("image/jpeg");
    expect(llm.steps[0].prompt).toMatch(/Do not infer chemical composition/);

    const saved = JSON.parse(await readFile(join(store.caseDir(r.id), "case.json"), "utf8"));
    expect(saved).toMatchObject({ id: r.id, state: "PENDING_REVIEW", metadata: { source: "Handpump" }, imageEvidence: [{ status: "analysed" }] });
  });

  it("2. audio without an image: voice-only decisions, no image step", async () => {
    const llm = new StepLlm({ extraction, verification });
    const r = await runCase({ ...base, audio: [audio] }, deps(llm));
    expect(statuses(r)).toEqual(ALL_CLEAN);
    expect(r.imageEvidence).toBeUndefined();
    expect(r.results.every((x) => x.visual === undefined)).toBe(true);
    expect(llm.steps.map((s) => s.step)).not.toContain("image_analysis");
  });

  it("3. untimed transcript + PNG: grounding by text, no invented times in the prompt", async () => {
    const llm = new StepLlm({ extraction, verification, image_analysis: goodImage({ 2: "present", 3: "cannot_tell" }) });
    const r = await runCase({ ...base, audio: [audio], images: [img.png] }, deps(llm));
    expect(r.results[2]).toMatchObject({ status: "PASS", visual: { assessment: "cannot_tell" } }); // cannot_tell does not force review
    expect(llm.steps[1].prompt).toMatch(/<transcript>\n\[audio-1\] यह पानी/);
    expect(llm.steps[1].prompt).not.toMatch(/0\.0s/);
    expect(r.evidenceSummary!.imageCorroborated).toEqual([2]);
  });
});
