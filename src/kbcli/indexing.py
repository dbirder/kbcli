from __future__ import annotations

import json
import re
import sqlite3
import time
from contextlib import contextmanager

from markdown_it import MarkdownIt

from .errors import KBError, result
from .state import readonly_database, state_file_exists
from .vault import Vault, sha

INDEX_VERSION = 1
ANALYZER_VERSION = "han-bigram-v1"


def tokens(text):
    output = []
    for part in re.findall(r"[\u3400-\u9fff]+|[A-Za-z0-9_]+", text):
        if "\u3400" <= part[0] <= "\u9fff":
            output.extend(part[i : i + 2] for i in range(len(part) - 1)) if len(
                part
            ) > 1 else output.append(part)
        else:
            output.append(part.lower())
    return " ".join(output)


def query_terms(text):
    return " AND ".join('"' + t + '"' for t in dict.fromkeys(tokens(text).split()))


def chunks(doc):
    lines = doc.body.splitlines()
    if not lines:
        return []
    parsed = MarkdownIt().parse(doc.body)
    headings = {}
    boundaries = {0, len(lines)}
    for i, token in enumerate(parsed):
        if token.map and token.level == 0:
            boundaries.update(token.map)
        if token.type == "heading_open" and token.map:
            headings[token.map[0]] = (int(token.tag[1:]), parsed[i + 1].content)
    # Keep source line locations; divide long blocks into bounded pieces.
    points = sorted(boundaries)
    heading = []
    output = []
    for start, end in zip(points, points[1:]):
        if start in headings:
            level, title = headings[start]
            heading = heading[: level - 1] + [title]
        for begin in range(start, end, 40):
            finish = min(begin + 40, end)
            raw = "\n".join(lines[begin:finish])
            if raw.strip():
                output.append(
                    {
                        "heading": heading.copy(),
                        "raw": raw,
                        "line_start": doc.body_offset + begin + 1,
                        "line_end": doc.body_offset + finish,
                    }
                )
    return output


DDL = """
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS documents(
 path TEXT PRIMARY KEY,doc_id TEXT,title TEXT NOT NULL,schema_id TEXT,
 metadata TEXT NOT NULL,file_hash TEXT NOT NULL,mtime INTEGER NOT NULL,size INTEGER NOT NULL,
 metadata_valid INTEGER NOT NULL,parse_error TEXT
);
CREATE INDEX IF NOT EXISTS doc_id_idx ON documents(doc_id);
CREATE INDEX IF NOT EXISTS doc_schema_idx ON documents(schema_id);
CREATE TABLE IF NOT EXISTS chunks(
 id INTEGER PRIMARY KEY,document_path TEXT NOT NULL REFERENCES documents(path) ON DELETE CASCADE,
 heading TEXT NOT NULL,line_start INTEGER NOT NULL,line_end INTEGER NOT NULL,raw TEXT NOT NULL,
 title_terms TEXT NOT NULL,body_terms TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_doc_idx ON chunks(document_path);
CREATE VIRTUAL TABLE IF NOT EXISTS chunk_fts USING fts5(
 title_terms,body_terms,content='chunks',content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
 INSERT INTO chunk_fts(rowid,title_terms,body_terms) VALUES(new.id,new.title_terms,new.body_terms);
END;
CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
 INSERT INTO chunk_fts(chunk_fts,rowid,title_terms,body_terms) VALUES('delete',old.id,old.title_terms,old.body_terms);
END;
"""


