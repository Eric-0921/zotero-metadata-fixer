# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]
### Added
- Project documentation framework under `docs/`:
  - `PROJECT_OVERVIEW.md`
  - `ARCHITECTURE.md`
  - `RUNBOOK.md`
  - `KNOWN_PITFALLS.md`
  - `HISTORY_AND_DECISIONS.md`
  - `ROADMAP.md`

### Changed
- Refactored root `README.md` into a project entry page linking structured docs.

## [v8.3] - 2026-02-17
### Added
- New script: `v8_3_s2_batch_primary_dryrun.js`
- S2-first batch pipeline using `POST /graph/v1/paper/batch`
  - DOI batch request with conservative batch size
  - strict S2 pacing with safety margin above 1 req/sec
- High-value S2 fields retrieval in one call:
  - `title,abstract,year,journal,externalIds,tldr,citationCount,influentialCitationCount,openAccessPdf`
- `Extra` enrichment builder with dedupe guard:
  - `S2_TLDR`, citation summary, OA PDF link
- Item-level detail logs include:
  - abstract source, abstract length, S2 metadata flags
- Improved throttling observability:
  - `[v8.3][throttle]`, `[v8.3][429]`, `[v8.3][retry]`

### Changed
- Waterfall strategy flipped for LLM stage:
  - `S2 batch primary -> OpenAlex fallback`
- Progress logging uses handled item count for accurate ETA.

### Validation
- Full dry-run sample (238 items) achieved:
  - `failed=0`
  - `provider_s2_429=0`, `provider_openalex_429=0`, `provider_deepseek_429=0`
  - `deepseek success=238/238`

## [v6.1] - 2026-02-16
### Added
- New script: `v6_1_rule_based_tagger.js`
- Expanded rule dictionary for better method/app recall:
  - Interferometer families (Michelson/Sagnac/Fabry-Perot/MZI)
  - Gratings and resonators (FBG/LPG/WGM/ring)
  - Electrochemical and simulation methods
  - Extra application labels (gas, pH, humidity, electric field)

### Changed
- V6.1 log metrics now separate:
  - `would_change_items` for dry runs
  - `changed_items` for write runs
- Increased default `MAX_TAGS_PER_ITEM` from 6 to 8 in v6.1

## [v3.3] - 2026-02-16
### Added
- New script: `v3_3_full_batch_pipeline_cn_split.js`
- Chinese split routing:
  - CJK title/journal records are routed to `/meta_review_cn`
- Repository-like source filtering:
  - arXiv, DSpace, ScholarWorks, repository/thesis-like journals are routed to review
- Fallback safety rule:
  - OpenAlex/Semantic fallback records must include DOI to be accepted
- Expanded review reason metrics:
  - `cn_split`, `no_title`, `low_score`, `no_journal`, `repo_source`, `fallback_no_doi`

### Changed
- Default thresholds in v3.3:
  - `MIN_SCORE_CROSSREF=0.78`
  - `MIN_SCORE_FALLBACK=0.68`
- Logging strategy emphasizes file-based logs for iteration and audit

## [v3.2] - 2026-02-16
### Added
- Multi-source metadata pipeline:
  - Crossref -> OpenAlex -> Semantic Scholar
- File logging to local workspace logs directory
- Provider acceptance counters and review-rate reporting

## [v3.1] - 2026-02-16
### Added
- In-run dedupe (`DEDUPE_WITHIN_RUN`)
- Review reason breakdown (`no_title`, `low_score`, `no_journal`)
- Journal-missing DOI hits routed to review

## [v3.0] - 2026-02-15
### Added
- Batch processing and optional auto-loop
- Note logging output

## [v2.0] - 2026-02-15
### Added
- Full-library batch mode
- Missing-field filter (DOI/journal/year)

## [v1.0] - 2026-02-15
### Added
- Selected-items metadata lookup workflow

### Changed (v3.3 patch)
- CN records are now skipped in English pipeline and counted as skipped_cn, instead of being routed to review.


## [v6.0] - 2026-02-16
### Added
- New script: v6_rule_based_tagger.js
- Rule-based English-first tagging baseline across topic/method/material/app dimensions
- File log output with top-tag and co-occurrence summaries

