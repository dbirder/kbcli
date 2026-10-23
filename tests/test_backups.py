import base64
import copy
import json
import subprocess
import uuid

import pytest
from fastapi.testclient import TestClient

from kbcli.api import create_app
from kbcli.backups import PREFIX, Backups
from kbcli.errors import KBError
from kbcli.git_sync import Git
from kbcli.operations import Operations
from kbcli.vault import Vault, sha


def payload():
    return {
        "navigation": {"groups": [{"id": "default", "name": "常用"}], "bookmarks": [{"id": "b1", "title": "参考文档", "url": "https://example.org/", "groupId": "default"}], "preferences": {"openInNewTab": True, "showKnowledge": True, "compact": False}},
        "appearance": {"theme": "mist", "dim": 24, "blur": 0, "position": "center", "showClock": True, "engine": "bing", "wallpaper": None},
    }


def request():
    return {"device_id": str(uuid.uuid4()), "backup_id": str(uuid.uuid4()), "device_name": "测试设备", "payload": payload()}


def store(vault):
    return Backups(vault, Operations(vault))


def test_backup_idempotency_devices_and_strict_non_markdown_scope(vault):
    api = store(vault)
    data = request()
    first = api.save(data)
    assert api.save(data)["duplicate"]
    assert len(Operations(vault).pending_writes()) == 1
    assert api.read(data["device_id"], data["backup_id"])["backup"]["payload"] == data["payload"]
    data2 = copy.deepcopy(data)
    data2["device_id"] = str(uuid.uuid4())
    api.save(data2)
    assert len(api.list()["backups"]) == 2
    assert not vault.documents()
    assert not vault.check()["issues"]
    assert first["path"].startswith(PREFIX)
    changed = copy.deepcopy(data)
    changed["payload"]["appearance"]["theme"] = "night"
    with pytest.raises(KBError):
        api.save(changed)
    assert api.read(data["device_id"], data["backup_id"])["backup"]["payload"] == data["payload"]


@pytest.mark.parametrize("change", [
    lambda d: d.update(token="never-write-this"),
    lambda d: d["payload"]["navigation"].update(connection={"token": "never-write-this"}),
    lambda d: d.update(device_id="../notes"),
    lambda d: d.update(backup_id="bad"),
    lambda d: d["payload"]["navigation"]["bookmarks"][0].update(url="javascript:alert(1)"),
    lambda d: d["payload"]["navigation"]["bookmarks"][0].update(url="https://user:secret@example.org/"),
    lambda d: d["payload"]["appearance"].update(dim=True),
    lambda d: d["payload"]["appearance"].update(wallpaper={"name": "bad", "dataURL": "data:image/svg+xml;base64,YQ=="}),
])
def test_invalid_backup_cannot_create_files(vault, change):
    api = store(vault)
    data = request()
    change(data)
    with pytest.raises(KBError):
        api.save(data)
    assert not (vault.root / PREFIX).exists()
    assert not Operations(vault).pending_writes()


def test_wallpaper_deduplication_and_tamper_detection(vault):
    api = store(vault)
    data = request()
    image = "data:image/webp;base64," + base64.b64encode(b"RIFF" + b"0000" + b"WEBP" + b"test").decode()
    data["payload"]["appearance"]["wallpaper"] = {"name": "sample.webp", "dataURL": image}
    api.save(data)
    data["backup_id"] = str(uuid.uuid4())
    api.save(data)
    assets = list((vault.root / PREFIX / "wallpapers").glob("*.json"))
    assert len(assets) == 1
    assert len(Operations(vault).pending_writes()) == 3
    restored = api.read(data["device_id"], data["backup_id"])["backup"]["payload"]
    assert restored == data["payload"]
    assets[0].write_text('{"dataURL":"bad"}')
    with pytest.raises(KBError):
        api.read(data["device_id"], data["backup_id"])


def test_paths_symlinks_and_journal_recovery(vault, tmp_path):
    api = store(vault)
    data = request()
    saved = api.save(data)
    ops = Operations(vault)
    with ops.database() as db:
        db.execute("UPDATE operations SET state='prepared'")
    assert not Operations(vault).recovery_pending()
    assert len(Operations(vault).pending_writes()) == 1
    with pytest.raises(KBError):
        ops.write_backup("notes/no.json", "{}", kind="chrome_backup")
    root = vault.root / PREFIX
    moved = tmp_path / "moved"
    root.rename(moved)
    root.symlink_to(moved, target_is_directory=True)
    with pytest.raises(KBError):
        api.read(data["device_id"], data["backup_id"])
    assert saved["saved"]


