#!/usr/bin/env python3
"""
Detect and clean duplicate PDF attachments in a Zotero library.

Modes:
- dry-run (default): scan and write logs only
- apply: delete exact duplicates and write deletion log

Safety:
- Only deletes attachments when parent item is the same AND file bytes (MD5) are identical.
- Never deletes "suspicious" cases automatically.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
import os
import shutil
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple


@dataclass
class Attachment:
    parent_item_id: int
    parent_key: str
    parent_title: str
    att_item_id: int
    att_key: str
    att_title: str
    db_path: str
    date_added: str
    file_path: Optional[Path]
    filename: Optional[str]
    md5: Optional[str]
    size_bytes: Optional[int]
    hash_error: Optional[str]


def now_stamp() -> str:
    return dt.datetime.now().strftime("%Y-%m-%d_%H-%M-%S")


def connect_db(db_path: Path, writable: bool) -> sqlite3.Connection:
    if writable:
        con = sqlite3.connect(str(db_path), timeout=30)
        con.execute("PRAGMA foreign_keys=ON")
        return con
    uri = f"file:{db_path.as_posix()}?mode=ro&immutable=1"
    return sqlite3.connect(uri, uri=True, timeout=30)


def fetch_pdf_attachments(con: sqlite3.Connection) -> List[Tuple]:
    sql = """
    SELECT
      ia.parentItemID,
      ia.itemID AS attItemID,
      COALESCE(ia.path, '') AS attPath,
      COALESCE(iAtt.key, '') AS attKey,
      iAtt.dateAdded AS attDateAdded,
      COALESCE(iParent.key, '') AS parentKey,
      COALESCE(pt.value, '') AS parentTitle,
      COALESCE(at.value, '') AS attTitle
    FROM itemAttachments ia
    JOIN items iAtt ON iAtt.itemID = ia.itemID
    JOIN items iParent ON iParent.itemID = ia.parentItemID
    LEFT JOIN itemData idp ON idp.itemID = iParent.itemID AND idp.fieldID = 1
    LEFT JOIN itemDataValues pt ON pt.valueID = idp.valueID
    LEFT JOIN itemData ida ON ida.itemID = iAtt.itemID AND ida.fieldID = 1
    LEFT JOIN itemDataValues at ON at.valueID = ida.valueID
    WHERE ia.parentItemID IS NOT NULL
      AND lower(COALESCE(ia.contentType, '')) = 'application/pdf'
    ORDER BY ia.parentItemID, ia.itemID
    """
    return list(con.execute(sql))


def norm_filename(name: str) -> str:
    base = os.path.splitext(name)[0].strip().lower()
    base = " ".join(base.replace("_", " ").replace("-", " ").split())
    return base


def resolve_file_path(storage_dir: Path, att_key: str, db_path: str) -> Optional[Path]:
    folder = storage_dir / att_key
    preferred = None
    if db_path.startswith("storage:"):
        preferred = folder / db_path[len("storage:") :]
        if preferred.exists() and preferred.is_file():
            return preferred
    if os.path.isabs(db_path):
        p = Path(db_path)
        if p.exists() and p.is_file():
            return p
    if not folder.exists() or not folder.is_dir():
        return None
    pdfs = [p for p in folder.iterdir() if p.is_file() and p.suffix.lower() == ".pdf"]
    if pdfs:
        return sorted(pdfs, key=lambda x: x.name)[0]
    files = [p for p in folder.iterdir() if p.is_file()]
    if files:
        return sorted(files, key=lambda x: x.name)[0]
    return None


def hash_file(path: Path) -> Tuple[Optional[str], Optional[int], Optional[str]]:
    try:
        h = hashlib.md5()
        size = 0
        with path.open("rb") as f:
            while True:
                chunk = f.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                h.update(chunk)
        return h.hexdigest(), size, None
    except Exception as e:  # pragma: no cover
        return None, None, str(e)


def build_attachments(rows: Iterable[Tuple], storage_dir: Path) -> List[Attachment]:
    out: List[Attachment] = []
    for (
        parent_item_id,
        att_item_id,
        db_path,
        att_key,
        date_added,
        parent_key,
        parent_title,
        att_title,
    ) in rows:
        fp = resolve_file_path(storage_dir, att_key, db_path)
        filename = fp.name if fp else None
        md5, size, hash_error = (None, None, "file_not_found")
        if fp:
            md5, size, hash_error = hash_file(fp)
        out.append(
            Attachment(
                parent_item_id=parent_item_id,
                parent_key=parent_key,
                parent_title=parent_title,
                att_item_id=att_item_id,
                att_key=att_key,
                att_title=att_title,
                db_path=db_path,
                date_added=date_added,
                file_path=fp,
                filename=filename,
                md5=md5,
                size_bytes=size,
                hash_error=hash_error,
            )
        )
    return out


def analyze(
    atts: List[Attachment],
) -> Tuple[List[dict], List[dict], List[Attachment], Dict[str, int]]:
    by_parent: Dict[int, List[Attachment]] = defaultdict(list)
    for a in atts:
        by_parent[a.parent_item_id].append(a)

    exact_rows: List[dict] = []
    suspicious_rows: List[dict] = []
    delete_candidates: List[Attachment] = []

    for parent_id, group in by_parent.items():
        by_hash: Dict[str, List[Attachment]] = defaultdict(list)
        for a in group:
            if a.md5:
                by_hash[a.md5].append(a)
            elif a.hash_error:
                suspicious_rows.append(
                    {
                        "type": "MISSING_OR_UNHASHABLE_FILE",
                        "parentItemID": parent_id,
                        "parentKey": a.parent_key,
                        "parentTitle": a.parent_title,
                        "details": json.dumps(
                            {
                                "attItemID": a.att_item_id,
                                "attKey": a.att_key,
                                "dbPath": a.db_path,
                                "error": a.hash_error,
                            },
                            ensure_ascii=True,
                        ),
                    }
                )

        # Exact duplicates by file bytes within same parent.
        for h, dup_group in by_hash.items():
            if len(dup_group) < 2:
                continue
            dup_group = sorted(dup_group, key=lambda x: (x.date_added or "", x.att_item_id))
            keep = dup_group[0]
            for idx, a in enumerate(dup_group):
                action = "KEEP" if idx == 0 else "DELETE_CANDIDATE"
                if idx > 0:
                    delete_candidates.append(a)
                exact_rows.append(
                    {
                        "parentItemID": a.parent_item_id,
                        "parentKey": a.parent_key,
                        "parentTitle": a.parent_title,
                        "md5": h,
                        "attachmentItemID": a.att_item_id,
                        "attachmentKey": a.att_key,
                        "attachmentTitle": a.att_title,
                        "attachmentDBPath": a.db_path,
                        "resolvedFilePath": str(a.file_path) if a.file_path else "",
                        "sizeBytes": a.size_bytes if a.size_bytes is not None else "",
                        "dateAdded": a.date_added,
                        "action": action,
                        "reason": f"same parent + identical bytes; keep={keep.att_item_id}",
                    }
                )

        # Suspicious: same normalized filename but different bytes.
        by_name: Dict[str, List[Attachment]] = defaultdict(list)
        for a in group:
            if a.filename:
                by_name[norm_filename(a.filename)].append(a)
        for n, name_group in by_name.items():
            if len(name_group) < 2:
                continue
            distinct = {x.md5 for x in name_group if x.md5}
            if len(distinct) > 1:
                suspicious_rows.append(
                    {
                        "type": "SAME_FILENAME_DIFFERENT_CONTENT",
                        "parentItemID": parent_id,
                        "parentKey": name_group[0].parent_key,
                        "parentTitle": name_group[0].parent_title,
                        "details": json.dumps(
                            [
                                {
                                    "attItemID": x.att_item_id,
                                    "attKey": x.att_key,
                                    "filename": x.filename,
                                    "sizeBytes": x.size_bytes,
                                    "md5": x.md5,
                                }
                                for x in sorted(name_group, key=lambda y: y.att_item_id)
                            ],
                            ensure_ascii=True,
                        ),
                    }
                )

        # Suspicious: multiple PDFs and no exact duplicate hashes (likely SI/supplement).
        if len(group) >= 2:
            hashes = [x.md5 for x in group if x.md5]
            if len(hashes) >= 2 and len(set(hashes)) == len(hashes):
                suspicious_rows.append(
                    {
                        "type": "MULTIPLE_PDFS_DIFFERENT_CONTENT",
                        "parentItemID": parent_id,
                        "parentKey": group[0].parent_key,
                        "parentTitle": group[0].parent_title,
                        "details": json.dumps(
                            [
                                {
                                    "attItemID": x.att_item_id,
                                    "attKey": x.att_key,
                                    "filename": x.filename,
                                    "sizeBytes": x.size_bytes,
                                    "md5": x.md5,
                                }
                                for x in sorted(group, key=lambda y: y.att_item_id)
                            ],
                            ensure_ascii=True,
                        ),
                    }
                )

    delete_candidates = sorted(delete_candidates, key=lambda x: x.att_item_id)
    metrics = {
        "pdf_attachments_total": len(atts),
        "parents_with_pdf": len(by_parent),
        "exact_duplicate_rows": len(exact_rows),
        "exact_delete_candidates": len(delete_candidates),
        "suspicious_rows": len(suspicious_rows),
    }
    return exact_rows, suspicious_rows, delete_candidates, metrics


def write_csv(path: Path, rows: List[dict], headers: List[str]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=headers)
        w.writeheader()
        for r in rows:
            w.writerow(r)


def delete_candidates_from_db(
    db_path: Path, storage_dir: Path, delete_candidates: List[Attachment]
) -> List[dict]:
    results: List[dict] = []
    con = connect_db(db_path, writable=True)
    try:
        con.execute("BEGIN IMMEDIATE")
        for a in delete_candidates:
            row = con.execute("SELECT key FROM items WHERE itemID=?", (a.att_item_id,)).fetchone()
            if not row:
                results.append(
                    {
                        "attachmentItemID": a.att_item_id,
                        "attachmentKey": a.att_key,
                        "parentItemID": a.parent_item_id,
                        "dbDelete": "SKIP_NOT_FOUND",
                        "storageDelete": "SKIP",
                        "error": "",
                    }
                )
                continue
            con.execute("DELETE FROM items WHERE itemID=?", (a.att_item_id,))
            results.append(
                {
                    "attachmentItemID": a.att_item_id,
                    "attachmentKey": a.att_key,
                    "parentItemID": a.parent_item_id,
                    "dbDelete": "DELETED",
                    "storageDelete": "",
                    "error": "",
                }
            )
        con.commit()
    except Exception as e:
        con.rollback()
        raise RuntimeError(f"DB delete failed: {e}") from e
    finally:
        con.close()

    # Remove storage folders after DB commit.
    by_key = {r["attachmentKey"]: r for r in results if r["dbDelete"] == "DELETED"}
    for att_key, r in by_key.items():
        folder = storage_dir / att_key
        try:
            if folder.exists() and folder.is_dir():
                shutil.rmtree(folder)
                r["storageDelete"] = "DELETED"
            else:
                r["storageDelete"] = "SKIP_NOT_FOUND"
        except Exception as e:  # pragma: no cover
            r["storageDelete"] = "ERROR"
            r["error"] = str(e)
    return results


def write_summary(
    summary_path: Path,
    metrics: Dict[str, int],
    exact_csv: Path,
    suspicious_csv: Path,
    deleted_csv: Optional[Path],
    args: argparse.Namespace,
) -> None:
    lines = [
        "# PDF Attachment Dedup Report",
        "",
        f"- Time: {dt.datetime.now().isoformat(timespec='seconds')}",
        f"- Mode: {'APPLY' if args.apply else 'DRY_RUN'}",
        f"- Database: `{args.db}`",
        f"- Storage: `{args.storage}`",
        "",
        "## Metrics",
        "",
        f"- PDF attachments scanned: `{metrics['pdf_attachments_total']}`",
        f"- Parent items with PDFs: `{metrics['parents_with_pdf']}`",
        f"- Exact duplicate rows: `{metrics['exact_duplicate_rows']}`",
        f"- Exact duplicate delete candidates: `{metrics['exact_delete_candidates']}`",
        f"- Suspicious rows: `{metrics['suspicious_rows']}`",
        "",
        "## Log Files",
        "",
        f"- Exact duplicates: `{exact_csv}`",
        f"- Suspicious cases: `{suspicious_csv}`",
    ]
    if deleted_csv:
        lines.append(f"- Deletion log: `{deleted_csv}`")
    summary_path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Detect/delete duplicate Zotero PDF attachments with logs."
    )
    parser.add_argument(
        "--db",
        default=r"E:\Zotero_database\zotero.sqlite",
        help="Path to zotero.sqlite",
    )
    parser.add_argument(
        "--storage",
        default=r"E:\Zotero_database\storage",
        help="Path to Zotero storage directory",
    )
    parser.add_argument(
        "--log-dir",
        default=r"scripts\metadata-fixer\logs",
        help="Directory for output logs",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Delete exact duplicate attachment items and write deletion log",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    db_path = Path(args.db)
    storage_dir = Path(args.storage)
    log_dir = Path(args.log_dir)
    log_dir.mkdir(parents=True, exist_ok=True)

    stamp = now_stamp()
    exact_csv = log_dir / f"pdf_dedupe_exact_{stamp}.csv"
    suspicious_csv = log_dir / f"pdf_dedupe_suspicious_{stamp}.csv"
    deleted_csv = log_dir / f"pdf_dedupe_deleted_{stamp}.csv"
    summary_md = log_dir / f"pdf_dedupe_summary_{stamp}.md"

    con = connect_db(db_path, writable=False)
    try:
        rows = fetch_pdf_attachments(con)
    finally:
        con.close()

    atts = build_attachments(rows, storage_dir)
    exact_rows, suspicious_rows, delete_candidates, metrics = analyze(atts)

    write_csv(
        exact_csv,
        exact_rows,
        [
            "parentItemID",
            "parentKey",
            "parentTitle",
            "md5",
            "attachmentItemID",
            "attachmentKey",
            "attachmentTitle",
            "attachmentDBPath",
            "resolvedFilePath",
            "sizeBytes",
            "dateAdded",
            "action",
            "reason",
        ],
    )
    write_csv(
        suspicious_csv,
        suspicious_rows,
        ["type", "parentItemID", "parentKey", "parentTitle", "details"],
    )

    deleted_log_path: Optional[Path] = None
    if args.apply and delete_candidates:
        del_rows = delete_candidates_from_db(db_path, storage_dir, delete_candidates)
        write_csv(
            deleted_csv,
            del_rows,
            [
                "attachmentItemID",
                "attachmentKey",
                "parentItemID",
                "dbDelete",
                "storageDelete",
                "error",
            ],
        )
        deleted_log_path = deleted_csv
    elif args.apply:
        write_csv(
            deleted_csv,
            [],
            [
                "attachmentItemID",
                "attachmentKey",
                "parentItemID",
                "dbDelete",
                "storageDelete",
                "error",
            ],
        )
        deleted_log_path = deleted_csv

    write_summary(summary_md, metrics, exact_csv, suspicious_csv, deleted_log_path, args)

    print(f"summary={summary_md}")
    print(f"exact={exact_csv}")
    print(f"suspicious={suspicious_csv}")
    if deleted_log_path:
        print(f"deleted={deleted_log_path}")
    print(json.dumps(metrics, ensure_ascii=True))


if __name__ == "__main__":
    main()
