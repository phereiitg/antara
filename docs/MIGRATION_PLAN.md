# ANTARA: Python migration plan

Status: **Phase 1 complete and verified** (2026-10-10; see "Phase 1 final verification" in
section 3). The Python backend foundation and provider integrations live in `backend/`, and
Gemini text, JSON, vision and Gnani STT were tested live. The TypeScript implementation in `src/`
is unchanged and still passes its 38 tests and the type-check. Phase 2 has not started.

## 1. Repository audit (before any change)

### What exists

| Area | Files | Assessment |
|---|---|---|
| Contracts | `src/contracts.ts` | Zod schemas: checklists, transcripts, findings, item statuses, review reasons, cases. The core domain model, so it is ported first. |
| Extraction | `src/engine/extraction.ts` | Prompt + JSON schema + parser. Explicit `passCondition`; `not_mentioned` kept separate from `not_applicable`; verbatim quotes; transcript treated as data (prompt-injection guard); duplicate item ids handled. |
| Grounding | `src/engine/grounding.ts` | Deterministic quote location: NFKC normalisation, then an exact match or a fuzzy LCS match (ratio >= 0.9, at least 4 tokens). The fuzzy match **must agree on negations** (English, Devanagari, romanised Hindi). Pure function, high value. |
| Verification | `src/engine/verify.ts` | One batched second-opinion LLM call. |
| Vision check | `src/engine/vision.ts` | Takes frames at the quote's timestamps. Vision can only *disagree* (forcing review), never override the voice finding. |
| Decision | `src/engine/decide.ts` | Deterministic per-item status from checkable signals only; parses Devanagari digits; applies numeric limits. |
| Guardrails | `src/engine/guardrails.ts` | Runs after the agent: any FAIL/NEEDS_REVIEW/NOT_INSPECTED item the agent left uncovered gets a system reviewer task. |
| Review | `src/engine/review.ts` | The human gate: the only code that changes proposal/task status. Requires a named reviewer and a reason. Mock connector only. |
| State | `src/engine/state.ts` | Case state machine with an explicit transition table and event log. |
| Pipeline | `src/engine/pipeline.ts` | ingest -> STT -> extract -> ground -> verify -> frames -> vision -> decide -> agent -> guardrail -> PENDING_REVIEW. Falls back to manual review if an LLM step fails. |
| Adapters | `src/adapters/*.ts` | `fire_safety` (4 NFPA checklists); `education` (video frames OFF because minors are in view); `jal_shakti` (FTK demo using **fixture values, not standards**). |
| Cline agent | `src/cline-runtime/*.ts` | `@cline/sdk@0.0.92` `Agent` with 4 allowlisted tools. Rules are enforced in the tool code. A scripted model is used for offline tests. |
| Gemini | `src/integrations/gemini.ts` | Raw REST `generateContent` with `responseJsonSchema`; 3 attempts on 429/5xx; 120 s timeout; ~18 MB inline cap. |
| STT | `src/integrations/stt.ts` | `GeminiStt` (approximate timestamps). **`GnaniStt` is a stub that throws.** |
| Media | `src/integrations/media.ts` | ffmpeg-static: 16 kHz mono WAV extraction, frame grabs, SHA-256, MIME map. |
| Store | `src/store.ts` | File store at `data/cases/<id>/case.json`, written atomically. |
| CLI | `src/cli.ts`, `src/demo.ts` | `domains`, `demo`, `smoke`, `run`, `show`, `approve/reject/resolve/close`. |
| Tests | `tests/*.test.ts` (vitest) | 38 tests. They include real ffmpeg and a real Cline agent loop with a scripted model; Gemini HTTP is mocked. |
| Config | `.env.example` | `GEMINI_*`, `CLINE_PROVIDER_ID/MODEL_ID/API_KEY`, `STT_PROVIDER`, `GNANI_API_KEY`, `GNANI_ENDPOINT`, `FFMPEG_PATH`, `ANTARA_DATA_DIR`. |

