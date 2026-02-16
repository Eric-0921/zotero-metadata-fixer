// v3.3_full_batch_pipeline_cn_split.js
// Zotero Run JavaScript (Async)
// Pipeline: Crossref -> OpenAlex -> Semantic Scholar
// English-focused mode: skip CN records, plus repository-source filtering

const WRITE = false;
const ONLY_MISSING_FIELDS = true;
const BATCH_SIZE = 120;
const AUTO_LOOP = true;
const MAX_BATCHES = 20;

const MIN_SCORE_CROSSREF = 0.78;
const MIN_SCORE_FALLBACK = 0.68;
const SLEEP_MS = 250;
const BATCH_GAP_MS = 1000;
const MAX_RETRY = 4;

const ENABLE_OPENALEX = true;
const ENABLE_SEMANTIC = true;

const SAMPLE_SHOW = 30;
const SAVE_LOG_NOTE = false;
const SAVE_LOG_FILE = true;
const DEDUPE_WITHIN_RUN = true;
const LOG_DIR = "C:\\Users\\Eric Tseng\\AppData\\Roaming\\Zotero\\Zotero\\scripts\\metadata-fixer\\logs";
const LOG_PREFIX = "metadata_fix";

const MAILTO = "piweitseng0921@gmail.com";
const UA = `ZoteroMetadataFixer/1.0 (mailto:${MAILTO})`;

const TAG_OK = "/meta_ok";
const TAG_REVIEW = "/meta_review";
const TAG_CN_QUEUE = "/meta_cn_queue";
const TAG_NOHIT = "/meta_nohit";
const TAG_FAIL = "/meta_fail";

