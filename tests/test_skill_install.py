import importlib.util
import json
import site
import subprocess
import sys
import uuid
import venv
from pathlib import Path

import pytest

from kbcli import __version__

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "kbcli_skill_installer", ROOT / "scripts/install_skill.py"
)
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


@pytest.fixture
def installation(vault, tmp_path, monkeypatch):
    registry = tmp_path / "install-state"
    monkeypatch.setenv("KBCLI_INSTALL_STATE_ROOT", str(registry))
    calls = []

    def prepared(release_dir, base, python_version, offline):
        # Dependency installation is replaced here; publication and the real launcher are tested.
        # The independent offline acceptance run also exercises uv with locked dependencies.
        environment = base / uuid.uuid4().hex
        venv.EnvBuilder(with_pip=False, symlinks=True).create(environment)
        interpreter = environment / (
            "Scripts/python.exe" if sys.platform == "win32" else "bin/python"
        )
        purelib = Path(
            subprocess.check_output(
                [str(interpreter), "-c", "import sysconfig;print(sysconfig.get_path('purelib'))"],
                text=True,
            ).strip()
        )
        purelib.mkdir(parents=True, exist_ok=True)
        (purelib / "test-dependencies.pth").write_text("\n".join(site.getsitepackages()) + "\n")
        calls.append(environment)
        return {"environment": str(environment), "python": str(interpreter)}

    monkeypatch.setattr(installer, "prepare_environment", prepared)
    return vault, registry, calls


def test_dry_run_and_scope_guards(installation):
    vault, registry, calls = installation
    before = sorted(str(p.relative_to(vault.root)) for p in vault.root.rglob("*"))
    response = installer.install(vault.root, dry_run=True)
    assert response["status"] == "planned"
    assert not registry.exists()
    assert not calls
    assert before == sorted(str(p.relative_to(vault.root)) for p in vault.root.rglob("*"))
    with pytest.raises(installer.InstallError) as exc:
        installer.plan(vault.root, vault.root / "env")
    assert exc.value.code == "RUNTIME_INSIDE_VAULT"


def test_unmanaged_skill_is_preserved(installation):
    vault, registry, _ = installation
    target = vault.root / ".agents/skills/knowledge-maintain"
    target.mkdir(parents=True)
    original = target / "SKILL.md"
    original.write_text("用户原有 skill")
    with pytest.raises(installer.InstallError) as exc:
        installer.install(vault.root, update=True)
    assert exc.value.code == "SKILL_TARGET_UNKNOWN"
    assert original.read_text() == "用户原有 skill"
    assert not registry.exists()


def test_install_bootstrap_and_repeat_are_idempotent(installation):
    vault, registry, calls = installation
    installed = installer.install(vault.root)
    assert installed["status"] == "installed"
    assert installed["doctor"]["fts5"]
    assert not Path(installed["environment"]).is_relative_to(vault.root)
    launch = subprocess.run(
        [sys.executable, installed["launcher"], "version"], capture_output=True, text=True
    )
    assert launch.returncode == 0, launch.stderr + launch.stdout
    assert json.loads(launch.stdout)["version"] == __version__
    again = installer.install(vault.root)
    assert again["status"] == "unchanged"
    assert len(calls) == 1
    assert not list((vault.root / ".agents/skills").glob(".kbcli-*"))
    assert registry.exists()


def test_failed_dependency_update_keeps_old_installation(installation, monkeypatch):
    vault, _, _ = installation
    installed = installer.install(vault.root)
    target = Path(installed["skill"])
    old = (target / "SKILL.md").read_bytes() + b"\ncustom user note\n"
    (target / "SKILL.md").write_bytes(old)
    record = installer.read_registry(target)

    def unavailable(*args, **kwargs):
        raise installer.InstallError("PROCESS_FAILED", "dependency download failed")

    monkeypatch.setattr(installer, "prepare_environment", unavailable)
    with pytest.raises(installer.InstallError):
        installer.install(vault.root, update=True)
    assert (target / "SKILL.md").read_bytes() == old
    assert installer.read_registry(target) == record


def test_failed_final_verification_rolls_back_package_and_registry(installation, monkeypatch):
    vault, _, calls = installation
    installed = installer.install(vault.root)
    target = Path(installed["skill"])
    old = (target / "SKILL.md").read_bytes() + b"\noriginal local note\n"
    (target / "SKILL.md").write_bytes(old)
    record = installer.read_registry(target)
    verify = installer.smoke

    def fail_final(interpreter, skill, *args):
        if skill == target:
            raise installer.InstallError("VERIFICATION_FAILED", "final validation failed")
        return verify(interpreter, skill, *args)

    monkeypatch.setattr(installer, "smoke", fail_final)
    with pytest.raises(installer.InstallError):
        installer.install(vault.root, update=True)
    assert (target / "SKILL.md").read_bytes() == old
    assert installer.read_registry(target) == record
    assert Path(installed["environment"]).exists()
    assert not calls[-1].exists()
    assert list(installer.registry_directory(target).glob("backups/*.zip"))
    assert not list(target.parent.glob(".kbcli-*"))


def test_launcher_rejects_changed_release_and_update_keeps_backup(installation):
    vault, _, _ = installation
    installed = installer.install(vault.root)
    target = Path(installed["skill"])
    file = target / "scripts/kbcli/__init__.py"
    original = file.read_bytes()
    file.write_bytes(original + b"\n# locally changed code\n")
    launch = subprocess.run(
        [sys.executable, installed["launcher"], "version"], capture_output=True, text=True
    )
    assert launch.returncode == 2
    assert json.loads(launch.stdout)["error"]["code"] == "INSTALLATION_STALE"
    updated = installer.install(vault.root, update=True)
    assert updated["status"] == "updated"
    assert Path(updated["backup"]).is_file()
    assert file.read_bytes() == original


def test_two_installers_do_not_replace_each_other(installation):
    vault, _, _ = installation
    target = vault.root / ".agents/skills/knowledge-maintain"
    with installer.install_lock(target):
        with pytest.raises(installer.InstallError) as exc:
            installer.install(vault.root)
        assert exc.value.code == "INSTALL_BUSY"
