"""Read-only health snapshot shared by the CLI, remote CLI and HTTP API."""

import sqlite3
from collections import Counter
from datetime import date

from . import __version__
from .errors import KBError, result
from .git_sync import Git
from .indexing import Index
from .operations import Operations


def bucket(value, allowed):
    return value if isinstance(value, str) and value in allowed else "invalid"


def content_summary(vault, documents, validation):
    by_directory = Counter({root: 0 for root in vault.roots})
    by_schema = Counter()
    reviews = Counter(
        {
            key: 0
            for key in [
                "pending",
                "approved",
                "needs_changes",
                "rejected",
                "stale",
                "unverified",
                "invalid",
                "not_requested",
            ]
        }
    )
    tasks = Counter(
        {key: 0 for key in ["todo", "doing", "done", "cancelled", "invalid", "overdue"]}
    )
    captures = Counter({key: 0 for key in ["pending", "complete", "partial", "failed", "invalid"]})
    testing = 0
    approved_knowledge = 0
    sample_tags = vault.config.get("analysis", {}).get("sample_tags", ["kbcli-实测"])
    if not isinstance(sample_tags, list) or not all(isinstance(tag, str) for tag in sample_tags):
        raise KBError("CONFIG_INVALID", "analysis.sample_tags 必须是字符串数组")
    bad_paths = {issue["path"] for issue in validation["issues"] if issue["severity"] == "error"}
    for doc in documents:
        by_directory[doc.path.split("/")[0]] += 1
        try:
            schema = vault.resolve_schema(doc)[0]
        except KBError:
            schema = "unknown"
        by_schema[schema] += 1
        tags = doc.metadata.get("tags", [])
        sample = isinstance(tags, list) and any(tag in sample_tags for tag in tags)
        testing += sample
        review = vault.review_effective(doc)
        review = "not_requested" if review is None else bucket(review, reviews)
        if review == "approved" and doc.path in bad_paths:
            review = "invalid"
        reviews[review] += 1
        if schema.startswith("note-") and review == "approved" and not sample:
            approved_knowledge += 1
        if schema.startswith("task-"):
            state = bucket(doc.metadata.get("status"), {"todo", "doing", "done", "cancelled"})
            tasks[state] += 1
            try:
                due = date.fromisoformat(doc.metadata.get("due", ""))
                if state in {"todo", "doing"} and due < date.fromisoformat(vault.now()[:10]):
                    tasks["overdue"] += 1
            except (TypeError, ValueError):
                pass
        if schema.startswith("source-"):
            captures[bucket(doc.metadata.get("capture_status"), captures)] += 1
    return {
        "records": len(documents),
        "by_directory": dict(by_directory),
        "by_schema": dict(by_schema),
        "test_records": testing,
        "non_test_records": len(documents) - testing,
        "sample_tags": sample_tags,
        "review": dict(reviews),
        "approved_non_test_notes": approved_knowledge,
        "sources": {"records": sum(captures.values()), "capture": dict(captures)},
        "tasks": {
            "records": sum(count for key, count in tasks.items() if key != "overdue"),
            "status": dict(tasks),
        },
    }


def snapshot(vault, *, portable=False):
    documents = vault.documents()
    validation = vault.check(documents=documents)
    content = content_summary(vault, documents, validation)
    git = Git(vault).status()
    idx = Index(vault)
    index = idx.status()
    if index["observed"]:
        try:
            index["pending_files"] = idx.pending()
        except (OSError, sqlite3.Error, KBError) as exc:
            index.update(
                observed=False,
                observation="unavailable",
                pending_files=None,
                error={"code": "INDEX_STATE_UNREADABLE", "message": str(exc)},
            )
    else:
        index["pending_files"] = None
    index["state_location"] = vault.state_location(portable)
    journal = Operations.observe(vault)
    diagnostics = []

    def diagnostic(code, severity, message):
        diagnostics.append({"code": code, "severity": severity, "message": message})

    if validation["errors"]:
        diagnostic("SCHEMA_ERRORS", "warning", "有记录未通过结构或关联检查")
    if git.get("state") == "unborn":
        diagnostic("NO_INITIAL_COMMIT", "warning", "尚无首次提交，当前没有 Git 版本历史可用于恢复")
    if git.get("branch") and not git.get("configured_upstream"):
        diagnostic("UPSTREAM_NOT_CONFIGURED", "info", "当前分支未配置上游")
    elif git.get("configured_upstream") and not git.get("upstream_ref_present"):
        diagnostic(
            "UPSTREAM_REF_MISSING", "info", "上游已配置，本地跟踪引用尚未获取；本次未访问远端"
        )
    if not index["observed"]:
        diagnostic("INDEX_STATE_UNOBSERVED", "info", "缓存状态未能读取；不能据此判断索引为空")
    elif not index["initialized"]:
        diagnostic(
            "INDEX_NOT_INITIALIZED", "info", "所选状态目录尚未建立索引，不代表知识库没有内容"
        )
    if index["state_location"]["temporary"]:
        diagnostic("TEMPORARY_STATE", "info", "当前观测的是临时状态目录，不能替代默认缓存的状态")
    if not journal["observed"]:
        diagnostic("JOURNAL_STATE_UNOBSERVED", "info", "操作日志不可读；待提交与恢复状态未知")
    if content["records"] and content["test_records"] == content["records"]:
        diagnostic("TEST_ONLY_CONTENT", "info", "当前内容全部带实测标签，真实知识积累尚未开始")
    if not content["approved_non_test_notes"]:
        diagnostic(
            "NO_APPROVED_KNOWLEDGE", "info", "尚无经版本核验的非实测知识笔记；这不是结构错误"
        )
    value = result(
        version=__version__,
        snapshot_at=vault.now(),
        scope="local_files",
        portable=portable,
        **(
            {"vault": str(vault.root)}
            if not portable
            else {"vault_name": vault.config.get("vault", {}).get("name")}
        ),
        git=git,
        index=index,
        journal=journal,
        pending_tool_writes=journal["pending_writes"],
        recovery_pending=journal["recovery_pending"],
        schema={
            "records": validation["documents"],
            "errors": validation["errors"],
            "warnings": validation["warnings"],
        },
        content=content,
        diagnostics=diagnostics,
    )
    if portable:
        replacements = [(str(vault.state), "<local-state>"), (str(vault.root), "<vault>")]

        def redact(item):
            if isinstance(item, str):
                for original, replacement in replacements:
                    item = item.replace(original, replacement)
                return item
            if isinstance(item, dict):
                return {key: redact(child) for key, child in item.items()}
            if isinstance(item, list):
                return [redact(child) for child in item]
            return item

        return redact(value)
    return value
