# Zotero Metadata Fixer

English | 中文

This repository contains practical Zotero JavaScript scripts for repairing large literature-library metadata with a reproducible workflow.

这个仓库提供一套可复用的 Zotero JavaScript 脚本，用于在大型文献库中批量修复元数据（DOI、期刊名、年份），并保留可审计日志。

## 1) What This Project Solves | 解决的问题

English:
- Bulk metadata completion for large Zotero libraries
- Controlled fallback across multiple APIs
- Review queue separation instead of silent wrong writes
- File-based logs for audit and iteration

中文：
- 面向大型 Zotero 文献库的批量元数据补全
- 多数据源的可控回退策略
- 将低置信条目明确进入 review 队列，避免“自动写错”
- 日志落盘，便于审计和持续优化

## 2) Script Versions | 脚本版本

- `v1_selected_lookup.js`
  - Selected-items lookup only (Crossref title/author)
  - 适合小批量验证

- `v2_full_batch_missing_only.js`
  - Full-library batch mode
  - Only process records missing DOI/journal/year

- `v3_full_batch_autoloop_log.js`
  - Multi-source pipeline and file logging (v3.2 baseline)

- `v3_3_full_batch_pipeline_cn_split.js` (latest)
  - Crossref -> OpenAlex -> Semantic Scholar pipeline
  - Chinese-item split to `/meta_review_cn`
  - Repository-like source filtering (arXiv/DSpace/etc.)
  - Fallback acceptance requires DOI
  - Detailed review reason breakdown

## 3) Prerequisites | 前置条件

- Zotero 8 (desktop)
- Open: `Tools -> Developer -> Run JavaScript`
- Check: `Run as async function`
- Stable internet connection

## 4) Recommended Workflow | 推荐流程

1. Dry-run first:
   - `WRITE=false`
   - `AUTO_LOOP=false`
   - `BATCH_SIZE=120`
2. Review metrics in output/log file:
   - `review_rate`
   - `provider_accept`
   - `review_reasons`
3. Tune thresholds if needed:
   - `MIN_SCORE_CROSSREF`
   - `MIN_SCORE_FALLBACK`
4. Run production:
   - `WRITE=true`
   - `AUTO_LOOP=true`

中文建议：
1. 先单批 dry-run，不写库
2. 看 `review_rate/provider_accept/review_reasons`
3. 调阈值后再正式写入
4. 正式时再开自动循环

## 5) Tags Produced | 输出标签

- `/meta_ok`: accepted metadata record
- `/meta_review`: low-confidence or policy-rejected record
- `/meta_review_cn`: Chinese-title/journal records split for dedicated CN pipeline
- `/meta_nohit`: no candidate (legacy versions)
- `/meta_fail`: runtime failure

## 6) Log Output | 日志输出

Default log directory:
- `Zotero/scripts/metadata-fixer/logs`

Each run writes:
- Summary metrics
- Provider acceptance counts
- Review reason breakdown
- Item-level detail lines

## 7) Safety Notes | 安全说明

English:
- Always run `WRITE=false` before changing thresholds.
- Never trust fallback source blindly.
- Keep repository-like sources in review queue.

中文：
- 每次改参数先 `WRITE=false` 试跑
- 不要盲信回退源
- arXiv/仓储源建议默认进 review

## 8) API Courtesy | 接口礼貌访问

This project uses polite headers and retry/backoff behavior.

- Mailto: `piweitseng0921@gmail.com`
- User-Agent: `ZoteroMetadataFixer/1.0 (mailto:...)`
- Request delay and bounded retries are built in.

## 9) Known Limits | 已知限制

- Heuristic score is not a probability.
- Name/year/title noise can depress score.
- Some records are outside Crossref scope.
- Review rate under 10% may not be realistic in first pass for noisy legacy libraries.

## 10) Contributing | 贡献方式

- Open an issue with:
  - script version
  - config values
  - output summary
  - sample log lines
- Submit PR with:
  - behavior changes documented in `CHANGELOG.md`
  - clear migration notes

---

Maintainer: Eric-0921
