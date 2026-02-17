# Known Pitfalls

## 1) API Rate Limits and 429
Symptom:
- burst of `429 Too Many Requests`

Root causes:
- provider global quotas
- hidden concurrent requests from other plugins/scripts
- aggressive batch cadence

Mitigation:
- conservative `minIntervalMs`
- global cooldown after 429
- keep API-heavy plugins paused during bulk runs

## 2) Missing Abstract Despite Valid DOI
Symptom:
- DOI resolves but abstract still missing

Root causes:
- legal/content restrictions on provider side
- source-specific metadata gaps

Mitigation:
- fallback to OpenAlex
- allow title-only low-confidence mode
- queue unresolved records for manual pass

## 3) Candidate Tag Drift
Symptom:
- too many novel candidate tags

Root causes:
- weak prompt constraints
- over-broad domain language in abstracts

Mitigation:
- keep whitelist strict
- treat `candidate/*` as review queue
- promote to whitelist only after repeated evidence

## 4) Duplicate Extra Field Growth
Symptom:
- repeated metadata block in `Extra`

Root cause:
- repeated writes without idempotency guard

Mitigation:
- use sentinel check (`S2_TLDR:`)
- never append blindly in repeated runs

## 5) Confusing Debug Output
Symptom:
- frequent `CookieSandbox: Not touching channel ...`

Meaning:
- informational debug line, not an error

What to monitor instead:
- HTTP status lines (`200/4xx/5xx`)
- script summary metrics

## 6) Reprocessing Already Touched Records
Symptom:
- same queue processed again

Root cause:
- queue membership unchanged

Mitigation:
- remove processed queue tag or add done tag
- define explicit queue entry/exit policy

## 7) Context Drift During Long Collaboration
Symptom:
- repeated decisions not reflected in next script edits

Mitigation:
- maintain persistent project docs
- commit small, traceable changes with changelog updates
