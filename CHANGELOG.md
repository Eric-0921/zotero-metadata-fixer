# Changelog | 更新日志

All notable changes to this project will be documented in this file.
本项目的所有重要变更都记录在此文件中。

---

## [Unreleased] | 未发布

### Added | 新增
- Project documentation framework under `docs/`:
  - `PROJECT_OVERVIEW.md`
  - `ARCHITECTURE.md`
  - `RUNBOOK.md`
  - `KNOWN_PITFALLS.md`
  - `HISTORY_AND_DECISIONS.md`
  - `ROADMAP.md`
- 双语 README 入口页。

### Changed | 调整
- Refactored root `README.md` into a project entry page linking structured docs.
- README now provides bilingual quick-start and project orientation.

---

## [v8.3] - 2026-02-17

### Added | 新增
- New script: `v8_3_s2_batch_primary_dryrun.js`
- S2-first batch pipeline using `POST /graph/v1/paper/batch`
  - DOI batch request with conservative group size
  - strict S2 pacing with safety margin above 1 req/sec
- High-value S2 fields retrieval in one call:
  - `title,abstract,year,journal,externalIds,tldr,citationCount,influentialCitationCount,openAccessPdf`
- `Extra` enrichment builder with dedupe guard:
  - `S2_TLDR`, citation summary, OA PDF link
- Item-level detail logs include:
  - abstract source, abstract length, S2 metadata flags
- Improved throttling observability:
  - `[v8.3][throttle]`, `[v8.3][429]`, `[v8.3][retry]`

### Changed | 调整
- Waterfall strategy flipped for LLM stage:
  - `S2 batch primary -> OpenAlex fallback`
- Progress logging uses handled item count for accurate ETA.

### Validation | 验证
- Full dry-run sample (238 items) achieved:
  - `failed=0`
  - `provider_s2_429=0`, `provider_openalex_429=0`, `provider_deepseek_429=0`
  - `deepseek success=238/238`

---

## [v6.1] - 2026-02-16

### Added | 新增
- New script: `v6_1_rule_based_tagger.js`
- Expanded rule dictionary for better method/app recall:
  - Interferometer families (Michelson/Sagnac/Fabry-Perot/MZI)
  - Gratings and resonators (FBG/LPG/WGM/ring)
  - Electrochemical and simulation methods
  - Extra application labels (gas, pH, humidity, electric field)

### Changed | 调整
- V6.1 log metrics now separate:
  - `would_change_items` for dry runs
  - `changed_items` for write runs
- Increased default `MAX_TAGS_PER_ITEM` from 6 to 8 in v6.1.

---

## [v3.3] - 2026-02-16

### Added | 新增
- New script: `v3_3_full_batch_pipeline_cn_split.js`
- Chinese split routing
- Repository-like source filtering
- Fallback safety rule (fallback record must include DOI)
- Expanded review reason metrics

### Changed | 调整
- Default thresholds:
  - `MIN_SCORE_CROSSREF=0.78`
  - `MIN_SCORE_FALLBACK=0.68`
- Logging strategy emphasized file-based auditability.

---

## [v3.2] - 2026-02-16
### Added | 新增
- Multi-source metadata pipeline: Crossref -> OpenAlex -> Semantic Scholar
- File logging to local workspace
- Provider acceptance counters and review-rate reporting

## [v3.1] - 2026-02-16
### Added | 新增
- In-run dedupe (`DEDUPE_WITHIN_RUN`)
- Review reason breakdown (`no_title`, `low_score`, `no_journal`)
- Journal-missing DOI hits routed to review

## [v3.0] - 2026-02-15
### Added | 新增
- Batch processing and optional auto-loop
- Note logging output

## [v2.0] - 2026-02-15
### Added | 新增
- Full-library batch mode
- Missing-field filter (DOI/journal/year)

## [v1.0] - 2026-02-15
### Added | 新增
- Selected-items metadata lookup workflow
