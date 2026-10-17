import os
import uuid

import pytest

from kbcli.errors import KBError
from kbcli.indexing import Index
from kbcli.operations import Operations
from kbcli.vault import parse_document, render_document


def test_routing_legacy_and_excluded(vault):
    (vault.root / "notes/旧笔记.md").write_text("# 手工笔记\n同步方案\n")
    (vault.root / "tasks/README.md").write_text("not a task")
    (vault.root / "notes/README.md").write_text("not a note")
    assert vault.check()["errors"] == 0
    assert vault.check()["warnings"] > 0
    assert len(vault.documents()) == 1
    card = parse_document("projects/kbcli/项目概览.md", "")
    process = parse_document("projects/kbcli/过程/决策.md", "")
    assert vault.resolve_schema(card) == ("project-v1", True)
    assert vault.resolve_schema(process) == ("note-v1", False)
    bad = parse_document(
        "tasks/错类型.md",
        render_document(
            {"schema": "note-v1", "id": str(uuid.uuid4()), "title": "错误", "status": "draft"},
            "正文",
        ),
    )
    assert vault.validate(bad)[0]["code"] == "SCHEMA_NOT_ALLOWED"


@pytest.mark.parametrize(
    "template,metadata",
    [
        ("note", {}),
        ("project", {}),
        ("task", {}),
        ("daily", {"date": "2026-10-03"}),
        ("source", {"url": "https://example.com/article"}),
    ],
)
@pytest.mark.parametrize("actor", ["human", "ai"])
def test_templates_schema_and_safe_titles(vault, template, metadata, actor):
    created = Operations(vault).create(
        '带 "引号" 与中文的标题', template=template, metadata=metadata, actor=actor
    )
    assert created["saved"] and created["indexed"]
    doc = vault.find(created["id"])
    assert doc.metadata["title"] == '带 "引号" 与中文的标题'
    assert vault.check()["errors"] == 0
    assert doc.metadata.get("review_status") == (
        "pending" if actor == "ai" or template == "source" else None
    )


def test_invalid_metadata_and_source_evidence(vault):
    ops = Operations(vault)
    with pytest.raises(KBError, match="规范"):
        ops.create("错日期", template="task", metadata={"due": "2026-02-30"})
    with pytest.raises(KBError, match="规范"):
        ops.create(
            "抓取完整",
            template="source",
            metadata={"url": "https://example.com", "capture_status": "complete"},
        )
    assert not vault.documents()


def test_chinese_retrieval_filters_and_source_lines(vault):
    ops = Operations(vault)
    first = ops.create(
        "Git 处理方法",
        metadata={"tags": ["git"], "aliases": ["同步教程"], "project_name": "kbcli"},
        actor="ai",
    )
    doc = vault.find(first["id"])
    ops.patch(
        doc.path,
        {"body": "# Git 处理方法\n\n需要处理知识库同步冲突。\n"},
        expect_hash=doc.file_hash,
        actor="ai",
    )
    ops.create("其他资料", metadata={"tags": ["github"]})
    idx = Index(vault)
    found = idx.search("同步", tag="git", prop="project_name=kbcli", fresh=True)
    assert len(found["results"]) == 1
    hit = found["results"][0]
    original = vault.read(hit["path"], hit["file_hash"], hit["line_start"], hit["line_end"])
    assert original["content"] == hit["snippet"]
    assert not idx.search("同步", tag="github", fresh=True)["results"]
    assert idx.grep("同步.*冲突")["results"]


def test_hash_verify_detects_same_stat_and_rename_delete(vault):
    ops = Operations(vault)
    created = ops.create("普通标题")
    doc = vault.find(created["id"])
    ops.patch(doc.path, {"body": "# 普通标题\n\n同步记录。\n"}, expect_hash=doc.file_hash)
    idx = Index(vault)
    assert idx.search("同步", fresh=True)["results"]
    path = vault.safe(doc.path)
    stat = path.stat()
    path.write_text(path.read_text().replace("同步记录", "检索记录"))
    os.utime(path, ns=(stat.st_atime_ns, stat.st_mtime_ns))
    assert not idx.search("同步", fresh=True)["results"]
    assert idx.search("检索", fresh=True)["results"]
    new = path.with_name("重命名.md")
    path.rename(new)
    assert idx.search("检索", fresh=True)["results"][0]["path"] == "notes/重命名.md"
    new.unlink()
    assert not idx.search("检索", fresh=True)["results"]
    assert idx.status()["documents"] == 0


