import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scriptedCaseModel } from "../src/cline-runtime/scripted-model";
import { assessImage, photoCheckFor } from "../src/engine/fusion";
import { ImageInputError, MAX_IMAGE_BYTES, readImage } from "../src/engine/image";
import { runCase, type PipelineDeps } from "../src/engine/pipeline";
import { FileCaseStore } from "../src/store";
import { extraction, fakeGnani, goodImage, StepLlm, verification, writeImages } from "./helpers/multimodal";

let dir: string;
let store: FileCaseStore;
let audio: string;
let img: Awaited<ReturnType<typeof writeImages>>;
const base = { domainId: "jal_shakti", checklistId: "field_sample_capture", language: "hi-IN" };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "antara-mms-"));
  store = new FileCaseStore(join(dir, "data"));
  audio = join(dir, "report.wav");
  await writeFile(audio, Buffer.from("RIFF....WAVE synthetic"));
  img = await writeImages(dir);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const deps = (llm: StepLlm, extra: Partial<PipelineDeps> = {}): PipelineDeps => ({ llm, stt: fakeGnani(), store, ...extra });

describe("voice/photo conflict and agent fallback", () => {
  it("6. photo contradicts the spoken finding: review forced, voice finding NOT overridden", async () => {
    const llm = new StepLlm({ extraction, verification, image_analysis: goodImage({ 2: "present", 3: "absent" }) });
    const r = await runCase({ ...base, audio: [audio], images: [img.jpg] }, deps(llm));
    expect(r.results[2]).toMatchObject({ status: "NEEDS_REVIEW", proposedStatus: "PASS", reasons: ["VISUAL_DISAGREES"] });
    expect(r.results[2].visual).toMatchObject({ source: "photo", assessment: "inconsistent" });
    expect(r.evidenceSummary).toMatchObject({ conflicting: [3], needsHumanVerification: [3], imageCorroborated: [2] });
    expect(r.reviewerTasks).toEqual([expect.objectContaining({ itemIds: [3], createdBy: "system" })]); // guardrail fallback (no agent)
  });

  it("a photo can never upgrade a voice FAIL or an unclear answer", () => {
    const item = { id: 3, question: "q", passCondition: "p", responseType: "pass_fail_na" as const, visualCheck: "chart" };
    const ev = [assessImage("photo-1", "x", "m", goodImage({ 3: "present" }))];
    expect(photoCheckFor(item, "FAIL", ev)).toMatchObject({ assessment: "cannot_tell" });
    expect(photoCheckFor(item, undefined, ev)).toBeUndefined();
    expect(photoCheckFor({ ...item, visualCheck: undefined }, "PASS", ev)).toBeUndefined();
  });

  it("flags analyses that claim water safety or concentrations a photo cannot show", () => {
    const bad = { ...goodImage(), summary: "The water appears safe to drink, about 2 mg/L." };
    expect(assessImage("photo-1", "x", "m", bad)).toMatchObject({ reviewRequired: true, reviewReason: expect.stringMatching(/cannot support/) });
  });

  it("8. live agent unavailable (crashes): case stays reviewable via guardrail tasks, reported as live-failed", async () => {
    const llm = new StepLlm({ extraction, verification, image_analysis: goodImage({ 2: "present", 3: "absent" }) });
    const agent = { backend: { kind: "model" as const, model: scriptedCaseModel({ failWith: "provider down" }), label: "x" }, label: "cline:gemini/test", execution: "live" as const };
    const r = await runCase({ ...base, audio: [audio], images: [img.jpg] }, deps(llm, { agent }));
    expect(r.agentRun).toMatchObject({ mode: "cline", execution: "live" });
    expect(r.agentRun!.status).not.toBe("completed");
    expect(r.reviewerTasks).toEqual([expect.objectContaining({ itemIds: [3], createdBy: "system" })]);
    expect(r.state).toBe("PENDING_REVIEW");
  });

  it("a scripted agent is labelled scripted, never live", async () => {
    const llm = new StepLlm({ extraction, verification });
    const agent = { backend: { kind: "model" as const, model: scriptedCaseModel(), label: "scripted" }, label: "cline:scripted-model" };
    const r = await runCase({ ...base, audio: [audio] }, deps(llm, { agent }));
    expect(r.agentRun).toMatchObject({ execution: "scripted", status: "completed" });
  });
});

describe("image input validation", () => {
  it("accepts JPEG/PNG with matching signatures and rejects everything else before any model call", async () => {
    await expect(readImage(img.jpg)).resolves.toMatchObject({ mimeType: "image/jpeg" });
    await expect(readImage(img.png)).resolves.toMatchObject({ mimeType: "image/png" });
    await expect(readImage(img.fake)).rejects.toThrow(/does not match/);
    const gif = join(dir, "x.gif");
    await writeFile(gif, "GIF89a");
    await expect(readImage(gif)).rejects.toBeInstanceOf(ImageInputError);
    const big = join(dir, "big.jpg");
    await writeFile(big, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(MAX_IMAGE_BYTES)]));
    await expect(readImage(big)).rejects.toThrow(/limit is 10 MB/);
  });

  it("an invalid image aborts the case in ERROR before anything is sent", async () => {
    const llm = new StepLlm({ extraction, verification });
    const stt = fakeGnani();
    await expect(runCase({ ...base, audio: [audio], images: [img.fake] }, deps(llm, { stt }))).rejects.toThrow(/does not match/);
    expect(llm.steps).toEqual([]);
    expect(stt.calls).toEqual([]);
  });
});
