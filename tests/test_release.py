"""Release boundaries: ship code and hidden contracts, never machine metadata."""

import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("kbcli_skill_builder", ROOT / "scripts/build_skill.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def test_skill_release_excludes_noise_and_keeps_contracts(tmp_path, monkeypatch):
    root = tmp_path / "source"
    root.mkdir()
    (root / "pyproject.toml").write_text(
        '[project]\nversion = "0.1.1"\nrequires-python = ">=3.12"\n'
    )
    (root / ".python-version").write_text("3.13\n")
    expected = {
        "SKILL.md": "maintenance instructions",
        "scripts/kbcli/__init__.py": '__version__ = "0.1.1"',
        "scripts/kbcli/defaults/.kb/config.toml": "[vault]",
        "scripts/kbcli/defaults/.kb/schemas/note-v1.json": "{}",
    }
    trees = [root / "skills/knowledge-maintain", root / "src/kbcli"]
    for relative, content in expected.items():
        source = (
            trees[1] / relative.removeprefix("scripts/kbcli/")
            if relative.startswith("scripts/kbcli/") else trees[0] / relative
        )
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_text(content)
    for tree in trees:
        for relative in (
            ".DS_Store", "._SKILL.md", "__MACOSX/metadata", "__pycache__/cached.pyc",
            "defaults/.kb/.DS_Store", "nested/._note", "nested/module.pyo",
            ".pytest_cache/state", ".ruff_cache/state", ".venv/bin/python",
            "nested/note.swp", "nested/note.swo", "nested/note.md~",
        ):
            file = tree / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text("local noise")

    monkeypatch.setattr(builder, "__file__", str(root / "scripts/build_skill.py"))
    monkeypatch.setattr(
        builder.subprocess, "run",
        lambda *args, **kwargs: subprocess.CompletedProcess(args[0], 0, "# locked dependencies\n"),
    )
    output = builder.build(tmp_path / "release", quiet=True)
    release = json.loads((output / "release.json").read_text())
    assert set(release["files"]) == set(expected) | {"requirements.txt"}
    for relative, content in expected.items():
        assert (output / relative).read_text() == content
    for relative, digest in release["files"].items():
        assert hashlib.sha256((output / relative).read_bytes()).hexdigest() == digest
    repeated = builder.build(tmp_path / "repeat", quiet=True)
    assert (output / "release.json").read_bytes() == (repeated / "release.json").read_bytes()


def test_skill_release_is_identical_with_offline_export(tmp_path):
    online = builder.build(tmp_path / "online", quiet=True)
    offline = builder.build(tmp_path / "offline", quiet=True, offline=True)
    assert (online / "requirements.txt").read_bytes() == (offline / "requirements.txt").read_bytes()
    assert (online / "release.json").read_bytes() == (offline / "release.json").read_bytes()
