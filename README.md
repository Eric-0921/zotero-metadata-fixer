# Zotero Metadata Fixer Scripts

Use these scripts in Zotero: Tools -> Developer -> Run JavaScript (Async).

Files:
- v1_selected_lookup.js: process only selected items (title/author search + DOI lookup)
- v2_full_batch_missing_only.js: process library in batches, only missing DOI/journal/date
- v3_full_batch_autoloop_log.js: batch + optional auto-loop + note logging

Recommended run order:
1) Start with v2 or v3 and set WRITE=false
2) Check output quality
3) Set WRITE=true
4) Repeat until no target items
