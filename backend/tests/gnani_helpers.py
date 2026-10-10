"""Offline fakes for the Gnani client tests (httpx MockTransport, synthetic WAV files)."""

from __future__ import annotations

import wave
from pathlib import Path

import httpx

from antara_core.integrations.gnani_client import GnaniSTTClient

SECRET = "gnani-test-secret-abcdef123456"
HINDI = "नमस्ते, आप कैसे हैं?"


def make_wav(path: Path, seconds: float = 1.0, rate: int = 16000) -> Path:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))
    return path


class Recorder:
    """MockTransport handler: returns queued responses (or raises queued exceptions)."""

    def __init__(self, outcomes: list[httpx.Response | Exception]) -> None:
        self.outcomes = list(outcomes)
        self.requests: list[httpx.Request] = []

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def make(outcomes: list, attempts: int = 3) -> tuple[GnaniSTTClient, Recorder, list[float]]:
    rec = Recorder(outcomes)
    sleeps: list[float] = []
    client = GnaniSTTClient(
        SECRET,
        max_attempts=attempts,
        http_client=httpx.Client(transport=httpx.MockTransport(rec)),
        sleep=sleeps.append,
    )
    return client, rec, sleeps


def ok(body: dict) -> httpx.Response:
    return httpx.Response(200, json=body)


def err(status: int, etype: str, message: str) -> httpx.Response:
    return httpx.Response(status, json={"success": False, "error": {"type": etype, "message": message}})