No separate Python "Stage 1 starter" was found in this repository. The only Python ancestor is
the Meta-glasses `pipeline.py` that the root README mentions. Its lessons are already built into
the TypeScript code (see the README section "What changed from the Python pipeline").

### Findings and blockers

1. **Gnani was never integrated.** The TypeScript stub assumed an account-specific or gRPC API.
   The current official docs (docs.gnani.ai, checked 2026-10-10) and the official SDK
   (`gnani-vachana` 0.8.1) describe a single-key REST API:
   - `POST https://api.vachana.ai/stt/v3` with an `X-API-Key-ID` header
   - multipart `audio_file` + `language_code`
   - at most 60 s per request
   - **no timestamps** in the response

   `GNANI_ENDPOINT` is therefore not needed. The base URL can be overridden with `GNANI_BASE_URL`.
2. **Timestamp dependency.** The TS pipeline uses segment timestamps for grounding windows and
   evidence frames. Gnani REST returns one untimed transcript. Grounding still works because it
   matches text, but `quoteWindow` and video frames are unavailable when Gnani is used.
3. **60 s REST limit.** Glasses clips run 3-5 minutes, so they need chunking or the Gnani Batch API.
4. **Model ID.** `gemini-3.8-flash` (the TS default) is confirmed as a current stable model, both
   in the docs and via the live Models API for this key. It accepts text, image, audio, video and
   PDF input and supports structured output. It is kept as the configurable default.
5. **The Cline SDK is TypeScript-only.** It stays in TypeScript (see section 4).
6. **`.env` location.** The TS CLI reads `.env` from the current directory; Python always reads
   `<repo root>/.env`. Both use the same file when the CLI is run from the repo root.
7. **`STT_PROVIDER` default is now `gnani`.** The TS CLI's Gnani path still throws, so TypeScript
   live runs need `STT_PROVIDER=gemini`. This is noted in `.env.example`.
8. **Jal Shakti limits are fixtures.** `DEMO_PARAM` and its limit of 1.0 must be replaced with
   values from the kit instructions and BIS IS 10500 before any real use.

### Logic that must be preserved exactly

- Negation-aware grounding, including the Hindi and romanised-Hindi negation list.
- Decision rules and review reasons. The model's self-reported confidence is never used.
- Vision may only force review; it never overrides the voice finding.
- The agent cannot change item statuses, tool rules are enforced in code, and the guardrail
  fallback always runs.
- Human review requires a named reviewer and a reason. Only the mock connector is called.
- Privacy gate: `allowVideoFrames=false` for education (minors are in view).
- Transcripts and images are treated as data, not instructions (prompt-injection framing).
- If extraction fails, the case degrades to manual review instead of crashing.

## 2. Module mapping (TypeScript -> Python)

