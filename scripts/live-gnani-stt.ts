// LIVE end-to-end STT check (uses Gnani credits through the Python service):
//   TypeScript GnaniStt -> Python FastAPI /internal/stt/transcribe -> Gnani API -> validated Transcript
//
// Start the Python service first (from backend/):
//   .\.venv\Scripts\python.exe -m uvicorn antara_core.main:app --port 8000
// Then, from the repository root:
//   npx tsx scripts/live-gnani-stt.ts <audio.wav> [language] [--expect-error <code>]
//
// Prints only the transcript and metadata; the Gnani key stays inside the Python process.

import { existsSync } from "node:fs";
import { Transcript, transcriptText } from "../src/contracts";
import { locateQuote } from "../src/engine/grounding";
import { GnaniStt, SttServiceError } from "../src/integrations/stt";

if (existsSync(".env")) process.loadEnvFile(".env");
const [audio, maybeLang, ...rest] = process.argv.slice(2);
if (!audio) {
  console.error("usage: npx tsx scripts/live-gnani-stt.ts <audio> [language] [--expect-error <code>]");
  process.exit(2);
}
const language = maybeLang && !maybeLang.startsWith("--") ? maybeLang : "hi-IN";
const flags = maybeLang?.startsWith("--") ? [maybeLang, ...rest] : rest;
const expectError = flags[0] === "--expect-error" ? flags[1] : undefined;
const serviceUrl = process.env.PYTHON_SERVICE_URL?.trim() || "http://127.0.0.1:8000";

const t0 = Date.now();
try {
  const transcript = await new GnaniStt(serviceUrl).transcribe(audio, { language, clipId: "audio-1" });
  if (expectError) {
    console.log(`FAIL  expected error ${expectError}, got a transcript`);
    process.exit(1);
  }
  Transcript.parse(transcript); // engine contract
  const text = transcriptText(transcript);
  const words = text.split(/\s+/).filter(Boolean);
  const probe = words.slice(1, Math.min(words.length, 6)).join(" ");
  const match = locateQuote(probe, transcript.segments);
  console.log(`PASS  TypeScript received a Gnani transcript via ${serviceUrl} [${Date.now() - t0} ms]`);
  console.log(JSON.stringify(transcript, null, 2));
  console.log(`engine check: grounded "${probe}" -> grounded=${match.grounded}, time window=${match.start === undefined ? "none (untimed)" : `${match.start}-${match.end}s`}`);
} catch (err) {
  if (err instanceof SttServiceError) {
    if (expectError && err.code === expectError) {
      console.log(`PASS  expected error ${err.code} (HTTP ${err.status ?? "-"}): ${err.message}`);
      process.exit(0);
    }
    console.log(`FAIL  ${err.code} (HTTP ${err.status ?? "-"}): ${err.message}`);
  } else {
    console.log(`FAIL  ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
}
