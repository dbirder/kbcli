"""NAS Docker acceptance: isolated HTTP writes and two Git replicas, no production knowledge writes."""
import argparse
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path


def shell(*args, timeout=90):
    return subprocess.check_output(args, text=True, stderr=subprocess.PIPE, timeout=timeout).strip()


def wait_for(predicate, label, timeout=60):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            value = predicate()
            if value:
                return value
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(1)
    raise RuntimeError(f"Timed out: {label}")


def verify(base, image, keep_api=False):
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ").lower()
    root = base / "tests" / ("image-acceptance-" + stamp)
    root.mkdir(parents=True, mode=0o700)
    os.chown(root, 10000, 10000)
    api_name = "kbcli-test-api-" + stamp
    worker_name = "kbcli-test-sync-" + stamp
    production_id = shell("docker", "compose", "--project-directory", str(base), "ps", "-q", "kbcli")
    networks = json.loads(shell("docker", "inspect", production_id))[0]["NetworkSettings"]["Networks"]
    network = next(iter(networks))
    mount = str(root) + ":/acceptance"
    report = {"workspace": str(root), "api_container": api_name, "worker_container": worker_name,
              "image": image, "tests": {}, "port": 18770}

    def helper(code, *args):
        return shell("docker", "run", "--rm", "--network", "none", "-v", mount, image, "-c", code, *args)

    def request(path, body=None, *, method="GET", agent=False):
        headers = {"Authorization": "Bearer " + ("ui-test-agent" if agent else "ui-test-user")}
        if body is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request("http://127.0.0.1:18770" + path, headers=headers,
                                     data=json.dumps(body).encode() if body is not None else None, method=method)
        with urllib.request.urlopen(req, timeout=15) as response:
            return json.load(response)

    worker_args = ["docker", "run", "-d", "--name", worker_name, "--network", network, "-v", mount,
                   "-e", "KBCLI_USER_TOKEN=ui-test-user", image, "/opt/app/nas_autosync.py",
                   "--server", "http://" + api_name + ":8765", "--token-env", "KBCLI_USER_TOKEN",
                   "--journal", "/acceptance/state/operations.sqlite3", "--state-dir", "/acceptance/sync",
                   "--poll", "1", "--pull", "2", "run"]
    try:
        helper("""
from pathlib import Path
import subprocess
from kbcli.vault import Vault
p=Path('/acceptance');Vault.initialize(p/'vault')
def git(*args): return subprocess.check_output(['git',*args],stderr=subprocess.PIPE,text=True).strip()
git('init','--bare',str(p/'remote.git'));git('init','-b','main',str(p/'vault'))
for key,value in [('user.name','KBCLI TEST ONLY'),('user.email','test@example.invalid')]: git('-C',str(p/'vault'),'config',key,value)
git('-C',str(p/'vault'),'add','.');git('-C',str(p/'vault'),'commit','-m','TEST ONLY initial')
git('-C',str(p/'vault'),'remote','add','origin',str(p/'remote.git'));git('-C',str(p/'vault'),'push','-u','origin','main')
git('--git-dir',str(p/'remote.git'),'symbolic-ref','HEAD','refs/heads/main')
git('clone',str(p/'remote.git'),str(p/'peer'))
for key,value in [('user.name','KBCLI TEST ONLY peer'),('user.email','test@example.invalid')]: git('-C',str(p/'peer'),'config',key,value)
""")
        initial = (root / "remote.git/refs/heads/main").read_text().strip()
        shell("docker", "run", "-d", "--name", api_name, "--network", network, "-v", mount,
              "-p", "127.0.0.1:18770:8765", "-e", "KBCLI_USER_TOKEN=ui-test-user", "-e", "KBCLI_AGENT_TOKEN=ui-test-agent",
              "-e", "KBCLI_AUTOSYNC_STATE_DIR=/acceptance/sync", image, "-m", "kbcli", "--vault", "/acceptance/vault",
              "--state-dir", "/acceptance/state", "serve", "--host", "0.0.0.0", "--port", "8765")
        wait_for(lambda: request("/api/status").get("role") == "human", "test API")
        shell(*worker_args)
        task = request("/api/tasks", {"title": "TEST ONLY migration acceptance", "tags": ["test"], "due": "2026-10-20"}, method="POST", agent=True)
        identifier = task["id"]
        wait_for(lambda: (root / "remote.git/refs/heads/main").read_text().strip() != initial, "automatic commit and push")
        report["tests"]["automatic_commit_push"] = True
        helper("""
from pathlib import Path
import subprocess,sys
from kbcli.vault import Vault
from kbcli.operations import Operations
p=Path('/acceptance');subprocess.run(['git','-C',str(p/'peer'),'pull','--ff-only'],check=True,capture_output=True)
v=Vault(p/'peer',p/'peer-state');doc=v.find(sys.argv[1]);Operations(v).patch(doc.metadata['id'],{'set':{'title':'TEST ONLY peer update'}},expect_hash=doc.file_hash,actor='human')
for args in [('add','.'),('commit','-m','TEST ONLY peer update'),('push',)]: subprocess.run(['git','-C',str(p/'peer'),*args],check=True,capture_output=True)
""", identifier)
        def updated():
            values = request("/api/tasks")["tasks"]
            return next((t for t in values if t["id"] == identifier and t["title"] == "TEST ONLY peer update"), None)
        current = wait_for(updated, "periodic remote pull")
        report["tests"]["periodic_pull"] = True
        request("/api/tasks/" + identifier, {"expect_hash": current["file_hash"], "changes": {"due": None}}, method="PATCH")
        current = next(t for t in request("/api/tasks")["tasks"] if t["id"] == identifier)
        assert current.get("due") is None
        try:
            request("/api/tasks/" + identifier, {"expect_hash": current["file_hash"], "changes": {"status": "done"}}, method="PATCH", agent=True)
            raise AssertionError("Agent unexpectedly completed a task")
        except urllib.error.HTTPError as exc:
            assert exc.code == 403
        request("/api/tasks/" + identifier, {"expect_hash": current["file_hash"], "changes": {"status": "done"}}, method="PATCH")
        done = next(t for t in request("/api/tasks")["tasks"] if t["id"] == identifier)
        assert done["status"] == "done" and done["review_status"] == "pending"
        report["tests"]["task_edit_complete_and_agent_boundary"] = True
        wait_for(lambda: request("/api/status").get("pending_tool_writes") == [], "last tool write committed")
        shell("docker", "stop", "-t", "60", worker_name)
        shell("docker", "rm", worker_name)
        helper("""
import subprocess
for directory,args in [('peer',['pull','--ff-only']),('vault',['commit','--allow-empty','-m','TEST ONLY local fork']),('peer',['commit','--allow-empty','-m','TEST ONLY remote fork']),('peer',['push'])]:
 subprocess.run(['git','-C','/acceptance/'+directory,*args],check=True,capture_output=True)
""")
        local_head = (root / "vault/.git/refs/heads/main").read_text().strip()
        remote_head = (root / "remote.git/refs/heads/main").read_text().strip()
        shell(*worker_args)
        pause = root / "sync/pause.json"
        wait_for(lambda: pause.exists(), "divergence pause")
        marker = pause.read_bytes()
        assert json.loads(marker)["error"]["code"] == "SYNC_CONFLICT"
        assert (root / "vault/.git/refs/heads/main").read_text().strip() == local_head
        assert (root / "remote.git/refs/heads/main").read_text().strip() == remote_head
        shell("docker", "restart", "-t", "60", worker_name)
        wait_for(lambda: json.loads((root / "sync/status.json").read_text()).get("state") == "paused", "restart pause")
        assert pause.read_bytes() == marker
        report["tests"]["conflict_preserves_heads_and_pause_survives_restart"] = True
        report["ok"] = True
        (root / "report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report))
    finally:
        subprocess.run(["docker", "rm", "-f", worker_name], capture_output=True)
        if not keep_api or not report.get("ok"):
            subprocess.run(["docker", "rm", "-f", api_name], capture_output=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-dir", type=Path, required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--keep-api", action="store_true", help="Keep only the isolated API for browser tests")
    args = parser.parse_args()
    verify(args.compose_dir.resolve(), args.image, args.keep_api)
