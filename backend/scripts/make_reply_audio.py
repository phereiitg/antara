"""Generate the demo's spoken Hindi reply with Gnani TTS (one-time, uses Gnani credits).

    python scripts/make_reply_audio.py

Writes ../web/assets/antara-reply.wav. Endpoint per docs.gnani.ai:
POST https://api.vachana.ai/api/v1/tts/inference (X-API-Key-ID header, model timbre-v2.5).
"""

from __future__ import annotations

import sys

import _bootstrap  # noqa: F401

import httpx

from antara_core.config import BACKEND_DIR, load_settings

REPLY = (
    "नमस्ते। आपका हैंडपंप के पानी का नमूना दर्ज कर लिया गया है। "
    "फोटो में दो परीक्षण शीशियाँ और क्लोरीन तथा पीएच के रंग तुलना चार्ट दिखाई दे रहे हैं। "
    "आपकी रिपोर्ट तैयार कर दी गई है और मानवीय जाँच के लिए भेज दी गई है। "
    "जाँच पूरी होने तक पानी को सुरक्षित घोषित नहीं किया गया है।"
)


def main() -> int:
    settings = load_settings()
    key = settings.require_gnani_key()
    out = BACKEND_DIR.parent / "web" / "assets" / "antara-reply.wav"
    out.parent.mkdir(parents=True, exist_ok=True)
    for rate in (24000, 16000):
        r = httpx.post(
            f"{settings.gnani_base_url}/api/v1/tts/inference",
            headers={"X-API-Key-ID": key, "Content-Type": "application/json"},
            json={
                "text": REPLY, "voice": "Nalini", "model": "timbre-v2.5", "language": "hi-IN", "speed": 1.0,
                "audio_config": {"sample_rate": rate, "num_channels": 1, "sample_width": 2,
                                 "encoding": "linear_pcm", "container": "wav"},
            },
            timeout=120,
        )
        print(f"Gnani TTS ({rate} Hz): HTTP {r.status_code} {r.headers.get('content-type')}")
        if r.status_code == 200 and r.content[:4] == b"RIFF":
            out.write_bytes(r.content)
            print(f"wrote {out} ({len(r.content)} bytes)")
            return 0
        print(r.text[:300])
    return 1


if __name__ == "__main__":
    sys.exit(main())
