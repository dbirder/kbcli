import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("image_context", ROOT / "scripts/build_nas_image_context.py")
context = importlib.util.module_from_spec(spec)
spec.loader.exec_module(context)


def fake_source(tmp_path, monkeypatch):
    root = tmp_path / "project"
    (root / "scripts").mkdir(parents=True)
    (root / "deploy/nas/image").mkdir(parents=True)
    (root / "pyproject.toml").write_text('[project]\nversion="0.1.2"\n')
    for name in ("Dockerfile", "healthcheck.py"):
        (root / "deploy/nas/image" / name).write_bytes((ROOT / "deploy/nas/image" / name).read_bytes())
    (root / "scripts/nas_autosync.py").write_text("# synthetic scheduler\n")
    (root / ".env").write_text("TEST_ONLY_SECRET=never-package-me")
    monkeypatch.setattr(context, "__file__", str(root / "scripts/build_nas_image_context.py"))
    return root


def test_context_includes_only_wheel_locked_requirements_and_explicit_runtime_inputs(tmp_path, monkeypatch):
    root = fake_source(tmp_path, monkeypatch)

    def run(args, **kwargs):
        output = Path(args[args.index("--out-dir") + 1])
        (output / "kbcli-0.1.2-py3-none-any.whl").write_bytes(b"test wheel")
        (output / ".gitignore").write_text("*")
        (output / "service.env").write_text("test-only-build-metadata")

    def export(args, **kwargs):
        assert "--locked" in args and "--no-dev" in args and "--no-emit-project" in args
        return "test-dependency==1 --hash=sha256:fixture\n"

    monkeypatch.setattr(context.subprocess, "run", run)
    monkeypatch.setattr(context.subprocess, "check_output", export)
    output = context.build(tmp_path / "context")
    manifest = json.loads((output / "context.json").read_text())
    expected = {"Dockerfile", "healthcheck.py", "nas_autosync.py", "requirements.txt", "kbcli-0.1.2-py3-none-any.whl", ".dockerignore"}
    assert set(manifest["files"]) == expected
    assert {p.name for p in output.iterdir()} == expected | {"context.json"}
    for name, digest in manifest["files"].items():
        assert hashlib.sha256((output / name).read_bytes()).hexdigest() == digest
        assert b"never-package-me" not in (output / name).read_bytes()
    assert "!kbcli-0.1.2-py3-none-any.whl" in (output / ".dockerignore").read_text()
    assert (root / ".env").read_text().endswith("never-package-me")


def test_existing_context_is_preserved_without_running_build_tools(tmp_path, monkeypatch):
    output = tmp_path / "context"
    output.mkdir()
    (output / "keep").write_text("existing")
    monkeypatch.setattr(context.subprocess, "run", lambda *a, **kw: pytest.fail("build must not run"))
    with pytest.raises(FileExistsError):
        context.build(output)
    assert (output / "keep").read_text() == "existing"


def test_failed_build_removes_only_its_new_context(tmp_path, monkeypatch):
    root = fake_source(tmp_path, monkeypatch)

    def fail(*a, **kw):
        raise subprocess.CalledProcessError(1, ["uv", "build"])

    monkeypatch.setattr(context.subprocess, "run", fail)
    with pytest.raises(subprocess.CalledProcessError):
        context.build(tmp_path / "context")
    assert not (tmp_path / "context").exists()
    assert (root / ".env").is_file()
