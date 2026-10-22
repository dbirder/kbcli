"""Switch a separated NAS layout to a locally built kbcli image; preserve data and tokens."""
import argparse
import json
import re
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from migrate_nas_layout import compose, knowledge_hashes, load_yaml, run, write_yaml


def image_config(config, image):
    api = config["services"]["kbcli"]
    api["image"] = image
    api["entrypoint"] = ["/usr/local/bin/python"]
    api["volumes"] = [v for v in api["volumes"] if not v.startswith("./kbcli-runtime:")]
    api["healthcheck"]["test"] = ["CMD", "/usr/local/bin/python", "/opt/app/healthcheck.py"]
    sync = config["services"]["kbcli-sync"]
    sync["image"] = image
    sync["entrypoint"] = ["/usr/local/bin/python"]
    sync["command"][0] = "/opt/app/nas_autosync.py"
    sync["volumes"] = [v for v in sync["volumes"] if not v.startswith("./kbcli-runtime/automation:")]
    sync["healthcheck"]["test"] = ["CMD", "/usr/local/bin/python", *["health" if a == "run" else a for a in sync["command"]]]
    return config


def wait_healthy(base, service, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        identifier = compose(base, "ps", "-q", service).strip()
        if identifier:
            data = json.loads(run(base, "docker", "inspect", identifier))[0]
            if data["State"].get("Health", {}).get("Status") == "healthy":
                return
        time.sleep(2)
    raise RuntimeError(f"Health check did not pass: {service}")


def assert_preserved_knowledge(before, after):
    # Once the new API is healthy, existing browser outboxes may immediately
    # create immutable backup records. Allow only these new records; every
    # pre-existing file must still match exactly, including old backups.
    if any(after.get(path) != digest for path, digest in before.items()):
        raise RuntimeError("Existing knowledge or backup content changed during activation")
    uuid = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
    pattern = rf"assets/app-backups/chrome-kb/(?:devices/{uuid}/{uuid}|shared/{uuid}|wallpapers/[0-9a-f]{{64}})\.json"
    added = set(after) - set(before)
    if any(not re.fullmatch(pattern, path) for path in added):
        raise RuntimeError("Unexpected new knowledge content during activation")
    return len(added)


def activate(base, image, expected_version="0.1.2"):
    base = base.resolve()
    run(base, "docker", "run", "--rm", "--network", "none", image, "-c", f"import kbcli; assert kbcli.__version__=={expected_version!r}")
    config_path = base / "docker-compose.yaml"
    config = load_yaml(config_path.read_text())
    previous = json.loads(compose(base, "config", "--format", "json"))
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = base / "backups" / ("kbcli-image-" + stamp)
    backup.mkdir(mode=0o700)
    shutil.copy2(config_path, backup / "docker-compose.yaml")
    # Fail on unsupported config shapes/env files before pausing healthy services.
    candidate = backup / "candidate.yaml"
    write_yaml(candidate, image_config(config, image))
    compose(base, "--project-directory", str(base), "-f", str(candidate), "config", "--quiet")
    pause = base / "kbcli-sync-data/pause.json"
    original_pause = pause.exists()
    marker = "Image migration " + stamp
    args = previous["services"]["kbcli-sync"]["command"]
    if not original_pause:
        compose(base, "exec", "-T", "kbcli-sync", "/usr/local/bin/python3", *args[:-1], "--reason", marker, "pause")
    compose(base, "stop", "-t", "120", "kbcli-sync", timeout=150)
    compose(base, "stop", "-t", "120", "kbcli", timeout=150)
    before = knowledge_hashes(base / "knowledge-base")
    # Both writers are stopped: keep a consistent, private rollback copy.
    for relative in ("knowledge-base", "kbcli-data/state", "kbcli-sync-data"):
        source = base / relative
        if source.is_dir():
            shutil.copytree(source, backup / relative, symlinks=True)
    shutil.copy2(candidate, config_path)
    compose(base, "config", "--quiet")
    current = json.loads(compose(base, "config", "--format", "json"))
    for key in ("KBCLI_USER_TOKEN", "KBCLI_AGENT_TOKEN"):
        assert current["services"]["kbcli"]["environment"][key] == previous["services"]["kbcli"]["environment"][key]
    compose(base, "up", "-d", "--no-deps", "kbcli", timeout=150)
    wait_healthy(base, "kbcli")
    compose(base, "up", "-d", "--no-deps", "kbcli-sync", timeout=150)
    new_backup_records = assert_preserved_knowledge(before, knowledge_hashes(base / "knowledge-base"))
    if not original_pause:
        value = json.loads(pause.read_text())
        assert value["error"]["code"] == "OPERATOR_PAUSED" and value["error"]["message"] == marker
        args = current["services"]["kbcli-sync"]["command"]
        compose(base, "exec", "-T", "kbcli-sync", "/usr/local/bin/python", *args[:-1], "resume")
        wait_healthy(base, "kbcli-sync")
    report = {"stage": "image-active", "image": image, "backup": str(backup), "original_pause": original_pause, "knowledge_files": len(before), "new_backup_records": new_backup_records}
    (backup / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-dir", type=Path, required=True)
    parser.add_argument("--image", required=True)
    parser.add_argument("--expected-version", default="0.1.2")
    options = parser.parse_args()
    activate(options.compose_dir, options.image, options.expected_version)
