import type { Segment } from "../contracts";

// Deterministic check that the model's quote really is in the transcript, and where.
// Replaces pipeline.py find_time_window(), whose bag-of-words overlap would accept
// "the extinguisher is damaged" as a match for "the extinguisher is not damaged".

export interface QuoteMatch {
  grounded: boolean;
  approximate: boolean;
  score: number;
  clipId?: string;
  start?: number;
  end?: number;
}

const MAX_WINDOW_SEGMENTS = 4;
const MIN_FUZZY_TOKENS = 4; // shorter quotes must match exactly
const MIN_FUZZY_RATIO = 0.9;

// Negation words in English, Hindi (Devanagari) and romanised Hindi. A fuzzy match must
// agree on these, because dropping one inverts the meaning of the quote.
const NEGATIONS = new Set([
  "no", "not", "never", "none", "nothing", "nobody", "neither", "nor", "without", "t", // "isn't" -> "isn t"
  "नहीं", "नही", "ना", "न", "मत", "बिना",
  "nahi", "nahin", "nahee", "nai", "mat", "bina",
]);

export function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    // keep letters, combining marks (Devanagari matras) and digits
    .replace(/[^\p{L}\p{M}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(" ") : [];
}

function negationsOf(toks: string[]): string {
  return toks.filter((t) => NEGATIONS.has(t)).sort().join(" ");
}

function lcsLength(a: string[], b: string[]): number {
  const prev = new Array(b.length + 1).fill(0);
  const cur = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = cur[j];
  }
  return prev[b.length];
}

// The stretch of the window that best lines up with the quote (allowing a word or two of
// ASR noise), so negation words elsewhere in the window don't affect the comparison.
function bestAlignedSpan(q: string[], w: string[]): { ratio: number; span: string[] } {
  let best = { ratio: 0, span: [] as string[] };
  for (let size = Math.max(1, q.length - 1); size <= q.length + 2; size++) {
    for (let k = 0; k + size <= w.length; k++) {
      const span = w.slice(k, k + size);
      const ratio = lcsLength(q, span) / q.length;
      if (ratio > best.ratio) best = { ratio, span };
    }
  }
  return best;
}

function groupByClip(segments: Segment[]): Segment[][] {
  const groups = new Map<string, Segment[]>();
  for (const s of segments) {
    const key = s.clipId ?? "";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  return [...groups.values()];
}

// Window length in seconds; untimed windows compare as 0, so the first exact match is kept.
function duration(span: { start?: number; end?: number }): number {
  return span.start !== undefined && span.end !== undefined ? span.end - span.start : 0;
}

export function locateQuote(quote: string, segments: Segment[]): QuoteMatch {
  const q = tokens(quote);
  const none: QuoteMatch = { grounded: false, approximate: false, score: 0 };
  if (q.length < 2) return none;
  const qNorm = q.join(" ");

  let best: QuoteMatch = none;
  for (const clip of groupByClip(segments)) {
    for (let i = 0; i < clip.length; i++) {
      for (let len = 1; len <= MAX_WINDOW_SEGMENTS && i + len <= clip.length; len++) {
        const window = clip.slice(i, i + len);
        const w = tokens(window.map((s) => s.text).join(" "));
        // Untimed segments (Gnani REST) leave start/end undefined: grounded by text, no window.
        const span = { clipId: window[0].clipId, start: window[0].start, end: window[len - 1].end };

        if (` ${w.join(" ")} `.includes(` ${qNorm} `)) {
          // exact match: the smallest window wins, so stop growing this one
          if (!best.grounded || best.approximate || duration(best) > duration(span)) {
            best = { grounded: true, approximate: false, score: 1, ...span };
          }
          break;
        }
        if (q.length < MIN_FUZZY_TOKENS) continue;
        const aligned = bestAlignedSpan(q, w);
        if (aligned.ratio >= MIN_FUZZY_RATIO && negationsOf(q) === negationsOf(aligned.span) && aligned.ratio > best.score) {
          best = { grounded: true, approximate: true, score: aligned.ratio, ...span };
        }
      }
    }
  }
  return best;
}
