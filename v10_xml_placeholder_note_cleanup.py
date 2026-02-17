#!/usr/bin/env python3
"""
Clean placeholder Zotero child notes like:
  Imported from <something>.xml

Default is dry-run with logs.
Use --apply to delete candidates and write deletion log.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import re
import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional, Tuple


PLACEHOLDER_RE = re.compile(r"^Imported from .+\.xml$")
TAG_RE = re.compile(r"<[^>]+>")


@dataclass
class NoteRow:
    note_item_id: int
    note_key: str
    parent_item_id: Optional[int]
    parent_key: str
    parent_title: str
    note_html: str
    note_text: str
    date_added: str
    date_modified: str


def now_stamp() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def connect_db(db_path: Path, writable: bool) -> sqlite3.Connection:
    if writable:
        con = sqlite3.connect(str(db_path), timeout=30)
        con.execute("PRAGMA foreign_keys=ON")
        return con
    uri = f"file:{db_path.as_posix()}?mode=ro&immutable=1"
    return sqlite3.connect(uri, uri=True, timeout=30)


def strip_html(html: str) -> str:
    text = TAG_RE.sub(" ", html or "")
    text = " ".join(text.split())
    return text.strip()


def fetch_notes(con: sqlite3.Connection) -> List[NoteRow]:
    sql = """
    SELECT
      i.itemID AS noteItemID,
      COALESCE(i.key, '') AS noteKey,
      n.parentItemID,
      COALESCE(ip.key, '') AS parentKey,
      COALESCE(pt.value, '') AS parentTitle,
      COALESCE(n.note, '') AS noteHtml,
      i.dateAdded,
      i.dateModified
    FROM itemNotes n
    JOIN items i ON i.itemID = n.itemID
    LEFT JOIN items ip ON ip.itemID = n.parentItemID
    LEFT JOIN itemData idp ON idp.itemID = ip.itemID AND idp.fieldID = 1
    LEFT JOIN itemDataValues pt ON pt.valueID = idp.valueID
    """
    out: List[NoteRow] = []
    for row in con.execute(sql):
        note_item_id, note_key, parent_item_id, parent_key, parent_title, note_html, date_added, date_modified = row
        out.append(
            NoteRow(
                note_item_id=note_item_id,
                note_key=note_key,
                parent_item_id=parent_item_id,
                parent_key=parent_key,
                parent_title=parent_title,
                note_html=note_html,
                note_text=strip_html(note_html),
                date_added=date_added,
                date_modified=date_modified,
            )
        )
    return out


def analyze(notes: List[NoteRow]) -> Tuple[List[dict], List[dict], dict]:
    candidates: List[dict] = []
    suspicious: List[dict] = []

    total_notes = len(notes)
    for n in notes:
        has_xml_phrase = "Imported from " in n.note_text and ".xml" in n.note_text
        is_placeholder = bool(PLACEHOLDER_RE.fullmatch(n.note_text))

        if is_placeholder and n.parent_item_id is not None:
            candidates.append(
                {
                    "noteItemID": n.note_item_id,
                    "noteKey": n.note_key,
                    "parentItemID": n.parent_item_id,
                    "parentKey": n.parent_key,
                    "parentTitle": n.parent_title,
                    "noteText": n.note_text,
                    "dateAdded": n.date_added,
                    "dateModified": n.date_modified,
                    "reason": "pure_placeholder_imported_xml_child_note",
                }
            )
        elif has_xml_phrase:
            suspicious.append(
                {
                    "type": "HAS_XML_IMPORT_PHRASE_BUT_NOT_STRICT_PLACEHOLDER",
                    "noteItemID": n.note_item_id,
                    "noteKey": n.note_key,
                    "parentItemID": n.parent_item_id if n.parent_item_id is not None else "",
                    "parentKey": n.parent_key,
                    "parentTitle": n.parent_title,
                    "noteTextPreview": n.note_text[:200],
                    "dateAdded": n.date_added,
                }
            )

    metrics = {
        "notes_total": total_notes,
        "candidate_placeholder_notes": len(candidates),
        "suspicious_notes": len(suspicious),
    }
    return candidates, suspicious, metrics


def write_csv(path: Path, rows: List[dict], headers: List[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def delete_notes(db_path: Path, note_ids: List[int]) -> List[dict]:
    con = connect_db(db_path, writable=True)
    logs: List[dict] = []
    try:
        con.execute("BEGIN IMMEDIATE")
        for nid in note_ids:
            row = con.execute("SELECT key FROM items WHERE itemID=?", (nid,)).fetchone()
            if not row:
                logs.append(
                    {"noteItemID": nid, "noteKey": "", "dbDelete": "SKIP_NOT_FOUND", "error": ""}
                )
                continue
            note_key = row[0] or ""
            con.execute("DELETE FROM items WHERE itemID=?", (nid,))
            logs.append({"noteItemID": nid, "noteKey": note_key, "dbDelete": "DELETED", "error": ""})
        con.commit()
    except Exception as e:
        con.rollback()
        raise RuntimeError(f"Delete failed: {e}") from e
    finally:
        con.close()
    return logs


def write_summary(
    path: Path,
    args: argparse.Namespace,
    metrics: dict,
    candidates_csv: Path,
    suspicious_csv: Path,
    deleted_csv: Optional[Path],
) -> None:
    lines = [
        "# XML Placeholder Note Cleanup Report",
        "",
        f"- Time: {dt.datetime.now().isoformat(timespec='seconds')}",
        f"- Mode: {'APPLY' if args.apply else 'DRY_RUN'}",
        f"- Database: `{args.db}`",
        "",
        "## Metrics",
        "",
        f"- Total notes scanned: `{metrics['notes_total']}`",
        f"- Placeholder delete candidates: `{metrics['candidate_placeholder_notes']}`",
        f"- Suspicious notes: `{metrics['suspicious_notes']}`",
        "",
        "## Log Files",
        "",
        f"- Candidates: `{candidates_csv}`",
        f"- Suspicious: `{suspicious_csv}`",
    ]
    if deleted_csv:
        lines.append(f"- Deletion log: `{deleted_csv}`")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Cleanup Zotero XML placeholder child notes with logs.")
    p.add_argument("--db", default=r"E:\Zotero_database\zotero.sqlite", help="Path to zotero.sqlite")
    p.add_argument(
        "--log-dir", default=r"scripts\metadata-fixer\logs", help="Directory for logs"
    )
    p.add_argument("--apply", action="store_true", help="Delete candidate notes")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    db_path = Path(args.db)
    log_dir = Path(args.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    stamp = now_stamp()
    candidates_csv = log_dir / f"xml_note_cleanup_candidates_{stamp}.csv"
    suspicious_csv = log_dir / f"xml_note_cleanup_suspicious_{stamp}.csv"
    deleted_csv = log_dir / f"xml_note_cleanup_deleted_{stamp}.csv"
    summary_md = log_dir / f"xml_note_cleanup_summary_{stamp}.md"

    con = connect_db(db_path, writable=False)
    try:
        notes = fetch_notes(con)
    finally:
        con.close()

    candidates, suspicious, metrics = analyze(notes)
    write_csv(
        candidates_csv,
        candidates,
        [
            "noteItemID",
            "noteKey",
            "parentItemID",
            "parentKey",
            "parentTitle",
            "noteText",
            "dateAdded",
            "dateModified",
            "reason",
        ],
    )
    write_csv(
        suspicious_csv,
        suspicious,
        [
            "type",
            "noteItemID",
            "noteKey",
            "parentItemID",
            "parentKey",
            "parentTitle",
            "noteTextPreview",
            "dateAdded",
        ],
    )

    deleted_path: Optional[Path] = None
    if args.apply:
        del_logs = delete_notes(db_path, [x["noteItemID"] for x in candidates])
        write_csv(deleted_csv, del_logs, ["noteItemID", "noteKey", "dbDelete", "error"])
        deleted_path = deleted_csv

    write_summary(summary_md, args, metrics, candidates_csv, suspicious_csv, deleted_path)

    print(f"summary={summary_md}")
    print(f"candidates={candidates_csv}")
    print(f"suspicious={suspicious_csv}")
    if deleted_path:
        print(f"deleted={deleted_path}")
    print(json.dumps(metrics, ensure_ascii=True))


if __name__ == "__main__":
    main()
