import json
import sqlite3

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from kbcli.api import create_app
from kbcli.cli import app
from kbcli.errors import KBError
from kbcli.operations import Operations
from kbcli.status import snapshot
from kbcli.vault import Vault, parse_document, render_document


def test_readonly_commands_need_no_state_directory(vault, tmp_path, monkeypatch):
    forbidden = tmp_path / "never-created" / "state"
    readonly = Vault(vault.root, forbidden)
    file = vault.root / "notes/旧笔记.md"
    file.write_text("# 旧笔记\n同步资料\n")

    def refuse(self):
        raise AssertionError("readonly operation attempted a state write")

    monkeypatch.setattr(Vault, "ensure_state", refuse)
    assert readonly.check()["errors"] == 0
    assert "同步资料" in readonly.read("notes/旧笔记.md")["content"]
    data = snapshot(readonly)
    assert data["content"]["records"] == 1
    assert data["index"]["initialized"] is False
    assert data["index"]["documents"] is None
    assert not forbidden.parent.exists()
    runner = CliRunner()
    args = ["--vault", str(vault.root), "--state-dir", str(forbidden)]
    for operation in [
        ["check"],
        ["read", "notes/旧笔记.md"],
        ["status", "--portable"],
        ["doctor"],
        ["task", "list"],
        ["review", "list"],
    ]:
        response = runner.invoke(app, args + operation)
        assert response.exit_code == 0, response.output
    assert not forbidden.parent.exists()


def test_status_observation_does_not_recover_or_create_journal(vault):
    ops = Operations(vault)
    record = ops.create("恢复状态", template="task", actor="ai")
    with ops.database() as db:
        db.execute("UPDATE operations SET state='prepared'")
    before = ops.journal_path.read_bytes()
    observed = snapshot(vault)
    assert observed["recovery_pending"][0]["state"] == "prepared"
    assert before == ops.journal_path.read_bytes()
    assert vault.find(record["id"]).metadata["status"] == "todo"


def test_unreadable_index_is_unknown_not_empty(vault, monkeypatch):
    from kbcli import indexing

    vault.ensure_state()
    (vault.state / "index.sqlite3").write_bytes(b"placeholder")

    def denied(path):
        raise sqlite3.OperationalError("unable to open database file")

    monkeypatch.setattr(indexing, "readonly_database", denied)
    data = snapshot(vault)
    assert data["index"]["observed"] is False
    assert data["index"]["documents"] is None
    assert data["index"]["pending_files"] is None
    assert "INDEX_STATE_UNOBSERVED" in {d["code"] for d in data["diagnostics"]}
    assert data["schema"]["errors"] == 0

    def local_path_error(path):
        raise PermissionError(f"cannot open {vault.state}/index.sqlite3")

    monkeypatch.setattr(indexing, "readonly_database", local_path_error)
    portable = snapshot(vault, portable=True)
    assert str(vault.state) not in json.dumps(portable)


def test_content_maturity_and_completed_pending_are_separate(vault):
    ops = Operations(vault)
    ops.create(
        "来源",
        template="source",
        metadata={"url": "https://example.com", "tags": ["kbcli-实测"]},
        actor="ai",
    )
    task = ops.create("任务", template="task", metadata={"tags": ["kbcli-实测"]}, actor="ai")
    ops.task_done(task["id"])
    data = snapshot(vault, portable=True)
    assert data["schema"]["errors"] == 0
    assert data["content"]["test_records"] == 2
    assert data["content"]["non_test_records"] == 0
    assert data["content"]["tasks"]["status"]["done"] == 1
    assert data["content"]["review"]["pending"] == 2
    assert data["content"]["sources"]["capture"]["pending"] == 1
    assert "vault" not in data and "path" not in data["index"]["state_location"]
    assert str(vault.root) not in json.dumps(data)
    assert data["index"]["state_location"]["temporary"] is True


def test_approved_requires_valid_schema_and_current_hash(vault):
    created = Operations(vault).create("审核夹具")
    doc = vault.find(created["id"])
    metadata = doc.editable_metadata
    metadata.update(
        review_status="approved",
        reviewed_by="人工测试夹具",
        reviewed_at="2026-10-04T10:00:00+08:00",
    )
    candidate = parse_document(doc.path, render_document(metadata, doc.body))
    metadata["reviewed_content_hash"] = vault.content_hash(candidate)
    vault.safe(doc.path).write_text(render_document(metadata, doc.body))
    assert snapshot(vault)["content"]["approved_non_test_notes"] == 1
    del metadata["reviewed_by"]
    candidate = parse_document(doc.path, render_document(metadata, doc.body))
    metadata["reviewed_content_hash"] = vault.content_hash(candidate)
    vault.safe(doc.path).write_text(render_document(metadata, doc.body))
    assert vault.review_effective(vault.find(created["id"])) == "invalid"
    assert snapshot(vault)["content"]["approved_non_test_notes"] == 0


def test_http_and_remote_status_use_same_summary(vault):
    Operations(vault).create("待办", template="task", actor="ai")
    with TestClient(create_app(vault, "user-test")) as client:
        headers = {"Authorization": "Bearer user-test"}
        direct = client.get("/api/status", headers=headers).json()
        remote = client.post(
            "/api/command",
            headers=headers,
            json={"command": "status", "params": {"portable": True}},
        ).json()
        assert direct["content"] == remote["content"]
        assert direct["schema"] == remote["schema"]
        assert direct["portable"] and remote["portable"]


def test_write_reports_unwritable_state_while_check_still_works(vault, monkeypatch):
    def denied(self):
        raise KBError("STATE_UNWRITABLE", "state denied")

    monkeypatch.setattr(Vault, "ensure_state", denied)
    assert vault.check()["errors"] == 0
    with pytest.raises(KBError) as exc:
        Operations(vault)
    assert exc.value.code == "STATE_UNWRITABLE"


def test_empty_database_is_not_a_completed_index(vault):
    from kbcli.indexing import Index

    idx = Index(vault)
    with idx.connect():
        pass
    observed = snapshot(vault)
    assert observed["index"]["observed"]
    assert observed["index"]["initialized"] is False
    assert observed["index"]["indexed_at"] is None
    assert "INDEX_NOT_INITIALIZED" in {d["code"] for d in observed["diagnostics"]}
