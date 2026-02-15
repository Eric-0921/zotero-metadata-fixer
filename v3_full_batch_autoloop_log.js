// v3_full_batch_autoloop_log.js
// Zotero Run JavaScript (Async)

const WRITE = false;
const ONLY_MISSING_FIELDS = true;
const BATCH_SIZE = 120;
const AUTO_LOOP = true;
const MAX_BATCHES = 20;

const MIN_SCORE = 0.88;
const SLEEP_MS = 250;
const BATCH_GAP_MS = 1000;
const MAX_RETRY = 4;

const SAMPLE_SHOW = 30;
const SAVE_LOG_NOTE = true;

const MAILTO = "piweitseng0921@gmail.com";
const UA = `ZoteroMetadataFixer/1.0 (mailto:${MAILTO})`;

const TAG_OK = "/meta_ok";
const TAG_REVIEW = "/meta_review";
const TAG_NOHIT = "/meta_nohit";
const TAG_FAIL = "/meta_fail";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function normalizeDOI(raw) {
  if (!raw) return "";
  return raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
}
function normText(s) { return (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim(); }
function tokenSet(s) { return new Set(normText(s).split(" ").filter((x) => x.length > 1)); }
function jaccard(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
function firstAuthorLastName(item) {
  const creators = item.getCreators() || [];
  for (const c of creators) {
    if (c.lastName) return c.lastName;
    if (c.name) {
      const parts = c.name.trim().split(/\s+/);
      if (parts.length) return parts[parts.length - 1];
    }
  }
  return "";
}
function extractYear(dateStr) {
  const m = (dateStr || "").match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}
function crYear(m) { const p = m?.issued?.["date-parts"]?.[0]; return p && p[0] ? parseInt(p[0], 10) : null; }
function crTitle(m) { return (m?.title && m.title[0]) || ""; }
function crJournal(m) { return ((m?.["container-title"] && m["container-title"][0]) || "").replace(/&amp;/gi, "&").trim(); }
function crDOI(m) { return normalizeDOI(m?.DOI || ""); }
function clearMetaTags(item) {
  const tags = item.getTags() || [];
  for (const t of tags) {
    const name = t?.tag || "";
    if (name.startsWith("/meta_")) item.removeTag(name);
  }
}
async function requestJSON(url) {
  let delay = 800;
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      const req = await Zotero.HTTP.request("GET", url, {
        headers: { Accept: "application/json", "User-Agent": UA },
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
async function crossrefByDOI(doi) {
  const d = encodeURIComponent(normalizeDOI(doi));
  const url = `https://api.crossref.org/works/${d}?mailto=${encodeURIComponent(MAILTO)}`;
  const json = await requestJSON(url);
  return json?.message || null;
}
async function crossrefByTitleAuthor(title, author, year) {
  const p = new URLSearchParams({
    "query.bibliographic": title || "",
    "query.author": author || "",
    rows: "5",
    select: "DOI,title,container-title,issued,author,type,publisher",
    mailto: MAILTO,
  });
  if (year) p.set("filter", `from-pub-date:${year - 1},until-pub-date:${year + 1}`);
  const url = `https://api.crossref.org/works?${p.toString()}`;
  const json = await requestJSON(url);
  return json?.message?.items || [];
}
function authorScore(lastName, crItem) {
  const q = normText(lastName);
  if (!q) return 0;
  const authors = crItem?.author || [];
  for (const a of authors) if (normText(a.family || "") === q) return 1;
  return 0;
}
function pickBest(queryTitle, queryAuthor, queryYear, candidates) {
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    const ts = jaccard(queryTitle, crTitle(c));
    const as = authorScore(queryAuthor, c);
    const y = crYear(c);
    const ys = queryYear && y ? (Math.abs(queryYear - y) <= 1 ? 1 : 0) : 0.2;
    const score = 0.70 * ts + 0.20 * as + 0.10 * ys;
    if (score > bestScore) { best = c; bestScore = score; }
  }
  return { best, bestScore };
}
function isTargetItem(item, journalTypeID) {
  if (!item.isRegularItem() || item.itemTypeID !== journalTypeID) return false;
  if (!ONLY_MISSING_FIELDS) return true;
  const doi = normalizeDOI(item.getField("DOI") || "");
  const journal = (item.getField("publicationTitle") || "").trim();
  const year = extractYear(item.getField("date") || "");
  return !doi || !journal || !year;
}

const pane = Zotero.getActiveZoteroPane();
const libraryID = pane.getSelectedLibraryID();
const journalTypeID = Zotero.ItemTypes.getID("journalArticle");
const doiCache = new Map();
const sample = [];
const allLogs = [];

let checked = 0, updated = 0, unchanged = 0, nohit = 0, review = 0, failed = 0;
let processedTotal = 0;
let batchesDone = 0;
let lastTotalCandidates = 0;

for (let b = 0; b < (AUTO_LOOP ? MAX_BATCHES : 1); b++) {
  const all = await Zotero.Items.getAll(libraryID, false, false, false);
  const candidates = all.filter((i) => isTargetItem(i, journalTypeID));
  lastTotalCandidates = candidates.length;
  const items = candidates.slice(0, BATCH_SIZE);
  if (!items.length) break;

  batchesDone++;

  for (const item of items) {
    checked++;
    try {
      const title = (item.getField("title") || "").trim();
      if (!title) {
        if (WRITE) { clearMetaTags(item); item.addTag(TAG_REVIEW); await item.saveTx(); }
        review++;
        continue;
      }

      const oldDOI = normalizeDOI(item.getField("DOI") || "");
      const oldJournal = (item.getField("publicationTitle") || "").trim();
      const oldYear = extractYear(item.getField("date") || "");
      const qAuthor = firstAuthorLastName(item);
      const qYear = oldYear || null;

      let meta = null;
      let mode = "search";

      if (oldDOI) {
        mode = "doi";
        if (doiCache.has(oldDOI)) meta = doiCache.get(oldDOI);
        else {
          try { meta = await crossrefByDOI(oldDOI); doiCache.set(oldDOI, meta); }
          catch (_) { meta = null; }
        }
      }

      if (!meta) {
        const cands = await crossrefByTitleAuthor(title, qAuthor, qYear);
        const { best, bestScore } = pickBest(title, qAuthor, qYear, cands);
        if (!best) {
          nohit++;
          if (WRITE) { clearMetaTags(item); item.addTag(TAG_NOHIT); await item.saveTx(); }
          await sleep(SLEEP_MS);
          continue;
        }
        if (bestScore < MIN_SCORE) {
          review++;
          if (WRITE) { clearMetaTags(item); item.addTag(TAG_REVIEW); await item.saveTx(); }
          await sleep(SLEEP_MS);
          continue;
        }
        meta = best;
      }

      const newDOI = crDOI(meta);
      const newJournal = crJournal(meta);
      const newYear = crYear(meta);

      let changed = false;
      if (!oldDOI && newDOI) { item.setField("DOI", newDOI); changed = true; }
      if (!oldJournal && newJournal) { item.setField("publicationTitle", newJournal); changed = true; }
      if (!oldYear && newYear) { item.setField("date", String(newYear)); changed = true; }

      if (WRITE) { clearMetaTags(item); item.addTag(TAG_OK); await item.saveTx(); }

      if (changed) updated++; else unchanged++;

      const line = `${mode} | ${title.slice(0, 68)} -> DOI:${newDOI || "-"} | Journal:${newJournal || "-"}`;
      sample.push(line);
      allLogs.push(line);
      await sleep(SLEEP_MS);
    } catch (e) {
      failed++;
      if (WRITE) {
        try { clearMetaTags(item); item.addTag(TAG_FAIL); await item.saveTx(); } catch (_) {}
      }
    }
  }

  processedTotal += items.length;
  if (AUTO_LOOP) await sleep(BATCH_GAP_MS);
}

if (SAVE_LOG_NOTE) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const fullLog = [
    `time=${stamp}`,
    `WRITE=${WRITE}, ONLY_MISSING_FIELDS=${ONLY_MISSING_FIELDS}`,
    `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
    `library=${libraryID}, last_total_candidates=${lastTotalCandidates}, processed_total=${processedTotal}, batches_done=${batchesDone}`,
    `checked=${checked}, updated=${updated}, unchanged=${unchanged}, nohit=${nohit}, review=${review}, failed=${failed}`,
    "",
    "details:",
    ...allLogs
  ].join("\n");

  const note = new Zotero.Item("note");
  note.libraryID = libraryID;
  note.setField("title", `Metadata Fix Log ${stamp}`);
  note.setNote(`<pre>${Zotero.Utilities.htmlSpecialChars(fullLog)}</pre>`);
  await note.saveTx();
}

return [
  `WRITE=${WRITE}, ONLY_MISSING_FIELDS=${ONLY_MISSING_FIELDS}`,
  `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
  `library=${libraryID}, processed_total=${processedTotal}, batches_done=${batchesDone}`,
  `checked=${checked}, updated=${updated}, unchanged=${unchanged}, nohit=${nohit}, review=${review}, failed=${failed}`,
  `sample:\n${sample.slice(0, SAMPLE_SHOW).join("\n")}`
].join("\n\n");
