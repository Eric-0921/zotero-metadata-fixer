// v1_selected_lookup.js
// Zotero Run JavaScript (Async)

const WRITE = false;
const MIN_SCORE = 0.88;
const SLEEP_MS = 250;

function norm(s) {
  return (s || "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function tokens(s) { return new Set(norm(s).split(" ").filter(x => x.length > 1)); }
function jaccard(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}
function getFirstAuthorLastName(item) {
  const creators = item.getCreators?.() || [];
  for (const c of creators) {
    if (c.lastName) return c.lastName;
    if (c.name) return c.name.split(" ").slice(-1)[0];
  }
  return "";
}
function getYear(item) {
  const d = item.getField("date") || "";
  const m = d.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}
function crossrefYear(crItem) {
  const dp = crItem?.issued?.["date-parts"]?.[0];
  return dp && dp[0] ? parseInt(dp[0], 10) : null;
}
function crossrefTitle(crItem) { return (crItem?.title && crItem.title[0]) || ""; }
function crossrefJournal(crItem) { return ((crItem?.["container-title"] && crItem["container-title"][0]) || "").replace(/&amp;/gi, "&"); }
function authorMatchScore(queryLast, crItem) {
  if (!queryLast) return 0;
  const q = norm(queryLast);
  const authors = crItem?.author || [];
  for (const a of authors) if (norm(a.family || "") === q) return 1;
  return 0;
}
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function queryCrossref(title, firstAuthor, year) {
  const params = new URLSearchParams({
    "query.bibliographic": title,
    "query.author": firstAuthor || "",
    rows: "5",
    select: "DOI,title,container-title,issued,author"
  });
  if (year) params.set("filter", `from-pub-date:${year-1},until-pub-date:${year+1}`);
  params.set("mailto", "piweitseng0921@gmail.com");
  const url = `https://api.crossref.org/works?${params.toString()}`;
  const req = await Zotero.HTTP.request("GET", url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "ZoteroMetadataFixer/1.0 (mailto:piweitseng0921@gmail.com)"
    }
  });
  const json = JSON.parse(req.responseText);
  return json?.message?.items || [];
}

const items = Zotero.getActiveZoteroPane().getSelectedItems();
if (!items.length) return "Select items first (30-100 recommended).";

let checked = 0, matched = 0, written = 0, lowConf = 0, skipped = 0, failed = 0;
const logs = [];

for (const item of items) {
  try {
    if (!item.isRegularItem() || item.itemType !== "journalArticle") { skipped++; continue; }
    const title = item.getField("title") || "";
    if (!title.trim()) { skipped++; continue; }

    const hasDOI = !!(item.getField("DOI") || "").trim();
    const hasJournal = !!(item.getField("publicationTitle") || "").trim();
    if (hasDOI && hasJournal) { skipped++; continue; }

    checked++;
    const firstAuthor = getFirstAuthorLastName(item);
    const y = getYear(item);
    const cands = await queryCrossref(title, firstAuthor, y);
    await sleep(SLEEP_MS);

    if (!cands.length) { lowConf++; if (WRITE) { item.addTag("/meta_review"); await item.saveTx(); } continue; }

    let best = null, bestScore = -1;
    for (const c of cands) {
      const ts = jaccard(title, crossrefTitle(c));
      const as = authorMatchScore(firstAuthor, c);
      const cy = crossrefYear(c);
      const ys = (y && cy) ? (Math.abs(y - cy) <= 1 ? 1 : 0) : 0.2;
      const score = 0.70 * ts + 0.20 * as + 0.10 * ys;
      if (score > bestScore) { bestScore = score; best = c; }
    }

    if (!best || bestScore < MIN_SCORE) {
      lowConf++;
      if (WRITE) { item.addTag("/meta_review"); await item.saveTx(); }
      continue;
    }

    matched++;
    const doi = best.DOI || "";
    const journal = crossrefJournal(best);
    const cy = crossrefYear(best);

    if (WRITE) {
      if (doi && !hasDOI) item.setField("DOI", doi);
      if (journal && !hasJournal) item.setField("publicationTitle", journal);
      if (!(item.getField("date") || "").trim() && cy) item.setField("date", String(cy));
      item.addTag("/meta_ok");
      await item.saveTx();
      written++;
    }

    logs.push(`[${bestScore.toFixed(2)}] ${title.slice(0, 80)} -> DOI:${doi || "-"} | Journal:${journal || "-"}`);
  } catch (e) {
    failed++;
  }
}

return [
  `WRITE=${WRITE}`,
  `checked=${checked}, matched=${matched}, written=${written}, low_conf=${lowConf}, skipped=${skipped}, failed=${failed}`,
  `sample:\n${logs.slice(0, 12).join("\n")}`
].join("\n\n");
