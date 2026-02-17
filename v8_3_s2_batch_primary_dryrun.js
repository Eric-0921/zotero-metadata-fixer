// v8_3_s2_batch_primary_dryrun.js
// Zotero Run JavaScript (Async)
// Dry-run by default: S2 paper/batch (primary) -> OpenAlex (fallback) -> DeepSeek
// Target queue: /meta_llm_untagged

const WRITE = false;
const TARGET_TAG = "/meta_llm_untagged";
const ONLY_ENGLISH = true;
const REQUIRE_CORE_METADATA = true;
const ALLOW_TITLE_ONLY_FALLBACK = true;

const BATCH_SIZE = 60;
const AUTO_LOOP = false;
const MAX_BATCHES = 5;
const PROGRESS_EVERY = 5;

const MAX_RETRY = 5;
const RETRY_JITTER_MS = 1000;
const LOG_RATE_LIMIT_EVENTS = true;
const GLOBAL_COOLDOWN_ON_429_MS = 60000;
const S2_STARTUP_WARMUP_MS = 3000;

// S2 hard policy: 1 req/sec across all endpoints. Keep safety margin.
const S2_MIN_INTERVAL_MS = 1500;
const S2_BATCH_SIZE = 10; // conservative (user preference)

const PROVIDER_POLICY = {
  s2: { minIntervalMs: S2_MIN_INTERVAL_MS, penalty429Ms: 90000 },
  openalex: { minIntervalMs: 2500, penalty429Ms: 30000 },
  deepseek: { minIntervalMs: 1800, penalty429Ms: 15000 },
};

const SAVE_LOG_FILE = true;
const LOG_DIR = "C:\\Users\\Eric Tseng\\AppData\\Roaming\\Zotero\\Zotero\\scripts\\metadata-fixer\\logs";
const LOG_PREFIX = "v8_3_s2_batch_primary_dryrun";

const MAILTO = "piweitseng0921@gmail.com";
const UA = `ZoteroMetadataFixer/1.0 (mailto:${MAILTO})`;
const OPENALEX_API_BASE = "https://api.openalex.org/works";
const S2_PAPER_BATCH_URL = "https://api.semanticscholar.org/graph/v1/paper/batch";

// User-requested: keep keys directly in JS.
let DEEPSEEK_API_KEY = "sk-395e033b636f4cdd8bed4e36b1519270";
let SEMANTIC_SCHOLAR_API_KEY = "czBrl4ImnYaZHCC5Fo7cx5qM4CRbeUZhunsAUlX3";
const DEEPSEEK_MODEL = "deepseek-chat";

const S2_FIELDS = "title,abstract,year,journal,externalIds,tldr,citationCount,influentialCitationCount,openAccessPdf";

const RULE_PREFIXES = ["topic/", "method/", "material/", "app/"];
const ALLOWED_TAGS = new Set([
  "topic/nv_center", "topic/plasmonic_sensing", "topic/fiber_optic_sensing", "topic/tmd_2d_materials", "topic/biosensing",
  "method/odmr", "method/cw_odmr", "method/pulsed_odmr", "method/esr_epr", "method/fabry_perot", "method/mach_zehnder",
  "method/michelson", "method/sagnac", "method/ring_resonator", "method/long_period_grating", "method/bragg_grating",
  "method/ring_down", "method/raman", "method/fluorescence_pl", "method/electrochemical", "method/fem_simulation",
  "material/diamond_nv", "material/graphene", "material/mos2", "material/tmd_other", "material/gold_nanostructure",
  "material/silver_nanostructure", "material/ferrofluid", "material/polymer_hydrogel",
  "app/magnetometry", "app/thermometry", "app/strain_pressure", "app/refractive_index", "app/biochemical_detection",
  "app/gas_sensing", "app/ph_sensing", "app/humidity_sensing", "app/electric_field",
]);

