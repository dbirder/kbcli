import json

from fastapi.testclient import TestClient

from kbcli.api import create_app
from kbcli.autosync_status import observe
from kbcli.operations import Operations


def test_task_edit_clear_due_reopen_and_completion_review(vault):
    created = Operations(vault).create(
        "原始待办", template="task", metadata={"due": "2026-10-18"}, actor="ai"
    )
    human = {"Authorization": "Bearer user"}
    with TestClient(create_app(vault, "user", agent_token="agent")) as client:
        assert client.get("/api/status", headers=human).json()["role"] == "human"
        assert (
            client.get("/api/status", headers={"Authorization": "Bearer agent"}).json()["role"]
            == "ai"
        )
        edited = client.patch(
            "/api/tasks/" + created["id"],
            headers=human,
            json={
                "expect_hash": created["file_hash"],
                "changes": {"title": "已修改", "due": None, "tags": ["测试"], "status": "doing"},
            },
        )
        assert edited.status_code == 200, edited.text
        assert "due" not in vault.find(created["id"]).metadata
        done = client.patch(
            "/api/tasks/" + created["id"],
            headers=human,
            json={"expect_hash": edited.json()["file_hash"], "changes": {"status": "done"}},
        ).json()
        assert done["review_status"] == "pending"
        assert vault.find(created["id"]).metadata["completed_at"]
        reopened = client.patch(
            "/api/tasks/" + created["id"],
            headers=human,
            json={"expect_hash": done["file_hash"], "changes": {"status": "todo"}},
        )
        assert reopened.status_code == 200
        assert "completed_at" not in vault.find(created["id"]).metadata
        stale = client.patch(
            "/api/tasks/" + created["id"],
            headers=human,
            json={"expect_hash": created["file_hash"], "changes": {"title": "不能覆盖"}},
        )
        assert stale.status_code == 409
        assert vault.find(created["id"]).title == "已修改"


def test_autosync_api_is_authenticated_read_only_and_portable(vault, tmp_path):
    state = tmp_path / "autosync"
    state.mkdir()
    status = state / "status.json"
    status.write_text(
        json.dumps(
            {
                "state": "idle",
                "heartbeat": 1000,
                "last_success_at": "2026-10-18T04:00:00Z",
                "poll_seconds": 5,
                "pull_seconds": 60,
                "last_error": {
                    "code": "SYNC_OFFLINE",
                    "message": "secret /root/private KEY=do-not-send",
                    "details": {"credential": "hidden"},
                },
                "private": "hidden",
            }
        )
    )
    pause = state / "pause.json"
    pause.write_text(
        json.dumps(
            {
                "paused_at": "2026-10-18T04:01:00Z",
                "error": {"code": "SYNC_CONFLICT", "message": "secret path /root/private"},
            }
        )
    )
    before = {p.name: p.read_bytes() for p in state.iterdir()}
    with TestClient(create_app(vault, "user", agent_token="agent", autosync_dir=state)) as client:
        assert client.get("/api/autosync").status_code == 401
        value = client.get("/api/autosync", headers={"Authorization": "Bearer user"}).json()
        assert value["state"] == "paused" and value["paused"]
        assert value["pause"]["error"]["code"] == "SYNC_CONFLICT"
        assert not any(
            word in json.dumps(value) for word in ("secret", "hidden", "/root", "credential")
        )
        assert (
            client.get("/api/autosync", headers={"Authorization": "Bearer agent"}).status_code
            == 200
        )
    assert before == {p.name: p.read_bytes() for p in state.iterdir()}


def test_autosync_unconfigured_missing_corrupt_and_stale(tmp_path):
    assert observe(None)["state"] == "not_configured"
    state = tmp_path / "not-created"
    assert observe(state)["state"] == "not_started"
    assert not state.exists()
    state.mkdir()
    (state / "status.json").write_text('{"state":"idle","heartbeat":100}')
    assert observe(state, now=500)["state"] == "stale"
    assert observe(state, now=110)["state"] == "idle"
    (state / "pause.json").write_text("broken")
    assert not observe(state)["observed"]
    assert (state / "pause.json").read_text() == "broken"
