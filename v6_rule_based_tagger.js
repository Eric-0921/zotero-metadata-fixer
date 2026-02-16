// v6_rule_based_tagger.js
// Zotero Run JavaScript (Async)
// Rule-based tagging baseline for English literature

const WRITE = false;
const ONLY_ENGLISH = true;
const REQUIRE_CORE_METADATA = true; // require DOI + journal + year to tag

const BATCH_SIZE = 300;
const AUTO_LOOP = false;
const MAX_BATCHES = 10;

const MAX_TAGS_PER_ITEM = 6;
const CLEAR_OLD_RULE_TAGS = false; // set true if you want to rewrite topic/method/material/app tags

const SAVE_LOG_FILE = true;
const SAVE_LOG_NOTE = false;
const LOG_DIR = "C:\\Users\\Eric Tseng\\AppData\\Roaming\\Zotero\\Zotero\\scripts\\metadata-fixer\\logs";
const LOG_PREFIX = "v6_rule_tagger";

const CN_QUEUE_TAG = "/meta_cn_queue";
const RULE_PREFIXES = ["topic/", "method/", "material/", "app/"];

// -------- Rule Dictionary --------
// Order matters. Earlier rules have higher priority when tags exceed MAX_TAGS_PER_ITEM.
const RULES = [
  // topic
  { dim: "topic", tag: "topic/nv_center", re: /\b(nv\s*center|nitrogen[- ]vacancy|diamond\s*nv|nv[- ]diamond)\b/i },
  { dim: "topic", tag: "topic/plasmonic_sensing", re: /\b(spr|surface\s+plasmon|plasmonic|lsp?r)\b/i },
  { dim: "topic", tag: "topic/fiber_optic_sensing", re: /\b(fiber[- ]optic|optical\s+fiber|fiber\s+sensor|photonic\s+crystal\s+fiber|pcf)\b/i },
  { dim: "topic", tag: "topic/tmd_2d_materials", re: /\b(mos2|wse2|mose2|transition\s+metal\s+dichalcogenide|2d\s+material|graphene)\b/i },
  { dim: "topic", tag: "topic/biosensing", re: /\b(biosensor|biomarker|immunoassay|aptamer|glucose|dna|protein)\b/i },

  // method
  { dim: "method", tag: "method/odmr", re: /\b(odmr|optically\s+detected\s+magnetic\s+resonance)\b/i },
  { dim: "method", tag: "method/cw_odmr", re: /\b(cw[- ]?odmr|continuous[- ]wave\s+odmr)\b/i },
  { dim: "method", tag: "method/pulsed_odmr", re: /\b(pulsed\s+odmr|ramsey|hahn\s+echo|rabi)\b/i },
  { dim: "method", tag: "method/fabry_perot", re: /\b(fabry[- ]perot|fp\s+interferometer)\b/i },
  { dim: "method", tag: "method/mach_zehnder", re: /\b(mach[- ]zehnder|mzi)\b/i },
  { dim: "method", tag: "method/whispering_gallery_mode", re: /\b(whispering\s+gallery\s+mode|wgm)\b/i },
  { dim: "method", tag: "method/raman", re: /\b(raman|surface[- ]enhanced\s+raman|sers)\b/i },

  // material
  { dim: "material", tag: "material/diamond_nv", re: /\b(diamond|nanodiamond|nv\s*center|nitrogen[- ]vacancy)\b/i },
  { dim: "material", tag: "material/graphene", re: /\b(graphene|graphene\s+oxide|go\b|rgo\b)\b/i },
  { dim: "material", tag: "material/mos2", re: /\b(mos2|molybdenum\s+disulfide)\b/i },
  { dim: "material", tag: "material/gold_nanostructure", re: /\b(gold\s+nanoparticle|au\s+nanoparticle|gold\s+film|nanohole)\b/i },
  { dim: "material", tag: "material/ferrofluid", re: /\b(ferrofluid|magnetic\s+fluid|fe3o4|magnetite)\b/i },

  // app
  { dim: "app", tag: "app/magnetometry", re: /\b(magnetometry|magnetic\s+field\s+sensing|magnetometer)\b/i },
  { dim: "app", tag: "app/thermometry", re: /\b(thermometry|temperature\s+sensing|thermal\s+sensing)\b/i },
  { dim: "app", tag: "app/strain_pressure", re: /\b(strain\s+sensing|pressure\s+sensing|stress\s+sensing)\b/i },
  { dim: "app", tag: "app/refractive_index", re: /\b(refractive\s+index\s+sensing|ri\s+sensor)\b/i },
  { dim: "app", tag: "app/biochemical_detection", re: /\b(glucose\s+sensing|biochemical\s+sensing|immunoassay|carcinoembryonic|aptamer)\b/i },
];