const providerState = {
  s2: { nextAllowedAt: 0, count: 0, ok: 0, err429: 0, errOther: 0, cooldownMs: 0 },
  openalex: { nextAllowedAt: 0, count: 0, ok: 0, err429: 0, errOther: 0, cooldownMs: 0 },
  deepseek: { nextAllowedAt: 0, count: 0, ok: 0, err429: 0, errOther: 0, cooldownMs: 0 },
};
let globalNextAllowedAt = 0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function now() { return Date.now(); }
function jitter(ms) { return Math.floor(Math.random() * ms); }
function containsCJK(s) { return /[\u3400-\u9FFF]/.test(s || ""); }
function chunkArray(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}
function formatDuration(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = t % 60;
  return `${h}h ${m}m ${s}s`;
}
function normalizeDOI(raw) {
  if (!raw) return "";
  return raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
}
function hasCoreMetadata(item) {
  const doi = normalizeDOI(item.getField("DOI") || "");
  const journal = (item.getField("publicationTitle") || "").trim();
  const year = /\b(19|20)\d{2}\b/.test(item.getField("date") || "");
  return !!doi && !!journal && !!year;
}
function sanitizeCandidateTag(raw) {
  const t = (raw || "").toLowerCase().replace(/[^a-z0-9_\/]/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "");
  if (!t) return "";
  if (ALLOWED_TAGS.has(t)) return "";
  if (t.startsWith("topic/") || t.startsWith("method/") || t.startsWith("material/") || t.startsWith("app/")) return `candidate/${t}`;
  return "";
}
function rebuildOpenAlexAbstract(inv) {
  if (!inv || typeof inv !== "object") return "";
  let max = -1;
  for (const word of Object.keys(inv)) for (const p of inv[word] || []) if (p > max) max = p;
  if (max < 0) return "";
  const arr = new Array(max + 1).fill("");
  for (const word of Object.keys(inv)) for (const p of inv[word] || []) arr[p] = word;
  return arr.join(" ").trim();
}
function buildS2Extra(meta, oldExtra) {
  const tldr = (meta?.tldr?.text || "").trim();
  const inf = meta?.influentialCitationCount || 0;
  const tot = meta?.citationCount || 0;
  const pdf = (meta?.openAccessPdf?.url || "").trim();
  if (!tldr && !inf && !tot && !pdf) return oldExtra || "";
  if ((oldExtra || "").includes("S2_TLDR:")) return oldExtra || "";
  const lines = [];
  if (tldr) lines.push(`S2_TLDR: ${tldr}`);
  lines.push(`S2_Inf_Citations: ${inf} | Total: ${tot}`);
  if (pdf) lines.push(`OA_PDF: ${pdf}`);
  const block = lines.join("\n");
  return oldExtra ? `${block}\n---\n${oldExtra}` : block;
}

async function beforeProviderCall(provider) {
  const state = providerState[provider];
  const policy = PROVIDER_POLICY[provider];
  const waitUntil = Math.max(globalNextAllowedAt, state.nextAllowedAt);
  const waitMs = waitUntil - now();
  if (waitMs > 0) await sleep(waitMs);
  state.nextAllowedAt = now() + policy.minIntervalMs + jitter(200);
}
function onProvider429(provider) {
  const state = providerState[provider];
  const policy = PROVIDER_POLICY[provider];
  state.err429++;
  // First 429 uses base penalty; subsequent 429s escalate exponentially.
  state.cooldownMs = state.cooldownMs > 0
    ? Math.min(state.cooldownMs * 2, 240000)
    : policy.penalty429Ms;
  state.nextAllowedAt = Math.max(state.nextAllowedAt, now() + state.cooldownMs + jitter(RETRY_JITTER_MS));
  globalNextAllowedAt = Math.max(globalNextAllowedAt, now() + GLOBAL_COOLDOWN_ON_429_MS);
  if (LOG_RATE_LIMIT_EVENTS) {
    Zotero.debug(`[v8.3][429] provider=${provider} cooldown_ms=${state.cooldownMs} global_cooldown_ms=${GLOBAL_COOLDOWN_ON_429_MS}`);
  }
}
function onProviderOk(provider) {
  const state = providerState[provider];
  state.ok++;
  if (state.cooldownMs > 0) state.cooldownMs = Math.floor(state.cooldownMs * 0.7);
}

