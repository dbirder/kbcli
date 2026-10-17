import subprocess

import pytest

from kbcli.errors import KBError
from kbcli.git_sync import Git
from kbcli.operations import Operations
from kbcli.vault import Vault


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def configure(root):
    git(root, "config", "user.name", "kbcli integration test")
    git(root, "config", "user.email", "kbcli-test@example.invalid")


@pytest.fixture
def git_pair(vault, tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.run(
        ["git", "init", "--bare", "--initial-branch=main", str(remote)],
        check=True,
        capture_output=True,
    )
    git(vault.root, "init", "--initial-branch=main")
    configure(vault.root)
    git(vault.root, "add", ".")
    git(vault.root, "commit", "-m", "initial contracts")
    git(vault.root, "remote", "add", "origin", str(remote))
    git(vault.root, "push", "-u", "origin", "main")
    other = tmp_path / "other"
    subprocess.run(["git", "clone", str(remote), str(other)], check=True, capture_output=True)
    configure(other)
    return vault, Vault(other, tmp_path / "other-state")


def test_git_fast_forward_and_recorded_commit(git_pair):
    first, second = git_pair
    created = Operations(first).create("Git 同步实测", actor="ai")
    synced = Git(first).sync(commit_tools=True)
    assert synced["synced"] and synced["local_commit"]
    pulled = Git(second).sync()
    assert pulled["synced"]
    assert second.find(created["id"]).metadata["title"] == "Git 同步实测"


def test_dirty_and_divergent_histories_are_preserved(git_pair):
    first, second = git_pair
    unknown = second.root / "notes/人工未提交.md"
    unknown.parent.mkdir(exist_ok=True)
    unknown.write_text("手工内容\n")
    with pytest.raises(KBError) as exc:
        Git(second).sync()
    assert exc.value.code == "DIRTY_WORKTREE"
    assert unknown.read_text() == "手工内容\n"
    git(second.root, "add", ".")
    git(second.root, "commit", "-m", "local user change")
    Operations(first).create("远端变更", actor="ai")
    Git(first).sync(commit_tools=True)
    before = git(second.root, "rev-parse", "HEAD")
    with pytest.raises(KBError) as exc:
        Git(second).sync()
    assert exc.value.code == "SYNC_CONFLICT"
    assert git(second.root, "rev-parse", "HEAD") == before
    assert unknown.read_text() == "手工内容\n"


def test_no_parent_repo_mutation(vault):
    git(vault.root.parent, "init", "--initial-branch=main")
    with pytest.raises(KBError) as exc:
        Git(vault).sync()
    assert exc.value.code == "GIT_ROOT_MISMATCH"


def test_commit_tools_does_not_include_earlier_manual_edits(git_pair):
    first, _ = git_pair
    ops = Operations(first)
    created = ops.create("已有记录", actor="ai")
    Git(first).sync(commit_tools=True)
    doc = first.find(created["id"])
    first.safe(doc.path).write_text(doc.raw + "用户未提交的正文\n")
    current = first.load(doc.path)
    ops.patch(doc.path, {"set": {"title": "工具改标题"}}, expect_hash=current.file_hash, actor="ai")
    before = git(first.root, "rev-parse", "HEAD")
    with pytest.raises(KBError) as exc:
        Git(first).sync(commit_tools=True)
    assert exc.value.code == "UNKNOWN_MODIFICATION"
    assert git(first.root, "rev-parse", "HEAD") == before
    assert "用户未提交的正文" in first.load(doc.path).body


def test_missing_tracking_ref_is_configured_then_fetched(git_pair):
    _, second = git_pair
    git(second.root, "update-ref", "-d", "refs/remotes/origin/main")
    data = Git(second).status()
    assert data["configured_upstream"] == "origin/main"
    assert data["upstream_ref_present"] is False
    assert data["remote_checked"] is False
    assert Git(second).sync()["git"]["upstream_ref_present"] is True


def test_unborn_repository_does_not_create_initial_commit(vault, tmp_path):
    remote = tmp_path / "empty.git"
    subprocess.run(
        ["git", "init", "--bare", "--initial-branch=master", str(remote)],
        check=True,
        capture_output=True,
    )
    git(vault.root, "init", "--initial-branch=master")
    configure(vault.root)
    git(vault.root, "remote", "add", "origin", str(remote))
    git(vault.root, "config", "branch.master.remote", "origin")
    git(vault.root, "config", "branch.master.merge", "refs/heads/master")
    Operations(vault).create("待提交")
    state = Git(vault).status()
    assert state["state"] == "unborn"
    assert state["configured_upstream"] == "origin/master"
    assert state["tracking_ref"] == "refs/remotes/origin/master"
    assert not state["upstream_ref_present"]
    with pytest.raises(KBError) as exc:
        Git(vault).sync(commit_tools=True)
    assert exc.value.code == "NO_INITIAL_COMMIT"
    assert Git(vault).status()["head"] is None


def test_fetched_remote_without_configured_branch_reports_precisely(git_pair):
    _, second = git_pair
    git(second.root, "config", "branch.main.merge", "refs/heads/missing")
    with pytest.raises(KBError) as exc:
        Git(second).sync()
    assert exc.value.code == "UPSTREAM_REF_MISSING"
    assert exc.value.details["remote_checked"] is True


def test_unconfigured_upstream_is_different_from_missing_ref(git_pair):
    _, second = git_pair
    git(second.root, "config", "--unset", "branch.main.remote")
    git(second.root, "config", "--unset", "branch.main.merge")
    assert Git(second).status()["configured_upstream"] is None
    with pytest.raises(KBError) as exc:
        Git(second).sync()
    assert exc.value.code == "UPSTREAM_NOT_CONFIGURED"
