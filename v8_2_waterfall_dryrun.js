// v8_2_waterfall_dryrun.js
// Zotero Run JavaScript (Async)
// Dry-run only: OpenAlex -> Semantic Scholar -> DeepSeek
// Target queue: /meta_llm_untagged

const WRITE = false;
const TARGET_TAG = "/meta_llm_untagged";
const ONLY_ENGLISH = true;
const REQUIRE_CORE_METADATA = true;
const ALLOW_TITLE_ONLY_FALLBACK = true;

const BATCH_SIZE = 20;
const AUTO_LOOP = false;
const MAX_BATCHES = 5;
const PROGRESS_EVERY = 1;

const MAX_RETRY = 6;
const RETRY_JITTER_MS = 1200;
const GLOBAL_COOLDOWN_ON_429_MS = 20000;
const LOG_RATE_LIMIT_EVENTS = true;

const PROVIDER_POLICY = {
  openalex: { minIntervalMs: 2500, penalty429Ms: 30000 },
  // S2 official policy: 1 request/sec across all endpoints. Keep safety margin > 1000ms.
  s2: { minIntervalMs: 1300, penalty429Ms: 60000 },
  deepseek: { minIntervalMs: 1800, penalty429Ms: 15000 },
};

const SAVE_LOG_FILE = true;
const LOG_DIR = "C:\\Users\\Eric Tseng\\AppData\\Roaming\\Zotero\\Zotero\\scripts\\metadata-fixer\\logs";
const LOG_PREFIX = "v8_2_waterfall_dryrun";

const MAILTO = "piweitseng0921@gmail.com";
const UA = `ZoteroMetadataFixer/1.0 (mailto:${MAILTO})`;
const OPENALEX_API_BASE = "https://api.openalex.org/works";
const S2_API_BASE = "https://api.semanticscholar.org/graph/v1/paper";

let DEEPSEEK_API_KEY = "sk-395e033b636f4cdd8bed4e36b1519270";
const DEEPSEEK_MODEL = "deepseek-chat";
let SEMANTIC_SCHOLAR_API_KEY = "czBrl4ImnYaZHCC5Fo7cx5qM4CRbeUZhunsAUlX3";

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
  openalex: { nextAllowedAt: 0, count: 0, ok: 0, err429: 0, errOther: 0, cooldownMs: 0 },
  s2: { nextAllowedAt: 0, count: 0, ok: 0, err429: 0, errOther: 0, cooldownMs: 0 },
  deepseek: { nextAllowedAt: 0, count: 0, ok: 0, err429: 0, errOther: 0, cooldownMs: 0 },
};
let globalNextAllowedAt = 0;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function now() { return Date.now(); }
function jitter(ms) { return Math.floor(Math.random() * ms); }
function containsCJK(s) { return /[\u3400-\u9FFF]/.test(s || ""); }
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
  for (const word of Object.keys(inv)) {
    for (const p of inv[word] || []) if (p > max) max = p;
  }
  if (max < 0) return "";
  const arr = new Array(max + 1).fill("");
  for (const word of Object.keys(inv)) for (const p of inv[word] || []) arr[p] = word;
  return arr.join(" ").trim();
}

async function beforeProviderCall(provider) {
  const state = providerState[provider];
  const policy = PROVIDER_POLICY[provider];
  const waitUntil = Math.max(globalNextAllowedAt, state.nextAllowedAt);
  const waitMs = waitUntil - now();
  if (waitMs > 0) await sleep(waitMs);
  state.nextAllowedAt = now() + policy.minIntervalMs + jitter(250);
}

function onProvider429(provider) {
  const state = providerState[provider];
  const policy = PROVIDER_POLICY[provider];
  state.err429++;
  state.cooldownMs = Math.min((state.cooldownMs || policy.penalty429Ms) * 2, 180000);
  const until = now() + state.cooldownMs + jitter(RETRY_JITTER_MS);
  state.nextAllowedAt = Math.max(state.nextAllowedAt, until);
  globalNextAllowedAt = Math.max(globalNextAllowedAt, now() + GLOBAL_COOLDOWN_ON_429_MS);
  if (LOG_RATE_LIMIT_EVENTS) {
    Zotero.debug(`[v8.2][429] provider=${provider} cooldown_ms=${state.cooldownMs} global_cooldown_ms=${GLOBAL_COOLDOWN_ON_429_MS}`);
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
        Zotero.debug(`[v8.2][retry] provider=${provider} status=${status} attempt=${i + 1}/${MAX_RETRY} wait_ms=${waitMs}`);
      }
      await sleep(waitMs);
      delay = Math.min(delay * 2, 20000);
    }
  }
  throw new Error("requestJSON failed");
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