// -------- Helpers --------
function containsCJK(s) { return /[\u3400-\u9FFF]/.test(s || ""); }
function hasCoreMetadata(item) {
  const doi = (item.getField("DOI") || "").trim();
  const journal = (item.getField("publicationTitle") || "").trim();
  const year = /\b(19|20)\d{2}\b/.test(item.getField("date") || "");
  return !!doi && !!journal && !!year;
}
function clearRuleTags(item) {
  const tags = item.getTags() || [];
  for (const t of tags) {
    const name = t?.tag || "";
    if (RULE_PREFIXES.some((p) => name.startsWith(p))) item.removeTag(name);
  }
}
function pickTags(text) {
  const byDim = {
    topic: new Set(),
    method: new Set(),
    material: new Set(),
    app: new Set(),
  };

  for (const r of RULES) {
    if (r.re.test(text)) byDim[r.dim].add(r.tag);
  }

  // Keep dimensional coverage first, then extras by rule order
  const selected = [];
  for (const dim of ["topic", "method", "material", "app"]) {
    const arr = Array.from(byDim[dim]);
    if (arr.length) selected.push(arr[0]);
  }

  if (selected.length < MAX_TAGS_PER_ITEM) {
    for (const r of RULES) {
      if (selected.length >= MAX_TAGS_PER_ITEM) break;
      if (byDim[r.dim].has(r.tag) && !selected.includes(r.tag)) selected.push(r.tag);
    }
  }

  return selected;
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

// -------- Main --------
const pane = Zotero.getActiveZoteroPane();
const libraryID = pane.getSelectedLibraryID();
const journalTypeID = Zotero.ItemTypes.getID("journalArticle");

const dimHit = { topic: 0, method: 0, material: 0, app: 0 };
const tagCount = new Map();
const pairCount = new Map();
const details = [];

let checked = 0;
let taggedItems = 0;
let updated = 0;
let skippedCN = 0;
let skippedNoMeta = 0;
let untagged = 0;
let failed = 0;
let processedTotal = 0;
let batchesDone = 0;
let savedLogFilePath = "";

for (let b = 0; b < (AUTO_LOOP ? MAX_BATCHES : 1); b++) {
  const all = await Zotero.Items.getAll(libraryID, false, false, false);
  const candidates = all.filter((i) => i.isRegularItem() && i.itemTypeID === journalTypeID).slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
  if (!candidates.length) break;

  batchesDone++;
  for (const item of candidates) {
    processedTotal++;
    try {
      const title = (item.getField("title") || "").trim();
      const abs = (item.getField("abstractNote") || "").trim();
      const journal = (item.getField("publicationTitle") || "").trim();

      if (ONLY_ENGLISH && (containsCJK(title) || containsCJK(abs) || containsCJK(journal) || (item.getTags() || []).some((t) => (t?.tag || "") === CN_QUEUE_TAG))) {
        skippedCN++;
        continue;
      }

      if (REQUIRE_CORE_METADATA && !hasCoreMetadata(item)) {
        skippedNoMeta++;
        continue;
      }

      checked++;
      const text = `${title}\n${abs}\n${journal}`.toLowerCase();
      const tags = pickTags(text);

      if (!tags.length) {
        untagged++;
        continue;
      }

      // stats
      const dims = new Set(tags.map((t) => t.split("/")[0]));
      for (const d of dims) dimHit[d]++;
      for (const t of tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
      for (let i = 0; i < tags.length; i++) {
        for (let j = i + 1; j < tags.length; j++) {
          const p = [tags[i], tags[j]].sort().join(" + ");
          pairCount.set(p, (pairCount.get(p) || 0) + 1);
        }
      }

      if (WRITE) {
        if (CLEAR_OLD_RULE_TAGS) clearRuleTags(item);
        for (const t of tags) {
          if (!item.hasTag(t)) item.addTag(t);
        }
        await item.saveTx();
      }

      taggedItems++;
      updated++;
      details.push(`${item.key} | ${tags.join("; ")}`);
    } catch (e) {
      failed++;
      details.push(`FAIL | ${item?.key || "?"} | ${String(e?.message || e)}`);
    }
  }

  if (!AUTO_LOOP) break;
}

const topTags = Array.from(tagCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 40);
const topPairs = Array.from(pairCount.entries()).sort((a, b) => b[1] - a[1]).slice(0, 30);

const summary = [
  `time=${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
  `WRITE=${WRITE}, ONLY_ENGLISH=${ONLY_ENGLISH}, REQUIRE_CORE_METADATA=${REQUIRE_CORE_METADATA}`,
  `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
  `library=${libraryID}, processed_total=${processedTotal}, batches_done=${batchesDone}`,
  `checked=${checked}, tagged_items=${taggedItems}, updated=${updated}, untagged=${untagged}, skipped_cn=${skippedCN}, skipped_no_meta=${skippedNoMeta}, failed=${failed}`,
  `dim_coverage: topic=${dimHit.topic}, method=${dimHit.method}, material=${dimHit.material}, app=${dimHit.app}`,
  "",
  "top_tags:",
  ...topTags.map(([t, n]) => `${t} => ${n}`),
  "",
  "top_pairs:",
  ...topPairs.map(([p, n]) => `${p} => ${n}`),
  "",
  "details:",
  ...details,
].join("\n");

if (SAVE_LOG_FILE) {
  try { savedLogFilePath = await saveLogFile(summary); } catch (_) {}
}

if (SAVE_LOG_NOTE) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const note = new Zotero.Item("note");
  note.libraryID = libraryID;
  note.setNote(`<h1>V6 Rule Tagger Log ${Zotero.Utilities.htmlSpecialChars(stamp)}</h1><pre>${Zotero.Utilities.htmlSpecialChars(summary)}</pre>`);
  await note.saveTx();
}

return [
  `WRITE=${WRITE}, ONLY_ENGLISH=${ONLY_ENGLISH}, REQUIRE_CORE_METADATA=${REQUIRE_CORE_METADATA}`,
  `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
  `library=${libraryID}, processed_total=${processedTotal}, batches_done=${batchesDone}`,
  `checked=${checked}, tagged_items=${taggedItems}, updated=${updated}, untagged=${untagged}, skipped_cn=${skippedCN}, skipped_no_meta=${skippedNoMeta}, failed=${failed}`,
  `dim_coverage: topic=${dimHit.topic}, method=${dimHit.method}, material=${dimHit.material}, app=${dimHit.app}`,
  `log_file=${savedLogFilePath || "(disabled/failed)"}`,
].join("\n\n");
