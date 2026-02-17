# Runbook

## 0. Preconditions
- Zotero desktop running.
- `Tools -> Developer -> Run JavaScript` available.
- `Run as async function` enabled.
- Stable network.
- Optional: pause other API-heavy plugins during long runs.

## 1. Recommended Order

1. Metadata foundation (v3.x)
2. Deterministic tagging (v6.1)
3. Queue curation for LLM (`/meta_llm_untagged`)
4. LLM completion with enrichment (v8.3)
5. Post-run audit and low-confidence handling

## 2. Dry-Run Pattern (Always First)
- Set `WRITE=false`.
- Use moderate batch size.
- Run one batch.
- Inspect summary metrics and item-level logs.

## 3. Production Pattern
- Set `WRITE=true` only after dry-run quality is acceptable.
- Increase `BATCH_SIZE` and enable looping.
- Keep conservative rate-limit values unchanged.

Suggested v8.3 production settings:
```js
const WRITE = true;
const BATCH_SIZE = 120;
const AUTO_LOOP = true;
const MAX_BATCHES = 20;
```

## 4. Interpreting v8.3 Metrics

Healthy indicators:
- `failed=0`
- `provider_s2_429=0` or very low
- `deepseek: fail=0`

Coverage indicators:
- `abstract: s2_batch=... openalex=... miss=... title_only=...`
- `s2_meta: hit=... miss=...`

Quality indicators:
- high `allowed_suggested`
- low but non-zero `candidate_suggested`

## 5. Handling Low-Confidence Items

Title-only fallback records are expected in noisy libraries.
Suggested operations:
- assign a dedicated low-confidence operational tag
- rerun with alternate sources for this subset
- manually review before high-impact use

## 6. Git Release Flow

From repo root (`scripts/metadata-fixer`):
```bash
git status
git add -A
git commit -m "chore: ..."
git push origin main
```

## 7. Rollback / Safety

- Prefer non-destructive workflows.
- Keep logs from every production run.
- If behavior regresses, revert script version by checking previous commit and rerun dry-run before write mode.