async function requestJSON(provider, method, url, body, headers = {}) {
  let delay = 1200;
  for (let i = 0; i < MAX_RETRY; i++) {
    const plannedWaitUntil = Math.max(globalNextAllowedAt, providerState[provider].nextAllowedAt);
    const plannedWaitMs = Math.max(0, plannedWaitUntil - now());
    if (LOG_RATE_LIMIT_EVENTS && plannedWaitMs > 0) {
      Zotero.debug(`[v8.3][throttle] provider=${provider} enforced_wait_ms=${plannedWaitMs}`);
    }
    await beforeProviderCall(provider);
    providerState[provider].count++;
    try {
      const req = await Zotero.HTTP.request(method, url, {
        body: body ? JSON.stringify(body) : undefined,
        headers: { Accept: "application/json", "User-Agent": UA, ...headers },
      });
      onProviderOk(provider);
      return JSON.parse(req.responseText);
    } catch (e) {
      const status = e?.status || 0;
      const retryable = [429, 500, 502, 503, 504].includes(status);
      if (status === 429) onProvider429(provider);
      else providerState[provider].errOther++;
      if (!retryable || i === MAX_RETRY - 1) throw e;
      const waitMs = delay + jitter(RETRY_JITTER_MS);
      if (LOG_RATE_LIMIT_EVENTS) {
        Zotero.debug(`[v8.3][retry] provider=${provider} status=${status} attempt=${i + 1}/${MAX_RETRY} wait_ms=${waitMs}`);
      }
      await sleep(waitMs);
      delay = Math.min(delay * 2, 20000);
    }
  }
  throw new Error("requestJSON failed");
}

async function fetchS2BatchByDOI(dois) {
  if (!dois.length) return [];
  const ids = dois.map((d) => `DOI:${normalizeDOI(d)}`);
  const headers = {
    "Content-Type": "application/json",
    "x-api-key": SEMANTIC_SCHOLAR_API_KEY,
  };
  const params = new URLSearchParams({ fields: S2_FIELDS });
  const url = `${S2_PAPER_BATCH_URL}?${params.toString()}`;
  const json = await requestJSON("s2", "POST", url, { ids }, headers);
  return Array.isArray(json) ? json : [];
}

async function fetchAbstractOpenAlex(doi, title) {
  try {
    if (doi) {
      const id = encodeURIComponent(`https://doi.org/${normalizeDOI(doi)}`);
      const url = `${OPENALEX_API_BASE}/${id}?mailto=${encodeURIComponent(MAILTO)}`;
      const json = await requestJSON("openalex", "GET", url, null);
      const abs = rebuildOpenAlexAbstract(json?.abstract_inverted_index);
      if (abs.length > 80) return { abstract: abs, source: "openalex_doi" };
    }
  } catch (_) {}
  try {
    const p = new URLSearchParams({ search: title || "", "per-page": "1", mailto: MAILTO });
    const url = `${OPENALEX_API_BASE}?${p.toString()}`;
    const json = await requestJSON("openalex", "GET", url, null);
    const first = json?.results?.[0];
    const abs = rebuildOpenAlexAbstract(first?.abstract_inverted_index);
    if (abs.length > 80) return { abstract: abs, source: "openalex_title" };
  } catch (_) {}
  return { abstract: "", source: "openalex_miss" };
}

async function askDeepSeek(itemKey, title, abstract, journal, year, existingRuleTags) {
  const prompt = [
    "You are a controlled tag suggestion engine for a Zotero library.",
    "Return strict JSON only.",
    "Prioritize allowed tags.",
    "If no allowed tag is suitable, propose candidate tags only with prefixes topic/, method/, material/, app/.",
    "Do not return generic tags.",
    "Allowed tags:",
    ...Array.from(ALLOWED_TAGS),
    '{"items":[{"key":"<itemKey>","allowed_tags":["..."],"candidate_tags":["..."],"reason":"..."}]}',
  ].join("\n");
  const userContent = [
    `item_key: ${itemKey}`,
    `title: ${title || ""}`,
    `journal: ${journal || ""}`,
    `year: ${year || ""}`,
    `existing_rule_tags: ${existingRuleTags.join(", ") || "(none)"}`,
    `abstract: ${abstract || ""}`,
  ].join("\n");
  const payload = {
    model: DEEPSEEK_MODEL,
    temperature: 0.1,
    response_format: { type: "json_object" },
    messages: [{ role: "system", content: prompt }, { role: "user", content: userContent }],
  };
  const json = await requestJSON("deepseek", "POST", "https://api.deepseek.com/chat/completions", payload, {
    "Content-Type": "application/json",
    Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
  });
  const content = json?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}

