// v8_deepseek_s2_dryrun.js
// Zotero Run JavaScript (Async)
// Dry-run only: fetch abstract (Semantic Scholar) + LLM tag suggestion (DeepSeek)
// Target queue: /meta_llm_untagged

const WRITE = false; // keep false for first run
const TARGET_TAG = "/meta_llm_untagged";
const ONLY_ENGLISH = true;
const REQUIRE_CORE_METADATA = true;

const BATCH_SIZE = 120;
const AUTO_LOOP = false;
const MAX_BATCHES = 10;
const S2_DELAY_MS = 900;
const DS_DELAY_MS = 600;
const MAX_RETRY = 3;

const SAVE_LOG_FILE = true;
const LOG_DIR = "C:\\Users\\Eric Tseng\\AppData\\Roaming\\Zotero\\Zotero\\scripts\\metadata-fixer\\logs";
const LOG_PREFIX = "v8_s2_deepseek_dryrun";

const MAILTO = "piweitseng0921@gmail.com";
const UA = `ZoteroMetadataFixer/1.0 (mailto:${MAILTO})`;

// Fill your real key before running
const DEEPSEEK_API_KEY = "sk-e8a602a3dfff46a4ab30ce9c1108177e";
const DEEPSEEK_MODEL = "deepseek-chat";

const RULE_PREFIXES = ["topic/", "method/", "material/", "app/"];
const ALLOWED_TAGS = new Set([
  "topic/nv_center",
  "topic/plasmonic_sensing",
  "topic/fiber_optic_sensing",
  "topic/tmd_2d_materials",
  "topic/biosensing",
  "method/odmr",
  "method/cw_odmr",
  "method/pulsed_odmr",
  "method/esr_epr",
  "method/fabry_perot",
  "method/mach_zehnder",
  "method/michelson",
  "method/sagnac",
  "method/ring_resonator",
  "method/long_period_grating",
  "method/bragg_grating",
  "method/ring_down",
  "method/raman",
  "method/fluorescence_pl",
  "method/electrochemical",
  "method/fem_simulation",
  "material/diamond_nv",
  "material/graphene",
  "material/mos2",
  "material/tmd_other",
  "material/gold_nanostructure",
  "material/silver_nanostructure",
  "material/ferrofluid",
  "material/polymer_hydrogel",
  "app/magnetometry",
  "app/thermometry",
  "app/strain_pressure",
  "app/refractive_index",
  "app/biochemical_detection",
  "app/gas_sensing",
  "app/ph_sensing",
  "app/humidity_sensing",
  "app/electric_field",
]);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function containsCJK(s) { return /[\u3400-\u9FFF]/.test(s || ""); }
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
  if (ALLOWED_TAGS.has(t)) return t;
  if (t.startsWith("topic/") || t.startsWith("method/") || t.startsWith("material/") || t.startsWith("app/")) {
    return `candidate/${t}`;
  }
  return "";
}

async function requestJSON(method, url, body, headers = {}) {
  let delay = 800;
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      const req = await Zotero.HTTP.request(method, url, {
        body: body ? JSON.stringify(body) : undefined,
        headers: {
          Accept: "application/json",
          "User-Agent": UA,
          ...headers,
        },
      });
      return JSON.parse(req.responseText);
    } catch (e) {
      const status = e?.status || 0;
      const retryable = [429, 500, 502, 503, 504].includes(status);
      if (!retryable || i === MAX_RETRY - 1) throw e;
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error("requestJSON failed");
}

async function fetchAbstractByDOI(doi) {
  const d = encodeURIComponent(`DOI:${normalizeDOI(doi)}`);
  const fields = "title,abstract,year,journal,externalIds";
  const url = `https://api.semanticscholar.org/graph/v1/paper/${d}?fields=${encodeURIComponent(fields)}`;
  const json = await requestJSON("GET", url, null);
  return {
    abstract: (json?.abstract || "").trim(),
    source: "s2_doi",
  };
}

