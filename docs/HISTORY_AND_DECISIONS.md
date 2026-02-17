# History and Decisions

This document records the major project steps and why decisions were made.

## Phase 1: Metadata Completion Foundation (v1-v3)

### v1
- Single/selected-item lookup.
- Goal: verify API integration and field mapping basics.

### v2
- Full-library missing-only mode.
- Decision: avoid touching complete records.

### v3.0-v3.2
- Added batched loops and file logs.
- Added Crossref/OpenAlex/Semantic fallback.

### v3.3
- Introduced CN split behavior and queue tags.
- Decision: English-first automation; Chinese handled by dedicated plugin/rules.
- Added stronger review reason accounting and fallback constraints.

## Phase 2: Deterministic Taxonomy Layer (v6-v6.1)

### v6
- Rule-based tags across 4 dimensions (`topic/method/material/app`).
- Decision: build stable baseline before LLM.

### v6.1
- Expanded sensing-method and application coverage.
- Improved dry-run observability (`would_change_items`).

## Phase 3: LLM Completion + Abstract Enrichment (v8 family)

### v8, v8.1
- Early S2 + DeepSeek attempts.
- Issue: frequent S2 429 and weak progress visibility.

### v8.2
- Waterfall and stronger throttling.
- Added provider stats and cooldown behavior.

### v8.3
- Architectural flip to S2 batch primary (`/paper/batch`).
- Added high-value fields (`tldr`, citations, OA PDF).
- Added `Extra` merge with dedupe guard.
- Outcome: stable full dry-run/production-level metrics with near-zero rate-limit events.

## Key Decisions Summary

1. Queue-first operations over implicit state.
2. Deterministic-first, LLM-second strategy.
3. Strict dry-run before write mode.
4. Conservative provider pacing even when key access exists.
5. Log everything required for replay and audit.

## Current Working Baseline

- Main production candidate: `v8_3_s2_batch_primary_dryrun.js`
- Full-run validation already achieved with:
  - `failed=0`
  - zero provider 429 in stable runs
  - complete deepseek response success