| TypeScript | Python target | Phase | Notes |
|---|---|---|---|
| `src/integrations/gemini.ts` | `backend/antara_core/integrations/gemini_client.py` | **1 (done)** | Official `google-genai` SDK; same retry / JSON / inline-limit behaviour, plus typed errors. |
| `src/integrations/stt.ts` (`GnaniStt`) | `backend/antara_core/integrations/gnani_client.py` | **1 (done)** | Real REST integration (was a stub). |
| `src/integrations/stt.ts` (`GeminiStt`) | `antara_core/integrations/gemini_stt.py` | 2 | Needed for timestamped transcripts of video. |
| `src/integrations/llm.ts` | `antara_core/integrations/base.py` (`Protocol`s) | 2 | `JsonLlm` and `SpeechToText` interfaces. |
| `src/integrations/media.ts` | `antara_core/media.py` | 2 | ffmpeg via `subprocess` (system ffmpeg or `imageio-ffmpeg`). |
| `src/contracts.ts` | `antara_core/schemas/` (`checklist.py`, `findings.py`, `case.py`) | 2 | Zod to Pydantic v2. `Transcript` was started in Phase 1. |
| `src/engine/grounding.ts` | `antara_core/engine/grounding.py` | 2 | Pure function; port its tests 1:1. |
| `src/engine/decide.ts` | `antara_core/engine/decide.py` | 2 | Pure function; port its tests 1:1. |
| `src/engine/extraction.ts` | `antara_core/engine/extraction.py` | 2 | Copy the prompt text verbatim. |
| `src/engine/verify.ts`, `vision.ts` | `antara_core/engine/verify.py`, `vision.py` | 2 | |
| `src/engine/state.ts`, `review.ts`, `guardrails.ts` | `antara_core/engine/state.py`, `review.py`, `guardrails.py` | 2 | |
| `src/engine/pipeline.ts` | `antara_core/engine/pipeline.py` | 2 | Until Phase 3: agent step skipped, so reviewer work comes from guardrail tasks only. |
| `src/store.ts` | `antara_core/store/` (SQLite, `DATABASE_URL`) | 2-3 | Media stays on disk under `ANTARA_DATA_DIR`. |
| `src/adapters/*.ts` | `antara_core/adapters/` (Python or YAML domain packs) | 2 | Store as data so ministries can review them. |
| `src/cli.ts` | FastAPI routes (`/cases`, `/cases/{id}/review`) + a small CLI | 2-3 | |
| `src/cline-runtime/*` | **stays TypeScript**, becomes `services/cline-bridge/` | 3 | See section 4. |
| `tests/*.test.ts` | `backend/tests/` (pytest) | with each module | TS tests stay until their TS module is retired. |


## 3. What Phase 1 delivered

- `backend/antara_core/config.py`: Pydantic Settings that load `<repo root>/.env`. Keys are held
  as `SecretStr`, `missing_required()` lists absent keys, and a logging filter redacts secrets.
- `backend/antara_core/integrations/gemini_client.py`: text, JSON (dict schema or Pydantic
  model) and image understanding. Typed errors, millisecond timeout, and bounded exponential
  retry on 408/429/5xx/network errors only.
- `backend/antara_core/integrations/gnani_client.py`: the documented REST API. Validates
  language, format and duration locally; maps 401/403/400/429/5xx; retries transient failures;
  raises on empty transcripts. Never fabricates timestamps.
- `backend/antara_core/main.py`: `GET /health` and `GET /health/providers` (no provider calls,
  no secrets).
- `backend/scripts/`: `check_env.py`, `smoke_gemini.py`, `smoke_gnani.py`.
- `backend/tests/`: 66 offline tests.

### Phase 1 final verification (2026-10-10)

All results below come from commands actually run on this machine. No key values were printed.

| Check | Result | Evidence |
|---|---|---|
| Root `.env` | OK | `scripts/check_env.py`: `GEMINI_API_KEY` set, `GNANI_API_KEY` set, `GEMINI_MODEL=gemini-3.8-flash`, exit 0 |
| Gemini model available | OK | Live `models.get("gemini-3.8-flash")` found `models/gemini-3.8-flash` ("Gemini 3.8 Flash"), `supported_actions` includes `generateContent`; input limit 1,048,576, output limit 65,536 tokens |
| Gemini text | **PASS** | `smoke_gemini.py`: HTTP 200, reply `'ANTARA_OK'` (3.1 s) |
| Gemini JSON structured output | **PASS** | HTTP 200, `{'status': 'ok', 'echo': 'antara'}` (2.9 s) |
| Gemini vision | **PASS** | Synthetic 320x200 PNG (blue square left, red circle right, black bar bottom; no people, no text). The model returned `quality=good` and correctly described all three shapes, their positions, the white background and "no text" (5.9 s) |
| Gnani STT | **PASS** | `smoke_gnani.py` re-run: HTTP 200, model `gnani-prisma-v2.5`, exact transcript of the Hindi test clip "नमस्ते, यह पानी का नमूना हैंडपंप से लिया गया है।", `timestamps_available: false` (0.8 s) |
| Python pytest | **66 passed, 0 failed** | `python -m pytest` |
| TypeScript vitest | **38 passed, 0 failed** (6 files) | `npx vitest run` |
| TypeScript type-check | **PASS** | `npx tsc --noEmit`, exit 0 |
| Git exclusions | OK | `git check-ignore` confirms `.env`, `backend/.venv`, `node_modules`, `data/`, `__pycache__/`, `.pytest_cache/` are ignored; none are tracked; a scan of all 63 trackable files found no configured key value |

