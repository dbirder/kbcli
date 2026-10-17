"""Standard-library bootstrap metadata shared by the launcher and installer."""

import hashlib
import json
import os
import sys
from pathlib import Path

SKILL_NAME = "knowledge-maintain"


def install_state_root():
    override = os.environ.get("KBCLI_INSTALL_STATE_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    if sys.platform == "darwin":
        base = Path.home() / "Library/Application Support/kbcli"
    elif os.name == "nt":
        base = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData/Local")) / "kbcli"
    else:
        base = Path(os.environ.get("XDG_STATE_HOME", Path.home() / ".local/state")) / "kbcli"
    return base / "skill-installations"


def registry_directory(skill_directory):
    identity = hashlib.sha256(str(Path(skill_directory).resolve()).encode()).hexdigest()[:24]
    return install_state_root() / identity


def registry_path(skill_directory):
    return registry_directory(skill_directory) / "installation.json"


def fingerprint(file_hashes):
    data = json.dumps(file_hashes, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(data.encode()).hexdigest()


def verify_release(directory, release):
    directory = Path(directory).resolve()
    hashes = release.get("files")
    if (
        not isinstance(hashes, dict)
        or not hashes
        or fingerprint(hashes) != release.get("fingerprint")
    ):
        return False
    for relative, expected in hashes.items():
        path = Path(relative)
        if path.is_absolute() or ".." in path.parts:
            return False
        target = directory / path
        if (
            not target.is_file()
            or target.is_symlink()
            or not target.resolve().is_relative_to(directory)
        ):
            return False
        if hashlib.sha256(target.read_bytes()).hexdigest() != expected:
            return False
    return True


def read_registry(skill_directory):
    path = registry_path(skill_directory)
    return json.loads(path.read_text()) if path.is_file() else None


def write_registry(skill_directory, data):
    import tempfile

    path = registry_path(skill_directory)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".installation-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