async function fetchAbstractS2(doi, title) {
  const headers = {};
  if (SEMANTIC_SCHOLAR_API_KEY) headers["x-api-key"] = SEMANTIC_SCHOLAR_API_KEY;

  try {
    if (doi) {
      const d = encodeURIComponent(`DOI:${normalizeDOI(doi)}`);
      const fields = "title,abstract,year,journal,externalIds";
      const url = `${S2_API_BASE}/${d}?fields=${encodeURIComponent(fields)}`;
      const json = await requestJSON("s2", "GET", url, null, headers);
      const abs = (json?.abstract || "").trim();
      if (abs.length > 80) return { abstract: abs, source: "s2_doi" };
    }
  } catch (_) {}

  try {
    const fields = "title,abstract,year,journal,externalIds";
    const p = new URLSearchParams({ query: title || "", limit: "1", fields });
    const url = `${S2_API_BASE}/search?${p.toString()}`;
    const json = await requestJSON("s2", "GET", url, null, headers);
    const abs = (json?.data?.[0]?.abstract || "").trim();
    if (abs.length > 80) return { abstract: abs, source: "s2_title" };
  } catch (_) {}

  return { abstract: "", source: "s2_miss" };
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
let processedTotal = 0, checked = 0, skipped = 0, skippedCN = 0, skippedNoMeta = 0, failed = 0;
let absFromExisting = 0, absFromOpenAlex = 0, absFromS2 = 0, absMiss = 0;
let deepseekSuccess = 0, deepseekFail = 0, allowedSuggested = 0, candidateSuggested = 0;
let lowConfidenceTitleOnly = 0;
let savedLogFilePath = "";

for (const item of candidates) {
  processedTotal++;
  try {
    const title = (item.getField("title") || "").trim();
    const journal = (item.getField("publicationTitle") || "").trim();
    const year = (item.getField("date") || "").trim();
    const doi = normalizeDOI(item.getField("DOI") || "");
    let abstract = (item.getField("abstractNote") || "").trim();
    let absSource = "existing";

    if (ONLY_ENGLISH && (containsCJK(title) || containsCJK(abstract) || containsCJK(journal))) {
      skipped++; skippedCN++; continue;
    }
    if (REQUIRE_CORE_METADATA && !hasCoreMetadata(item)) {
      skipped++; skippedNoMeta++; continue;
    }
    checked++;

    if (!abstract || abstract.length < 80) {
      const oa = await fetchAbstractOpenAlex(doi, title);
      if (oa.abstract.length > 80) {
        abstract = oa.abstract;
        absSource = oa.source;
        absFromOpenAlex++;
      } else {
        const s2 = await fetchAbstractS2(doi, title);
        if (s2.abstract.length > 80) {
          abstract = s2.abstract;
          absSource = s2.source;
          absFromS2++;
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
    } else {
      absFromExisting++;
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
        for (const t of allowed) if (!item.hasTag(t)) item.addTag(t);
        for (const t of candidate) if (!item.hasTag(t)) item.addTag(t);
        if (allowed.length || candidate.length) await item.saveTx();
      }

      details.push(`${item.key} | abs=${absSource} | allowed=[${allowed.join(", ")}] | candidate=[${candidate.join(", ")}] | ${title.slice(0, 80)}`);
    } catch (e) {
      deepseekFail++;
      details.push(`${item.key} | deepseek_fail | ${String(e?.message || e)}`);
    }
  } catch (e) {
    failed++;
    details.push(`FAIL | ${item?.key || "?"} | ${String(e?.message || e)}`);
  }

  if (processedTotal % PROGRESS_EVERY === 0 || processedTotal === totalPlanned) {
    const elapsed = now() - startedAt;
    const avg = elapsed / Math.max(processedTotal, 1);
    const eta = avg * (totalPlanned - processedTotal);
    Zotero.debug(`[v8.2] progress ${processedTotal}/${totalPlanned} | elapsed=${formatDuration(elapsed)} | eta=${formatDuration(eta)}`);
  }
}

const elapsedMs = now() - startedAt;
const avgMsPerItem = totalPlanned ? Math.round(elapsedMs / totalPlanned) : 0;
const summary = [
  `time=${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
  `WRITE=${WRITE}, TARGET_TAG=${TARGET_TAG}, ONLY_ENGLISH=${ONLY_ENGLISH}, REQUIRE_CORE_METADATA=${REQUIRE_CORE_METADATA}`,
  `ALLOW_TITLE_ONLY_FALLBACK=${ALLOW_TITLE_ONLY_FALLBACK}`,
  `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
  `provider_intervals_ms: openalex=${PROVIDER_POLICY.openalex.minIntervalMs}, s2=${PROVIDER_POLICY.s2.minIntervalMs}, deepseek=${PROVIDER_POLICY.deepseek.minIntervalMs}`,
  `library=${libraryID}, planned=${totalPlanned}, processed_total=${processedTotal}`,
  `checked=${checked}, skipped=${skipped}, skipped_cn=${skippedCN}, skipped_no_meta=${skippedNoMeta}, failed=${failed}`,
  `abstract: existing=${absFromExisting}, openalex=${absFromOpenAlex}, s2=${absFromS2}, miss=${absMiss}, title_only=${lowConfidenceTitleOnly}`,
  `deepseek: success=${deepseekSuccess}, fail=${deepseekFail}, allowed_suggested=${allowedSuggested}, candidate_suggested=${candidateSuggested}`,
  `provider_openalex: calls=${providerState.openalex.count}, ok=${providerState.openalex.ok}, err429=${providerState.openalex.err429}, errOther=${providerState.openalex.errOther}, cooldownMs=${providerState.openalex.cooldownMs}`,
  `provider_s2: calls=${providerState.s2.count}, ok=${providerState.s2.ok}, err429=${providerState.s2.err429}, errOther=${providerState.s2.errOther}, cooldownMs=${providerState.s2.cooldownMs}`,
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
  `abstract: existing=${absFromExisting}, openalex=${absFromOpenAlex}, s2=${absFromS2}, miss=${absMiss}, title_only=${lowConfidenceTitleOnly}`,
  `deepseek: success=${deepseekSuccess}, fail=${deepseekFail}, allowed_suggested=${allowedSuggested}, candidate_suggested=${candidateSuggested}`,
  `provider_openalex_429=${providerState.openalex.err429}, provider_s2_429=${providerState.s2.err429}, provider_deepseek_429=${providerState.deepseek.err429}`,
  `timing: elapsed=${formatDuration(elapsedMs)}, avg_ms_per_item=${avgMsPerItem}`,
  `log_file=${savedLogFilePath || "(disabled/failed)"}`,
].join("\n\n");
