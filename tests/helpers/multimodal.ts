import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ImageAnalysis, Transcript } from "../../src/contracts";
import type { JsonLlm, JsonRequest } from "../../src/integrations/llm";
import type { SpeechToText } from "../../src/integrations/stt";

// Shared fakes for the Jal Shakti voice + photo pipeline tests. All synthetic; no model calls.

export const HINDI_REPORT = [
  "यह पानी का नमूना हैंडपंप से लिया गया है।",
  "नमूना बोतल में भर लिया है।",
  "रंग चार्ट से मिलान करके जाँच की गई, रीडिंग 0.5 है।",
].join(" ");

// Untimed, like Gnani REST output after GnaniStt (no start/end).
export const untimedTranscript = (text = HINDI_REPORT): Transcript => ({
  language: "hi-IN", provider: "gnani:test", timestampsApproximate: false, segments: [{ text, clipId: "audio-1" }],
});

export const fakeGnani = (t: Transcript = untimedTranscript()): SpeechToText & { calls: string[] } => {
  const calls: string[] = [];
  return {
    provider: "gnani", calls,
    async transcribe(path, { clipId }) {
      calls.push(path);
      return { ...t, segments: t.segments.map((s) => ({ ...s, clipId })) };
    },
  };
};

const f = (item_id: number, finding: string, quote: string, extra: Record<string, unknown> = {}) => ({
  item_id, finding, conflicting_statements: false, quote, date: "", numeric_value: "", note: "", ...extra,
});

export const extraction = {
  items: [
    f(1, "meets", "यह पानी का नमूना हैंडपंप से लिया गया है"),
    f(2, "meets", "नमूना बोतल में भर लिया है"),
    f(3, "meets", "रंग चार्ट से मिलान करके जाँच की गई"),
    f(4, "value_reported", "रीडिंग 0.5 है", { numeric_value: "0.5" }),
  ],
};
export const verification = { items: [1, 2, 3, 4].map((item_id) => ({ item_id, supported: true, note: "stated" })) };

export const goodImage = (presence: Record<number, "present" | "absent" | "cannot_tell"> = { 2: "present", 3: "present" }): ImageAnalysis => ({
  image_quality: "good", quality_issues: [], summary: "A clear plastic bottle of pale liquid next to a printed colour card.",
  observations: ["clear bottle with liquid", "printed card with coloured squares"], visible_text: [], uncertainties: ["exact colour match cannot be judged"],
  items: Object.entries(presence).map(([id, p]) => ({ item_id: Number(id), presence: p, observation: `item ${id}: ${p}` })),
});

// Scripted JsonLlm keyed by step; a step mapped to an Error throws (simulates a model failure).
export class StepLlm implements JsonLlm {
  readonly model = "scripted-test";
  readonly steps: JsonRequest[] = [];
  constructor(private readonly responses: Partial<Record<JsonRequest["step"], unknown>>) {}
  async generateJson(req: JsonRequest): Promise<unknown> {
    this.steps.push(req);
    const r = this.responses[req.step];
    if (r instanceof Error) throw r;
    if (r === undefined) throw new Error(`no scripted response for ${req.step}`);
    return structuredClone(r);
  }
}

// Minimal real JPEG/PNG headers: enough for signature validation; never decoded in tests.
export async function writeImages(dir: string) {
  const jpg = join(dir, "sample.jpg");
  const png = join(dir, "sample.png");
  const fake = join(dir, "fake.jpg");
  await writeFile(jpg, Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64)]));
  await writeFile(png, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64)]));
  await writeFile(fake, Buffer.from("not really a jpeg"));
  return { jpg, png, fake };
}
