# Architecture

## High-Level Components

1. Metadata Repair Scripts (v1-v3)
- Purpose: fill missing DOI/journal/year using API waterfall and confidence thresholds.
- Typical outputs: `/meta_ok`, `/meta_review`, `/meta_cn_queue`, `/meta_fail`.

2. Rule-Based Tagging (v6, v6.1)
- Purpose: deterministic taxonomy assignment from title/abstract/journal text.
- Taxonomy axes:
  - `topic/*`
  - `method/*`
  - `material/*`
  - `app/*`

3. LLM Completion (v8 family)
- Purpose: complete or refine tags for queued records, leveraging abstract enrichment.
- Core controls:
  - allowed whitelist tags
  - optional `candidate/*` tags
  - strict JSON output contract

4. Cleanup Utilities (v9-v10 Python)
- Purpose: attachment dedupe and suspicious-note cleanup workflows.

## Data Flow

Zotero Library Item
-> filtering gates (type/language/required metadata)
-> metadata source pipeline (S2/OpenAlex/etc.)
-> tag decision layer (rules and/or LLM)
-> optional write-back
-> logging and summary metrics

## Queue Model

- `/meta_cn_queue`: Chinese split queue.
- `/meta_llm_untagged`: records targeted for LLM completion.
- Additional operational tags can be introduced for low-confidence post-processing.

## API Strategy

### Semantic Scholar (S2)
- Preferred for batch DOI enrichment in v8.3.
- Endpoint: `POST /graph/v1/paper/batch`
- Fields include: `abstract`, `tldr`, `citationCount`, `influentialCitationCount`, `openAccessPdf`.
- Strictly paced above official 1 req/sec limit.

### OpenAlex
- Fallback abstract source when S2 abstract is unavailable or missing.
- Uses `abstract_inverted_index`, reconstructed into plain text.

### DeepSeek
- Controlled tag suggestion stage.
- Not a source of bibliographic truth; used for taxonomy completion.

## Reliability Controls

- Per-provider interval control (`minIntervalMs`).
- Retry with jitter and capped exponential backoff.
- Provider-specific 429 penalties and global cooldown.
- Explicit debug logs:
  - `[throttle]`
  - `[429]`
  - `[retry]`

## Write Safety Controls

- Dry-run default in major scripts.
- `item.hasTag()` checks prevent duplicate tag writes.
- `Extra` block dedupe sentinel (`S2_TLDR:`).
- Title-only fallback remains marked low-confidence.

## Logging Contract

Every run should emit:
- run config snapshot
- processed/checked/skipped/failed counts
- provider call stats and 429 counts
- enrichment coverage (existing/s2/openalex/miss/title-only)
- item-level detail lines for traceability
