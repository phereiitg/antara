"""LIVE Gnani STT smoke test (uses your GNANI_API_KEY and consumes Gnani credits).

    python scripts/smoke_gnani.py path\\to\\hindi_clip.wav
    python scripts/smoke_gnani.py path\\to\\clip.wav --language en-IN --format transcribe

The clip must be a real recording of speech: WAV/MP3/OGG/FLAC/AAC/M4A, 8-44.1 kHz, at most
60 seconds (ideal ~30 s). Synthetic tones or silence will (correctly) return an empty transcript.
"""

from __future__ import annotations

import argparse
import json
import sys
import time

import _bootstrap  # noqa: F401

from antara_core.config import ConfigError, configure_logging, load_settings
from antara_core.integrations.gnani_client import GnaniError, GnaniSTTClient, GnaniTranscriptionOptions


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("audio", help="short speech recording (<= 60 s)")
    parser.add_argument("--language", help="BCP-47 code, default GNANI_LANGUAGE (hi-IN)")
    parser.add_argument("--format", choices=["verbatim", "transcribe"], default="verbatim")
    args = parser.parse_args()

    settings = load_settings()
    configure_logging(settings)
    try:
        client = GnaniSTTClient.from_settings(settings)
    except ConfigError as exc:
        print(f"BLOCKED  {exc}")
        return 2

    t0 = time.perf_counter()
    try:
        result = client.transcribe(args.audio, args.language, GnaniTranscriptionOptions(format=args.format))
    except GnaniError as exc:
        print(f"FAIL  Gnani STT [{time.perf_counter() - t0:.1f}s] {type(exc).__name__}: {exc}")
        return 1
    finally:
        client.close()

    print(f"PASS  Gnani STT [{time.perf_counter() - t0:.1f}s]")
    print(json.dumps(result.model_dump(), ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