def test_duplicate_ids_recover_structured_search(vault):
    created = Operations(vault).create("原记录", metadata={"tags": ["git"]})
    doc = vault.find(created["id"])
    duplicate = vault.root / "notes/复制.md"
    duplicate.write_text(doc.raw)
    idx = Index(vault)
    assert vault.check()["errors"] > 0
    assert not idx.search("", tag="git", fresh=True)["results"]
    duplicate.unlink()
    assert len(idx.search("", tag="git", fresh=True)["results"]) == 1


def test_old_hash_does_not_overwrite_and_comments_survive(vault):
    ops = Operations(vault)
    created = ops.create("手工正文")
    doc = vault.find(created["id"])
    p = vault.safe(doc.path)
    p.write_text(doc.raw.replace("status: draft", "status: draft # 用户注释"))
    with pytest.raises(KBError) as exc:
        ops.patch(doc.path, {"set": {"title": "新标题"}}, expect_hash=doc.file_hash)
    assert exc.value.code == "FILE_CHANGED"
    current = vault.load(doc.path)
    ops.patch(doc.path, {"set": {"title": "新标题"}}, expect_hash=current.file_hash)
    assert "# 用户注释" in p.read_text()
    assert "# 手工正文" in p.read_text()


@pytest.mark.parametrize("review", [None, "pending", "approved", "needs_changes", "rejected"])
def test_completion_preserves_review(vault, review):
    ops = Operations(vault)
    created = ops.create("测试任务", template="task")
    doc = vault.find(created["id"])
    meta = doc.editable_metadata
    if review:
        meta["review_status"] = review
    if review == "approved":
        meta["reviewed_by"] = "人工测试夹具"
        meta["reviewed_at"] = "2026-10-03T18:30:00+08:00"
        candidate = parse_document(doc.path, render_document(meta, doc.body))
        meta["reviewed_content_hash"] = vault.content_hash(candidate)
    vault.safe(doc.path).write_text(render_document(meta, doc.body))
    before = vault.load(doc.path)
    ops.task_done(created["id"], before.file_hash)
    after = vault.find(created["id"])
    assert after.metadata["status"] == "done"
    assert after.metadata.get("review_status") == review
    assert before.body == after.body
    assert vault.content_hash(before) == vault.content_hash(after)
    assert before.file_hash != after.file_hash
    if review == "approved":
        assert before.metadata["reviewed_content_hash"] == after.metadata["reviewed_content_hash"]
        ops.patch(
            after.path, {"set": {"due": "2026-10-10"}}, expect_hash=after.file_hash, actor="ai"
        )
        changed = vault.find(created["id"])
        assert changed.metadata["review_status"] == "pending"
        assert "reviewed_by" not in changed.metadata


def test_reject_ai_completion_and_approval_patch(vault):
    ops = Operations(vault)
    created = ops.create("任务", template="task", actor="ai")
    with pytest.raises(KBError) as exc:
        ops.task_done(created["id"], actor="ai")
    assert exc.value.code == "USER_ACTION_REQUIRED"
    doc = vault.find(created["id"])
    with pytest.raises(KBError) as exc:
        ops.patch(doc.path, {"set": {"review_status": "approved"}}, expect_hash=doc.file_hash)
    assert exc.value.code == "FIELD_PROTECTED"


def test_dry_run_and_reference_type_check(vault):
    ops = Operations(vault)
    preview = ops.create("预览", dry_run=True)
    assert preview["dry_run"] and not vault.documents()
    project = ops.create("kbcli", template="project")
    linked = ops.create(
        "决策", path="projects/kbcli/决策.md", metadata={"projects": [project["id"]]}
    )
    assert vault.resolve_schema(vault.find(linked["id"]))[0] == "note-v1"
    with pytest.raises(KBError):
        ops.create("错误引用", metadata={"sources": [project["id"]]})


