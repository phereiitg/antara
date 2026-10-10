from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from antara_core import __version__
from antara_core.main import create_app

GEMINI_SECRET = "AIzaSyTEST-gemini-secret-0123456789"
GNANI_SECRET = "gnani-test-secret-abcdef123456"


@pytest.fixture
def client() -> TestClient:
    return TestClient(create_app())


def test_health(client: TestClient):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "service": "antara-core", "version": __version__, "environment": "development"}


def test_providers_degraded_without_keys(client: TestClient):
    r = client.get("/health/providers")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "degraded"
    assert body["missing_configuration"] == ["GEMINI_API_KEY", "GNANI_API_KEY"]
    by_name = {p["provider"]: p for p in body["providers"]}
    assert by_name["gemini"]["configured"] is False
    assert by_name["gnani"]["configured"] is False
    assert by_name["gnani"]["selected"] is True
    assert by_name["cline-bridge"]["details"]["status"] == "not implemented in Phase 1"


def test_providers_ok_with_keys_and_no_secret_leak(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI_SECRET)
    monkeypatch.setenv("GNANI_API_KEY", GNANI_SECRET)
    r = TestClient(create_app()).get("/health/providers")
    body = r.json()
    assert body["status"] == "ok" and body["missing_configuration"] == []
    by_name = {p["provider"]: p for p in body["providers"]}
    assert by_name["gemini"]["configured"] is True
    assert by_name["gemini"]["details"]["model"] == "gemini-3.8-flash"
    assert by_name["gnani"]["details"]["language_supported"] is True
    assert GEMINI_SECRET not in r.text and GNANI_SECRET not in r.text


def test_providers_flags_unsupported_language(monkeypatch):
    monkeypatch.setenv("GNANI_LANGUAGE", "xx-YY")
    body = TestClient(create_app()).get("/health/providers").json()
    gnani = next(p for p in body["providers"] if p["provider"] == "gnani")
    assert gnani["details"]["language_supported"] is False


def test_provider_health_makes_no_network_calls(monkeypatch):
    import httpx

    def forbidden(*args, **kwargs):
        raise AssertionError("health endpoint must not call providers")

    monkeypatch.setattr(httpx.Client, "send", forbidden)
    monkeypatch.setenv("GEMINI_API_KEY", GEMINI_SECRET)
    # TestClient itself uses httpx.Client.send, so call the route function directly.
    app = create_app()
    route = next(r for r in app.routes if getattr(r, "path", None) == "/health/providers")
    from antara_core.config import load_settings

    result = route.endpoint(settings=load_settings())
    assert result.providers[0].configured is True
