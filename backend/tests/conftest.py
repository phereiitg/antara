"""Test isolation: never read the developer's real .env or shell credentials."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from antara_core.config import get_settings  # noqa: E402

ANTARA_VARS = [
    "ENVIRONMENT", "LOG_LEVEL",
    "GEMINI_API_KEY", "GEMINI_MODEL", "GEMINI_TIMEOUT_SECONDS", "GEMINI_MAX_ATTEMPTS",
    "GNANI_API_KEY", "GNANI_LANGUAGE", "GNANI_BASE_URL", "GNANI_TIMEOUT_SECONDS", "GNANI_MAX_ATTEMPTS",
    "STT_PROVIDER", "VISION_PROVIDER", "CLINE_BRIDGE_URL", "ANTARA_DATA_DIR", "DATABASE_URL",
]


@pytest.fixture(autouse=True)
def isolated_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    for var in ANTARA_VARS:
        monkeypatch.delenv(var, raising=False)
    missing_env = tmp_path / "no.env"
    monkeypatch.setenv("ANTARA_ENV_FILE", str(missing_env))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


@pytest.fixture
def write_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    """Write a .env file and point the loader at it."""

    def _write(content: str) -> Path:
        path = tmp_path / ".env"
        path.write_text(content, encoding="utf-8")
        monkeypatch.setenv("ANTARA_ENV_FILE", str(path))
        get_settings.cache_clear()
        return path

    return _write
