import importlib.util
import os
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nas_layout", ROOT / "scripts/migrate_nas_layout.py")
layout = importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)


def test_split_mounts_are_least_scope_and_sync_has_only_owner_env():
    original = {"services": {
        "hermes": {"volumes": ["./hermes-data:/opt/data", "./scripts:/opt/hermes-deploy:ro"]},
        "kbcli": {"environment": {"HOME": "/opt/data/home", "KBCLI_USER_TOKEN": "test-owner", "KBCLI_AGENT_TOKEN": "test-agent"}},
        "kbcli-sync": {"environment": {"KBCLI_USER_TOKEN": "test-owner", "KBCLI_AGENT_TOKEN": "test-agent"}, "command": ["/opt/data/kbcli/automation/nas_autosync.py", "--token-env", "KBCLI_USER_TOKEN", "run"], "healthcheck": {"test": ["old"]}},
    }}
    result = layout.split_config(original)["services"]
    assert "./knowledge-base:/opt/data/knowledge-base:ro" in result["hermes"]["volumes"]
    assert "./hermes-client:/opt/data/kbcli:ro" in result["hermes"]["volumes"]
    assert all("hermes-data" not in v for n in ("kbcli", "kbcli-sync") for v in result[n]["volumes"])
    assert all("knowledge-base" not in v and "ssh" not in v for v in result["kbcli-sync"]["volumes"])
    assert "./kbcli-data/state:/opt/data/kbcli/state:ro" in result["kbcli-sync"]["volumes"]
    assert "./kbcli-sync-data:/opt/data/kbcli/autosync:ro" in result["kbcli"]["volumes"]
    assert result["kbcli-sync"]["env_file"] == ["./config/kbcli/sync.env"]
    assert "KBCLI_AGENT_TOKEN" not in result["kbcli-sync"]["environment"]
    assert result["kbcli-sync"]["healthcheck"]["test"][-1] == "health"


def prepare(base):
    old = base / "hermes-data"
    for rel in ("knowledge-base/.git", "kbcli/state", "kbcli/autosync", "kbcli/python", "kbcli/environments", "kbcli/bin", ".ssh"):
        (old / rel).mkdir(parents=True, exist_ok=True)
    for rel, content in {
        "knowledge-base/note.md": "existing knowledge", "knowledge-base/.git/HEAD": "ref: refs/heads/master",
        "kbcli/state/operations.sqlite3": "operation journal", "kbcli/autosync/pause.json": '{"error":{"code":"SYNC_CONFLICT"}}',
        "kbcli/agent-token": "test-agent", "kbcli/bin/kbcli": "client", "kbcli/bin/kbcli-autosync": "operator",
        ".ssh/id_ed25519": "private-test-fixture", ".ssh/known_hosts": "test-known-host",
    }.items():
        (old / rel).write_text(content)
    (old / "kbcli/python/interpreter").symlink_to("/opt/data/kbcli/python/version/bin/python")
    return old


def test_layout_preserves_knowledge_git_journal_pause_and_client_symlinks(tmp_path):
    old = prepare(tmp_path)
    source = {"services": {"kbcli": {"environment": {"KBCLI_USER_TOKEN": "test-owner", "KBCLI_AGENT_TOKEN": "test-agent"}}}}
    before = layout.knowledge_hashes(old / "knowledge-base")
    layout.split_layout(tmp_path, source, uid=os.getuid(), gid=os.getgid())
    assert layout.knowledge_hashes(tmp_path / "knowledge-base") == before
    assert (tmp_path / "knowledge-base/.git/HEAD").read_text() == "ref: refs/heads/master"
    assert (tmp_path / "kbcli-data/state/operations.sqlite3").read_text() == "operation journal"
    assert "SYNC_CONFLICT" in (tmp_path / "kbcli-sync-data/pause.json").read_text()
    assert os.readlink(tmp_path / "hermes-client/python/interpreter") == "/opt/data/kbcli/python/version/bin/python"
    assert not (tmp_path / "hermes-client/bin/kbcli-autosync").exists()
    assert not (tmp_path / "hermes-client/service.env").exists()
    assert "test-agent" not in (tmp_path / "config/kbcli/sync.env").read_text()
    assert (tmp_path / "config/kbcli/api.env").stat().st_mode & 0o777 == 0o600
    assert (tmp_path / "kbcli-runtime/state").is_dir()


