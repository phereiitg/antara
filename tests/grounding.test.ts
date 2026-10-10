import { describe, expect, it } from "vitest";
import { locateQuote } from "../src/engine/grounding";

const segs = [
  { clipId: "video-1", start: 0, end: 4, text: "Pin is in place and the tamper seal looks fine." },
  { clipId: "video-1", start: 4, end: 7, text: "The extinguisher is not damaged." },
  { clipId: "video-2", start: 0, end: 5, text: "नेमप्लेट वाले निर्देश पढ़ने लायक नहीं हैं, बहुत फीके हो गए हैं।" },
  { clipId: "video-2", start: 5, end: 9, text: "Gauge is in the green. Hose looks okay" },
  { clipId: "video-2", start: 9, end: 12, text: "but the nozzle is clogged." },
];

describe("locateQuote", () => {
  it("finds an exact quote and returns its clip and time window", () => {
    const m = locateQuote("The extinguisher is NOT damaged!", segs);
    expect(m).toMatchObject({ grounded: true, approximate: false, clipId: "video-1", start: 4, end: 7 });
  });

  it("finds a quote that spans two segments", () => {
    const m = locateQuote("Hose looks okay but the nozzle is clogged", segs);
    expect(m).toMatchObject({ grounded: true, clipId: "video-2", start: 5, end: 12 });
  });

  it("matches Devanagari text (combining vowel marks kept)", () => {
    const m = locateQuote("निर्देश पढ़ने लायक नहीं हैं", segs);
    expect(m).toMatchObject({ grounded: true, clipId: "video-2", start: 0 });
  });

  it("rejects a quote with the negation removed (pipeline.py's word overlap accepted this)", () => {
    expect(locateQuote("The extinguisher is damaged", segs).grounded).toBe(false);
  });

  it("rejects a quote with a negation added", () => {
    expect(locateQuote("Pin is not in place and the tamper seal looks fine", segs).grounded).toBe(false);
  });

  it("accepts small ASR differences in a long quote, marked approximate", () => {
    const m = locateQuote("Pin is in place and the tamper seal look fine", segs);
    expect(m).toMatchObject({ grounded: true, approximate: true, clipId: "video-1" });
  });

  it("rejects paraphrases and too-short quotes", () => {
    expect(locateQuote("The pressure gauge is in the green range", segs).grounded).toBe(false);
    expect(locateQuote("fine", segs).grounded).toBe(false);
    expect(locateQuote("", segs).grounded).toBe(false);
  });
});
