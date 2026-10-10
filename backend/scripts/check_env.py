"""Check the ANTARA environment configuration without calling any paid API.

    python scripts/check_env.py

Exit code 0 when everything required by the selected providers is set, 1 otherwise.
Secret values are never printed; only whether they are set.
"""

from __future__ import annotations

import sys

import _bootstrap  # noqa: F401

from pydantic import ValidationError

from antara_core.config import env_file_path, load_settings
from antara_core.integrations.gnani_client import SUPPORTED_LANGUAGES


def main() -> int:
    path = env_file_path()
    print(f"Env file : {path} ({'found' if path.is_file() else 'NOT FOUND - using process environment only'})")
    try:
        s = load_settings()
    except ValidationError as exc:
        print("Configuration is invalid:")
        for err in exc.errors():
            print(f"  {'.'.join(str(p) for p in err['loc']).upper()}: {err['msg']}")
        return 1

    def flag(ok: bool) -> str:
        return "set" if ok else "MISSING"

    print(f"ENVIRONMENT      : {s.environment}")
    print(f"VISION_PROVIDER  : {s.vision_provider}")
    print(f"STT_PROVIDER     : {s.stt_provider}")
    print(f"GEMINI_API_KEY   : {flag(s.gemini_configured)}")
    print(f"GEMINI_MODEL     : {s.gemini_model}")
    print(f"GNANI_API_KEY    : {flag(s.gnani_configured)}")
    lang_note = "" if s.gnani_language in SUPPORTED_LANGUAGES else "  (NOT a supported Gnani language)"
    print(f"GNANI_LANGUAGE   : {s.gnani_language}{lang_note}")
    print(f"GNANI_BASE_URL   : {s.gnani_base_url}")
    print(f"CLINE_BRIDGE_URL : {s.cline_bridge_url}  (bridge not implemented in Phase 1)")
    print(f"ANTARA_DATA_DIR  : {s.data_dir}")
    print(f"DATABASE_URL     : {s.database_url}")

    problems = s.missing_required()
    if s.gnani_language not in SUPPORTED_LANGUAGES:
        problems.append("GNANI_LANGUAGE (unsupported)")
    if problems:
        print(f"\nNot ready: {', '.join(problems)}. Edit {path}.")
        return 1
    print("\nConfiguration OK (no API calls were made).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
