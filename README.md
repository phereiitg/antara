# ANTARA: glasses inspection pipeline, adapted

This is the Meta-glasses fire-inspection pipeline (`Meta-Glass-Inspection-Fire-Safety-main.zip`, Python)
rebuilt as an ANTARA evidence-to-action pipeline in TypeScript on the Cline SDK, following
`ANTARA_Execution_Blueprint.md`.
> **Python migration in progress.** The Python-first backend (FastAPI, Gemini and Gnani STT
> clients) lives in [`backend/`](backend/README.md). The plan for moving this TypeScript engine
> is in [`docs/MIGRATION_PLAN.md`](docs/MIGRATION_PLAN.md). Everything below describes the
> TypeScript implementation, which is unchanged and still works. The Cline SDK agent stays in
> TypeScript.



```
glasses clips (<=3-5 min each) / phone audio + photos
  -> ffmpeg: 16 kHz mono WAV per clip
  -> speech-to-text (Gemini; Gnani stub)            timestamped segments per clip
  -> checklist extraction (Gemini, JSON schema)      one finding + verbatim quote per item
  -> quote grounding (deterministic)                 is the quote really in the transcript? where?
  -> verification (Gemini, one batch call)           second opinion on each finding
  -> evidence frames at the quote's timestamps       replaces CLIP search over every frame
  -> vision cross-check (Gemini)                     disagreement -> review, never an override
  -> per-item decision (deterministic)               PASS/FAIL/NOT_APPLICABLE/NOT_INSPECTED/RECORDED/NEEDS_REVIEW
  -> Cline agent (4 allowlisted tools)               drafts PENDING proposals, reviewer tasks, clarifications
  -> guardrail fallback (deterministic)              anything the agent missed gets a reviewer task
  -> human review -> mock connector                  approve / reject / resolve, with reviewer + reason
```

## Run it

```bash
npm install
npm test                      # 38 tests, offline (includes real ffmpeg + real Cline agent loop)
npm run antara -- demo        # offline end-to-end demo, no API keys
npm run antara -- domains

cp .env.example .env          # add GEMINI_API_KEY
npm run antara -- smoke       # checks live Gemini JSON output and the Cline agent on a real model
npm run antara -- run --domain fire_safety --checklist fire_extinguisher --language hi-IN \
    --video clip1.mp4 --video clip2.mp4
npm run antara -- show <caseId>
npm run antara -- approve <caseId> <proposalId> --reviewer "Fire Officer" --reason "..."
npm run antara -- resolve <caseId> <taskId> --status FAIL --reviewer "Fire Officer" --reason "..."
```

The demo uses a synthetic transcript and **hand-written model responses** (`fixtures/demo/`). The
pipeline, checks, Cline agent loop, tools and review flow are real code; the model answers are not.

## Domains

| Domain | Checklists | Agent actions | Wearable video frames |
|---|---|---|---|
| `fire_safety` | 4 NFPA checklists ported from the zip | `rectification_notice_draft`, `reinspection_visit` | allowed |
| `education` | school facilities (demo) | `repair_inspection` | **off**: minors in view (DPDP Act) |
| `jal_shakti` | FTK sample capture (demo, fixture limit) | `lab_referral`, `retest_request` | allowed (kit, not people) |

Checklist items carry an explicit `passCondition`, so "Is the FDC blocked? Yes" is judged against
"The FDC is NOT blocked" instead of the model guessing the question's polarity.

## What changed from the Python pipeline

| pipeline.py | Here |
|---|---|
| Ambiguous answers (`null`) saved as N/A | `UNCLEAR_ANSWER` -> NEEDS_REVIEW |
| Items never mentioned saved as N/A | NOT_INSPECTED |
| Items the model dropped saved as N/A | `EXTRACTION_MISSING_ITEM` -> NEEDS_REVIEW |
| Contradictions printed, then ignored | per-item `CONFLICTING_STATEMENTS` -> NEEDS_REVIEW |
| LLM self-reported confidence >= 0.85 | checkable signals: quote grounding, verifier, vision, missing date/value |
| Word-overlap quote matching (accepts a dropped "not") | exact/fuzzy match that must agree on negations, incl. Hindi |
| "Distance" item never treated as numeric | numeric item, value RECORDED (or PASS/FAIL against a limit) |
| Unguarded `json.loads` crashes the run | JSON-schema output + Zod; extraction failure degrades to manual review |
| Whisper medium + CLIP ViT-L, GPU recommended | Gemini STT/vision over HTTP; CPU only |
| All frames in RAM (~20 GB for 30 min 1080p) | 3 frames per item, grabbed at the quote's timestamps |
| Writes final PASS/FAIL to Postgres | agent proposals stay PENDING until a named reviewer decides |
| `db_setup.sql` fails on re-run after dropping results | file store per case (Postgres later) |

## Cline SDK notes (checked against the installed `@cline/sdk@0.0.92`)

- `Agent` comes from `@cline/agents`, which has no built-in shell/file/browser tools; the agent only sees the 4 case tools.
- A tool with `autoApprove: false` and no `requestToolApproval` callback is **refused** (test:
  `tests/agent.test.ts`). The blueprint's `toolPolicies: { propose_action: { autoApprove: false } }`
  would therefore block every proposal. Here the tools only write PENDING records, so they are
  auto-approved at the SDK level and the human gate is the review step.
- Every rule (allowed action types, which item statuses an action may cite) is enforced inside the
  tools; the guardrail creates reviewer tasks for anything the agent leaves uncovered.

## Status

Tested offline: all deterministic logic, ffmpeg audio extraction and frame grabbing on synthetic
clips, the real Cline agent loop with a scripted model, review flow, Gemini client request/retry
handling (mocked HTTP).

**Not yet tested live** (no API key was available): Gemini extraction quality on real Hindi/Hinglish
narration, Gemini STT timestamp accuracy, the Cline agent on a real Gemini model, and whether the
configured model ID accepts `responseJsonSchema`. Run `npm run antara -- smoke` first.

Not built: web UI (CLI only), auth/multi-tenancy, Postgres, Gnani client (account-specific
endpoint), Files API upload for clips over ~18 MB, sending clarifications back to the field
worker, face redaction.
# antara
