"""NAS-only staged layout migration. Secrets remain on the NAS; no Docker image is changed here."""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path


def load_yaml(value):
    try:
        import yaml
        return yaml.safe_load(value)
    except ModuleNotFoundError:
        from ruamel.yaml import YAML
        return YAML(typ="safe").load(value)


def write_yaml(path, value):
    try:
        import yaml
        text = yaml.safe_dump(value, allow_unicode=True, sort_keys=False)
    except ModuleNotFoundError:
        from io import StringIO

        from ruamel.yaml import YAML
        stream = StringIO()
        YAML().dump(value, stream)
        text = stream.getvalue()
    path.write_text(text)
    path.chmod(0o600)


def run(base, *args, timeout=120):
    return subprocess.check_output(args, cwd=base, text=True, stderr=subprocess.PIPE, timeout=timeout)


def compose(base, *args, timeout=120):
    return run(base, "docker", "compose", *args, timeout=timeout)


def knowledge_hashes(root):
    return {p.relative_to(root).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(root.rglob("*")) if p.is_file() and ".git" not in p.relative_to(root).parts}


def private_write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(text)


def preflight_split(base, source, client_launcher=None):
    """Reject invalid inputs before creating destinations or moving canonical data."""
    for name in ("knowledge-base", "kbcli-runtime", "kbcli-data", "kbcli-sync-data", "hermes-client", "config/kbcli"):
        target = base / name
        if target.exists() or target.is_symlink():
            raise RuntimeError(f"Destination exists; refusing replacement: {name}")
    old = base / "hermes-data"
    required = ("knowledge-base", "kbcli", "kbcli/state", "kbcli/autosync", "kbcli/python", "kbcli/environments", "kbcli/bin", ".ssh")
    for name in required:
        path = old / name
        if not path.is_dir() or path.is_symlink():
            raise RuntimeError(f"Required original directory is missing or linked: {name}")
    token_file = old / "kbcli/agent-token"
    if not token_file.is_file() or token_file.is_symlink():
        raise RuntimeError("Original agent token file is missing or linked")
    if (base / "config").is_symlink():
        raise RuntimeError("Configuration parent must not be a symlink")
    try:
        environment = source["services"]["kbcli"]["environment"]
        for key in ("KBCLI_USER_TOKEN", "KBCLI_AGENT_TOKEN"):
            value = environment[key]
            if not isinstance(value, str) or not value or any(c in value for c in "\n\r\0"):
                raise RuntimeError("Invalid existing token; no data was moved")
    except (KeyError, TypeError):
        raise RuntimeError("Existing API credentials are required; no data was moved") from None
    if client_launcher and (not Path(client_launcher).is_file() or Path(client_launcher).is_symlink()):
        raise RuntimeError("Client launcher is missing or linked; no data was moved")
    return environment


def split_layout(base, source, uid=10000, gid=10000, client_launcher=None):
    """Move data without rewriting its contents. Caller must stop all writers first."""
    environment = preflight_split(base, source, client_launcher)
    old = base / "hermes-data"
    config = base / "config/kbcli"
    # Copy the client before moving any canonical data; preserve absolute symlinks and ownership.
    client = base / "hermes-client"
    client.mkdir(mode=0o700)
    for name in ("python", "environments", "bin"):
        run(base, "rsync", "-a", str(old / "kbcli" / name), str(client) + "/")
    shutil.copy2(old / "kbcli/agent-token", client / "agent-token")
    for p in [client, *client.rglob("*")]:
        os.chown(p, uid, gid, follow_symlinks=False)
    # The client receives neither the owner environment nor the scheduler's mutable directory.
    (client / "bin/kbcli-autosync").unlink(missing_ok=True)
    if client_launcher:
        launcher = client / "bin/kbcli-autosync"
        shutil.copyfile(client_launcher, launcher)
        launcher.chmod(0o755)
        os.chown(launcher, uid, gid)
    (old / "knowledge-base").rename(base / "knowledge-base")
    (old / "kbcli").rename(base / "kbcli-runtime")
    data = base / "kbcli-data"
    data.mkdir(mode=0o700)
    os.chown(data, uid, gid)
    (base / "kbcli-runtime/state").rename(data / "state")
    (base / "kbcli-runtime/autosync").rename(base / "kbcli-sync-data")
    for name in ("state", "autosync"):
        (base / "kbcli-runtime" / name).mkdir(mode=0o755)
    config.mkdir(parents=True, mode=0o700)
    # API already accessed these keys through the old shared mount; the new scope is narrower.
    run(base, "rsync", "-a", str(old / ".ssh") + "/", str(config / "ssh") + "/")
    private_write(config / "api.env", "\n".join(f"{k}={environment[k]}" for k in ("KBCLI_USER_TOKEN", "KBCLI_AGENT_TOKEN")) + "\n")
    private_write(config / "sync.env", "KBCLI_USER_TOKEN=" + environment["KBCLI_USER_TOKEN"] + "\n")
    return client


