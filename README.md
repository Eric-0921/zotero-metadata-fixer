# Zotero Metadata Fixer

A production-style Zotero automation project for:
- metadata completion (DOI/journal/year/abstract)
- deterministic + LLM-assisted tagging
- queue-based workflow control
- auditable logs and repeatable batch execution

## Project Docs
- Overview: `docs/PROJECT_OVERVIEW.md`
- Architecture: `docs/ARCHITECTURE.md`
- Runbook: `docs/RUNBOOK.md`
- Pitfalls: `docs/KNOWN_PITFALLS.md`
- History and decision log: `docs/HISTORY_AND_DECISIONS.md`
- Roadmap: `docs/ROADMAP.md`

## Quick Start
1. Open Zotero: `Tools -> Developer -> Run JavaScript`
2. Keep `Run as async function` checked.
3. Start with dry-run:
   - `WRITE=false`
   - `AUTO_LOOP=false`
4. Read summary + file log under `logs/`.
5. Switch to production only after dry-run metrics look good.

## Current Recommended Script
- `v8_3_s2_batch_primary_dryrun.js`
  - S2 `paper/batch` as primary metadata source
  - OpenAlex fallback for missing abstracts
  - DeepSeek controlled tag suggestion
  - Optional write-back for `abstractNote`, `Extra`, and tags

## Repository Layout
- Root scripts:
  - `v1...v3`: metadata repair evolution
  - `v6...`: rule-based tagging
  - `v8...`: LLM-assisted completion with API waterfall/batch
  - `v9...v10...`: attachment and note cleanup tooling (Python)
- Logs: `logs/`
- Docs: `docs/`

## Status
This project is actively evolving. See `CHANGELOG.md` for release notes.