def test_backup_auth_body_limit_and_reads(vault):
    with TestClient(create_app(vault, "test-owner", agent_token="test-agent")) as client:
        data = request()
        for token, code in [("test-agent", 403), ("bad", 401)]:
            headers = {"Authorization": f"Bearer {token}"}
            assert client.post("/api/backups/chrome", json=data, headers=headers).status_code == code
            assert client.get("/api/backups/chrome", headers=headers).status_code == code
        headers = {"Authorization": "Bearer test-owner"}
        assert client.post("/api/backups/chrome", json=data, headers=headers).json()["saved"]
        assert client.post("/api/backups/chrome", json=data, headers=headers).json()["duplicate"]
        assert len(client.get("/api/backups/chrome", headers=headers).json()["backups"]) == 1
        path = f'/api/backups/chrome/{data["device_id"]}/{data["backup_id"]}'
        assert client.get(path, headers=headers).json()["backup"]["payload"] == data["payload"]
        assert client.get(path, headers={"Authorization": "Bearer test-agent"}).status_code == 403
        assert client.post("/api/backups/chrome", content=b"x" * (4 * 1024 * 1024 + 1), headers=headers).status_code == 413


def git(root, *args):
    return subprocess.check_output(["git", "-C", str(root), *args], text=True).strip()


def test_backup_recorded_git_push_pull_and_tamper_pause(vault, tmp_path):
    remote = tmp_path / "remote.git"
    subprocess.run(["git", "init", "--bare", "--initial-branch=main", str(remote)], check=True, capture_output=True)
    git(vault.root, "init", "--initial-branch=main")
    git(vault.root, "config", "user.name", "test")
    git(vault.root, "config", "user.email", "test@example.invalid")
    git(vault.root, "add", ".")
    git(vault.root, "commit", "-m", "init")
    git(vault.root, "remote", "add", "origin", str(remote))
    git(vault.root, "push", "-u", "origin", "main")
    other = tmp_path / "clone"
    subprocess.run(["git", "clone", str(remote), str(other)], check=True, capture_output=True)
    api = store(vault)
    data = request()
    api.save(data)
    assert Git(vault).sync(commit_tools=True)["synced"]
    assert git(vault.root, "status", "--porcelain") == ""
    second = Vault(other, tmp_path / "second-state")
    assert Git(second).sync()["synced"]
    assert store(second).read(data["device_id"], data["backup_id"])["backup"]["payload"] == data["payload"]
    data["backup_id"] = str(uuid.uuid4())
    saved = api.save(data)
    path = vault.safe(saved["path"])
    path.write_text(path.read_text() + " ")
    before = git(vault.root, "rev-parse", "HEAD")
    with pytest.raises(KBError) as exc:
        Git(vault).sync(commit_tools=True)
    assert exc.value.code == "UNKNOWN_MODIFICATION"
    assert git(vault.root, "rev-parse", "HEAD") == before
    assert sha(path.read_bytes()) != Operations(vault).pending_writes()[0]["after_hash"]
    assert json.loads(path.read_text())["backup_id"] == data["backup_id"]


def test_per_bookmark_icons_roundtrip_and_reject_invalid_data(vault):
    api = store(vault)
    icon = {"mode": "image", "dataURL": "data:image/webp;base64," + base64.b64encode(b"RIFF0000WEBPtest").decode(), "sourceURL": "https://images.example/icon.webp"}
    data = request()
    data["payload"]["navigation"]["bookmarks"][0]["icon"] = icon
    api.save(data)
    assert api.read(data["device_id"], data["backup_id"])["backup"]["payload"] == data["payload"]
    data["backup_id"] = str(uuid.uuid4())
    data["payload"]["navigation"]["bookmarks"][0]["icon"] = {"mode": "text", "text": "文档", "color": "#2c756a"}
    api.save(data)
    assert api.read(data["device_id"], data["backup_id"])["backup"]["payload"] == data["payload"]
    for bad in [dict(icon, sourceURL="javascript:alert(1)"), dict(icon, dataURL="data:image/svg+xml;base64,AA=="), dict(icon, token="private"), {"mode": "text", "text": "三个字", "color": "#2c756a"}]:
        data["backup_id"] = str(uuid.uuid4())
        data["payload"]["navigation"]["bookmarks"][0]["icon"] = bad
        with pytest.raises(KBError):
            api.save(data)


def test_backup_accepts_zero_and_user_named_groups_without_default(vault):
    api = store(vault)
    data = request()
    data["payload"]["navigation"].update(groups=[], bookmarks=[])
    api.save(data)
    assert api.read(data["device_id"], data["backup_id"])["backup"]["payload"] == data["payload"]
    data = request()
    nav = data["payload"]["navigation"]
    nav["groups"] = [{"id": "user-work", "name": "手动创建"}]
    nav["bookmarks"][0]["groupId"] = "user-work"
    api.save(data)
    assert api.read(data["device_id"], data["backup_id"])["backup"]["payload"] == data["payload"]
    invalid = request()
    invalid["payload"]["navigation"]["groups"] = []
    with pytest.raises(KBError):
        api.save(invalid)