def test_existing_destination_is_never_replaced(tmp_path):
    prepare(tmp_path)
    (tmp_path / "knowledge-base").mkdir()
    (tmp_path / "knowledge-base/keep").write_text("keep")
    with pytest.raises(RuntimeError):
        layout.split_layout(tmp_path, {})
    assert (tmp_path / "knowledge-base/keep").read_text() == "keep"
    assert (tmp_path / "hermes-data/knowledge-base/note.md").exists()


def test_image_activation_keeps_hermes_and_removes_legacy_runtime_mounts(monkeypatch):
    import copy
    import sys
    monkeypatch.setitem(sys.modules, "migrate_nas_layout", layout)
    image_spec = importlib.util.spec_from_file_location("nas_image", ROOT / "scripts/activate_nas_image.py")
    image = importlib.util.module_from_spec(image_spec)
    image_spec.loader.exec_module(image)
    original = {"services": {
        "hermes": {"image": "hermes-pinned", "volumes": ["./hermes-data:/opt/data"]},
        "kbcli": {"image": "old", "volumes": ["./kbcli-runtime:/opt/data/kbcli:ro", "./knowledge-base:/opt/data/knowledge-base", "./kbcli-data/state:/opt/data/kbcli/state", "./config/kbcli/ssh:/opt/data/.ssh:ro"], "healthcheck": {}, "env_file": ["./config/kbcli/api.env"]},
        "kbcli-sync": {"image": "old", "volumes": ["./kbcli-runtime/automation:/opt/data/kbcli/automation:ro", "./kbcli-data/state:/opt/data/kbcli/state:ro", "./kbcli-sync-data:/opt/data/kbcli/autosync"], "command": ["old-script", "--token-env", "KBCLI_USER_TOKEN", "run"], "healthcheck": {}, "env_file": ["./config/kbcli/sync.env"]},
    }}
    before = copy.deepcopy(original["services"]["hermes"])
    result = image.image_config(original, "kbcli:test")["services"]
    assert result["hermes"] == before
    assert result["kbcli"]["image"] == result["kbcli-sync"]["image"] == "kbcli:test"
    assert all("runtime" not in v for n in ("kbcli", "kbcli-sync") for v in result[n]["volumes"])
    assert result["kbcli"]["env_file"] == ["./config/kbcli/api.env"]
    assert result["kbcli-sync"]["healthcheck"]["test"][-1] == "health"


def test_rollback_moves_current_data_back_instead_of_restoring_stale_backup(tmp_path, monkeypatch):
    old = prepare(tmp_path)
    source = {"services": {"kbcli": {"environment": {"KBCLI_USER_TOKEN": "test-owner", "KBCLI_AGENT_TOKEN": "test-agent"}}}}
    layout.split_layout(tmp_path, source, uid=os.getuid(), gid=os.getgid())
    (tmp_path / "knowledge-base/note.md").write_text("new content after migration")
    (old / "knowledge-base").mkdir()
    (old / "kbcli").mkdir()
    backup = tmp_path / "backup"
    backup.mkdir()
    (backup / "docker-compose.yaml").write_text("services: {}\n")
    commands = []
    monkeypatch.setattr(layout, "compose", lambda base, *args, **kwargs: commands.append(args) or "")
    layout.rollback(tmp_path, backup)
    assert (old / "knowledge-base/note.md").read_text() == "new content after migration"
    assert (old / "kbcli/state/operations.sqlite3").read_text() == "operation journal"
    assert "SYNC_CONFLICT" in (old / "kbcli/autosync/pause.json").read_text()
    assert commands[0][:2] == ("stop", "-t")
    assert (tmp_path / "docker-compose.yaml").read_text() == "services: {}\n"


def load_client():
    spec = importlib.util.spec_from_file_location("sync_client", ROOT / "deploy/nas/kbcli-autosync-client.py")
    client = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(client)
    return client


