# ANTARA

**Adaptive multi-agent AI for Indian government field workflows.**
One reusable intelligence engine, specialised per ministry through adapters (like antibodies:
one body, many specialised receptors).

Primary use case: **Ministry of Jal Shakti**. A field worker speaks a report in Hindi and attaches
a photo of the water-test kit. ANTARA turns both into a structured screening case that a named
human reviewer approves or rejects.

```
voice (Hindi) ──► Gnani STT ──────────┐
                                      ├─► extraction ─► grounding ─► verification ─► decisions
photo (JPEG/PNG) ──► Gemini Vision ───┘        (Gemini)  (negation-aware)            (deterministic)
                                                                                      │
                     human review ◄── guardrails ◄── Cline SDK agent (PENDING proposals only)
```

## Repository layout

| Path | What it is |
|---|---|
| `src/` | TypeScript engine: contracts, pipeline, grounding, decisions, review, guardrails, Cline agent, CLI |
| `src/adapters/` | Ministry adapters: `jal_shakti`, `education`, `fire_safety` (demo checklists) |
| `backend/` | Python FastAPI service: Gnani speech-to-text, Gemini client, Pydantic contracts |
| `web/` | Hackathon web prototype (static, scripted demo flow) |
| `tests/`, `backend/tests/` | Offline test suites (vitest, pytest) |
| `docs/MIGRATION_PLAN.md` | Architecture notes, verification log and roadmap |

## Quick start: web prototype

Requires Node 22+.

```powershell
powershell -ExecutionPolicy Bypass -File .\start-demo.ps1         # opens http://127.0.0.1:5173
powershell -ExecutionPolicy Bypass -File .\start-demo.ps1 -Stop
```

Flow: select **Ministry of Jal Shakti** → record your voice → upload the test-kit photo →
**Analyze Sample** → watch the pipeline → read the case report → hear the Hindi reply → approve or reject.

> **The web prototype is a scripted UI demo.** Real: your microphone recording, the photo you
> upload, and the spoken reply (generated with Gnani TTS into `web/assets/antara-reply.wav` by
> `backend/scripts/make_reply_audio.py`). Scripted: the displayed transcript, image observations,
> pipeline timing, case contents and review outcome. The live engine runs through the CLI below.

## Live engine (CLI)

```powershell
npm install
copy .env.example .env      # add GEMINI_API_KEY and GNANI_API_KEY (never commit .env)

# Python Gnani service (separate terminal)
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn antara_core.main:app --port 8000
cd ..

# Voice + photo Jal Shakti case
npm run antara -- run --domain jal_shakti --checklist field_sample_capture --language hi-IN `
  --audio report.wav --image water-test.jpeg --meta source=Handpump --meta "location=Demo Village A"

npm run antara -- show <caseId>
npm run antara -- approve <caseId> <proposalId> --reviewer "Block Water Officer" --reason "..."
npm run antara -- demo      # offline end-to-end demo, no API keys
```

## Safety principles

- A photo never establishes water safety, pH or chlorine concentration. The engine screens model
  output for such claims and flags them for review.
- Vision can corroborate a spoken finding or force review; it never overrides it.
- No invented timestamps: Gnani returns untimed transcripts, so quotes are grounded by text only.
- Agents create **PENDING** proposals only. Every action needs a named reviewer and a reason.
  There are no real government-system submissions (mock connector).
- Jal Shakti checklists are **synthetic demo** configuration, not official standards.

## Tests

```powershell
npm test                    # TypeScript (vitest)
npx tsc --noEmit            # type-check
cd backend; .\.venv\Scripts\python.exe -m pytest    # Python
```

All suites run offline with mocked providers; no paid API calls.

## Tech stack

TypeScript (Node 22, Zod, `@cline/sdk`) · Python 3.11 (FastAPI, Pydantic, `google-genai`, httpx) ·
Gemini (`gemini-3.8-flash`) · Gnani Speech APIs (STT `stt/v3`, TTS `timbre-v2.5`) · ffmpeg.

## Status

| Component | State |
|---|---|
| Gnani STT via Python service, called from TypeScript | Working, verified live |
| Gnani TTS (Hindi reply audio) | Working, verified live |
| Voice + independent photo pipeline (engine) | Implemented, tested offline with mocks |
| Gemini live calls | Verified earlier; currently timing out from the dev machine |
| Live Cline agent | Wired; runs with configured provider credentials, otherwise deterministic fallback |
| Web UI connected to live engine | Not yet (prototype is scripted) |
| Health ministry adapter | Planned |