class Index:
    def __init__(self, vault: Vault):
        self.vault = vault
        self.path = vault.state / "index.sqlite3"

    @contextmanager
    def connect(self):
        self.vault.ensure_state()
        db = sqlite3.connect(self.path, timeout=15)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("PRAGMA journal_mode=WAL")
        try:
            db.executescript(DDL)
        except sqlite3.Error as exc:
            db.close()
            raise KBError("INDEX_UNAVAILABLE", "SQLite FTS5 不可用", reason=str(exc)) from exc
        try:
            with db:
                yield db
        finally:
            db.close()

    @staticmethod
    def setting(db, key, default=None):
        row = db.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        return row[0] if row else default

    def status(self):
        empty = {
            "index_generation": None,
            "indexed_at": None,
            "documents": None,
            "chunks": None,
            "analyzer_version": ANALYZER_VERSION,
            "index_version": INDEX_VERSION,
        }
        try:
            if not state_file_exists(self.path):
                return {**empty, "observed": True, "initialized": False, "observation": "missing"}
            with readonly_database(self.path) as db:
                return {
                    "index_generation": int(self.setting(db, "generation", "0")),
                    "indexed_at": self.setting(db, "indexed_at"),
                    "documents": db.execute("SELECT count(*) FROM documents").fetchone()[0],
                    "chunks": db.execute("SELECT count(*) FROM chunks").fetchone()[0],
                    "analyzer_version": ANALYZER_VERSION,
                    "index_version": INDEX_VERSION,
                    "observed": True,
                    "initialized": self.setting(db, "indexed_at") is not None,
                    "observation": "read_only",
                }
        except (OSError, sqlite3.Error, ValueError) as exc:
            return {
                **empty,
                "observed": False,
                "initialized": None,
                "observation": "unavailable",
                "error": {"code": "INDEX_STATE_UNREADABLE", "message": str(exc)},
            }

    def pending(self, verify=False):
        if not state_file_exists(self.path):
            return [p.relative_to(self.vault.root).as_posix() for p in self.vault.discover()]
        with readonly_database(self.path) as db:
            known = {row["path"]: row for row in db.execute("SELECT * FROM documents")}
            contract_changed = self.setting(db, "contract_hash") != self.vault.contract_hash()
        pending = []
        for p in self.vault.discover():
            relative = p.relative_to(self.vault.root).as_posix()
            old = known.pop(relative, None)
            stat = p.stat()
            if not old or contract_changed:
                pending.append(relative)
            elif verify or stat.st_mtime_ns != old["mtime"] or stat.st_size != old["size"]:
                if sha(p.read_bytes()) != old["file_hash"]:
                    pending.append(relative)
        return sorted(set(pending + list(known)))

    def refresh(self, verify=False):
        start = time.monotonic()
        with self.vault.writing(), self.connect() as db:
            fingerprint = self.vault.contract_hash()
            rebuild = self.setting(db, "contract_hash") != fingerprint or self.setting(
                db, "version"
            ) != str(INDEX_VERSION)
            known = {row["path"]: row for row in db.execute("SELECT * FROM documents")}
            changed = []
            removed = []
            for p in self.vault.discover():
                rel = p.relative_to(self.vault.root).as_posix()
                old = known.pop(rel, None)
                stat = p.stat()
                if (
                    old
                    and not rebuild
                    and not verify
                    and stat.st_mtime_ns == old["mtime"]
                    and stat.st_size == old["size"]
                ):
                    continue
                doc = self.vault.load(p)
                if old and not rebuild and doc.file_hash == old["file_hash"]:
                    db.execute(
                        "UPDATE documents SET mtime=?,size=? WHERE path=?",
                        (stat.st_mtime_ns, stat.st_size, rel),
                    )
                    continue
                local_issues = self.vault.validate(doc)
                eligible = metadata_eligible(local_issues)
                try:
                    schema = self.vault.resolve_schema(doc)[0]
                except KBError:
                    schema = None
                db.execute("DELETE FROM documents WHERE path=?", (rel,))
                db.execute(
                    "INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (
                        rel,
                        doc.metadata.get("id") if isinstance(doc.metadata.get("id"), str) else None,
                        doc.title,
                        schema,
                        json.dumps(doc.metadata, ensure_ascii=False),
                        doc.file_hash,
                        stat.st_mtime_ns,
                        stat.st_size,
                        eligible,
                        doc.parse_error,
                    ),
                )
                aliases = doc.metadata.get("aliases", [])
                aliases = (
                    " ".join(x for x in aliases if isinstance(x, str))
                    if isinstance(aliases, list)
                    else ""
                )
                for chunk in chunks(doc):
                    db.execute(
                        "INSERT INTO chunks(document_path,heading,line_start,line_end,raw,title_terms,body_terms) VALUES(?,?,?,?,?,?,?)",
                        (
                            rel,
                            json.dumps(chunk["heading"], ensure_ascii=False),
                            chunk["line_start"],
                            chunk["line_end"],
                            chunk["raw"],
                            tokens(doc.title + " " + aliases + " " + " ".join(chunk["heading"])),
                            tokens(chunk["raw"]),
                        ),
                    )
                changed.append(rel)
            for rel in known:
                db.execute("DELETE FROM documents WHERE path=?", (rel,))
                removed.append(rel)
            # Restore locally valid rows after a duplicate was removed or renamed.
            for row in db.execute("SELECT path FROM documents WHERE metadata_valid=0").fetchall():
                doc = self.vault.load(row["path"])
                db.execute(
                    "UPDATE documents SET metadata_valid=? WHERE path=?",
                    (metadata_eligible(self.vault.validate(doc)), row["path"]),
                )
            # Duplicate IDs must not be exposed as unambiguous structured results.
            db.execute(
                "UPDATE documents SET metadata_valid=0 WHERE doc_id IN (SELECT doc_id FROM documents WHERE doc_id IS NOT NULL GROUP BY doc_id HAVING count(*)>1)"
            )
            generation = int(self.setting(db, "generation", "0"))
            if changed or removed or rebuild:
                generation += 1
            for key, value in {
                "generation": str(generation),
                "indexed_at": self.vault.now(),
                "contract_hash": fingerprint,
                "version": str(INDEX_VERSION),
                "analyzer": ANALYZER_VERSION,
            }.items():
                db.execute("INSERT OR REPLACE INTO settings VALUES(?,?)", (key, value))
        return result(
            **self.status(),
            changed=changed,
            removed=removed,
            elapsed_ms=round((time.monotonic() - start) * 1000, 2),
        )

    def ensure_fresh(self, timeout=15):
        if timeout <= 0:
            raise KBError("QUERY_INVALID", "fresh timeout 必须大于零")
        deadline = time.monotonic() + timeout
        for _ in range(3):
            self.refresh(verify=True)
            pending = self.pending(verify=True)
            if not pending and time.monotonic() <= deadline:
                return
            if time.monotonic() >= deadline:
                break
        raise KBError("INDEX_STALE", "本地文件持续变化，不能返回 fresh 结果", pending_files=pending)

    def search(
        self,
        query="",
        *,
        tag=None,
        status=None,
        under=None,
        prop=None,
        limit=10,
        fresh=False,
        literal=False,
        timeout=15,
    ):
        if not 1 <= limit <= 100:
            raise KBError("QUERY_INVALID", "limit 必须在 1 到 100 之间")
        if fresh:
            self.ensure_fresh(timeout)
        elif not self.status()["indexed_at"]:
            self.refresh(verify=True)
        conditions = []
        args = []
        if under:
            under = self.vault.safe(under).relative_to(self.vault.root).as_posix()
            if under != ".":
                conditions.append("(d.path=? OR substr(d.path,1,?)=?)")
                prefix = under.rstrip("/") + "/"
                args += [under, len(prefix), prefix]
        if tag or status or prop:
            conditions.append("d.metadata_valid=1")
        if tag:
            conditions.append("EXISTS(SELECT 1 FROM json_each(d.metadata,'$.tags') WHERE value=?)")
            args.append(tag)
        if status:
            conditions.append("json_extract(d.metadata,'$.status')=?")
            args.append(status)
        if prop:
            if "=" not in prop:
                raise KBError("QUERY_INVALID", "属性条件应为 key=value")
            key, value = prop.split("=", 1)
            if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", key):
                raise KBError("QUERY_INVALID", "属性名无效")
            conditions.append("CAST(json_extract(d.metadata,?) AS TEXT)=?")
            args += ["$." + key, value]
        where = " AND ".join(conditions) if conditions else "1=1"
        matches = query_terms(query)
        use_literal = (
            literal or not matches or bool(re.fullmatch(r"[\u3400-\u9fff]", query.strip()))
        )
        with self.connect() as db:
            if query and not use_literal and matches:
                sql = f"""WITH hits AS MATERIALIZED (
                    SELECT rowid,bm25(chunk_fts,5,1) AS score FROM chunk_fts WHERE chunk_fts MATCH ?
                ), ranked AS (
                  SELECT c.*,d.title,d.metadata,d.file_hash,d.parse_error,d.metadata_valid,h.score,
                  row_number() OVER(PARTITION BY c.document_path ORDER BY h.score,c.line_start) AS position
                  FROM hits h JOIN chunks c ON c.id=h.rowid JOIN documents d ON d.path=c.document_path
                  WHERE {where}
                ) SELECT * FROM ranked WHERE position=1 ORDER BY score,document_path LIMIT ?"""
                rows = db.execute(sql, [matches] + args + [limit]).fetchall()
            else:
                rows = db.execute(
                    f"SELECT c.*,d.title,d.metadata,d.file_hash,d.parse_error,d.metadata_valid,0 AS score FROM chunks c JOIN documents d ON d.path=c.document_path WHERE {where} ORDER BY d.path,c.line_start",
                    args,
                ).fetchall()
        selected = []
        seen = set()
        scanned = {}
        for original in rows:
            row = dict(original)
            if row["document_path"] in seen:
                continue
            if query and use_literal:
                if row["document_path"] not in scanned:
                    try:
                        scanned[row["document_path"]] = self.vault.load(row["document_path"])
                    except KBError:
                        scanned[row["document_path"]] = None
                doc = scanned[row["document_path"]]
                if not doc or (query not in doc.raw and query not in doc.title):
                    continue
                position = doc.raw.find(query)
                if position >= 0:
                    begin = doc.raw[:position].count("\n")
                    end = begin + query.count("\n") + 1
                    row.update(
                        raw="\n".join(doc.raw.splitlines()[begin:end]),
                        line_start=begin + 1,
                        line_end=end,
                        file_hash=doc.file_hash,
                    )
            meta = json.loads(row["metadata"])
            fields = {
                "title": row["title"],
                "heading": " ".join(json.loads(row["heading"])),
                "body": row["raw"],
                "aliases": " ".join(a for a in meta.get("aliases", []) if isinstance(a, str))
                if isinstance(meta.get("aliases", []), list)
                else "",
            }
            terms = set(tokens(query).split())
            matched_fields = [
                name
                for name, text in fields.items()
                if (query and query in text) or terms.intersection(tokens(text).split())
            ]
            if tag or status or prop:
                matched_fields.append("properties")
            try:
                current = self.vault.load(row["document_path"])
                review_effective = self.vault.review_effective(current)
            except KBError:
                review_effective = None
            stale = (
                sha(self.vault.safe(row["document_path"]).read_bytes()) != row["file_hash"]
                if self.vault.safe(row["document_path"]).is_file()
                else True
            )
            selected.append(
                {
                    "path": row["document_path"],
                    "id": meta.get("id"),
                    "title": row["title"],
                    "heading": json.loads(row["heading"]),
                    "line_start": row["line_start"],
                    "line_end": row["line_end"],
                    "file_hash": row["file_hash"],
                    "snippet": row["raw"],
                    "metadata": meta,
                    "metadata_valid": bool(row["metadata_valid"]),
                    "parse_error": row["parse_error"],
                    "score": row["score"],
                    "stale": stale,
                    "matched_fields": matched_fields,
                    "review_effective": review_effective,
                }
            )
            seen.add(row["document_path"])
            if len(selected) >= limit:
                break
        pending = self.pending(verify=fresh)
        if fresh and (pending or any(x["stale"] for x in selected)):
            raise KBError("INDEX_STALE", "查询期间文件发生变化", pending_files=pending)
        return result(
            **self.status(),
            results=selected,
            pending_files=pending,
            fresh=fresh,
            scope="local_files",
            git_synced=None,
            search_mode="literal" if use_literal and query else "keyword" if query else "metadata",
        )

    def grep(self, expression, limit=100):
        if not 1 <= limit <= 1000:
            raise KBError("QUERY_INVALID", "grep limit 必须在 1 到 1000 之间")
        try:
            pattern = re.compile(expression)
        except re.error as exc:
            raise KBError("QUERY_INVALID", "正则表达式无效", reason=str(exc)) from exc
        hits = []
        for doc in self.vault.documents():
            for line, content in enumerate(doc.raw.splitlines(), 1):
                if pattern.search(content):
                    hits.append(
                        {
                            "path": doc.path,
                            "line": line,
                            "content": content,
                            "file_hash": doc.file_hash,
                        }
                    )
                    if len(hits) >= limit:
                        return result(results=hits, truncated=True)
        return result(results=hits, truncated=False)


def metadata_eligible(issues):
    return not any(i["code"] not in {"REVIEW_UNVERIFIED", "REVIEW_STALE"} for i in issues)
