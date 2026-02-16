# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

