# Project Overview

## What This Project Is
Zotero Metadata Fixer is a local-first automation toolkit for cleaning and enriching a large Zotero library. It is designed as an operational pipeline rather than a one-off script.

Core goals:
- Complete missing core metadata (`DOI`, `publicationTitle`, `date`, later `abstractNote`).
- Separate uncertain records into explicit queues instead of silently writing risky data.
- Apply a stable tagging taxonomy (`topic/*`, `method/*`, `material/*`, `app/*`).
- Add LLM completion only after deterministic and API-based stages are done.
- Keep every run auditable through log files.

## Scope
In scope:
- Journal-article focused metadata completion and enrichment.
- English-first pipeline with explicit CN split handling.
- Rule-based and LLM-assisted tagging.
- Attachment and note cleanup helpers.

Out of scope:
- Full bibliographic normalization for every item type.
- Author identity disambiguation at knowledge-graph level.
- Automatic deduplication merge decisions without manual review.

## Pipeline Philosophy
The project follows a strict confidence ordering:
1. Deterministic rules and exact IDs.
2. Trusted APIs with constrained fallback and retries.
3. LLM as controlled completer, not primary source of truth.
4. Manual review queue for low-confidence edge cases.

## Current Production Baseline
Metadata + LLM stage baseline:
- Script: `v8_3_s2_batch_primary_dryrun.js`
- Main strategy:
  - S2 batch lookup (`/graph/v1/paper/batch`) for DOI groups.
  - OpenAlex fallback for missing abstracts.
  - DeepSeek for controlled tag completion (allowed + optional candidate tags).
- Safety defaults:
  - conservative rate limit spacing
  - retry with backoff
  - explicit 429 cooldown logging

## Success Criteria
A run is considered healthy when:
- `failed=0`
- provider 429 rates are near zero
- queue progression is measurable
- logs are complete enough for post-run audits
- write mode does not cause duplicate metadata blocks or tag explosions

## Key Outputs
- Updated Zotero fields: `abstractNote`, `extra` (with S2 metadata block when enabled), and tags.
- Structured logs in `logs/` with provider stats, timing, and item-level details.
- Optional review queues/tags for low-confidence records.