def test_malformed_yaml_still_searchable_and_paths_safe(vault, tmp_path):
    (vault.root / "notes/坏格式.md").write_text("---\ntitle: [损坏\n---\n\n同步冲突资料\n")
    assert vault.check()["errors"]
    hit = Index(vault).search("同步", fresh=True)["results"][0]
    assert hit["parse_error"] and not hit["metadata_valid"]
    with pytest.raises(KBError):
        vault.read("../outside.md")
    outside = tmp_path / "outside.md"
    outside.write_text("秘密")
    (vault.root / "notes/link.md").symlink_to(outside)
    with pytest.raises(KBError) as exc:
        vault.discover()
    assert exc.value.code in {"PATH_OUTSIDE_VAULT", "SYMLINK_NOT_ALLOWED"}


def test_literal_spans_blocks_and_invalid_record_is_readable(vault):
    ops = Operations(vault)
    created = ops.create("文本", actor="ai")
    before = vault.find(created["id"])
    ops.patch(
        created["id"],
        {"body": "# 文本\n\n第一段结束。\n\n第二段开始。\n"},
        expect_hash=before.file_hash,
        actor="ai",
    )
    query = "第一段结束。\n\n第二段开始。"
    hit = Index(vault).search(query, literal=True, fresh=True)["results"][0]
    assert (
        query
        in vault.read(hit["path"], hit["file_hash"], hit["line_start"], hit["line_end"])["content"]
    )
    bad = vault.root / "tasks/错规范.md"
    bad.write_text("---\nschema: note-v1\ntitle: 不合规范\n---\n原文内容\n")
    assert "原文内容" in vault.read("tasks/错规范.md")["content"]


def test_prepared_journal_recovers_without_overwriting_unknown_content(vault):
    ops = Operations(vault)
    created = ops.create("中断恢复")
    with ops.database() as db:
        db.execute("UPDATE operations SET state='prepared'")
    recovered = Operations(vault)
    assert recovered.pending_writes()[0]["state"] == "saved"
    assert not recovered.recovery_pending()
    original = vault.find(created["id"])
    vault.safe(original.path).write_text(original.raw + "人工变化\n")
    with ops.database() as db:
        db.execute("UPDATE operations SET state='prepared'")
    unknown = Operations(vault)
    assert unknown.recovery_pending()[0]["state"] == "recovery_needed"
    assert vault.safe(original.path).read_text().endswith("人工变化\n")


def test_concurrent_patches_only_one_can_use_same_hash(vault):
    from concurrent.futures import ThreadPoolExecutor

    ops = Operations(vault)
    created = ops.create("并发任务", template="task")

    def update(title):
        try:
            return Operations(vault).patch(
                created["id"], {"set": {"title": title}}, expect_hash=created["file_hash"]
            )
        except KBError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(pool.map(update, ["标题甲", "标题乙"]))
    assert sum(isinstance(a, dict) and a["saved"] for a in answers) == 1
    assert answers.count("FILE_CHANGED") == 1


def test_fresh_timeout_is_not_reported_as_fresh(vault, monkeypatch):
    import time

    idx = Index(vault)
    original = idx.refresh

    def slow(*args, **kwargs):
        time.sleep(0.01)
        return original(*args, **kwargs)

    monkeypatch.setattr(idx, "refresh", slow)
    with pytest.raises(KBError) as exc:
        idx.search("同步", fresh=True, timeout=0.001)
    assert exc.value.code == "INDEX_STALE"


def test_single_han_character_and_absolute_filter(vault):
    ops = Operations(vault)
    created = ops.create("知识库检索", actor="ai")
    found = Index(vault).search("库", under=str(vault.root / "notes"), fresh=True)
    assert found["results"][0]["id"] == created["id"]
    assert found["search_mode"] == "literal"
    assert "title" in found["results"][0]["matched_fields"]
    assert found["results"][0]["review_effective"] == "pending"