const REPO_LIKE_SOURCE_RE = /(arxiv|dspace|scholarworks|repository|thesis|dissertation|phd)/i;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function normalizeDOI(raw) {
  if (!raw) return "";
  return raw.trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, "").replace(/^doi:\s*/i, "").trim();
}
function normText(s) { return (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim(); }
function tokenSet(s) { return new Set(normText(s).split(" ").filter((x) => x.length > 1)); }
function containsCJK(s) { return /[\u3400-\u9FFF]/.test(s || ""); }
function isRepoLikeSource(journal) { return REPO_LIKE_SOURCE_RE.test(journal || ""); }
function jaccard(a, b) {
  const A = tokenSet(a), B = tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}
function extractYear(dateStr) {
  const m = (dateStr || "").match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}
function getFirstAuthorLastName(item) {
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
function toLastNames(authorNames) {
  return (authorNames || []).map((n) => (n || "").trim().split(/\s+/).pop() || "").filter(Boolean);
}
function candidateScore(queryTitle, queryAuthorLast, queryYear, cand) {
  const ts = jaccard(queryTitle, cand.title || "");
  let as = 0;
  if (queryAuthorLast) {
    const q = normText(queryAuthorLast);
    const authors = (cand.authors || []).map((x) => normText(x));
    if (authors.includes(q)) as = 1;
  }
  const ys = (queryYear && cand.year) ? (Math.abs(queryYear - cand.year) <= 1 ? 1 : 0) : 0.2;
  return 0.70 * ts + 0.20 * as + 0.10 * ys;
}
function pickBest(queryTitle, queryAuthorLast, queryYear, candidates) {
  let best = null;
  let bestScore = -1;
  for (const c of candidates) {
    const s = candidateScore(queryTitle, queryAuthorLast, queryYear, c);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  return { best, bestScore };
}
function clearMetaTags(item) {
  const tags = item.getTags() || [];
  for (const t of tags) {
    const name = t?.tag || "";
    if (name.startsWith("/meta_")) item.removeTag(name);
  }
}
function isTargetItem(item, journalTypeID) {
  if (!item.isRegularItem() || item.itemTypeID !== journalTypeID) return false;
  // Skip items already routed to CN queue in previous runs
  const tags = item.getTags() || [];
  if (tags.some((t) => (t?.tag || "") === TAG_CN_QUEUE)) return false;
  if (!ONLY_MISSING_FIELDS) return true;
  const doi = normalizeDOI(item.getField("DOI") || "");
  const journal = (item.getField("publicationTitle") || "").trim();
  const year = extractYear(item.getField("date") || "");
  return !doi || !journal || !year;
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

function normalizeCrossrefItem(m) {
  return {
    source: "crossref",
    title: (m?.title && m.title[0]) || "",
    doi: normalizeDOI(m?.DOI || ""),
    journal: ((m?.["container-title"] && m["container-title"][0]) || "").replace(/&amp;/gi, "&").trim(),
    year: (m?.issued?.["date-parts"]?.[0]?.[0]) || null,
    authors: toLastNames((m?.author || []).map((a) => a.family || a.name || "")),
  };
}
function normalizeOpenAlexItem(m) {
  return {
    source: "openalex",
    title: m?.display_name || "",
    doi: normalizeDOI(m?.doi || ""),
    journal: (m?.primary_location?.source?.display_name || "").trim(),
    year: m?.publication_year || null,
    authors: toLastNames((m?.authorships || []).map((a) => a?.author?.display_name || "")),
  };
}
function normalizeSemanticItem(m) {
  return {
    source: "semantic",
    title: m?.title || "",
    doi: normalizeDOI(m?.externalIds?.DOI || ""),
    journal: (m?.journal?.name || "").trim(),
    year: m?.year || null,
    authors: toLastNames((m?.authors || []).map((a) => a?.name || "")),
  };
}

async function crossrefByDOI(doi) {
  const d = encodeURIComponent(normalizeDOI(doi));
  const url = `https://api.crossref.org/works/${d}?mailto=${encodeURIComponent(MAILTO)}`;
  const json = await requestJSON(url);
  return normalizeCrossrefItem(json?.message || null);
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
  return (json?.message?.items || []).map(normalizeCrossrefItem);
}

async function openAlexByDOI(doi) {
  const d = encodeURIComponent(`https://doi.org/${normalizeDOI(doi)}`);
  const url = `https://api.openalex.org/works/${d}?mailto=${encodeURIComponent(MAILTO)}`;
  const json = await requestJSON(url);
  return normalizeOpenAlexItem(json || null);
}
async function openAlexByTitle(title) {
  const p = new URLSearchParams({ search: title || "", "per-page": "5", mailto: MAILTO });
  const url = `https://api.openalex.org/works?${p.toString()}`;
  const json = await requestJSON(url);
  return (json?.results || []).map(normalizeOpenAlexItem);
}

async function semanticByDOI(doi) {
  const d = encodeURIComponent(`DOI:${normalizeDOI(doi)}`);
  const fields = "title,year,journal,externalIds,authors";
  const url = `https://api.semanticscholar.org/graph/v1/paper/${d}?fields=${encodeURIComponent(fields)}`;
  const json = await requestJSON(url);
  return normalizeSemanticItem(json || null);
}
async function semanticByTitle(title) {
  const fields = "title,year,journal,externalIds,authors";
  const p = new URLSearchParams({ query: title || "", limit: "5", fields });
  const url = `https://api.semanticscholar.org/graph/v1/paper/search?${p.toString()}`;
  const json = await requestJSON(url);
  return (json?.data || []).map(normalizeSemanticItem);
}

async function resolveMetadata(query) {
  const { title, authorLast, year, oldDOI } = query;

  try {
    if (oldDOI) {
      const c = await crossrefByDOI(oldDOI);
      if (c && c.doi) {
        if (!c.journal) return { status: "review", reason: "no_journal", candidate: c };
        return { status: "ok", provider: "crossref", candidate: c, score: 1 };
      }
    } else {
      const cs = await crossrefByTitleAuthor(title, authorLast, year);
      const { best, bestScore } = pickBest(title, authorLast, year, cs);
      if (best && bestScore >= MIN_SCORE_CROSSREF) {
        if (!best.journal) return { status: "review", reason: "no_journal", candidate: best, score: bestScore };
        if (isRepoLikeSource(best.journal)) return { status: "review", reason: "repo_source", candidate: best, score: bestScore };
        return { status: "ok", provider: "crossref", candidate: best, score: bestScore };
      }
    }
  } catch (_) {}

  if (ENABLE_OPENALEX) {
    try {
      if (oldDOI) {
        const o = await openAlexByDOI(oldDOI);
        if (o && (o.doi || o.title)) {
          if (!o.journal) return { status: "review", reason: "no_journal", candidate: o };
          if (!o.doi) return { status: "review", reason: "fallback_no_doi", candidate: o };
          if (isRepoLikeSource(o.journal)) return { status: "review", reason: "repo_source", candidate: o };
          return { status: "ok", provider: "openalex", candidate: o, score: 1 };
        }
      } else {
        const os = await openAlexByTitle(title);
        const { best, bestScore } = pickBest(title, authorLast, year, os);
        if (best && bestScore >= MIN_SCORE_FALLBACK) {
          if (!best.journal) return { status: "review", reason: "no_journal", candidate: best, score: bestScore };
          if (!best.doi) return { status: "review", reason: "fallback_no_doi", candidate: best, score: bestScore };
          if (isRepoLikeSource(best.journal)) return { status: "review", reason: "repo_source", candidate: best, score: bestScore };
          return { status: "ok", provider: "openalex", candidate: best, score: bestScore };
        }
      }
    } catch (_) {}
  }

  if (ENABLE_SEMANTIC) {
    try {
      if (oldDOI) {
        const s = await semanticByDOI(oldDOI);
        if (s && (s.doi || s.title)) {
          if (!s.journal) return { status: "review", reason: "no_journal", candidate: s };
          if (!s.doi) return { status: "review", reason: "fallback_no_doi", candidate: s };
          if (isRepoLikeSource(s.journal)) return { status: "review", reason: "repo_source", candidate: s };
          return { status: "ok", provider: "semantic", candidate: s, score: 1 };
        }
      } else {
        const ss = await semanticByTitle(title);
        const { best, bestScore } = pickBest(title, authorLast, year, ss);
        if (best && bestScore >= MIN_SCORE_FALLBACK) {
          if (!best.journal) return { status: "review", reason: "no_journal", candidate: best, score: bestScore };
          if (!best.doi) return { status: "review", reason: "fallback_no_doi", candidate: best, score: bestScore };
          if (isRepoLikeSource(best.journal)) return { status: "review", reason: "repo_source", candidate: best, score: bestScore };
          return { status: "ok", provider: "semantic", candidate: best, score: bestScore };
        }
      }
    } catch (_) {}
  }

  return { status: "review", reason: "low_score_or_no_hit" };
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
const processedItemIDs = new Set();

const sample = [];
const allLogs = [];

let checked = 0, updated = 0, unchanged = 0, nohit = 0, review = 0, failed = 0;
let skippedCN = 0, cnTagged = 0, reviewNoTitle = 0, reviewLowScore = 0, reviewNoJournal = 0, reviewRepoSource = 0, reviewFallbackNoDOI = 0;
let acceptedCrossref = 0, acceptedOpenAlex = 0, acceptedSemantic = 0;
let processedTotal = 0;
let batchesDone = 0;
let lastTotalCandidates = 0;
let savedLogFilePath = "";

for (let b = 0; b < (AUTO_LOOP ? MAX_BATCHES : 1); b++) {
  const all = await Zotero.Items.getAll(libraryID, false, false, false);
  const candidates = all.filter((i) => isTargetItem(i, journalTypeID));
  lastTotalCandidates = candidates.length;
  const items = candidates.slice(0, BATCH_SIZE);
  if (!items.length) break;
  let batchProcessed = 0;

  batchesDone++;

  for (const item of items) {
    if (DEDUPE_WITHIN_RUN && processedItemIDs.has(item.id)) continue;
    processedItemIDs.add(item.id);
    batchProcessed++;

    try {
      const title = (item.getField("title") || "").trim();
      const existingJournal = (item.getField("publicationTitle") || "").trim();
      if (!title) {
        checked++;
        review++;
        reviewNoTitle++;
        if (WRITE) { clearMetaTags(item); item.addTag(TAG_REVIEW); await item.saveTx(); }
        allLogs.push(`review(no_title) | itemID:${item.id}`);
        continue;
      }

      // Skip CN records from English pipeline
      if (containsCJK(title) || containsCJK(existingJournal)) {
        skippedCN++;
        if (WRITE) {
          clearMetaTags(item);
          item.addTag(TAG_CN_QUEUE);
          await item.saveTx();
          cnTagged++;
        }
        allLogs.push(`skip(cn) | ${title.slice(0, 68)}`);
        continue;
      }

      checked++;

      const oldDOI = normalizeDOI(item.getField("DOI") || "");
      const oldJournal = existingJournal;
      const oldYear = extractYear(item.getField("date") || "");
      const authorLast = getFirstAuthorLastName(item);

      const res = await resolveMetadata({ title, authorLast, year: oldYear, oldDOI });

      if (res.status !== "ok") {
        const reasonText = res.reason || "low_score_or_no_hit";
        review++;
        if (reasonText === "no_journal") reviewNoJournal++;
        else if (reasonText === "repo_source") reviewRepoSource++;
        else if (reasonText === "fallback_no_doi") reviewFallbackNoDOI++;
        else reviewLowScore++;

        if (WRITE) {
          clearMetaTags(item);
          item.addTag(TAG_REVIEW);
          await item.saveTx();
        }
        allLogs.push(`review(${reasonText}) | ${title.slice(0, 68)} | doi:${res.candidate?.doi || "-"} | journal:${res.candidate?.journal || "-"}`);
        await sleep(SLEEP_MS);
        continue;
      }

      const c = res.candidate;
      const newDOI = normalizeDOI(c.doi || "");
      const newJournal = (c.journal || "").trim();
      const newYear = c.year || null;

      let changed = false;
      if (!oldDOI && newDOI) { item.setField("DOI", newDOI); changed = true; }
      if (!oldJournal && newJournal) { item.setField("publicationTitle", newJournal); changed = true; }
      if (!oldYear && newYear) { item.setField("date", String(newYear)); changed = true; }

      if (WRITE) { clearMetaTags(item); item.addTag(TAG_OK); await item.saveTx(); }

      if (res.provider === "crossref") acceptedCrossref++;
      if (res.provider === "openalex") acceptedOpenAlex++;
      if (res.provider === "semantic") acceptedSemantic++;

      if (changed) updated++; else unchanged++;

      const line = `${res.provider} | ${title.slice(0, 68)} -> DOI:${newDOI || "-"} | Journal:${newJournal || "-"}`;
      sample.push(line);
      allLogs.push(line);
      await sleep(SLEEP_MS);
    } catch (e) {
      failed++;
      if (WRITE) {
        try { clearMetaTags(item); item.addTag(TAG_FAIL); await item.saveTx(); } catch (_) {}
      }
      allLogs.push(`fail | itemID:${item.id} | ${String(e?.message || e)}`);
    }
  }

  processedTotal += batchProcessed;
  if (!batchProcessed) break;
  if (AUTO_LOOP) await sleep(BATCH_GAP_MS);
}

const reviewRate = checked ? ((review / checked) * 100).toFixed(2) : "0.00";
const fullLog = [
  `time=${new Date().toISOString().replace("T", " ").slice(0, 19)}`,
  `WRITE=${WRITE}, ONLY_MISSING_FIELDS=${ONLY_MISSING_FIELDS}`,
  `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
  `DEDUPE_WITHIN_RUN=${DEDUPE_WITHIN_RUN}`,
  `pipeline=Crossref -> OpenAlex(${ENABLE_OPENALEX}) -> SemanticScholar(${ENABLE_SEMANTIC})`,
  `thresholds: crossref=${MIN_SCORE_CROSSREF}, fallback=${MIN_SCORE_FALLBACK}`,
  `library=${libraryID}, last_total_candidates=${lastTotalCandidates}, processed_total=${processedTotal}, batches_done=${batchesDone}`,
  `checked=${checked}, unique_checked=${processedItemIDs.size}, skipped_cn=${skippedCN}, cn_tagged=${cnTagged}, updated=${updated}, unchanged=${unchanged}, nohit=${nohit}, review=${review}, failed=${failed}, review_rate=${reviewRate}%`,
  `provider_accept: crossref=${acceptedCrossref}, openalex=${acceptedOpenAlex}, semantic=${acceptedSemantic}`,
  `review_reasons: no_title=${reviewNoTitle}, low_score=${reviewLowScore}, no_journal=${reviewNoJournal}, repo_source=${reviewRepoSource}, fallback_no_doi=${reviewFallbackNoDOI}`,
  "",
  "details:",
  ...allLogs,
].join("\n");

if (SAVE_LOG_FILE) {
  try { savedLogFilePath = await saveLogFile(fullLog); }
  catch (e) { allLogs.push(`log_file_error | ${String(e?.message || e)}`); }
}

if (SAVE_LOG_NOTE) {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  const note = new Zotero.Item("note");
  note.libraryID = libraryID;
  note.setNote(
    `<h1>Metadata Fix Log ${Zotero.Utilities.htmlSpecialChars(stamp)}</h1>` +
    `<pre>${Zotero.Utilities.htmlSpecialChars(fullLog)}</pre>`
  );
  await note.saveTx();
}

return [
  `WRITE=${WRITE}, ONLY_MISSING_FIELDS=${ONLY_MISSING_FIELDS}`,
  `AUTO_LOOP=${AUTO_LOOP}, BATCH_SIZE=${BATCH_SIZE}, MAX_BATCHES=${MAX_BATCHES}`,
  `DEDUPE_WITHIN_RUN=${DEDUPE_WITHIN_RUN}`,
  `pipeline=Crossref -> OpenAlex(${ENABLE_OPENALEX}) -> SemanticScholar(${ENABLE_SEMANTIC})`,
  `thresholds: crossref=${MIN_SCORE_CROSSREF}, fallback=${MIN_SCORE_FALLBACK}`,
  `library=${libraryID}, processed_total=${processedTotal}, batches_done=${batchesDone}`,
  `checked=${checked}, unique_checked=${processedItemIDs.size}, skipped_cn=${skippedCN}, cn_tagged=${cnTagged}, updated=${updated}, unchanged=${unchanged}, nohit=${nohit}, review=${review}, failed=${failed}, review_rate=${reviewRate}%`,
  `provider_accept: crossref=${acceptedCrossref}, openalex=${acceptedOpenAlex}, semantic=${acceptedSemantic}`,
  `review_reasons: no_title=${reviewNoTitle}, low_score=${reviewLowScore}, no_journal=${reviewNoJournal}, repo_source=${reviewRepoSource}, fallback_no_doi=${reviewFallbackNoDOI}`,
  `log_file=${savedLogFilePath || "(save failed or disabled)"}`,
  `sample:\n${sample.slice(0, SAMPLE_SHOW).join("\n")}`,
].join("\n\n");