async function fetchAbstractByTitle(title) {
  const fields = "title,abstract,year,journal,externalIds";
  const p = new URLSearchParams({ query: title || "", limit: "1", fields });
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${p.toString()}`;
  const json = await requestJSON("GET", url, null);
  const first = json?.data?.[0];
  return {
    abstract: (first?.abstract || "").trim(),
    source: "s2_title",
  };
}

async function askDeepSeek(itemKey, title, abstract, journal, year, existingRuleTags) {
  const prompt = [
    "You are a controlled tag suggestion engine for a Zotero library.",
    "Return strict JSON only.",
    "You must prioritize allowed tags.",
    "If no allowed tag is suitable, you may propose candidate tags only with prefixes topic/, method/, material/, app/.",
    "Do not return generic tags.",
    "",
    "Allowed tags:",
    ...Array.from(ALLOWED_TAGS),
    "",
    "Output schema:",
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
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: userContent },
    ],
  };

  const json = await requestJSON("POST", "https://api.deepseek.com/chat/completions", payload, {
    "Content-Type": "application/json",
    Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
  });
  const content = json?.choices?.[0]?.message?.content || "{}";
  return JSON.parse(content);
}

async function saveLogFile(logText) {
  const stamp = new Date().toISOString().replace(/[:]/g, "-").replace("T", "_").slice(0, 19);
  const filePath = `${LOG_DIR}\\${LOG_PREFIX}_${stamp}.log`;
  if (typeof IOUtils !== "undefined") {
    await IOUtils.makeDirectory(LOG_DIR, { createAncestors: true, ignoreExisting: true });
  }
  await Zotero.File.putContentsAsync(filePath, logText);
  return filePath;
}

const pane = Zotero.getActiveZoteroPane();
const libraryID = pane.getSelectedLibraryID();
const journalTypeID = Zotero.ItemTypes.getID("journalArticle");
const details = [];

let processedTotal = 0;
let checked = 0;
let skipped = 0;
let skippedCN = 0;
let skippedNoMeta = 0;
let s2Fetched = 0;
let s2Miss = 0;
let dsSuccess = 0;
let dsFail = 0;
let allowedSuggested = 0;
let candidateSuggested = 0;
let batchesDone = 0;
let failed = 0;
let savedLogFilePath = "";

for (let b = 0; b < (AUTO_LOOP ? MAX_BATCHES : 1); b++) {
  const all = await Zotero.Items.getAll(libraryID, false, false, false);
  const candidates = all
    .filter((i) => i.isRegularItem() && i.itemTypeID === journalTypeID)
    .filter((i) => (i.getTags() || []).some((t) => (t?.tag || "") === TARGET_TAG))
    .slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
  if (!candidates.length) break;

  batchesDone++;
  for (const item of candidates) {
    processedTotal++;
    try {
      const title = (item.getField("title") || "").trim();
      const journal = (item.getField("publicationTitle") || "").trim();
      const year = (item.getField("date") || "").trim();
      const doi = normalizeDOI(item.getField("DOI") || "");
      let abstract = (item.getField("abstractNote") || "").trim();

      if (ONLY_ENGLISH && (containsCJK(title) || containsCJK(abstract) || containsCJK(journal))) {
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
      if (!abstract || abstract.length < 80) {
        try {
          const s2 = doi ? await fetchAbstractByDOI(doi) : await fetchAbstractByTitle(title);
          if (s2.abstract && s2.abstract.length > 80) {
            abstract = s2.abstract;
            s2Fetched++;
            await sleep(S2_DELAY_MS);
          } else {
            s2Miss++;
          }
        } catch (_) {
          s2Miss++;
        }
      }

      const existingRuleTags = (item.getTags() || []).map((t) => t.tag).filter((t) => RULE_PREFIXES.some((p) => t.startsWith(p)));
      if (!abstract || abstract.length < 80) {
        details.push(`${item.key} | skip_no_abstract_after_s2 | ${title.slice(0, 80)}`);
        continue;
      }

      try {
        const ds = await askDeepSeek(item.key, title, abstract, journal, year, existingRuleTags);
        const first = ds?.items?.[0] || {};
        const allowedRaw = Array.isArray(first.allowed_tags) ? first.allowed_tags : [];
        const candidateRaw = Array.isArray(first.candidate_tags) ? first.candidate_tags : [];

        const allowed = allowedRaw.map((x) => (x || "").trim().toLowerCase()).filter((x) => ALLOWED_TAGS.has(x));
        const candidatesNorm = candidateRaw.map(sanitizeCandidateTag).filter(Boolean);

        allowedSuggested += allowed.length;
        candidateSuggested += candidatesNorm.length;
        dsSuccess++;

        if (WRITE) {
          for (const t of allowed) if (!item.hasTag(t)) item.addTag(t);
          for (const t of candidatesNorm) if (!item.hasTag(t)) item.addTag(t);
          if (allowed.length || candidatesNorm.length) await item.saveTx();
        }

        details.push(`${item.key} | allowed=[${allowed.join(", ")}] | candidate=[${candidatesNorm.join(", ")}] | ${title.slice(0, 80)}`);
        await sleep(DS_DELAY_MS);
      } catch (e) {
        dsFail++;
        details.push(`${item.key} | deepseek_fail | ${String(e?.message || e)}`);
      }
    } catch (e) {
      failed++;
      details.push(`FAIL | ${item?.key || "?"} | ${String(e?.message || e)}`);
    }
  }

  if (!AUTO_LOOP) break;
}

const summary = [
  `time=${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
  `WRITE=${WRITE}, TARGET_TAG=${TARGET_TAG}, ONLY_ENGLISH=${ONLY_ENGLISH}, REQUIRE_CORE_METADATA=${REQUIRE_CORE_METADATA}`,
  `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
  `library=${libraryID}, processed_total=${processedTotal}, batches_done=${batchesDone}`,
  `checked=${checked}, skipped=${skipped}, skipped_cn=${skippedCN}, skipped_no_meta=${skippedNoMeta}, failed=${failed}`,
  `s2: fetched=${s2Fetched}, miss=${s2Miss}`,
  `deepseek: success=${dsSuccess}, fail=${dsFail}, allowed_suggested=${allowedSuggested}, candidate_suggested=${candidateSuggested}`,
  "",
  "details:",
  ...details,
].join("\n");

if (SAVE_LOG_FILE) {
  try { savedLogFilePath = await saveLogFile(summary); } catch (_) {}
}

return [
  `WRITE=${WRITE}, TARGET_TAG=${TARGET_TAG}`,
  `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
  `processed_total=${processedTotal}, checked=${checked}, skipped=${skipped}, failed=${failed}`,
  `s2: fetched=${s2Fetched}, miss=${s2Miss}`,
  `deepseek: success=${dsSuccess}, fail=${dsFail}, allowed_suggested=${allowedSuggested}, candidate_suggested=${candidateSuggested}`,
  `log_file=${savedLogFilePath || "(disabled/failed)"}`,
].join("\n\n");