Caveats:
- The Gnani clip is synthetic: Gnani TTS output for a known Hindi sentence. It shows the
  integration is correct end to end, but says nothing about accuracy on noisy field recordings.
  Test with a real field recording early in Phase 2.
- The vision test uses a synthetic shapes image. It confirms grounded description only; no
  water-quality or safety interpretation was requested or produced.
- The smoke-test helper files (test image, TTS clip, model check, secret scan) are in the
  gitignored `data/smoke/` folder.

**Phase 1 is verified complete.** Phase 2 starts only after approval.

## 4. Phase 2: migrate the engine (next milestone)

Order matters: pure deterministic code first, so parity can be proven before any LLM is involved.

1. **Contracts.** Port `contracts.ts` to Pydantic: `ChecklistItem`, `Checklist`, `Segment`,
   `Transcript` (merge with the Phase 1 model and keep `timestamps_available`), `ItemFinding`,
   `ExtractionResult`, `VerificationResult`, `VisualCheck`, `ItemStatus`, `ReviewReason`,
   `ItemResult`, `CaseRecord`. Use `Literal`/`Enum` with the same string values so JSON is
   interchangeable with the TS case files.
2. **Grounding and decision.** Port `grounding.py` and `decide.py` line by line, together with
   `tests/grounding.test.ts` and `tests/decide.test.ts` as pytest. Add a parity test: run both
   implementations on `fixtures/demo/*.json` and compare the results.
3. **Prompts.** Port extraction, verification and vision prompt builders and schemas verbatim,
   then run them through `GeminiClient.generate_json` (already supports `response_json_schema`).
4. **State, review, guardrails** with their transition tables unchanged.
5. **Pipeline without the agent.** `agent=None`, so the guardrail creates reviewer tasks. That
   path is already valid in TS today (`--no-agent`).
6. **STT strategy for timestamps.** Gnani REST for phone audio (<= 60 s, no timestamps). For
   glasses video, either chunk into ~30 s pieces (giving chunk-level offsets, which are real but
   coarse) or keep Gemini STT. Mark `timestamps_available` accordingly and let `collectFrames`
   skip frames when timings are missing.
7. **Adapters** as data, starting with Jal Shakti. Real thresholds come only from verified kit/BIS
   documents.
8. **SQLite store** behind a repository interface, plus FastAPI routes to create, read and review
   cases.

Exit criteria: all ported pytest tests pass; the TS and Python parity test agrees on the demo
fixtures; the TS suite still passes.

## 5. Cline SDK boundary (design only; not built in Phase 1)

The official Cline SDK is TypeScript. No Python SDK will be written.

```
React UI --HTTP--> FastAPI (Python: owns cases, rules, providers, database)
                      |  POST {CLINE_BRIDGE_URL}/agent/run   (case view + allowed actions)
                      v
               cline-bridge (Node: @cline/sdk Agent with the 4 tools)
                      |  each tool call -> HTTP callback to FastAPI:
                      |    POST /internal/cases/{id}/proposals | reviewer-tasks | clarifications
                      v
               FastAPI validates every tool call (allowed action types and item statuses),
               writes PENDING records, and returns ok/error to the agent.
```

- The bridge holds no case state and has no database access; Python is the source of truth.
- Tool-rule enforcement moves to Python, so there is one implementation; the bridge only forwards.
- The bridge contract uses JSON Schemas generated from the Python Pydantic models.
- `CLINE_BRIDGE_URL` (default `http://127.0.0.1:4317`) is already in the config, and
  `/health/providers` reports it as "not implemented in Phase 1".
- Until Phase 3, the existing TS CLI (`npm run antara -- demo|run`) is the working agent path.