def split_config(config):
    services = config["services"]
    hermes = services["hermes"]
    hermes["volumes"] = [v for v in hermes.get("volumes", []) if not (isinstance(v, str) and v.split(":")[1] in {"/opt/data/kbcli", "/opt/data/knowledge-base"})]
    hermes["volumes"] += ["./hermes-client:/opt/data/kbcli:ro", "./knowledge-base:/opt/data/knowledge-base:ro"]
    api = services["kbcli"]
    api["env_file"] = ["./config/kbcli/api.env"]
    api.setdefault("environment", {}).pop("KBCLI_USER_TOKEN", None)
    api["environment"].pop("KBCLI_AGENT_TOKEN", None)
    api["environment"]["PYTHONDONTWRITEBYTECODE"] = "1"
    api["volumes"] = [
        "./kbcli-runtime:/opt/data/kbcli:ro",
        "./kbcli-data/state:/opt/data/kbcli/state",
        "./kbcli-sync-data:/opt/data/kbcli/autosync:ro",
        "./knowledge-base:/opt/data/knowledge-base",
        "./config/kbcli/ssh:/opt/data/.ssh:ro",
    ]
    sync = services["kbcli-sync"]
    sync["env_file"] = ["./config/kbcli/sync.env"]
    sync.setdefault("environment", {}).pop("KBCLI_USER_TOKEN", None)
    sync["environment"].pop("KBCLI_AGENT_TOKEN", None)
    sync["volumes"] = [
        "./kbcli-runtime/automation:/opt/data/kbcli/automation:ro",
        "./kbcli-data/state:/opt/data/kbcli/state:ro",
        "./kbcli-sync-data:/opt/data/kbcli/autosync",
    ]
    args = sync["command"]
    health_args = ["health" if a == "run" else a for a in args]
    sync["healthcheck"]["test"] = ["CMD", "/usr/local/bin/python3", *health_args]
    for name in ("kbcli", "kbcli-sync"):
        services[name]["stop_grace_period"] = "120s"
    return config


