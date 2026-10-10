from __future__ import annotations

import logging

import pytest

from antara_core.config import (
    DEFAULT_GEMINI_MODEL,
    REPO_ROOT,
    ConfigError,
    SecretRedactingFilter,
    configure_logging,
    load_settings,
    redact,
)

GEMINI_SECRET = "AIzaSyTEST-gemini-secret-0123456789"
GNANI_SECRET = "gnani-test-secret-abcdef123456"


def test_defaults_without_env_file():
    s = load_settings()
    assert s.environment == "development"
    assert s.gemini_model == DEFAULT_GEMINI_MODEL
    assert s.gnani_language == "hi-IN"
    assert s.stt_provider == "gnani"
    assert s.vision_provider == "gemini"
    assert s.cline_bridge_url == "http://127.0.0.1:4317"
    assert not s.gemini_configured and not s.gnani_configured


def test_loads_values_from_env_file(write_env):
    write_env(
        f"ENVIRONMENT=test\nGEMINI_API_KEY={GEMINI_SECRET}\nGEMINI_MODEL=gemini-custom\n"
        f"GNANI_API_KEY={GNANI_SECRET}\nGNANI_LANGUAGE=ta-IN\nANTARA_DATA_DIR=./data\n"
        "CLINE_PROVIDER_ID=gemini\n"  # TypeScript-only variable must be ignored, not rejected
    )
    s = load_settings()
    assert s.environment == "test"
    assert s.gemini_model == "gemini-custom"
    assert s.gnani_language == "ta-IN"
    assert s.require_gemini_key() == GEMINI_SECRET
    assert s.require_gnani_key() == GNANI_SECRET
    assert s.data_dir == (REPO_ROOT / "data").resolve()
    assert s.missing_required() == []


def test_blank_values_fall_back_to_defaults(write_env):
    write_env("GEMINI_API_KEY=\nGEMINI_MODEL=\nGNANI_LANGUAGE=\n")
    s = load_settings()
    assert s.gemini_model == DEFAULT_GEMINI_MODEL
    assert s.gnani_language == "hi-IN"
    assert not s.gemini_configured


def test_process_environment_overrides_env_file(write_env, monkeypatch):
    write_env("GEMINI_MODEL=from-file\n")
    monkeypatch.setenv("GEMINI_MODEL", "from-process")
    assert load_settings().gemini_model == "from-process"


def test_missing_keys_are_reported_with_readable_errors():
    s = load_settings()
    assert s.missing_required() == ["GEMINI_API_KEY", "GNANI_API_KEY"]
    with pytest.raises(ConfigError, match="GEMINI_API_KEY is not set"):
        s.require_gemini_key()
    with pytest.raises(ConfigError, match="GNANI_API_KEY is not set"):
        s.require_gnani_key()


def test_whitespace_only_key_counts_as_missing(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "   ")
    assert not load_settings().gemini_configured


def test_stt_provider_gemini_does_not_require_gnani(monkeypatch):
    monkeypatch.setenv("STT_PROVIDER", "gemini")
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI_SECRET)
    assert load_settings().missing_required() == []


def test_invalid_provider_is_rejected(monkeypatch):
    monkeypatch.setenv("STT_PROVIDER", "whisper")
    with pytest.raises(ValueError, match="stt_provider"):
        load_settings()


def test_secrets_hidden_in_repr_and_dump(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI_SECRET)
    monkeypatch.setenv("GNANI_API_KEY", GNANI_SECRET)
    s = load_settings()
    for rendered in (repr(s), str(s), s.model_dump_json(), str(s.model_dump())):
        assert GEMINI_SECRET not in rendered
        assert GNANI_SECRET not in rendered


def test_redact_helper():
    assert redact(f"key={GEMINI_SECRET}!", [GEMINI_SECRET]) == "key=***!"
    assert redact("abc", ["ab"]) == "abc"  # very short values are not treated as secrets


def test_logging_filter_redacts_secrets(monkeypatch, caplog):
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI_SECRET)
    monkeypatch.setenv("GNANI_API_KEY", GNANI_SECRET)
    s = load_settings()
    logger = logging.getLogger("antara.test.redaction")
    caplog.handler.addFilter(SecretRedactingFilter(s.secret_values()))
    with caplog.at_level(logging.INFO):
        logger.info("calling with %s and %s", GEMINI_SECRET, GNANI_SECRET)
        try:
            raise RuntimeError(f"boom {GNANI_SECRET}")
        except RuntimeError:
            logger.exception("failed")
    assert GEMINI_SECRET not in caplog.text
    assert GNANI_SECRET not in caplog.text
    assert "***" in caplog.text


def test_configure_logging_is_idempotent(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI_SECRET)
    s = load_settings()
    configure_logging(s)
    configure_logging(s)
    for handler in logging.getLogger().handlers:
        assert sum(isinstance(f, SecretRedactingFilter) for f in handler.filters) == 1