async function saveLogFile(logText) {
  const stamp = new Date().toISOString().replace(/[:]/g, "-").replace("T", "_").slice(0, 19);
  const filePath = `${LOG_DIR}\\${LOG_PREFIX}_${stamp}.log`;
  if (typeof IOUtils !== "undefined") await IOUtils.makeDirectory(LOG_DIR, { createAncestors: true, ignoreExisting: true });
  await Zotero.File.putContentsAsync(filePath, logText);
  return filePath;
}

if (!DEEPSEEK_API_KEY || DEEPSEEK_API_KEY === "YOUR_DEEPSEEK_API_KEY") throw new Error("Please set DEEPSEEK_API_KEY.");
if (!SEMANTIC_SCHOLAR_API_KEY) throw new Error("Please set SEMANTIC_SCHOLAR_API_KEY.");
if (LOG_RATE_LIMIT_EVENTS) {
  Zotero.debug(`[v8.3] s2_key_loaded=${!!SEMANTIC_SCHOLAR_API_KEY} s2_key_len=${SEMANTIC_SCHOLAR_API_KEY.length}`);
  Zotero.debug(`[v8.3] s2_startup_warmup_ms=${S2_STARTUP_WARMUP_MS}`);
}
await sleep(S2_STARTUP_WARMUP_MS);

const pane = Zotero.getActiveZoteroPane();
const libraryID = pane.getSelectedLibraryID();
const journalTypeID = Zotero.ItemTypes.getID("journalArticle");

const all = await Zotero.Items.getAll(libraryID, false, false, false);
const targetAll = all
  .filter((i) => i.isRegularItem() && i.itemTypeID === journalTypeID)
  .filter((i) => (i.getTags() || []).some((t) => (t?.tag || "") === TARGET_TAG));

const maxItems = AUTO_LOOP ? Math.min(targetAll.length, BATCH_SIZE * MAX_BATCHES) : Math.min(targetAll.length, BATCH_SIZE);
const candidates = targetAll.slice(0, maxItems);
const totalPlanned = candidates.length;
const startedAt = now();

const details = [];
let processedTotal = 0, handledTotal = 0, checked = 0, skipped = 0, skippedCN = 0, skippedNoMeta = 0, failed = 0;
let absFromExisting = 0, absFromS2Batch = 0, absFromOpenAlex = 0, absMiss = 0;
let s2MetaHit = 0, s2MetaMiss = 0, s2ExtraPrepared = 0, s2ExtraSkippedExisting = 0;
let deepseekSuccess = 0, deepseekFail = 0, allowedSuggested = 0, candidateSuggested = 0;
let lowConfidenceTitleOnly = 0;
let savedLogFilePath = "";

const ready = [];
for (const item of candidates) {
  processedTotal++;
  const title = (item.getField("title") || "").trim();
  const abs = (item.getField("abstractNote") || "").trim();
  const journal = (item.getField("publicationTitle") || "").trim();
  if (ONLY_ENGLISH && (containsCJK(title) || containsCJK(abs) || containsCJK(journal))) {
    skipped++;
    skippedCN++;
    continue;
  }
  if (REQUIRE_CORE_METADATA && !hasCoreMetadata(item)) {
    skipped++;
    skippedNoMeta++;
    continue;
  }
  checked++;
  ready.push(item);
}

const needS2ByDOI = [];
for (const item of ready) {
  const oldAbs = (item.getField("abstractNote") || "").trim();
  const doi = normalizeDOI(item.getField("DOI") || "");
  if (oldAbs.length < 80 && doi) needS2ByDOI.push(doi);
}
const uniqueDois = Array.from(new Set(needS2ByDOI));
const doiToS2 = new Map();
for (const group of chunkArray(uniqueDois, S2_BATCH_SIZE)) {
  try {
    const rows = await fetchS2BatchByDOI(group);
    for (const r of rows) {
      const d = normalizeDOI(r?.externalIds?.DOI || "");
      if (d && !doiToS2.has(d)) doiToS2.set(d, r);
    }
  } catch (e) {
    details.push(`s2_batch_fail | size=${group.length} | ${String(e?.message || e)}`);
  }
}