def test_hermes_sync_client_does_not_allow_pause_or_resume(tmp_path, capsys):
    client = load_client()
    for action in ("pause", "resume"):
        assert client.main([action], token_file=tmp_path / "missing-secret") == 2
        assert "OPERATOR_ACTION_REQUIRED" in capsys.readouterr().out


def test_hermes_sync_client_status_uses_only_agent_api_and_redacts_failure(tmp_path, monkeypatch, capsys):
    import io
    client = load_client()
    token = tmp_path / "agent-token"
    token.write_text("agent-fixture")
    def reply(request, **kwargs):
        assert request.full_url == "http://kbcli:8765/api/autosync"
        assert request.headers["Authorization"] == "Bearer agent-fixture"
        return io.BytesIO(b'{"ok":true,"state":"idle","worker_alive":true}')
    monkeypatch.setattr(client.urllib.request, "urlopen", reply)
    assert client.main(["status"], token_file=token) == 0
    assert "agent-fixture" not in capsys.readouterr().out
    def fail(*args, **kwargs):
        raise OSError("agent-fixture private failure")
    monkeypatch.setattr(client.urllib.request, "urlopen", fail)
    assert client.main(["status"], token_file=token) == 2
    assert "agent-fixture" not in capsys.readouterr().out


def test_hermes_sync_client_health_observes_pause(tmp_path, monkeypatch, capsys):
    import io
    client = load_client()
    token = tmp_path / "agent-token"
    token.write_text("agent-fixture")
    monkeypatch.setattr(client.urllib.request, "urlopen", lambda *a, **kw: io.BytesIO(b'{"ok":true,"state":"paused","worker_alive":true}'))
    assert client.main(["health"], token_file=token) == 1


@pytest.mark.parametrize("credentials", [None, {"KBCLI_USER_TOKEN": "test-owner"}, {"KBCLI_USER_TOKEN": "invalid\nsecret", "KBCLI_AGENT_TOKEN": "test-agent"}])
def test_invalid_credentials_fail_before_creating_or_moving_anything(tmp_path, credentials):
    old = prepare(tmp_path)
    before = sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*"))
    source = {"services": {"kbcli": {"environment": credentials}}}
    with pytest.raises(RuntimeError, match="credentials|token"):
        layout.split_layout(tmp_path, source, uid=os.getuid(), gid=os.getgid())
    assert sorted(p.relative_to(tmp_path).as_posix() for p in tmp_path.rglob("*")) == before
    assert (old / "knowledge-base/note.md").read_text() == "existing knowledge"


def test_missing_source_or_launcher_is_rejected_without_partial_split(tmp_path):
    old = prepare(tmp_path)
    source = {"services": {"kbcli": {"environment": {"KBCLI_USER_TOKEN": "test-owner", "KBCLI_AGENT_TOKEN": "test-agent"}}}}
    for name in ("missing-launcher.py",):
        with pytest.raises(RuntimeError, match="launcher"):
            layout.split_layout(tmp_path, source, client_launcher=tmp_path / name)
    (old / "kbcli/autosync/pause.json").unlink()
    (old / "kbcli/autosync").rmdir()
    with pytest.raises(RuntimeError, match="Required original directory"):
        layout.split_layout(tmp_path, source)
    assert not (tmp_path / "hermes-client").exists()
    assert (old / "knowledge-base/.git/HEAD").is_file()


def test_broken_destination_link_is_not_followed_or_replaced(tmp_path):
    old = prepare(tmp_path)
    (tmp_path / "knowledge-base").symlink_to(tmp_path / "absent-directory")
    with pytest.raises(RuntimeError, match="Destination exists"):
        layout.split_layout(tmp_path, {})
    assert (tmp_path / "knowledge-base").is_symlink()
    assert (old / "knowledge-base/note.md").is_file()


