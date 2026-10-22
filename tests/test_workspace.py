import copy
import json
import uuid
from concurrent.futures import ThreadPoolExecutor

import pytest
from fastapi.testclient import TestClient
from test_backups import payload
from test_git import git, git_pair  # noqa: F401

from kbcli.api import create_app
from kbcli.backups import PREFIX, Backups, canonical
from kbcli.errors import KBError
from kbcli.git_sync import Git
from kbcli.operations import Operations
from kbcli.vault import Vault
from kbcli.workspace import Workspace


def proposal(base=None):
    return {"device_id": str(uuid.uuid4()), "device_name": "workspace test", "request_id": str(uuid.uuid4()), "base_revision": base, "payload": payload()}


def service(vault):
    return Workspace(vault, Operations(vault))


def test_shared_publish_read_increment_and_ack(vault):
    api = service(vault)
    assert api.read()["head"] is None
    first = proposal()
    response = api.publish(first)
    assert response["revision"]["revision"] == first["request_id"]
    assert api.publish(first)["duplicate"]
    second = proposal(first["request_id"])
    second["payload"]["appearance"]["theme"] = "night"
    api.publish(second)
    assert api.publish(first)["duplicate"]
    latest = api.read(first["request_id"], second["request_id"])
    assert latest["unchanged"] and "payload" not in latest["head"]
    assert latest["acknowledged"]["revision"] == first["request_id"]
    assert api.read()["head"]["payload"] == second["payload"]
    assert len(Backups(vault, Operations(vault)).list()["backups"]) == 2


def test_stale_write_preserves_both_without_overwrite(vault):
    api = service(vault)
    first = proposal()
    api.publish(first)
    stale = proposal()
    stale["payload"]["navigation"]["bookmarks"][0]["title"] = "offline device data"
    with pytest.raises(KBError) as exc:
        api.publish(stale)
    assert exc.value.code == "WORKSPACE_CHANGED"
    assert api.read()["head"]["payload"] == first["payload"]
    assert Backups(vault, Operations(vault)).read(stale["device_id"], stale["request_id"])["backup"]["payload"] == stale["payload"]
    with pytest.raises(KBError):
        api.publish(stale)
    assert len(Backups(vault, Operations(vault)).list()["backups"]) == 2


def test_two_simultaneous_initial_writers_have_one_winner(vault):
    api = service(vault)
    requests = [proposal(), proposal()]
    requests[1]["payload"]["appearance"]["engine"] = "google"

    def publish(value):
        try:
            return api.publish(value)["saved"]
        except KBError as exc:
            return exc.code

    with ThreadPoolExecutor(max_workers=2) as pool:
        values = list(pool.map(publish, requests))
    assert sorted(map(str, values)) == ["True", "WORKSPACE_CHANGED"]
    assert len(Backups(vault, Operations(vault)).list()["backups"]) == 2
    assert len(list((vault.root / PREFIX / "shared").glob("*.json"))) == 1


def test_explicit_resolution_uses_reviewed_remote_revision(vault):
    api = service(vault)
    first = proposal()
    api.publish(first)
    stale = proposal()
    with pytest.raises(KBError):
        api.publish(stale)
    resolved = proposal(first["request_id"])
    resolved["payload"]["appearance"]["engine"] = "baidu"
    api.publish(resolved)
    assert api.read()["head"]["payload"] == resolved["payload"]
    assert len(Backups(vault, Operations(vault)).list()["backups"]) == 3


def test_fork_missing_parent_and_tamper_pause(vault):
    api = service(vault)
    first = proposal()
    api.publish(first)
    file = vault.root / PREFIX / "shared" / (first["request_id"] + ".json")
    raw = json.loads(file.read_text())
    fork = copy.deepcopy(raw)
    fork["revision"] = str(uuid.uuid4())
    file2 = file.with_name(fork["revision"] + ".json")
    Operations(vault).write_backup(str(file2.relative_to(vault.root)), canonical(fork), kind="chrome_workspace")
    with pytest.raises(KBError) as exc:
        api.read()
    assert exc.value.code == "WORKSPACE_FORK"
    file2.unlink()
    api.read()
    raw["payload"]["appearance"]["dim"] = 50
    file.write_text(canonical(raw))
    with pytest.raises(KBError) as exc:
        api.read(known_revision=first["request_id"])
    assert exc.value.code == "WORKSPACE_INVALID"


def test_missing_parent_and_symlink_are_not_followed(vault, tmp_path):
    api = service(vault)
    first = proposal()
    api.publish(first)
    second = proposal(first["request_id"])
    api.publish(second)
    (vault.root / PREFIX / "shared" / (first["request_id"] + ".json")).unlink()
    with pytest.raises(KBError):
        api.read()
    root = vault.root / PREFIX / "shared"
    root.rename(tmp_path / "shared")
    root.symlink_to(tmp_path / "shared", target_is_directory=True)
    with pytest.raises(KBError):
        api.publish(proposal())


@pytest.mark.parametrize("change", [lambda r: r.update(token="secret"), lambda r: r.update(base_revision="../notes"), lambda r: r.update(request_id="bad"), lambda r: r["payload"]["appearance"].update(connection={"token": "secret"})])
def test_invalid_requests_cannot_write_shared_state(vault, change):
    value = proposal()
    change(value)
    with pytest.raises(KBError):
        service(vault).publish(value)
    assert not (vault.root / PREFIX).exists()


def test_http_owner_boundary_cas_and_body_limit(vault):
    with TestClient(create_app(vault, "test-user", agent_token="test-agent")) as client:
        for token, expected in [("bad", 401), ("test-agent", 403)]:
            headers = {"Authorization": "Bearer " + token}
            assert client.get("/api/workspace/chrome", headers=headers).status_code == expected
            assert client.post("/api/workspace/chrome", json=proposal(), headers=headers).status_code == expected
        headers = {"Authorization": "Bearer test-user"}
        assert client.post("/api/workspace/chrome", json=proposal(), headers=headers).status_code == 200
        value = proposal()
        assert client.post("/api/workspace/chrome", json=value, headers=headers).status_code == 409
        assert client.get(f'/api/backups/chrome/{value["device_id"]}/{value["request_id"]}', headers=headers).json()["backup"]["payload"] == value["payload"]
        assert client.post("/api/workspace/chrome", content=b"x" * (4 * 1024 * 1024 + 1), headers=headers).status_code == 413


def test_shared_revision_journal_recovery_and_git_roundtrip(request):
    first, second = request.getfixturevalue("git_pair")
    api = service(first)
    value = proposal()
    api.publish(value)
    ops = Operations(first)
    with ops.database() as db:
        db.execute("UPDATE operations SET state='prepared'")
    assert not Operations(first).recovery_pending()
    assert Git(first).sync(commit_tools=True)["synced"]
    assert git(first.root, "status", "--porcelain") == ""
    assert Git(second).sync()["synced"]
    assert service(second).read()["head"]["payload"] == value["payload"]
    assert not Vault(second.root, second.state).check()["issues"]


def test_shared_workspace_preserves_per_bookmark_icon(vault):
    api = service(vault)
    first = proposal()
    first["payload"]["navigation"]["bookmarks"][0]["icon"] = {"mode": "text", "text": "文档", "color": "#2c756a"}
    api.publish(first)
    assert api.read()["head"]["payload"] == first["payload"]
    assert Backups(vault, Operations(vault)).read(first["device_id"], first["request_id"])["backup"]["payload"] == first["payload"]
