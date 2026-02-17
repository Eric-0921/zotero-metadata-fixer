# Roadmap

## Near Term (v8.x hardening)
- Add explicit done/exit queue policy for `/meta_llm_untagged`.
- Add low-confidence queue tag for `title_only` outcomes.
- Add post-run report splitting:
  - high-confidence writes
  - candidate-tag records
  - unresolved/no-abstract records

## Mid Term (v8.4 / v8.5)
- Optional provider expansion (Europe PMC fallback for biosensor-heavy subset).
- Add per-batch quality report (coverage + latency + provider hit matrix).
- Add optional field-level write switches:
  - write abstract only
  - write extra only
  - write tags only

## Long Term
- Build a compact local dashboard from log files.
- Add regression tests on synthetic metadata fixtures.
- Formalize release branches and semantic versioning.
- Add Chinese documentation set and user-facing operations guide.

## Operational Targets
- `failed=0` for production runs.
- `provider_429` near zero.
- abstract coverage > 75% for LLM queue records.
- candidate-tag ratio controlled and reviewed before promotion to whitelist.
