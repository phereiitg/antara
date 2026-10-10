import type { JsonLlm, JsonRequest } from "./llm";

// Minimal Gemini REST client with JSON-schema output. Replaces the OpenRouter call in
// pipeline.py, which parsed free text with json.loads and crashed the run on bad JSON.

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const MAX_INLINE_BYTES = 18 * 1024 * 1024; // inline request limit is ~20 MB; larger files need the Files API
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

export class GeminiError extends Error {}

export class GeminiClient implements JsonLlm {
  constructor(
    private readonly apiKey: string,
    readonly model: string,
    private readonly timeoutMs = 120_000,
    private readonly maxAttempts = 3,
  ) {
    if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set");
  }

  async generateJson({ prompt, schema, media = [] }: JsonRequest): Promise<unknown> {
    const mediaBytes = media.reduce((n, m) => n + m.data.length, 0);
    if (mediaBytes > MAX_INLINE_BYTES) {
      throw new GeminiError(
        `Media is ${(mediaBytes / 1e6).toFixed(1)} MB; inline limit is ~18 MB. Split the clip (glasses clips are <= 3-5 min) or add Files API upload.`,
      );
    }
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            ...media.map((m) => ({ inlineData: { mimeType: m.mimeType, data: m.data.toString("base64") } })),
            { text: prompt },
          ],
        },
      ],
      generationConfig: { temperature: 0.1, responseMimeType: "application/json", responseJsonSchema: schema },
    };

    let lastError: Error = new GeminiError("no attempts made");
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      if (attempt > 1) await new Promise((r) => setTimeout(r, 1000 * 2 ** (attempt - 2)));
      let res: Response;
      try {
        res = await fetch(`${API_BASE}/models/${encodeURIComponent(this.model)}:generateContent`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-goog-api-key": this.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        lastError = err instanceof Error ? err : new GeminiError(String(err)); // network error or timeout
        continue;
      }
      if (res.ok) return parseResponse(await res.json());
      lastError = new GeminiError(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
      if (!RETRYABLE.has(res.status)) throw lastError;
    }
    throw lastError;
  }
}

function parseResponse(json: any): unknown {
  const candidate = json?.candidates?.[0];
  if (!candidate) {
    throw new GeminiError(`Gemini returned no candidates (blockReason: ${json?.promptFeedback?.blockReason ?? "unknown"})`);
  }
  if (candidate.finishReason && candidate.finishReason !== "STOP") {
    throw new GeminiError(`Gemini stopped with finishReason ${candidate.finishReason}`);
  }
  const text: string = (candidate.content?.parts ?? [])
    .filter((p: any) => typeof p.text === "string" && !p.thought)
    .map((p: any) => p.text)
    .join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError(`Gemini returned invalid JSON: ${text.slice(0, 200)}`);
  }
}
