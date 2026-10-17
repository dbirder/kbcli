import json

import pytest
from fastapi.testclient import TestClient
from typer.testing import CliRunner

from kbcli.api import create_app
from kbcli.cli import app
from kbcli.operations import Operations


def test_cli_json_and_arguments(vault):
    runner = CliRunner()
    base = ["--vault", str(vault.root), "--state-dir", str(vault.state)]
    created = runner.invoke(app, base + ["task", "add", "同步验证", "--actor", "ai", "--json"])
    assert created.exit_code == 0, created.output
    data = json.loads(created.stdout)
    read = runner.invoke(app, base + ["read", data["id"]])
    assert read.exit_code == 0, read.output
    assert json.loads(read.stdout)["file_hash"] == data["file_hash"]
    found = runner.invoke(app, base + ["search", "同步", "--fresh", "--json"])
    assert found.exit_code == 0, found.output
    assert json.loads(found.stdout)["results"]
    done = runner.invoke(app, base + ["task", "done", data["id"]])
    assert done.exit_code == 0, done.output
    assert json.loads(done.stdout)["review_status"] == "pending"
    broken = runner.invoke(app, base + ["task", "add", "错误", "--due", "2026-02-30"])
    assert broken.exit_code == 2
    assert json.loads(broken.stdout)["error"]["code"] == "SCHEMA_INVALID"


def test_api_auth_identity_completion_and_stale_version(vault):
    created = Operations(vault).create("API 待办", template="task", actor="ai")
    with TestClient(
        create_app(vault, "user-secret", agent_token="agent-secret", interval=0.2)
    ) as client:
        assert client.get("/api/tasks").status_code == 401
        human = {"Authorization": "Bearer user-secret"}
        ai = {"Authorization": "Bearer agent-secret"}
        request = {"expect_hash": created["file_hash"], "changes": {"status": "done"}}
        assert (
            client.patch("/api/tasks/" + created["id"], json=request, headers=ai).status_code == 403
        )
        fake = {**request, "actor": "human"}
        assert client.patch("/api/tasks/" + created["id"], json=fake, headers=ai).status_code == 422
        done = client.patch("/api/tasks/" + created["id"], json=request, headers=human)
        assert done.status_code == 200, done.text
        assert done.json()["review_status"] == "pending"
        assert (
            client.patch("/api/tasks/" + created["id"], json=request, headers=human).status_code
            == 409
        )
        items = client.get("/api/tasks?status=done", headers=human).json()
        assert items["tasks"][0]["status"] == "done"
        assert client.get("/api/search?q=待办&fresh=true", headers=ai).json()["results"]
        assert client.get("/api/read?path=../outside.md", headers=human).status_code == 403


def test_api_requires_explicit_auth_config(vault):
    with pytest.raises(Exception):
        create_app(vault, "")


def test_remote_cli_uses_service_identity_without_local_writer(vault, monkeypatch):
    from kbcli import client as client_module

    with TestClient(create_app(vault, "human-token", agent_token="ai-token")) as server:

        def bridge(url, token, command, params):
            response = server.post(
                "/api/command",
                headers={"Authorization": "Bearer " + token},
                json={"command": command, "params": params},
            )
            value = response.json()
            if not value["ok"]:
                from kbcli.errors import KBError

                raise KBError(value["error"]["code"], value["error"]["message"])
            return value

        monkeypatch.setattr(client_module, "request", bridge)
        monkeypatch.setenv("KBCLI_TOKEN", "ai-token")
        runner = CliRunner()
        options = ["--server", "http://local-service"]
        created = runner.invoke(app, options + ["task", "add", "远端任务", "--actor", "human"])
        assert created.exit_code == 0, created.output
        record = json.loads(created.stdout)
        assert vault.find(record["id"]).metadata["created_by"] == "ai"
        denied = runner.invoke(
            app, options + ["task", "done", record["id"], "--expect-hash", record["file_hash"]]
        )
        assert denied.exit_code == 2
        monkeypatch.setenv("KBCLI_TOKEN", "human-token")
        done = runner.invoke(
            app, options + ["task", "done", record["id"], "--expect-hash", record["file_hash"]]
        )
        assert done.exit_code == 0, done.output
        assert json.loads(done.stdout)["review_status"] == "pending"
        assert (
            server.post(
                "/api/command",
                headers={"Authorization": "Bearer ai-token"},
                json={"command": "shell", "params": {"cmd": "echo bad"}},
            ).status_code
            == 400
        )


def test_rpc_invalid_params_do_not_leak_traceback(vault):
    with TestClient(create_app(vault, "test-user")) as server:
        response = server.post(
            "/api/command",
            headers={"Authorization": "Bearer test-user"},
            json={"command": "create", "params": {}},
        )
        assert response.status_code == 400
        assert response.json()["error"]["code"] == "REQUEST_INVALID"
        invalid = server.post(
            "/api/command",
            headers={"Authorization": "Bearer test-user"},
            json={"command": "create", "params": {"title": "错误", "metadata": ["foo"]}},
        )
        assert invalid.status_code == 400
        assert invalid.json()["error"]["code"] == "REQUEST_INVALID"


def test_remote_mode_does_not_initialize_local_vault(tmp_path):
    root = tmp_path / "do-not-create"
    value = CliRunner().invoke(app, ["--server", "http://local", "--vault", str(root), "init"])
    assert value.exit_code == 2
    assert not root.exists()