def migrate(base, client_launcher=None):
    base = base.resolve()
    for name in ("knowledge-base", "kbcli-runtime", "kbcli-data", "kbcli-sync-data", "hermes-client", "config/kbcli"):
        if (base / name).exists():
            raise RuntimeError(f"Migration destination already exists: {name}")
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup = base / "backups" / ("kbcli-layout-" + stamp)
    backup.mkdir(parents=True, mode=0o700)
    backup.parent.chmod(0o700)
    config_path = base / "docker-compose.yaml"
    raw = load_yaml(config_path.read_text())
    resolved = json.loads(compose(base, "config", "--format", "json"))
    preflight_split(base, resolved, client_launcher)
    old = base / "hermes-data"
    pause = old / "kbcli/autosync/pause.json"
    was_paused = pause.exists()
    shutil.copy2(config_path, backup / "docker-compose.yaml")
    if (base / ".env").is_file():
        shutil.copy2(base / ".env", backup / ".env")
    marker = "Layout migration " + stamp
    report = {"backup": str(backup), "original_pause": was_paused, "migration_reason": marker,
              "stage": "prepared"}
    (backup / "report.json").write_text(json.dumps(report, indent=2))
    if not was_paused:
        compose(base, "exec", "-T", "--user", "10000:10000", "hermes", "/opt/data/kbcli/bin/kbcli-autosync", "--reason", marker, "pause")
    # SIGTERM lets the current scheduler call finish; stop the API only after that.
    compose(base, "stop", "-t", "120", "kbcli-sync", timeout=150)
    compose(base, "stop", "-t", "120", "kbcli", "hermes", timeout=150)
    before = knowledge_hashes(old / "knowledge-base")
    report["knowledge_files"] = len(before)
    report["stage"] = "stopped"
    (backup / "report.json").write_text(json.dumps(report, indent=2))
    run(base, "tar", "--acls", "--xattrs", "-cpf", str(backup / "hermes-data.tar"), "hermes-data", timeout=240)
    split_layout(base, resolved, client_launcher=client_launcher)
    assert knowledge_hashes(base / "knowledge-base") == before, "Knowledge content changed during migration"
    write_yaml(config_path, split_config(raw))
    compose(base, "config", "--quiet")
    after = json.loads(compose(base, "config", "--format", "json"))
    for key in ("KBCLI_USER_TOKEN", "KBCLI_AGENT_TOKEN"):
        assert after["services"]["kbcli"]["environment"][key] == resolved["services"]["kbcli"]["environment"][key]
    assert "KBCLI_AGENT_TOKEN" not in after["services"]["kbcli-sync"]["environment"]
    report["stage"] = "split"
    (backup / "report.json").write_text(json.dumps(report, indent=2))
    compose(base, "up", "-d", "--no-build", "hermes", "kbcli", "kbcli-sync", timeout=150)
    print(json.dumps(report, ensure_ascii=False))


def preflight_rollback(base, backup):
    if not (backup / "docker-compose.yaml").is_file():
        raise RuntimeError("Rollback Compose backup is missing")
    for name in ("hermes-data", "knowledge-base", "kbcli-runtime", "kbcli-data/state", "kbcli-sync-data"):
        path = base / name
        if not path.is_dir() or path.is_symlink():
            raise RuntimeError(f"Rollback source is missing or linked: {name}")
    for target in (base / "hermes-data/knowledge-base", base / "hermes-data/kbcli", base / "kbcli-runtime/state", base / "kbcli-runtime/autosync"):
        if target.is_symlink() or (target.exists() and (not target.is_dir() or any(target.iterdir()))):
            raise RuntimeError("Rollback target is not empty; current data was preserved")


def rollback(base, backup):
    """Move the current data back; never overwrite it with an older archive."""
    preflight_rollback(base, backup)
    compose(base, "stop", "-t", "120", "kbcli-sync", timeout=150)
    compose(base, "stop", "-t", "120", "kbcli", "hermes", timeout=150)
    old = base / "hermes-data"
    for name in ("knowledge-base", "kbcli"):
        target = old / name
        if target.exists():
            target.rmdir()  # Refuse to discard unexpected content.
    (base / "knowledge-base").rename(old / "knowledge-base")
    runtime = base / "kbcli-runtime"
    for name, source in (("state", base / "kbcli-data/state"), ("autosync", base / "kbcli-sync-data")):
        (runtime / name).rmdir()
        source.rename(runtime / name)
    runtime.rename(old / "kbcli")
    shutil.copy2(backup / "docker-compose.yaml", base / "docker-compose.yaml")
    compose(base, "config", "--quiet")
    compose(base, "up", "-d", "--no-build", "hermes", "kbcli", "kbcli-sync", timeout=150)
    print("Previous layout restored with current data; verify before resuming synchronization")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--compose-dir", type=Path, required=True)
    parser.add_argument("--rollback", type=Path, help="Backup directory from this migration")
    parser.add_argument("--client-status-launcher", type=Path, help="deploy/nas/kbcli-autosync-client.py; keep Hermes status queries without mutable scheduler mounts")
    args = parser.parse_args()
    if args.rollback:
        rollback(args.compose_dir.resolve(), args.rollback.resolve())
    else:
        if args.client_status_launcher and not args.client_status_launcher.is_file():
            parser.error("Client status launcher does not exist")
        migrate(args.compose_dir, args.client_status_launcher)
