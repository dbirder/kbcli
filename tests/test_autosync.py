import importlib.util
import io
import json
import subprocess
from pathlib import Path
from urllib.error import HTTPError

import pytest

from kbcli.errors import KBError
from kbcli.git_sync import Git
from kbcli.operations import Operations
from kbcli.status import snapshot
from kbcli.vault import Vault

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nas_autosync", ROOT / "scripts/nas_autosync.py")
autosync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(autosync)


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


@pytest.fixture
def pair(vault, tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.run(
        ["git", "init", "--bare", "--initial-branch=main", str(remote)],
        capture_output=True,
        check=True,
    )
    git(vault.root, "init", "--initial-branch=main")
    git(vault.root, "config", "user.name", "autosync test")
    git(vault.root, "config", "user.email", "test@example.invalid")
    git(vault.root, "add", ".")
    git(vault.root, "commit", "-m", "initial")
    git(vault.root, "remote", "add", "origin", str(remote))
    git(vault.root, "push", "-u", "origin", "main")
    other = tmp_path / "other"
    subprocess.run(["git", "clone", str(remote), str(other)], capture_output=True, check=True)
    git(other, "config", "user.name", "other test")
    git(other, "config", "user.email", "other@example.invalid")
    return vault, Vault(other, tmp_path / "other-state"), remote


def worker_for(vault, tmp_path):
    calls = []

    def api(command, params):
        calls.append(command)
        try:
            if command == "status":
                return snapshot(vault, **params)
            return Git(vault).sync(**params)
        except KBError as exc:
            raise autosync.SyncError(exc.result()["error"]) from exc

    worker = autosync.Worker(api, vault.state / "operations.sqlite3", tmp_path / "autosync")
    return worker, calls


def test_recorded_changes_push_early_and_remote_updates_pull_on_schedule(pair, tmp_path):
    first, second, remote = pair
    worker, calls = worker_for(first, tmp_path)
    assert worker.tick(now=0)["state"] == "idle"
    created = Operations(first).create("自动提交中文实测", actor="ai")
    assert worker.tick(now=5)["local_commit"]
    assert git(remote, "show", "main:" + created["path"])
    Git(second).sync()
    from_remote = Operations(second).create("电脑更新", actor="ai")
    Git(second).sync(commit_tools=True)
    worker.tick(now=10)
    assert len(calls) == 2  # idle polling does not fetch
    worker.tick(now=65)
    assert first.find(from_remote["id"]).title == "电脑更新"
    assert not git(first.root, "status", "--porcelain")


def test_divergence_pauses_persistently_without_changing_either_history(pair, tmp_path):
    first, second, remote = pair
    Operations(first).create("共同记录", actor="ai")
    Git(first).sync(commit_tools=True)
    Git(second).sync()
    local = first.root / "notes/local.md"
    local.write_text("local content survives\n")
    git(first.root, "add", ".")
    git(first.root, "commit", "-m", "local branch")
    Operations(second).create("remote content survives", actor="ai")
    Git(second).sync(commit_tools=True)
    local_head = git(first.root, "rev-parse", "HEAD")
    remote_head = git(remote, "rev-parse", "main")
    worker, calls = worker_for(first, tmp_path)
    assert worker.tick(now=0)["state"] == "paused"
    assert worker.pause_reason()["error"]["code"] == "SYNC_CONFLICT"
    worker.tick(now=120)
    restarted, restarted_calls = worker_for(first, tmp_path)
    assert restarted.tick(now=240)["state"] == "paused"
    assert len(calls) == 1 and restarted_calls == []
    with pytest.raises(autosync.SyncError, match="Resolve"):
        restarted.resume()
    assert git(first.root, "rev-parse", "HEAD") == local_head
    assert git(remote, "rev-parse", "main") == remote_head
    assert local.read_text() == "local content survives\n"


def test_unknown_manual_change_is_preserved_and_not_committed(pair, tmp_path):
    first, _, _ = pair
    created = Operations(first).create("existing", actor="ai")
    Git(first).sync(commit_tools=True)
    doc = first.find(created["id"])
    first.safe(doc.path).write_text(doc.raw + "manual text\n")
    doc = first.find(created["id"])
    Operations(first).patch(
        doc.path, {"set": {"title": "AI edit"}}, expect_hash=doc.file_hash, actor="ai"
    )
    expected = first.safe(doc.path).read_bytes()
    head = git(first.root, "rev-parse", "HEAD")
    worker, _ = worker_for(first, tmp_path)
    assert worker.tick(now=0)["state"] == "paused"
    assert worker.pause_reason()["error"]["code"] == "UNKNOWN_MODIFICATION"
    assert first.safe(doc.path).read_bytes() == expected
    assert git(first.root, "rev-parse", "HEAD") == head
    assert not git(first.root, "diff", "--cached", "--name-only")


def test_unknown_staged_content_is_preserved_and_not_committed(pair, tmp_path):
    first, _, remote = pair
    created = Operations(first).create("recorded tool write", actor="ai")
    manual = first.root / "notes/manual-staged.md"
    manual.write_text("Human staged content must survive\n")
    git(first.root, "add", "notes/manual-staged.md")
    staged = git(first.root, "diff", "--cached", "--binary")
    head = git(first.root, "rev-parse", "HEAD")
    worker, _ = worker_for(first, tmp_path)

    assert worker.tick(now=0)["state"] == "paused"
    assert worker.pause_reason()["error"]["code"] == "GIT_INDEX_DIRTY"
    assert git(first.root, "diff", "--cached", "--binary") == staged
    assert git(first.root, "rev-parse", "HEAD") == git(remote, "rev-parse", "main") == head
    assert manual.read_text() == "Human staged content must survive\n"
    assert first.find(created["id"]).title == "recorded tool write"


def test_offline_preserves_commit_and_retries_even_when_journal_is_committed(pair, tmp_path):
    first, _, remote = pair
    created = Operations(first).create("offline survives", actor="ai")
    git(first.root, "remote", "set-url", "origin", str(tmp_path / "unreachable.git"))
    worker, calls = worker_for(first, tmp_path)
    assert worker.tick(now=0)["state"] == "retrying"
    saved_head = git(first.root, "rev-parse", "HEAD")
    assert not Operations.observe(first)["pending_writes"]
    assert first.find(created["id"]).title == "offline survives"
    worker.tick(now=5)
    assert len(calls) == 1
    git(first.root, "remote", "set-url", "origin", str(remote))
    assert worker.tick(now=15)["state"] == "idle"
    assert git(remote, "rev-parse", "main") == saved_head
    assert not worker.pause_reason()


def test_operator_resume_rechecks_local_state_and_clears_latch(pair, tmp_path):
    first, _, _ = pair
    worker, calls = worker_for(first, tmp_path)
    worker.pause({"code": "OPERATOR_PAUSED", "message": "test pause"})
    assert worker.tick(now=0)["state"] == "paused" and calls == []
    unknown = first.root / "notes/manual.md"
    unknown.write_text("do not discard\n")
    with pytest.raises(autosync.SyncError):
        worker.resume()
    assert worker.pause_reason()
    git(first.root, "add", "notes/manual.md")
    git(first.root, "commit", "-m", "explicit human resolution")
    worker.resume()
    assert not worker.pause_reason()
    assert worker.tick(now=5)["state"] == "idle"


@pytest.mark.parametrize("reason", ["[rejected] (fetch first)", "[remote rejected] protected"])
def test_push_rejections_pause_instead_of_retrying(tmp_path, reason):
    def rejected(*_):
        raise autosync.SyncError({"code": "PUSH_PENDING", "details": {"reason": reason}})

    worker = autosync.Worker(rejected, tmp_path / "absent.sqlite3", tmp_path / "state")
    assert worker.tick(now=0)["state"] == "paused"
    assert worker.pause_reason()


@pytest.mark.parametrize("data", ["null", "broken json"])
def test_invalid_pause_marker_never_resumes_automatically(tmp_path, data):
    def forbidden(*_):
        raise AssertionError("Must not contact Git/API while paused")

    worker = autosync.Worker(forbidden, tmp_path / "absent.sqlite3", tmp_path / "state")
    (worker.directory / "pause.json").write_text(data)
    assert worker.tick(now=0)["state"] == "paused"
    assert worker.pause_reason()["error"]["code"] == "PAUSE_STATE_INVALID"
    assert json.loads((worker.directory / "status.json").read_text())["state"] == "paused"


@pytest.mark.parametrize("role,expected", [("agent", "paused"), ("owner", "idle")])
def test_http_scheduler_requires_explicit_owner_identity(
    pair, tmp_path, monkeypatch, role, expected
):
    from fastapi.testclient import TestClient

    from kbcli.api import create_app

    first, _, _ = pair
    with TestClient(create_app(first, "owner", agent_token="agent")) as server:

        def transport(request, **_):
            response = server.post(
                "/api/command",
                json=json.loads(request.data),
                headers={"Authorization": request.get_header("Authorization")},
            )
            body = io.BytesIO(response.content)
            if response.status_code >= 400:
                raise HTTPError(request.full_url, response.status_code, "error", {}, body)
            return body

        monkeypatch.setattr(autosync, "urlopen", transport)
        monkeypatch.setenv("AUTOSYNC_TEST_TOKEN", role)
        api = autosync.API("http://local", token_env="AUTOSYNC_TEST_TOKEN")
        worker = autosync.Worker(api, first.state / "operations.sqlite3", tmp_path / "scheduler")
        assert worker.tick(now=0)["state"] == expected
        if role == "agent":
            assert worker.pause_reason()["error"]["code"] == "USER_ACTION_REQUIRED"