def test_rollback_checks_all_targets_before_stopping_or_moving(tmp_path, monkeypatch):
    old = prepare(tmp_path)
    source = {"services": {"kbcli": {"environment": {"KBCLI_USER_TOKEN": "test-owner", "KBCLI_AGENT_TOKEN": "test-agent"}}}}
    layout.split_layout(tmp_path, source, uid=os.getuid(), gid=os.getgid())
    (tmp_path / "kbcli-runtime/autosync/unexpected").write_text("keep this")
    backup = tmp_path / "backup"
    backup.mkdir()
    (backup / "docker-compose.yaml").write_text("services: {}\n")
    commands = []
    monkeypatch.setattr(layout, "compose", lambda *a, **kw: commands.append(a))
    with pytest.raises(RuntimeError, match="not empty"):
        layout.rollback(tmp_path, backup)
    assert commands == []
    assert (tmp_path / "knowledge-base/note.md").read_text() == "existing knowledge"
    assert not (old / "knowledge-base").exists()
    assert (tmp_path / "kbcli-data/state/operations.sqlite3").is_file()


def test_image_activation_preserves_an_existing_conflict_pause(tmp_path, monkeypatch):
    import copy
    import json
    import sys
    monkeypatch.setitem(sys.modules, "migrate_nas_layout", layout)
    spec = importlib.util.spec_from_file_location("activation_pause", ROOT / "scripts/activate_nas_image.py")
    image = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(image)
    source = {"services": {
        "hermes": {"image": "hermes-original"},
        "kbcli": {"image": "old", "environment": {"KBCLI_USER_TOKEN": "test-owner", "KBCLI_AGENT_TOKEN": "test-agent"}, "volumes": [], "healthcheck": {}},
        "kbcli-sync": {"image": "old", "volumes": [], "command": ["old.py", "--token-env", "KBCLI_USER_TOKEN", "run"], "healthcheck": {}},
    }}
    (tmp_path / "backups").mkdir()
    (tmp_path / "knowledge-base").mkdir()
    (tmp_path / "knowledge-base/note.md").write_text("keep knowledge")
    (tmp_path / "kbcli-sync-data").mkdir()
    marker = b'{"error":{"code":"SYNC_CONFLICT"}}'
    pause = tmp_path / "kbcli-sync-data/pause.json"
    pause.write_bytes(marker)
    layout.write_yaml(tmp_path / "docker-compose.yaml", source)
    calls = []

    def compose(base, *args, **kwargs):
        calls.append(args)
        return json.dumps(copy.deepcopy(source)) if args == ("config", "--format", "json") else ""

    monkeypatch.setattr(image, "run", lambda *a, **kw: "")
    monkeypatch.setattr(image, "compose", compose)
    monkeypatch.setattr(image, "wait_healthy", lambda *a, **kw: None)
    image.activate(tmp_path, "kbcli:test")
    assert pause.read_bytes() == marker
    assert not any("pause" in args or "resume" in args for args in calls)
    assert (tmp_path / "knowledge-base/note.md").read_text() == "keep knowledge"
    report = json.loads(next((tmp_path / "backups").glob("*/report.json")).read_text())
    assert report["original_pause"] is True
    snapshot = next((tmp_path / "backups").glob("*/report.json")).parent
    assert (snapshot / "knowledge-base/note.md").read_text() == "keep knowledge"
    assert (snapshot / "kbcli-sync-data/pause.json").read_bytes() == marker


def test_image_activation_allows_only_new_immutable_backups_without_overwriting_old_data(monkeypatch):
    import sys
    monkeypatch.setitem(sys.modules, "migrate_nas_layout", layout)
    spec = importlib.util.spec_from_file_location("activation_preservation", ROOT / "scripts/activate_nas_image.py")
    image = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(image)
    identifier = "6cf5fae0-9a6e-42d1-8a3e-2186f10a5488"
    backup = f"assets/app-backups/chrome-kb/devices/{identifier}/{identifier}.json"
    old = {"notes/existing.md": "original"}
    assert image.assert_preserved_knowledge(old, {**old, backup: "new"}) == 1
    for after in [{}, {"notes/existing.md": "changed"}, {**old, "notes/new.md": "new"}, {**old, "assets/app-backups/chrome-kb/devices/bad.json": "new"}]:
        with pytest.raises(RuntimeError):
            image.assert_preserved_knowledge(old, after)
    with pytest.raises(RuntimeError):
        image.assert_preserved_knowledge({**old, backup: "original"}, {**old, backup: "changed"})