for (const item of ready) {
  handledTotal++;
  try {
    const title = (item.getField("title") || "").trim();
    const journal = (item.getField("publicationTitle") || "").trim();
    const year = (item.getField("date") || "").trim();
    const doi = normalizeDOI(item.getField("DOI") || "");
    const oldExtra = (item.getField("extra") || "").trim();
    let abstract = (item.getField("abstractNote") || "").trim();
    let absSource = abstract.length >= 80 ? "existing" : "none";
    let s2meta = null;

    if (abstract.length >= 80) {
      absFromExisting++;
    } else if (doi && doiToS2.has(doi)) {
      s2meta = doiToS2.get(doi);
      const abs = (s2meta?.abstract || "").trim();
      if (abs.length >= 80) {
        abstract = abs;
        absSource = "s2_batch_doi";
        absFromS2Batch++;
      }
      s2MetaHit++;
    } else {
      s2MetaMiss++;
    }

    if (absSource === "none") {
      const oa = await fetchAbstractOpenAlex(doi, title);
      if (oa.abstract.length > 80) {
        abstract = oa.abstract;
        absSource = oa.source;
        absFromOpenAlex++;
      } else {
        absMiss++;
        if (!ALLOW_TITLE_ONLY_FALLBACK) {
          details.push(`${item.key} | skip_no_abstract_after_waterfall | ${title.slice(0, 80)}`);
          continue;
        }
        abstract = "";
        absSource = "title_only_fallback";
        lowConfidenceTitleOnly++;
      }
    }

    let newExtra = oldExtra;
    if (s2meta) {
      const merged = buildS2Extra(s2meta, oldExtra);
      if (merged !== oldExtra) {
        newExtra = merged;
        s2ExtraPrepared++;
      } else if (oldExtra.includes("S2_TLDR:")) {
        s2ExtraSkippedExisting++;
      }
    }

    const existingRuleTags = (item.getTags() || []).map((t) => t.tag).filter((t) => RULE_PREFIXES.some((p) => t.startsWith(p)));
    try {
      const ds = await askDeepSeek(item.key, title, abstract, journal, year, existingRuleTags);
      const first = ds?.items?.[0] || {};
      const allowed = (Array.isArray(first.allowed_tags) ? first.allowed_tags : [])
        .map((x) => (x || "").trim().toLowerCase())
        .filter((x) => ALLOWED_TAGS.has(x));
      const allowedSet = new Set(allowed);
      const candidate = (Array.isArray(first.candidate_tags) ? first.candidate_tags : [])
        .map(sanitizeCandidateTag)
        .filter((x) => x && !allowedSet.has(x.replace(/^candidate\//, "")));

      allowedSuggested += allowed.length;
      candidateSuggested += candidate.length;
      deepseekSuccess++;

      if (WRITE) {
        if (absSource !== "existing" && absSource !== "title_only_fallback" && abstract.length > 80) {
          item.setField("abstractNote", abstract);
        }
        if (newExtra !== oldExtra) item.setField("extra", newExtra);
        for (const t of allowed) if (!item.hasTag(t)) item.addTag(t);
        for (const t of candidate) if (!item.hasTag(t)) item.addTag(t);
        await item.saveTx();
      }

      const absLen = abstract ? abstract.length : 0;
      const tldrFlag = s2meta?.tldr?.text ? "1" : "0";
      const citeFlag = (typeof s2meta?.citationCount === "number") ? "1" : "0";
      details.push(`${item.key} | abs=${absSource} len=${absLen} s2_tldr=${tldrFlag} s2_cite=${citeFlag} | allowed=[${allowed.join(", ")}] | candidate=[${candidate.join(", ")}] | ${title.slice(0, 80)}`);
    } catch (e) {
      deepseekFail++;
      details.push(`${item.key} | deepseek_fail | ${String(e?.message || e)}`);
    }
  } catch (e) {
    failed++;
    details.push(`FAIL | ${item?.key || "?"} | ${String(e?.message || e)}`);
  }

  if (handledTotal % PROGRESS_EVERY === 0 || handledTotal === totalPlanned) {
    const elapsed = now() - startedAt;
    const avg = elapsed / Math.max(handledTotal, 1);
    const eta = avg * (totalPlanned - handledTotal);
    Zotero.debug(`[v8.3] progress ${handledTotal}/${totalPlanned} | elapsed=${formatDuration(elapsed)} | eta=${formatDuration(eta)}`);
  }
}

const elapsedMs = now() - startedAt;
const avgMsPerItem = totalPlanned ? Math.round(elapsedMs / totalPlanned) : 0;
const summary = [
  `time=${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
  `WRITE=${WRITE}, TARGET_TAG=${TARGET_TAG}, ONLY_ENGLISH=${ONLY_ENGLISH}, REQUIRE_CORE_METADATA=${REQUIRE_CORE_METADATA}`,
  `ALLOW_TITLE_ONLY_FALLBACK=${ALLOW_TITLE_ONLY_FALLBACK}`,
  `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
  `provider_intervals_ms: s2=${PROVIDER_POLICY.s2.minIntervalMs}, openalex=${PROVIDER_POLICY.openalex.minIntervalMs}, deepseek=${PROVIDER_POLICY.deepseek.minIntervalMs}`,
  `s2_startup_warmup_ms=${S2_STARTUP_WARMUP_MS}`,
  `s2_batch_size=${S2_BATCH_SIZE}, s2_fields=${S2_FIELDS}`,
  `library=${libraryID}, planned=${totalPlanned}, processed_total=${processedTotal}`,
  `checked=${checked}, skipped=${skipped}, skipped_cn=${skippedCN}, skipped_no_meta=${skippedNoMeta}, failed=${failed}`,
  `abstract: existing=${absFromExisting}, s2_batch=${absFromS2Batch}, openalex=${absFromOpenAlex}, miss=${absMiss}, title_only=${lowConfidenceTitleOnly}`,
  `s2_meta: hit=${s2MetaHit}, miss=${s2MetaMiss}, extra_prepared=${s2ExtraPrepared}, extra_skipped_existing=${s2ExtraSkippedExisting}`,
  `deepseek: success=${deepseekSuccess}, fail=${deepseekFail}, allowed_suggested=${allowedSuggested}, candidate_suggested=${candidateSuggested}`,
  `provider_s2: calls=${providerState.s2.count}, ok=${providerState.s2.ok}, err429=${providerState.s2.err429}, errOther=${providerState.s2.errOther}, cooldownMs=${providerState.s2.cooldownMs}`,
  `provider_openalex: calls=${providerState.openalex.count}, ok=${providerState.openalex.ok}, err429=${providerState.openalex.err429}, errOther=${providerState.openalex.errOther}, cooldownMs=${providerState.openalex.cooldownMs}`,
  `provider_deepseek: calls=${providerState.deepseek.count}, ok=${providerState.deepseek.ok}, err429=${providerState.deepseek.err429}, errOther=${providerState.deepseek.errOther}, cooldownMs=${providerState.deepseek.cooldownMs}`,
  `timing: elapsed=${formatDuration(elapsedMs)}, avg_ms_per_item=${avgMsPerItem}, est_per_100_items=${formatDuration(avgMsPerItem * 100)}`,
  "",
  "details:",
  ...details,
].join("\n");

if (SAVE_LOG_FILE) {
  try { savedLogFilePath = await saveLogFile(summary); } catch (_) {}
}

return [
  `WRITE=${WRITE}, TARGET_TAG=${TARGET_TAG}`,
  `planned=${totalPlanned}, processed_total=${processedTotal}`,
  `checked=${checked}, skipped=${skipped}, failed=${failed}`,
  `abstract: existing=${absFromExisting}, s2_batch=${absFromS2Batch}, openalex=${absFromOpenAlex}, miss=${absMiss}, title_only=${lowConfidenceTitleOnly}`,
  `s2_meta: hit=${s2MetaHit}, miss=${s2MetaMiss}, extra_prepared=${s2ExtraPrepared}, extra_skipped_existing=${s2ExtraSkippedExisting}`,
  `deepseek: success=${deepseekSuccess}, fail=${deepseekFail}, allowed_suggested=${allowedSuggested}, candidate_suggested=${candidateSuggested}`,
  `provider_s2_429=${providerState.s2.err429}, provider_openalex_429=${providerState.openalex.err429}, provider_deepseek_429=${providerState.deepseek.err429}`,
  `timing: elapsed=${formatDuration(elapsedMs)}, avg_ms_per_item=${avgMsPerItem}`,
  `log_file=${savedLogFilePath || "(disabled/failed)"}`,
].join("\n\n");
