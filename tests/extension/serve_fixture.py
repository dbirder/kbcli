"""Local-only browser fixture. Real kbcli endpoints, synthetic Chrome APIs and sample content."""

import argparse
import time
from pathlib import Path

import uvicorn
from fastapi import Response
from fastapi.staticfiles import StaticFiles

from kbcli.api import create_app
from kbcli.operations import Operations
from kbcli.vault import Vault

ROOT = Path(__file__).resolve().parents[2]

parser = argparse.ArgumentParser()
parser.add_argument("--workspace", type=Path, required=True)
parser.add_argument("--port", type=int, default=18767)
args = parser.parse_args()
base = args.workspace.resolve()
base.mkdir(parents=True, exist_ok=True)
root = base / "vault"
if not root.exists():
    Vault.initialize(root)
vault = Vault(root, base / "state")
ops = Operations(vault)
if not vault.documents():
    for title, due, tags in [
        ("整理本周的项目会议记录", "2026-10-20", ["工作"]),
        ("读完 Git 同步方案的参考资料", "2026-10-18", ["阅读", "知识库"]),
        ("检查 NAS 附件的独立备份", "2026-10-15", ["NAS"]),
    ]:
        ops.create(title, template="task", metadata={"due": due, "tags": tags}, actor="ai")
    finished = ops.create("搭好知识库目录与规范", template="task", actor="ai")
    ops.task_done(finished["id"], finished["file_hash"])
# Rich, synthetic reading fixtures; never copied into the extension package.
if not any(doc.path == "notes/阅读器-关联笔记.md" for doc in vault.documents()):
    related = ops.create("知识库整理清单", path="notes/阅读器-关联笔记.md", actor="ai")
    ops.patch(related["id"], {"body": "## 下一次回顾\n\n先整理 inbox，再复习 notes。\n"}, expect_hash=related["file_hash"], actor="ai")
if not any(doc.path == "notes/阅读器-展示示例.md" for doc in vault.documents()):
    article = ops.create("从收集到沉淀：我的知识库工作流", path="notes/阅读器-展示示例.md", metadata={"tags": ["知识管理", "实践"]}, actor="ai")
    ops.patch(article["id"], {"body": (ROOT / "tests/extension/fixtures/article.md").read_text()}, expect_hash=article["file_hash"], actor="ai")
sync = base / "autosync"
sync.mkdir(exist_ok=True)
(sync / "status.json").write_text(
    __import__("json").dumps(
        {
            "state": "idle",
            "heartbeat": time.time(),
            "poll_seconds": 5,
            "pull_seconds": 60,
            "last_success_at": "2026-10-18T04:00:00Z",
            "next_attempt_at": "2026-10-18T04:01:00Z",
        }
    )
)
app = create_app(vault, "ui-test-user", agent_token="ui-test-agent", autosync_dir=sync)
html = (
    (ROOT / "extensions/chrome-kb/newtab.html")
    .read_text()
    .replace('src="app.mjs"', 'src="/__test_bootstrap.mjs"')
)


@app.get("/")
@app.get("/newtab.html")
def page():
    return Response(html, media_type="text/html")


@app.get("/__test_bootstrap.mjs")
def bootstrap():
    return Response(
        (ROOT / "tests/extension/chrome-shim.mjs").read_text(), media_type="text/javascript"
    )


@app.get("/popup.html")
def popup():
    source = (ROOT / "extensions/chrome-kb/popup.html").read_text()
    return Response(source.replace('src="popup.mjs"', 'src="/__test_bootstrap.mjs"'), media_type="text/html")


@app.post("/__test/conflict/{identifier}")
def conflict(identifier: str):
    doc = vault.find(identifier)
    return ops.patch(
        identifier,
        {"set": {"title": doc.title + "（NAS 新版本）"}},
        expect_hash=doc.file_hash,
        actor="ai",
    )


@app.post("/__test/pause")
def pause():
    (sync / "pause.json").write_text('{"error":{"code":"SYNC_CONFLICT"}}')
    return {"ok": True}


# Opt-in persistent icon fixture. No production origin or credentials are used.
icon_test_state = {"offline": False, "variant": 0, "chrome": 0, "site": 0}


@app.get("/__icon_test_worker.mjs")
def icon_worker():
    return Response((ROOT / "tests/extension/icon-test-worker.mjs").read_text(), media_type="text/javascript")


@app.get("/__test/icon/state")
def icon_state():
    return icon_test_state


@app.post("/__test/icon/control/{offline}/{variant}")
def icon_control(offline: int, variant: int):
    icon_test_state.update(offline=bool(offline), variant=variant)
    return icon_test_state


@app.get("/__test/icon/source/{source}")
def icon_source(source: str):
    if source not in {"chrome", "site"}:
        return Response(status_code=404)
    icon_test_state[source] += 1
    if icon_test_state["offline"]:
        return Response(status_code=503)
    color = "#2080e0" if icon_test_state["variant"] == 0 else "#20c050"
    return Response(f'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="{color}"/></svg>', media_type="image/svg+xml", headers={"Cache-Control": "no-store"})


@app.get("/__test/audit/{kind}")
def audit_response(kind: str):
    if kind == "slow":
        time.sleep(0.6)
    code = {"missing": 404, "blocked": 403, "server": 503}.get(kind, 200)
    title = "Just a moment..." if kind == "challenge" else "TEST ONLY audit response"
    return Response(f"<html><title>{title}</title><body>TEST ONLY</body></html>", status_code=code, media_type="text/html")


app.mount("/", StaticFiles(directory=ROOT / "extensions/chrome-kb"), name="extension-assets")
uvicorn.run(app, host="127.0.0.1", port=args.port)
