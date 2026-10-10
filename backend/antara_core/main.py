"""ANTARA FastAPI application (Phase 1: health endpoints only).

Run from the ``backend`` directory:
    uvicorn antara_core.main:app --reload --port 8000
"""

from __future__ import annotations

from fastapi import Depends, FastAPI

from antara_core import __version__
from antara_core.config import Settings, configure_logging, get_settings
from antara_core.integrations.gnani_client import SUPPORTED_LANGUAGES
from antara_core.schemas import HealthResponse, ProviderStatus, ProvidersHealthResponse

SERVICE_NAME = "antara-core"


def create_app() -> FastAPI:
    configure_logging(get_settings())
    application = FastAPI(
        title="ANTARA Core API",
        version=__version__,
        description="Python processing engine for ANTARA (Phase 1: configuration and provider integrations).",
    )

    @application.get("/health", response_model=HealthResponse, tags=["health"])
    def health(settings: Settings = Depends(get_settings)) -> HealthResponse:
        return HealthResponse(status="ok", service=SERVICE_NAME, version=__version__, environment=settings.environment)

    @application.get("/health/providers", response_model=ProvidersHealthResponse, tags=["health"])
    def providers(settings: Settings = Depends(get_settings)) -> ProvidersHealthResponse:
        """Configuration status only: no provider calls are made and no secrets are returned."""
        gemini_roles = ["vision"] + (["stt"] if settings.stt_provider == "gemini" else [])
        statuses = [
            ProviderStatus(
                provider="gemini",
                role="+".join(gemini_roles),
                selected=settings.vision_provider == "gemini" or settings.stt_provider == "gemini",
                configured=settings.gemini_configured,
                details={"model": settings.gemini_model, "api_key_set": settings.gemini_configured},
            ),
            ProviderStatus(
                provider="gnani",
                role="stt",
                selected=settings.stt_provider == "gnani",
                configured=settings.gnani_configured,
                details={
                    "base_url": settings.gnani_base_url,
                    "default_language": settings.gnani_language,
                    "language_supported": settings.gnani_language in SUPPORTED_LANGUAGES,
                    "api_key_set": settings.gnani_configured,
                },
            ),
            ProviderStatus(
                provider="cline-bridge",
                role="agent-orchestration",
                selected=False,
                configured=bool(settings.cline_bridge_url),
                details={"url": settings.cline_bridge_url, "status": "not implemented in Phase 1"},
            ),
        ]
        missing = settings.missing_required()
        return ProvidersHealthResponse(
            status="degraded" if missing else "ok",
            missing_configuration=missing,
            providers=statuses,
            note="Configuration check only; run the smoke-test scripts to verify live connectivity.",
        )

    return application


app = create_app()
