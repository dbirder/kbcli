"""Build an installable skill directory; no runtime environment is vendored."""

import argparse
import hashlib
import json
import shutil
import subprocess
import tomllib
from pathlib import Path

# Finder metadata, bytecode and editor/cache files are never release inputs.
RELEASE_IGNORE = shutil.ignore_patterns(
    ".DS_Store", "._*", "__MACOSX", "__pycache__", "*.py[cod]",
    ".pytest_cache", ".ruff_cache", ".venv", "*.swp", "*.swo", "*~",
)


def build(destination, *, quiet=False, offline=False):
    root = Path(__file__).resolve().parents[1]
    project = tomllib.loads((root / "pyproject.toml").read_text())
    destination = Path(destination).resolve()
    if destination.exists():
        raise SystemExit("输出目录已经存在，请指定新的目录，避免覆盖")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        root / "skills/knowledge-maintain",
        destination,
        ignore=RELEASE_IGNORE,
    )
    package = destination / "scripts/kbcli"
    package.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        root / "src/kbcli", package, ignore=RELEASE_IGNORE
    )
    # Export the locked runtime requirements, omitting this editable source project and dev tools.
    exported = subprocess.run(
        [
            "uv",
            "export",
            "--locked",
            "--no-dev",
            "--no-emit-project",
            # The command header includes --offline and would change an identical release.
            "--no-header",
            "--format",
            "requirements-txt",
            *(["--offline"] if offline else []),
        ],
        cwd=root,
        check=True,
        capture_output=True,
        text=True,
    )
    (destination / "requirements.txt").write_text(exported.stdout)
    file_hashes = {
        p.relative_to(destination).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
        for p in sorted(destination.rglob("*"))
        if p.is_file()
    }
    fingerprint = hashlib.sha256(
        json.dumps(file_hashes, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    (destination / "release.json").write_text(
        json.dumps(
            {
                "name": "knowledge-maintain",
                "kbcli_version": project["project"]["version"],
                "python": project["project"]["requires-python"],
                "python_runtime": (root / ".python-version").read_text().strip(),
                "files": file_hashes,
                "fingerprint": fingerprint,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n"
    )
    if not quiet:
        print(destination)
    return destination


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="dist/knowledge-maintain")
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    build(args.output, offline=args.offline)
