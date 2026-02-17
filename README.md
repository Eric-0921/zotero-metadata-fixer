# Zotero Metadata Fixer

English | 中文

## What This Project Is | 项目定位

This is a production-style Zotero automation project for:
- metadata completion (`DOI`, journal, year, abstract)
- deterministic + LLM-assisted tagging
- queue-based workflow control
- auditable logs and repeatable batch execution

这是一个面向生产实践的 Zotero 自动化项目，目标是：
- 补全文献核心元数据（`DOI`、期刊、年份、摘要）
- 结合规则系统与 LLM 进行标签分类
- 基于队列标签进行可控流程编排
- 全流程日志可追溯、可复跑

## Project Docs | 文档导航

- Overview | 总览: `docs/PROJECT_OVERVIEW.md`
- Architecture | 架构: `docs/ARCHITECTURE.md`
- Runbook | 运行手册: `docs/RUNBOOK.md`
- Pitfalls | 常见坑位: `docs/KNOWN_PITFALLS.md`
- History & Decisions | 历史决策: `docs/HISTORY_AND_DECISIONS.md`
- Roadmap | 路线图: `docs/ROADMAP.md`

Note: the `docs/` set is currently English-first; Chinese versions will be added incrementally.
说明：`docs/` 当前以英文为主，中文版本将逐步补齐。

## Quick Start | 快速开始

1. Open Zotero: `Tools -> Developer -> Run JavaScript`
2. Keep `Run as async function` checked.
3. Start with dry-run:
   - `WRITE=false`
   - `AUTO_LOOP=false`
4. Review summary + logfile under `logs/`.
5. Switch to production only after dry-run metrics look healthy.

1. 打开 Zotero：`工具 -> 开发者 -> 运行 JavaScript`
2. 勾选 `作为异步函数执行`
3. 先 dry-run：
   - `WRITE=false`
   - `AUTO_LOOP=false`
4. 查看返回摘要与 `logs/` 日志文件
5. 指标正常后再切 `WRITE=true` 正式写入

## Current Recommended Script | 当前推荐脚本

- `v8_3_s2_batch_primary_dryrun.js`
  - S2 `paper/batch` primary source
  - OpenAlex fallback for missing abstracts
  - DeepSeek controlled tag completion
  - Optional write-back for `abstractNote`, `Extra`, and tags

- `v8_3_s2_batch_primary_dryrun.js`
  - 以 S2 `paper/batch` 作为主数据源
  - 摘要缺失时回退到 OpenAlex
  - DeepSeek 受控补标签（白名单 + 候选）
  - 可选写回 `abstractNote`、`Extra` 与标签

## Repository Layout | 仓库结构

- Root scripts:
  - `v1...v3`: metadata repair evolution
  - `v6...`: rule-based tagging
  - `v8...`: LLM-assisted completion with API waterfall/batch
  - `v9...v10...`: attachment/note cleanup tools (Python)
- Logs: `logs/`
- Docs: `docs/`

- 根目录脚本：
  - `v1...v3`：元数据修复演进
  - `v6...`：规则打标阶段
  - `v8...`：LLM + API 管线补全阶段
  - `v9...v10...`：附件/笔记清理工具（Python）
- 日志目录：`logs/`
- 文档目录：`docs/`

## Status | 状态

This project is actively evolving. See `CHANGELOG.md` for release notes.
项目持续迭代中，版本变更请查看 `CHANGELOG.md`。
