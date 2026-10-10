import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Transcript } from "../src/contracts";
import { decideItem } from "../src/engine/decide";
import { buildExtractionPrompt } from "../src/engine/extraction";
import { locateQuote } from "../src/engine/grounding";
import { GnaniStt, SttServiceError } from "../src/integrations/stt";
import { HINDI, pythonTranscript, startFakeService, type FakeService } from "./helpers/fake-stt-service";

// GnaniStt against a stand-in for the Python service (offline). The live path through the real
// FastAPI service and the Gnani API is exercised by scripts/live-gnani-stt.ts.

let dir: string;
let wav: string;
let svc: FakeService | undefined;
const start = async (status: number, body: unknown) => (svc = await startFakeService(status, body));
const opts = { language: "hi-IN", clipId: "audio-1" };

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "antara-gnani-"));
  wav = join(dir, "clip.wav");
  await writeFile(wav, Buffer.from("RIFF....WAVEfmt fake audio bytes"));
});
afterAll(() => rm(dir, { recursive: true, force: true }));
afterEach(async () => {
  await svc?.close();
  svc = undefined;
});

describe("GnaniStt (TypeScript -> Python STT service)", () => {
  it("posts the audio and language, and returns an untimed engine transcript", async () => {
    const s = await start(200, pythonTranscript);
    const t = await new GnaniStt(s.url).transcribe(wav, opts);

    expect(s.last!.url).toBe("/internal/stt/transcribe");
    expect(s.last!.contentType).toMatch(/^multipart\/form-data/);
    expect(s.last!.body).toContain('name="audio"; filename="clip.wav"');
    expect(s.last!.body).toMatch(/name="language"\r\n\r\nhi-IN/);
    expect(t).toEqual({
      language: "hi-IN", provider: "gnani:gnani-prisma-v2.5", timestampsApproximate: false,
      segments: [{ text: HINDI, clipId: "audio-1" }], // no start/end: none were supplied
    });
    expect(Transcript.parse(t)).toEqual(t); // valid against the engine contract
  });

  it("lets the engine ground a quote in an untimed transcript without inventing a time window", async () => {
    const t = await new GnaniStt((await start(200, pythonTranscript)).url).transcribe(wav, opts);
    const match = locateQuote("पानी का नमूना हैंडपंप से लिया गया है", t.segments);
    expect(match).toMatchObject({ grounded: true, approximate: false, clipId: "audio-1" });
    expect(match.start).toBeUndefined();
    expect(locateQuote("पानी का नमूना हैंडपंप से नहीं लिया गया है", t.segments).grounded).toBe(false); // negation added

    const item = { id: 2, question: "Source stated?", passCondition: "The source type is stated", responseType: "pass_fail_na" as const };
    const r = decideItem({
      item, match, verification: { supported: true, note: "" },
      finding: { item_id: 2, finding: "meets", conflicting_statements: false, quote: "हैंडपंप से लिया गया है", date: "", numeric_value: "", note: "" },
    });
    expect(r).toMatchObject({ status: "PASS", reasons: [] });
    expect(r.quoteWindow).toBeUndefined();

    const prompt = buildExtractionPrompt({ id: "c", name: "c", standard: "s", items: [item] }, t);
    expect(prompt).toContain(`<transcript>\n[audio-1] ${HINDI}\n</transcript>`); // no fake "0.0s" label
  });

  it("keeps real provider timings when the service supplies them", async () => {
    const timed = { ...pythonTranscript, timestampsAvailable: true, segments: [{ text: HINDI, start: 1.5, end: 4 }] };
    const t = await new GnaniStt((await start(200, timed)).url).transcribe(wav, { language: "hi-IN", clipId: "a" });
    expect(t.segments).toEqual([{ text: HINDI, start: 1.5, end: 4, clipId: "a" }]);
  });

  it.each([
    [422, { error: "unsupported_audio", message: "Audio is 61.0s; Gnani STT REST accepts at most 60s" }, "unsupported_audio", /at most 60s/],
    [502, { error: "provider_auth_failed", message: "Gnani HTTP 401: Invalid API key" }, "provider_auth_failed", /provider_auth_failed/],
    [504, { error: "provider_timeout", message: "timed out" }, "provider_timeout", /timed out/],
    [500, "<html>oops</html>", "service_error", /HTTP 500/],
  ])("maps service errors (HTTP %i)", async (status, body, code, message) => {
    const err = await new GnaniStt((await start(status, body)).url).transcribe(wav, opts).catch((e) => e);
    expect(err).toBeInstanceOf(SttServiceError);
    expect(err).toMatchObject({ code, status });
    expect(err.message).toMatch(message);
  });

  it("rejects a malformed transcript instead of passing it on", async () => {
    const err = await new GnaniStt((await start(200, { language: "hi-IN" })).url).transcribe(wav, opts).catch((e) => e);
    expect(err).toMatchObject({ code: "invalid_response" });
  });

  it("rejects an empty transcript", async () => {
    const empty = { ...pythonTranscript, text: "", segments: [] };
    const err = await new GnaniStt((await start(200, empty)).url).transcribe(wav, opts).catch((e) => e);
    expect(err).toMatchObject({ code: "empty_transcript" });
  });

  it("reports an unreachable service clearly", async () => {
    const s = await start(200, {});
    await s.close();
    svc = undefined;
    const err = await new GnaniStt(s.url).transcribe(wav, opts).catch((e) => e);
    expect(err).toMatchObject({ code: "service_unavailable" });
    expect(err.message).toMatch(/unreachable/);
  });

  it("fails on a missing local audio file before any request", async () => {
    await expect(new GnaniStt("http://127.0.0.1:9").transcribe(join(dir, "missing.wav"), opts)).rejects.toThrow(/ENOENT/);
  });
});
