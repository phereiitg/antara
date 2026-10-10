"""Environment configuration for the ANTARA Python backend.

All settings come from environment variables, optionally loaded from the repository-root
``.env`` file (the same file the TypeScript CLI reads). Secrets are held as ``SecretStr`` so
they never appear in ``repr()``, logs or API responses.
"""

from __future__ import annotations

import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[1]
REPO_ROOT = BACKEND_DIR.parent
DEFAULT_ENV_FILE = REPO_ROOT / ".env"

# Verified against https://ai.google.dev/gemini-api/docs/models (stable, text + image input).
DEFAULT_GEMINI_MODEL = "gemini-3.8-flash"
# Verified against https://docs.gnani.ai/api/introduction (base URL for all Gnani speech APIs).
DEFAULT_GNANI_BASE_URL = "https://api.vachana.ai"


class ConfigError(RuntimeError):
    """Required configuration is missing or invalid. Messages never contain secret values."""


def env_file_path() -> Path:
    """The .env file to load: ``ANTARA_ENV_FILE`` if set, else ``<repo root>/.env``."""
    override = os.environ.get("ANTARA_ENV_FILE", "").strip()
    return Path(override) if override else DEFAULT_ENV_FILE


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file_encoding="utf-8",
        env_ignore_empty=True,  # GEMINI_MODEL= (blank) falls back to the default
        extra="ignore",  # the shared .env also holds TypeScript-only variables
        case_sensitive=False,
    )

    environment: Literal["development", "test", "staging", "production"] = "development"
    log_level: str = "INFO"

    gemini_api_key: SecretStr | None = None
    gemini_model: str = DEFAULT_GEMINI_MODEL
    gemini_timeout_seconds: float = Field(default=60.0, gt=0, le=600)
    gemini_max_attempts: int = Field(default=3, ge=1, le=6)

    gnani_api_key: SecretStr | None = None
    gnani_language: str = "hi-IN"
    gnani_base_url: str = DEFAULT_GNANI_BASE_URL
    gnani_timeout_seconds: float = Field(default=60.0, gt=0, le=600)
    gnani_max_attempts: int = Field(default=3, ge=1, le=6)

    stt_provider: Literal["gnani", "gemini", "fixture"] = "gnani"
    vision_provider: Literal["gemini"] = "gemini"

    cline_bridge_url: str = "http://127.0.0.1:4317"
    python_service_url: str = "http://127.0.0.1:8000"  # read by the TypeScript engine; listed for check_env

    antara_data_dir: str = "./data"
    database_url: str = "sqlite:///./data/antara.db"

    # ------------------------------------------------------------------ helpers
    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key and self.gemini_api_key.get_secret_value().strip())

    @property
    def gnani_configured(self) -> bool:
        return bool(self.gnani_api_key and self.gnani_api_key.get_secret_value().strip())

    @property
    def data_dir(self) -> Path:
        """Data directory; relative paths resolve against the repository root, not the cwd."""
        p = Path(self.antara_data_dir)
        return p if p.is_absolute() else (REPO_ROOT / p).resolve()

    def secret_values(self) -> list[str]:
        """All configured secret values (used only to redact them from logs)."""
        return [
            s.get_secret_value().strip()
            for s in (self.gemini_api_key, self.gnani_api_key)
            if s is not None and s.get_secret_value().strip()
        ]

    def require_gemini_key(self) -> str:
        if not self.gemini_configured:
            raise ConfigError(
                f"GEMINI_API_KEY is not set. Add it to {env_file_path()} "
                "(create a key at https://aistudio.google.com/apikey)."
            )
        return self.gemini_api_key.get_secret_value().strip()  # type: ignore[union-attr]

    def require_gnani_key(self) -> str:
        if not self.gnani_configured:
            raise ConfigError(
                f"GNANI_API_KEY is not set. Add it to {env_file_path()} "
                "(generate a key on the Gnani API dashboard)."
            )
        return self.gnani_api_key.get_secret_value().strip()  # type: ignore[union-attr]

    def missing_required(self) -> list[str]:
        """Variables required by the currently selected providers that are not set."""
        missing: list[str] = []
        needs_gemini = self.vision_provider == "gemini" or self.stt_provider == "gemini"
        if needs_gemini and not self.gemini_configured:
            missing.append("GEMINI_API_KEY")
        if self.stt_provider == "gnani" and not self.gnani_configured:
            missing.append("GNANI_API_KEY")
        return missing


def load_settings(env_file: Path | None = None) -> Settings:
    """Build settings from the process environment plus the .env file (environment wins)."""
    path = env_file if env_file is not None else env_file_path()
    return Settings(_env_file=path if path.is_file() else None)  # type: ignore[call-arg]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return load_settings()



# --------------------------------------------------------------------------- logging
def redact(text: str, secrets: list[str]) -> str:
    """Replace every occurrence of each secret (4+ chars) with ``***``."""
    for secret in secrets:
        if secret and len(secret) >= 4:
            text = text.replace(secret, "***")
    return text


class SecretRedactingFilter(logging.Filter):
    """Removes configured secret values from log records before any handler formats them."""

    def __init__(self, secrets: list[str]) -> None:
        super().__init__()
        self._secrets = [s for s in secrets if len(s) >= 4]

    def filter(self, record: logging.LogRecord) -> bool:
        if self._secrets:
            message = record.getMessage()
            redacted = redact(message, self._secrets)
            if redacted != message:
                record.msg, record.args = redacted, None
            if record.exc_info:
                # Format the traceback now (or reuse text cached by an earlier handler) so only
                # the redacted version can be emitted by any handler.
                text = record.exc_text or logging.Formatter().formatException(record.exc_info)
                record.exc_text = redact(text, self._secrets)
                record.exc_info = None
            elif record.exc_text:
                record.exc_text = redact(record.exc_text, self._secrets)
            if record.stack_info:
                record.stack_info = redact(record.stack_info, self._secrets)
        return True


def configure_logging(settings: Settings) -> None:
    """Root logging with secret redaction on every handler. Safe to call repeatedly."""
    root = logging.getLogger()
    if not root.handlers:
        logging.basicConfig(format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    root.setLevel(settings.log_level.upper())
    for handler in root.handlers:
        for f in list(handler.filters):
            if isinstance(f, SecretRedactingFilter):
                handler.removeFilter(f)
        handler.addFilter(SecretRedactingFilter(settings.secret_values()))
