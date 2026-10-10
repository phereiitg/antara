import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { extname } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const bundled = createRequire(import.meta.url)("ffmpeg-static") as string | null;
  if (!bundled) throw new Error("No ffmpeg: set FFMPEG_PATH or reinstall ffmpeg-static");
  return bundled;
}

export async function sha256File(path: string): Promise<string> {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4", ".mov": "video/quicktime", ".mkv": "video/x-matroska", ".webm": "video/webm",
  ".wav": "audio/wav", ".mp3": "audio/mp3", ".m4a": "audio/aac", ".ogg": "audio/ogg", ".flac": "audio/flac",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".heic": "image/heic",
};

export function mimeFor(path: string): string {
  const mime = MIME[extname(path).toLowerCase()];
  if (!mime) throw new Error(`Unsupported media type: ${path}`);
  return mime;
}

// 16 kHz mono PCM16 WAV: the format the blueprint lists for Gnani, and small enough to send
// a 3-5 minute glasses clip inline to Gemini (~32 KB/s).
export async function extractAudio(videoPath: string, wavPath: string): Promise<void> {
  await run(ffmpegPath(), ["-y", "-v", "error", "-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath], {
    maxBuffer: 16 * 1024 * 1024,
  });
}

// Grab one frame at `seconds`. Returns false when there is no frame there (past the end).
export async function grabFrame(videoPath: string, seconds: number, jpgPath: string): Promise<boolean> {
  await run(ffmpegPath(), ["-y", "-v", "error", "-ss", seconds.toFixed(2), "-i", videoPath, "-frames:v", "1", "-q:v", "3", jpgPath], {
    maxBuffer: 16 * 1024 * 1024,
  });
  try {
    return (await stat(jpgPath)).size > 0;
  } catch {
    return false;
  }
}
