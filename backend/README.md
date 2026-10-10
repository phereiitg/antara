# ANTARA backend (Python, Phase 1)

The Python-first processing engine for ANTARA. Phase 1 provides:

- secure environment configuration (`antara_core/config.py`, Pydantic Settings)
- a Gemini client (official `google-genai` SDK): text, JSON structured output, image understanding
- a Gnani speech-to-text client (documented REST API `POST https://api.vachana.ai/stt/v3`)
- a FastAPI app with `GET /health` and `GET /health/providers`
- offline pytest tests and explicit live smoke-test scripts

The TypeScript implementation in `../src` (engine, adapters, Cline SDK agent) is unchanged and
still runs. See `../docs/MIGRATION_PLAN.md` for what moves to Python, and when.

```text
backend/
  antara_core/
    config.py                  settings, .env loading, secret-redacting logging
    main.py                    FastAPI app
    integrations/gemini_client.py
    integrations/gnani_client.py
    schemas/__init__.py        Transcript, VisionObservation, health responses
  scripts/
    check_env.py               configuration check (no API calls)
    smoke_gemini.py            LIVE: text, JSON and (optional) vision
    smoke_gnani.py             LIVE: transcribe one short recording
  tests/                       offline tests (no keys, no network)
  requirements.txt
```

All commands below are **Windows PowerShell**, run from the `backend` folder unless noted.

## 1. Create the virtual environment

Requires Python 3.11 or newer (`py -0p` lists installed versions).

```powershell
cd C:\Users\mappr\OneDrive\Desktop\Cline\backend
py -3.11 -m venv .venv
```

If `py` is not available, call the interpreter directly, e.g.
`& "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe" -m venv .venv`.

## 2. Activate it

```powershell
.\.venv\Scripts\Activate.ps1
```

If PowerShell blocks the script (`running scripts is disabled on this system`), allow it for the
current window only, then activate again:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\.venv\Scripts\Activate.ps1
```

Every command below also works without activating if you replace `python` with
`.\.venv\Scripts\python.exe`.

## 3. Install dependencies

```powershell
python -m pip install -r requirements.txt
```

## 4. Configure `.env`

The backend reads **`.env` in the repository root** (`..\.env`, shared with the TypeScript CLI),
whatever directory you start it from. Real environment variables override `.env`. To use a
different file, set `$env:ANTARA_ENV_FILE = "C:\path\to\file.env"`.

```powershell
if (-not (Test-Path ..\.env)) { Copy-Item ..\.env.example ..\.env }   # never overwrites an existing .env
notepad ..\.env
```

Set at least:

| Variable | Purpose |
|---|---|
| `GEMINI_API_KEY` | from https://aistudio.google.com/apikey |
| `GEMINI_MODEL` | default `gemini-3.8-flash` (stable; text, image, audio, video, PDF input) |
| `GNANI_API_KEY` | from the Gnani API dashboard; sent as the `X-API-Key-ID` header |
| `GNANI_LANGUAGE` | `hi-IN` (also `en-IN bn-IN gu-IN kn-IN ml-IN mr-IN pa-IN ta-IN te-IN`) |

`.env` is gitignored. Then check it (prints only *set*/*MISSING*, never the values):

```powershell
python scripts\check_env.py
```

## 5. Start FastAPI

```powershell
python -m uvicorn antara_core.main:app --reload --port 8000
```

In a second PowerShell window:

```powershell
Invoke-RestMethod http://127.0.0.1:8000/health
Invoke-RestMethod http://127.0.0.1:8000/health/providers | ConvertTo-Json -Depth 5
```

Interactive docs: http://127.0.0.1:8000/docs. `/health/providers` reports configuration status
only: it makes no model calls and never returns keys. `status` is `degraded` while a key that a
selected provider needs is missing.

## 6. Test Gemini (live, costs a few tokens)

```powershell
python scripts\smoke_gemini.py                              # text (ANTARA_OK) + JSON output
python scripts\smoke_gemini.py --image C:\path\to\photo.jpg # + vision
python scripts\smoke_gemini.py --model gemini-3.6-flash     # try another model
```

The vision test returns a general description, a visible-text list and an image-quality rating.
The prompt tells the model **not** to infer chemical concentrations, contamination or safety from
a photo; ministry-specific water-testing logic comes in a later phase.

## 7. Test Gnani (live, uses Gnani credits)

Record a **real** Hindi sentence, 5-30 seconds long (at most 60 s; WAV/MP3/OGG/FLAC/AAC/M4A,
8-44.1 kHz). The Windows *Sound Recorder* app saves `.m4a`, which is accepted.

```powershell
python scripts\smoke_gnani.py C:\path\to\hindi_clip.wav
python scripts\smoke_gnani.py C:\path\to\clip.m4a --language en-IN --format transcribe
```

Output is the normalised transcript:

```json
{"provider": "gnani", "language": "hi-IN", "text": "...", "segments": [{"text": "...", "start": null, "end": null}],
 "timestamps_available": false, "request_id": "...", "model": "..."}
```

The Gnani REST API returns no word or segment timings (its `timestamp` field is the request time),
so `timestamps_available` is always `false` and no timings are invented.

## 8. Run the offline tests

```powershell
python -m pytest
```

The tests mock the Gemini SDK and the Gnani HTTP transport. They ignore your `.env` and shell
keys, so they never call a paid API.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `BLOCKED GEMINI_API_KEY is not set` | Key missing in `..\.env`. `python scripts\check_env.py` shows which file was loaded. |
| `GeminiAuthError ... Check GEMINI_API_KEY` | Invalid or restricted key, or the Generative Language API is disabled for its project. |
| `GeminiRequestError HTTP 404 ... Check that GEMINI_MODEL=...` | Model ID unknown or not enabled for your key. Try `--model gemini-3.6-flash`. |
| `GeminiRateLimitError HTTP 429` | Quota exhausted; wait or enable billing. Retried automatically (3 attempts). |
| `GeminiResponseError ... finish reason SAFETY / MAX_TOKENS` | Output blocked or truncated; change the prompt or image. |
| `GnaniAuthError HTTP 401/403` | Invalid key, inactive organisation or **no credits** (Gnani returns 403 for all three). |
| `GnaniUnsupportedAudioError ... at most 60s` | Split the clip (ideal 30 s). Longer files need the Gnani Batch API (not in Phase 1). |
| `GnaniUnsupportedAudioError ... Unsupported audio format` | Convert to WAV: `ffmpeg -i in.mp4 -ac 1 -ar 16000 out.wav`. After `npm install` in the repo root, the bundled binary path is printed by `node -e "console.log(require('ffmpeg-static'))"`. |
| `GnaniEmptyTranscriptError` | Silence, a tone, noise, or the wrong `--language`. |
| `...TimeoutError` | Slow network; raise `GEMINI_TIMEOUT_SECONDS` / `GNANI_TIMEOUT_SECONDS` in `.env`. |
| `ModuleNotFoundError: antara_core` | Run uvicorn/pytest from the `backend` folder with the venv active. |
| Hindi prints as `???` | Use Windows Terminal or run `chcp 65001`. The scripts already switch output to UTF-8. |
| Port 8000 in use | Add `--port 8001`. |

Keys are never printed: settings hold them as `SecretStr`, client errors redact them, and
`configure_logging` adds a filter that removes them from every log record.

