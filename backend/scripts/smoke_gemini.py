"""LIVE Gemini smoke test (uses your GEMINI_API_KEY and costs a few tokens).

    python scripts/smoke_gemini.py                       # text + JSON tests
    python scripts/smoke_gemini.py --image path\\to\\photo.jpg   # also the vision test

Test 1 (text): asks for the literal token ANTARA_OK.
Test 2 (JSON): structured output against a small schema.
Test 3 (vision, optional): a general, grounded description of the supplied image. No water
quality, chemical or safety conclusions are requested or accepted from a photograph.
"""

from __future__ import annotations

import argparse
import sys
import time
from collections.abc import Callable

import _bootstrap  # noqa: F401

from antara_core.config import ConfigError, configure_logging, load_settings
from antara_core.integrations.gemini_client import GeminiClient, GeminiError


def run(name: str, fn: Callable[[], str]) -> bool:
    t0 = time.perf_counter()
    try:
        detail = fn()
    except (GeminiError, ConfigError) as exc:
        print(f"FAIL  {name} [{time.perf_counter() - t0:.1f}s] {type(exc).__name__}: {exc}")
        return False
    print(f"PASS  {name} [{time.perf_counter() - t0:.1f}s] {detail}")
    return True


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--image", help="JPG/PNG/WEBP image for the vision test")
    parser.add_argument("--model", help="override GEMINI_MODEL for this run")
    args = parser.parse_args()

    settings = load_settings()
    configure_logging(settings)
    try:
        client = GeminiClient.from_settings(settings)
    except ConfigError as exc:
        print(f"BLOCKED  {exc}")
        return 2
    if args.model:
        client.model = args.model
    print(f"Gemini model: {client.model}\n")

    def text_test() -> str:
        out = client.generate_text("Reply with exactly this token and nothing else: ANTARA_OK")
        if "ANTARA_OK" not in out:
            raise GeminiError(f"unexpected reply: {out[:100]!r}")
        return repr(out.strip()[:50])

    def json_test() -> str:
        schema = {
            "type": "object",
            "properties": {"status": {"type": "string", "enum": ["ok"]}, "echo": {"type": "string"}},
            "required": ["status", "echo"],
        }
        out = client.generate_json('Return status "ok" and echo the word "antara".', schema)
        if out.get("status") != "ok":
            raise GeminiError(f"unexpected JSON: {out}")
        return str(out)

    ok = run("text generation", text_test)
    ok = run("JSON structured output", json_test) and ok

    if args.image:
        def vision_test() -> str:
            obs = client.describe_image(args.image)
            lines = [f"quality={obs.image_quality}", f"summary: {obs.summary}"]
            lines += [f"  - {o}" for o in obs.observations[:6]]
            if obs.visible_text:
                lines.append(f"  visible text: {obs.visible_text[:5]}")
            return "\n      ".join(lines)

        ok = run(f"vision ({args.image})", vision_test) and ok
    else:
        print("SKIP  vision (pass --image path\\to\\photo.jpg)")

    print("\nNote: the vision output is a general description, not a water-quality or safety result.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
