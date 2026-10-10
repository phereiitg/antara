import { afterEach, describe, expect, it, vi } from "vitest";
import { GeminiClient } from "../src/integrations/gemini";

const ok = (text: string, finishReason = "STOP") =>
  new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text }] } }] }), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe("GeminiClient (mocked HTTP)", () => {
  it("sends the schema, inline media and API key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok('{"a":1}'));
    vi.stubGlobal("fetch", fetchMock);
    const client = new GeminiClient("k", "gemini-test", 1000, 1);
    const out = await client.generateJson({ step: "vision", prompt: "p", schema: { type: "object" }, media: [{ mimeType: "image/jpeg", data: Buffer.from("img") }] });

    expect(out).toEqual({ a: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/models/gemini-test:generateContent");
    expect(init.headers["x-goog-api-key"]).toBe("k");
    const body = JSON.parse(init.body);
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", responseJsonSchema: { type: "object" } });
    expect(body.contents[0].parts[0]).toEqual({ inlineData: { mimeType: "image/jpeg", data: Buffer.from("img").toString("base64") } });
  });

  it("retries 503 and gives up immediately on 400", async () => {
    const flaky = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(ok("{}"));
    vi.stubGlobal("fetch", flaky);
    await expect(new GeminiClient("k", "m", 1000, 2).generateJson({ step: "extraction", prompt: "p", schema: {} })).resolves.toEqual({});
    expect(flaky).toHaveBeenCalledTimes(2);

    const bad = vi.fn().mockResolvedValue(new Response("bad schema", { status: 400 }));
    vi.stubGlobal("fetch", bad);
    await expect(new GeminiClient("k", "m", 1000, 3).generateJson({ step: "extraction", prompt: "p", schema: {} })).rejects.toThrow(/HTTP 400/);
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it("raises clear errors for truncated output, invalid JSON and oversized media", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok('{"a":', "MAX_TOKENS")));
    await expect(new GeminiClient("k", "m", 1000, 1).generateJson({ step: "extraction", prompt: "p", schema: {} })).rejects.toThrow(/MAX_TOKENS/);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok("not json")));
    await expect(new GeminiClient("k", "m", 1000, 1).generateJson({ step: "extraction", prompt: "p", schema: {} })).rejects.toThrow(/invalid JSON/);
    const huge = { mimeType: "audio/wav", data: Buffer.alloc(19 * 1024 * 1024) };
    await expect(new GeminiClient("k", "m").generateJson({ step: "transcription", prompt: "p", schema: {}, media: [huge] })).rejects.toThrow(/Split the clip/);
  });
});
