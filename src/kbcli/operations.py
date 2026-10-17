from __future__ import annotations

import copy
import difflib
import json
import os
import re
import sqlite3
import tempfile
import uuid
from contextlib import contextmanager, suppress
from datetime import date

from .errors import KBError, result
from .indexing import Index
from .state import readonly_database, state_file_exists
from .vault import Vault, parse_document, render_document, sha

PROTECTED = {
    "id",
    "schema",
    "created_by",
    "created_at",
    "review_status",
    "reviewed_by",
    "reviewed_at",
    "reviewed_content_hash",
}


class Operations:
    @classmethod
    def observe(cls, vault):
        path = vault.state / "operations.sqlite3"
        try:
            if not state_file_exists(path):
                return {
                    "observed": True,
                    "initialized": False,
                    "observation": "missing",
                    "pending_writes": [],
                    "recovery_pending": [],
                }
            with readonly_database(path) as db:
                rows = [
                    dict(row)
                    for row in db.execute(
                        "SELECT id,path,before_hash,after_hash,state FROM operations WHERE state='saved' AND commit_id IS NULL ORDER BY rowid"
                    )
                ]
                pending = {}
                baseline = {}
                for row in rows:
                    baseline.setdefault(row["path"], row["before_hash"])
                    row["baseline_hash"] = baseline[row["path"]]
                    pending[row["path"]] = row
                recovery = [
                    dict(row)
                    for row in db.execute(
                        "SELECT id,path,state,before_hash,after_hash FROM operations WHERE state IN ('prepared','recovery_needed')"
                    )
                ]
            return {
                "observed": True,
                "initialized": True,
                "observation": "read_only",
                "pending_writes": list(pending.values()),
                "recovery_pending": recovery,
            }
        except (OSError, sqlite3.Error) as exc:
            return {
                "observed": False,
                "initialized": None,
                "observation": "unavailable",
                "pending_writes": None,
                "recovery_pending": None,
                "error": {"code": "JOURNAL_STATE_UNREADABLE", "message": str(exc)},
            }

    def __init__(self, vault: Vault, *, readonly=False):
        self.vault = vault
        self.journal_path = vault.state / "operations.sqlite3"
        if readonly:
            return
        with self.vault.writing(), self.database() as db:
            db.execute("""CREATE TABLE IF NOT EXISTS operations(
              id TEXT PRIMARY KEY,path TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,
              at TEXT NOT NULL,before_hash TEXT,after_hash TEXT NOT NULL,before_raw TEXT,after_raw TEXT,
              state TEXT NOT NULL,commit_id TEXT
            )""")
            db.row_factory = sqlite3.Row
            for entry in db.execute(
                "SELECT * FROM operations WHERE state IN ('prepared','recovery_needed')"
            ).fetchall():
                try:
                    target = self.vault.safe(entry["path"], business=True)
                    current = sha(target.read_bytes()) if target.is_file() else None
                    state = (
                        "saved"
                        if current == entry["after_hash"]
                        else "failed"
                        if current == entry["before_hash"]
                        else "recovery_needed"
                    )
                except (KBError, OSError):
                    state = "recovery_needed"
                db.execute("UPDATE operations SET state=? WHERE id=?", (state, entry["id"]))

    @contextmanager
    def database(self):
        db = sqlite3.connect(self.journal_path, timeout=15)
        try:
            with db:
                yield db
        finally:
            db.close()

    def recovery_pending(self):
        with self.database() as db:
            db.row_factory = sqlite3.Row
            return [
                dict(r)
                for r in db.execute(
                    "SELECT id,path,state,before_hash,after_hash FROM operations WHERE state IN ('prepared','recovery_needed')"
                )
            ]

    def pending_writes(self):
        with self.database() as db:
            db.row_factory = sqlite3.Row
            rows = [
                dict(row)
                for row in db.execute(
                    "SELECT id,path,before_hash,after_hash,state FROM operations WHERE state='saved' AND commit_id IS NULL ORDER BY rowid"
                )
            ]
        latest = {}
        baseline = {}
        for row in rows:
            baseline.setdefault(row["path"], row["before_hash"])
            latest[row["path"]] = row
            row["baseline_hash"] = baseline[row["path"]]
        return list(latest.values())

    def journal(self, op_id, state):
        with self.database() as db:
            db.execute("UPDATE operations SET state=? WHERE id=?", (state, op_id))

    def mark_committed(self, paths, commit_id):
        with self.database() as db:
            for path in paths:
                db.execute(
                    "UPDATE operations SET commit_id=? WHERE path=? AND state='saved' AND commit_id IS NULL",
                    (commit_id, path),
                )

    def validate_write(self, candidate, *, completion=False):
        issues = self.vault.validate(candidate)
        errors = [
            i
            for i in issues
            if i["severity"] == "error" and not (completion and i["code"] == "REVIEW_STALE")
        ]
        if errors:
            raise KBError("SCHEMA_INVALID", "写入内容未通过规范检查", issues=errors)
        docs = [d for d in self.vault.documents() if d.path != candidate.path]
        identifier = candidate.metadata.get("id")
        if any(identifier == d.metadata.get("id") for d in docs):
            errors.append({"code": "DUPLICATE_ID", "message": "已有记录使用相同 ID"})
        by_id = {}
        for doc in docs:
            if isinstance(doc.metadata.get("id"), str):
                by_id.setdefault(doc.metadata["id"], []).append(doc)
        for field, kind in [("projects", "project-"), ("sources", "source-")]:
            for target in candidate.metadata.get(field, []):
                matches = by_id.get(target, [])
                if target == identifier or len(matches) != 1:
                    errors.append({"code": "REFERENCE_INVALID", "field": field, "target": target})
                else:
                    try:
                        if not self.vault.resolve_schema(matches[0])[0].startswith(kind):
                            errors.append(
                                {"code": "REFERENCE_TYPE_INVALID", "field": field, "target": target}
                            )
                    except KBError:
                        errors.append(
                            {"code": "REFERENCE_TYPE_INVALID", "field": field, "target": target}
                        )
        if errors:
            raise KBError("SCHEMA_INVALID", "写入内容未通过规范检查", issues=errors)
        return issues

    def write(
        self,
        path,
        raw,
        *,
        actor,
        kind,
        expected=None,
        create=False,
        dry_run=False,
        completion=False,
    ):
        if actor not in {"human", "ai"}:
            raise KBError("ACTOR_INVALID", "actor 必须是 human 或 ai")
        with self.vault.writing():
            target = self.vault.safe(path, business=True)
            before = self.vault.load(path) if target.exists() else None
            if create and before:
                raise KBError("FILE_EXISTS", "不覆盖已有文件", path=path)
            if not create and not before:
                raise KBError("FILE_NOT_FOUND", "找不到目标文件", path=path)
            if before and before.file_hash != expected:
                raise KBError(
                    "FILE_CHANGED",
                    "文件已变化，请重新读取",
                    expected=expected,
                    actual=before.file_hash,
                )
            candidate = parse_document(path, raw)
            warnings = self.validate_write(candidate, completion=completion)
            difference = "".join(
                difflib.unified_diff(
                    (before.raw if before else "").splitlines(True),
                    raw.splitlines(True),
                    fromfile=path,
                    tofile=path,
                )
            )
            if dry_run:
                return result(
                    path=path,
                    dry_run=True,
                    diff=difference,
                    expected_hash=before.file_hash if before else None,
                    candidate_hash=candidate.file_hash,
                )
            op_id = str(uuid.uuid4())
            with self.database() as db:
                db.execute(
                    "INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?,?,NULL)",
                    (
                        op_id,
                        path,
                        actor,
                        kind,
                        self.vault.now(),
                        before.file_hash if before else None,
                        candidate.file_hash,
                        before.raw if before else None,
                        raw,
                        "prepared",
                    ),
                )
            target.parent.mkdir(parents=True, exist_ok=True)
            fd, temporary = tempfile.mkstemp(prefix=".kbcli-", dir=target.parent)
            installed = False
            try:
                with os.fdopen(fd, "w", encoding="utf-8", newline="") as stream:
                    stream.write(raw)
                    stream.flush()
                    os.fsync(stream.fileno())
                # Recheck after validation and journal creation, immediately before replacement.
                if before and self.vault.load(path).file_hash != before.file_hash:
                    raise KBError("FILE_CHANGED", "校验期间文件变化，未替换")
                if create and target.exists():
                    raise KBError("FILE_EXISTS", "创建期间出现同名文件")
                os.chmod(temporary, (target.stat().st_mode & 0o777) if target.exists() else 0o644)
                if create:
                    os.link(temporary, target)
                    os.unlink(temporary)
                else:
                    os.replace(temporary, target)
                installed = True
                self.journal(op_id, "saved")
            except Exception as exc:
                if os.path.exists(temporary):
                    os.unlink(temporary)
                if installed:
                    raise KBError(
                        "JOURNAL_PENDING",
                        "文件已保存，但操作记录需要恢复",
                        saved=True,
                        path=path,
                        file_hash=candidate.file_hash,
                        operation_id=op_id,
                    ) from exc
                with suppress(sqlite3.Error):
                    self.journal(op_id, "failed")
                raise
            index_error = None
            try:
                indexed = Index(self.vault).refresh(verify=True)
            except Exception as exc:
                indexed = None
                index_error = str(exc)
            return result(
                path=path,
                id=candidate.metadata.get("id"),
                file_hash=candidate.file_hash,
                operation_id=op_id,
                saved=True,
                committed=False,
                pushed=False,
                indexed=indexed is not None,
                index_error=index_error,
                review_status=candidate.metadata.get("review_status"),
                warnings=warnings,
            )

    def create(
        self, title, *, template="note", path=None, metadata=None, actor="human", dry_run=False
    ):
        if not title.strip() or "\n" in title or "\r" in title:
            raise KBError("INPUT_INVALID", "标题必须是非空单行文本")
        template_path = self.vault.config.get("templates", {}).get(template)
        if not template_path:
            raise KBError("TEMPLATE_UNKNOWN", "找不到模板", template=template)
        extra = copy.deepcopy(metadata or {})
        if PROTECTED.intersection(extra):
            raise KBError("FIELD_PROTECTED", "创建属性不能覆盖身份或审核字段")
        identifier = str(uuid.uuid4())
        now = self.vault.now()
        values = {
            "uuid": identifier,
            "title": title,
            "created_at": now,
            "updated_at": now,
            "created_by": actor,
            "review_status": "pending",
            "source_type": extra.get("source_type", "web"),
            "url": extra.get("url", ""),
            "date": extra.get("date", now[:10]),
        }
        raw_template = self.vault.safe(template_path).read_text()
        head, fm, body = raw_template.split("---", 2)
        if head.strip():
            raise KBError("TEMPLATE_INVALID", "模板缺少 frontmatter")
        for key, value in values.items():
            # Quoted placeholders use JSON string escaping; unquoted ones become quoted scalars.
            escaped = json.dumps(str(value), ensure_ascii=False)
            fm = fm.replace('"{{' + key + '}}"', escaped).replace("{{" + key + "}}", escaped)
            body = body.replace("{{" + key + "}}", str(value))
        if "{{" in fm or "{{" in body:
            raise KBError("TEMPLATE_INVALID", "模板仍含未替换变量")
        doc = parse_document("template", "---" + fm + "---" + body)
        if doc.parse_error:
            raise KBError("TEMPLATE_INVALID", doc.parse_error)
        meta = doc.editable_metadata
        meta.update(extra)
        if actor == "human" and template != "source":
            meta.pop("review_status", None)
        if template == "source" and meta.get("source_type") != "web" and not meta.get("url"):
            meta.pop("url", None)
        slug = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "-", title).strip(" .")[:100] or "记录"
        if not path:
            if template == "project":
                path = f"{self.vault.config['paths']['projects']}/{slug}/项目概览.md"
            elif template == "daily":
                try:
                    day = date.fromisoformat(str(meta["date"]))
                except ValueError as exc:
                    raise KBError("INPUT_INVALID", "日记日期无效") from exc
                path = f"{self.vault.config['paths']['daily']}/{day:%Y/%m/%Y-%m-%d}.md"
            else:
                folder = self.vault.config["paths"].get(
                    template + "s", self.vault.config["paths"].get(template)
                )
                if not folder:
                    raise KBError("CONFIG_INVALID", "模板没有对应目录")
                path = f"{folder}/{slug}-{identifier[:8]}.md"
        return self.write(
            path,
            render_document(meta, doc.body),
            actor=actor,
            kind="create",
            create=True,
            dry_run=dry_run,
        )

    def patch(self, identifier, change, *, expect_hash, actor="human", dry_run=False):
        if not expect_hash:
            raise KBError("EXPECTED_HASH_REQUIRED", "修改必须提供读取时的全文件哈希")
        if not isinstance(change, dict) or set(change) - {"set", "unset", "replace", "body"}:
            raise KBError("PATCH_INVALID", "patch 只支持 set/unset/replace/body")
        sets = change.get("set", {})
        unsets = change.get("unset", [])
        if (
            not isinstance(sets, dict)
            or not isinstance(unsets, list)
            or not all(isinstance(x, str) for x in unsets)
        ):
            raise KBError("PATCH_INVALID", "set 必须是对象，unset 必须是字段名数组")
        if PROTECTED.intersection(set(sets) | set(unsets)):
            raise KBError("FIELD_PROTECTED", "不能用 patch 伪造身份或人工审核")
        with self.vault.writing():
            before = self.vault.find(identifier)
            if before.file_hash != expect_hash:
                raise KBError("FILE_CHANGED", "目标版本已变化", actual=before.file_hash)
            if before.parse_error:
                raise KBError("YAML_INVALID", "先修复损坏的 YAML")
            meta = copy.deepcopy(before.editable_metadata)
            meta.update(sets)
            for key in unsets:
                meta.pop(key, None)
            body = change.get("body", before.body)
            if not isinstance(body, str):
                raise KBError("PATCH_INVALID", "body 必须是字符串")
            for item in change.get("replace", []):
                if (
                    not isinstance(item, dict)
                    or not isinstance(item.get("old"), str)
                    or not isinstance(item.get("new"), str)
                    or not item["old"]
                    or body.count(item["old"]) != 1
                ):
                    raise KBError("PATCH_AMBIGUOUS", "每个替换必须唯一匹配非空原文")
                body = body.replace(item["old"], item["new"], 1)
            candidate = parse_document(before.path, render_document(meta, body))
            content_changed = self.vault.content_hash(candidate) != self.vault.content_hash(before)
            if content_changed and (actor == "ai" or "review_status" in meta):
                meta["review_status"] = "pending"
                for key in ["reviewed_by", "reviewed_at", "reviewed_content_hash"]:
                    meta.pop(key, None)
            # Only an explicit human completion is allowed to use the no-review completion path.
            completion = (
                self.vault.resolve_schema(before)[0].startswith("task-")
                and sets.get("status") == "done"
            )
            if completion:
                if actor != "human":
                    raise KBError("USER_ACTION_REQUIRED", "完成待办需用户直接操作")
                allowed = set(
                    self.vault.config.get("review", {})
                    .get("task_completion", {})
                    .get("allowed_fields", ["status", "completed_at", "updated_at"])
                )
                completion = (
                    not content_changed
                    and not (set(sets) | set(unsets)) - allowed
                    and not change.get("replace")
                    and "body" not in change
                )
            meta["updated_at"] = self.vault.now()
            return self.write(
                before.path,
                render_document(meta, body),
                expected=before.file_hash,
                actor=actor,
                kind="task_complete" if completion else "patch",
                dry_run=dry_run,
                completion=completion,
            )

    def task_done(self, identifier, expect_hash=None, actor="human"):
        doc = self.vault.find(identifier)
        if not self.vault.resolve_schema(doc)[0].startswith("task-"):
            raise KBError("NOT_A_TASK", "目标不是待办")
        return self.patch(
            identifier,
            {"set": {"status": "done", "completed_at": self.vault.now()}},
            expect_hash=expect_hash or doc.file_hash,
            actor=actor,
        )

    def tasks(self, status=None, tag=None, overdue=False):
        tasks = []
        issues = []
        today = self.vault.now()[:10]
        root = self.vault.config["paths"]["tasks"]
        for doc in self.vault.documents():
            if not doc.path.startswith(root + "/"):
                continue
            local = self.vault.validate(doc)
            issues.extend(local)
            if any(i["severity"] == "error" and i["code"] != "REVIEW_STALE" for i in local):
                continue
            if status and doc.metadata.get("status") != status:
                continue
            if tag and tag not in doc.metadata.get("tags", []):
                continue
            late = bool(
                doc.metadata.get("due")
                and doc.metadata["due"] < today
                and doc.metadata.get("status") not in {"done", "cancelled"}
            )
            if overdue and not late:
                continue
            tasks.append(
                {"path": doc.path, "file_hash": doc.file_hash, "overdue": late, **doc.metadata}
            )
        return result(
            tasks=sorted(tasks, key=lambda x: (x.get("due", "9999"), x["title"])), issues=issues
        )

    def review_list(self):
        records = []
        for doc in self.vault.documents():
            state = doc.metadata.get("review_status")
            if state in {"pending", "needs_changes"}:
                records.append(
                    {
                        "path": doc.path,
                        "id": doc.metadata.get("id"),
                        "title": doc.title,
                        "review_status": state,
                        "file_hash": doc.file_hash,
                    }
                )
            elif state == "approved":
                issues = self.vault.validate(doc)
                codes = {i["code"] for i in issues}
                if {"REVIEW_STALE", "REVIEW_UNVERIFIED"}.intersection(codes):
                    records.append(
                        {
                            "path": doc.path,
                            "id": doc.metadata.get("id"),
                            "title": doc.title,
                            "review_status": "stale" if "REVIEW_STALE" in codes else "unverified",
                            "file_hash": doc.file_hash,
                        }
                    )
        return result(records=records)

    def fix(self, identifier, *, apply=False, expect_hash=None):
        doc = self.vault.find(identifier)
        if doc.parse_error:
            raise KBError("YAML_INVALID", "损坏的 YAML 需要手工修复")
        meta = copy.deepcopy(doc.editable_metadata)
        schema = self.vault.resolve_schema(doc)[0]
        meta.setdefault("schema", schema)
        meta.setdefault("id", str(uuid.uuid4()))
        meta.setdefault("title", doc.title)
        meta.setdefault("tags", [])
        if schema.startswith("note-"):
            meta.setdefault("status", "draft")
        if "review_status" in meta and self.vault.content_hash(
            parse_document(doc.path, render_document(meta, doc.body))
        ) != self.vault.content_hash(doc):
            meta["review_status"] = "pending"
            for key in ["reviewed_by", "reviewed_at", "reviewed_content_hash"]:
                meta.pop(key, None)
        if apply and not expect_hash:
            raise KBError("EXPECTED_HASH_REQUIRED", "实际修复需要预期哈希")
        return self.write(
            doc.path,
            render_document(meta, doc.body),
            actor="human",
            kind="fix",
            expected=expect_hash or doc.file_hash,
            dry_run=not apply,
        )
