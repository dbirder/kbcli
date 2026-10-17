"""Install this repository's complete skill and an external, isolated Python environment."""

from __future__ import annotations

import argparse
import errno
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import tomllib
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "skills/knowledge-maintain/scripts"))
sys.path.insert(0, str(ROOT / "scripts"))

from build_skill import build  # noqa: E402
from skill_runtime import (  # noqa: E402
    SKILL_NAME,
    read_registry,
    registry_directory,
    registry_path,
    verify_release,
    write_registry,
)


class InstallError(Exception):
    def __init__(self, code, message, **details):
        super().__init__(message)
        self.code = code
        self.details = details


@contextmanager
def install_lock(target):
    directory = registry_directory(target)
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "install.lock").open("a+b") as stream:
        acquired = False
        try:
            if os.name == "nt":
                import msvcrt

                stream.seek(0)
                stream.write(b"0")
                stream.flush()
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            acquired = True
            yield
        except OSError as exc:
            if not acquired:
                code = (
                    "INSTALL_BUSY"
                    if exc.errno in {errno.EACCES, errno.EAGAIN}
                    else "INSTALL_LOCK_FAILED"
                )
                raise InstallError(
                    code,
                    "已有安装正在执行" if code == "INSTALL_BUSY" else "无法获取安装锁",
                    reason=str(exc),
                ) from exc
            raise
        finally:
            if acquired:
                if os.name == "nt":
                    stream.seek(0)
                    msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def reject_links(root, target):
    current = root
    for part in target.relative_to(root).parts:
        current /= part
        if current.is_symlink():
            raise InstallError("SYMLINK_NOT_ALLOWED", "安装目录不能经过符号链接", path=str(current))


def plan(vault, runtime_dir=None, *, update=False):
    vault = Path(vault).expanduser().resolve()
    config = vault / ".kb/config.toml"
    if not config.is_file():
        raise InstallError(
            "VAULT_CONFIG_MISSING",
            "请指定已有 .kb/config.toml 的知识库；安装器不会初始化或改写知识内容",
            vault=str(vault),
        )
    try:
        tomllib.loads(config.read_text())
    except ValueError as exc:
        raise InstallError("VAULT_CONFIG_INVALID", "知识库配置无法解析") from exc
    target = vault / ".agents/skills" / SKILL_NAME
    reject_links(vault, target)
    record_dir = registry_directory(target).resolve()
    environment_base = (
        Path(runtime_dir).expanduser().resolve() if runtime_dir else record_dir / "environments"
    )
    if record_dir.is_relative_to(vault) or environment_base.is_relative_to(vault):
        raise InstallError("RUNTIME_INSIDE_VAULT", "本机安装记录与 Python 环境必须在知识库之外")
    if target.exists():
        try:
            old_release = json.loads((target / "release.json").read_text())
        except (OSError, ValueError) as exc:
            raise InstallError(
                "SKILL_TARGET_UNKNOWN",
                "目标已有其他或未标识的 skill，保留原文件",
                target=str(target),
            ) from exc
        if old_release.get("name") != SKILL_NAME:
            raise InstallError("SKILL_TARGET_UNKNOWN", "目标不是本项目发布包", target=str(target))
        if any(p.is_symlink() for p in target.rglob("*")):
            raise InstallError("SYMLINK_NOT_ALLOWED", "已有发布包含符号链接，不能自动替换")
    project = tomllib.loads((ROOT / "pyproject.toml").read_text())
    return {
        "vault": str(vault),
        "skill": str(target),
        "version": project["project"]["version"],
        "registry": str(registry_path(target)),
        "environment_base": str(environment_base),
        "exists": target.exists(),
        "update_requested": update,
        "knowledge_records_modified": False,
    }


def run_process(arguments, *, timeout=300):
    try:
        value = subprocess.run(arguments, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise InstallError("PROCESS_FAILED", "安装子进程无法完成", command=arguments[:3]) from exc
    if value.returncode:
        reason = re.sub(
            r"(https?://)[^\s/@]+:[^\s/@]+@", r"\1***@", (value.stderr or value.stdout)[-2000:]
        )
        raise InstallError(
            "PROCESS_FAILED", "安装步骤失败，保留现有 skill", command=arguments[:3], reason=reason
        )
    return value.stdout


def prepare_environment(release_dir, base, python_version, offline):
    uv = shutil.which("uv")
    if not uv:
        raise InstallError("UV_MISSING", "请先按 uv 官方说明安装 uv，再执行本脚本")
    environment = base / uuid.uuid4().hex
    base.mkdir(parents=True, exist_ok=True)
    extra = ["--offline"] if offline else []
    try:
        run_process(
            [uv, "venv", "--no-project", "--python", python_version, *extra, str(environment)]
        )
        interpreter = environment / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        run_process(
            [
                uv,
                "pip",
                "install",
                "--python",
                str(interpreter),
                "--require-hashes",
                "-r",
                str(release_dir / "requirements.txt"),
                *extra,
            ]
        )
    except Exception:
        shutil.rmtree(environment, ignore_errors=True)
        raise
    return {"environment": str(environment), "python": str(interpreter)}


def smoke(interpreter, skill, vault, state, expected_version):
    launcher = skill / "scripts/run_kbcli.py"
    try:
        version = json.loads(run_process([interpreter, str(launcher), "version"]))
        diagnostic = json.loads(
            run_process(
                [
                    interpreter,
                    str(launcher),
                    "--vault",
                    str(vault),
                    "--state-dir",
                    str(state),
                    "doctor",
                ]
            )
        )
    except ValueError as exc:
        raise InstallError("VERIFICATION_FAILED", "工具没有返回有效 JSON") from exc
    if (
        not version.get("ok")
        or version.get("version") != expected_version
        or not diagnostic.get("ok")
        or not diagnostic.get("fts5")
    ):
        raise InstallError("VERIFICATION_FAILED", "版本或 SQLite FTS5 核验失败")
    return {"version": version["version"], "doctor": diagnostic}


def backup_skill(target, record_dir):
    backup_dir = record_dir / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    archive = backup_dir / (uuid.uuid4().hex + ".zip")
    with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as zipped:
        for path in sorted(target.rglob("*")):
            if path.is_file():
                zipped.write(path, path.relative_to(target))
    return archive


def install(
    vault, runtime_dir=None, *, update=False, dry_run=False, python_version=None, offline=False
):
    details = plan(vault, runtime_dir, update=update)
    if dry_run:
        return {"ok": True, "status": "planned", **details}
    if not shutil.which("uv"):
        raise InstallError("UV_MISSING", "找不到 uv；本脚本不自动修改系统包管理器")
    with install_lock(Path(details["skill"])):
        return install_locked(
            details, update=update, python_version=python_version, offline=offline
        )


def install_locked(details, *, update, python_version, offline):
    vault = Path(details["vault"])
    target = Path(details["skill"])
    record_dir = registry_directory(target)
    environment_base = Path(details["environment_base"])
    old_record = read_registry(target)
    environment = None
    backup = None
    previous_target = None
    new_target_installed = False
    new_record_installed = False
    stage = None
    with tempfile.TemporaryDirectory(prefix="kbcli-install-build-") as temporary:
        release_dir = build(Path(temporary) / SKILL_NAME, quiet=True, offline=offline)
        release = json.loads((release_dir / "release.json").read_text())
        if not verify_release(release_dir, release):
            raise InstallError("RELEASE_INVALID", "发布包文件校验失败")
        if target.exists():
            old_release = json.loads((target / "release.json").read_text())
            if (
                old_record
                and old_release.get("fingerprint") == release["fingerprint"]
                and old_record.get("release_fingerprint") == release["fingerprint"]
                and verify_release(target, old_release)
                and Path(old_record["python"]).is_file()
            ):
                verified = smoke(
                    old_record["python"],
                    target,
                    vault,
                    record_dir / "verification-state",
                    release["kbcli_version"],
                )
                return {
                    "ok": True,
                    "status": "unchanged",
                    **details,
                    **verified,
                    "python": old_record["python"],
                    "launcher": str(target / "scripts/run_kbcli.py"),
                }
            if not update:
                raise InstallError(
                    "SKILL_EXISTS",
                    "已有本项目发布包；安装当前版本请使用 --update，先备份再替换",
                    target=str(target),
                )
        try:
            environment = prepare_environment(
                release_dir, environment_base, python_version or release["python_runtime"], offline
            )
            smoke(
                environment["python"],
                release_dir,
                vault,
                record_dir / "verification-state",
                release["kbcli_version"],
            )
            # Only replace the skill after dependencies and its executable have been checked.
            target.parent.mkdir(parents=True, exist_ok=True)
            reject_links(vault, target)
            stage = target.parent / (".kbcli-stage-" + uuid.uuid4().hex)
            shutil.copytree(release_dir, stage)
            if target.exists():
                backup = backup_skill(target, record_dir)
                previous_target = target.parent / (".kbcli-old-" + uuid.uuid4().hex)
                target.rename(previous_target)
            stage.rename(target)
            stage = None
            new_target_installed = True
            data = {
                "schema_version": 1,
                "name": SKILL_NAME,
                "skill": str(target),
                "version": release["kbcli_version"],
                "release_fingerprint": release["fingerprint"],
                **environment,
            }
            write_registry(target, data)
            new_record_installed = True
            verified = smoke(
                environment["python"],
                target,
                vault,
                record_dir / "verification-state",
                release["kbcli_version"],
            )
            if previous_target:
                shutil.rmtree(previous_target, ignore_errors=True)
            return {
                "ok": True,
                "status": "updated" if details["exists"] else "installed",
                **details,
                **verified,
                **environment,
                "backup": str(backup) if backup else None,
                "launcher": str(target / "scripts/run_kbcli.py"),
                "cleanup_pending": str(previous_target)
                if previous_target and previous_target.exists()
                else None,
                "agent_trust_modified": False,
                "server_started": False,
            }
        except Exception:
            # Restore both sides of an update; leave the external backup available.
            if new_target_installed and target.exists():
                shutil.rmtree(target)
            if previous_target and previous_target.exists():
                previous_target.rename(target)
            if new_record_installed:
                if old_record is None:
                    registry_path(target).unlink(missing_ok=True)
                else:
                    write_registry(target, old_record)
            if stage and stage.exists():
                shutil.rmtree(stage)
            if environment:
                shutil.rmtree(environment["environment"], ignore_errors=True)
            raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vault", required=True, help="已存在的知识库根目录")
    parser.add_argument("--runtime-dir", help="Python 环境父目录，必须在知识库外")
    parser.add_argument(
        "--python",
        dest="python_version",
        help="uv 使用的 Python 版本或解释器；默认 .python-version",
    )
    parser.add_argument("--update", action="store_true", help="备份后更新本项目的已有发布包")
    parser.add_argument("--dry-run", action="store_true", help="只报告路径与版本，不下载或写文件")
    parser.add_argument("--offline", action="store_true", help="仅使用 uv 现有缓存")
    try:
        value = install(**vars(parser.parse_args()))
    except InstallError as exc:
        value = {
            "ok": False,
            "error": {"code": exc.code, "message": str(exc), "details": exc.details},
        }
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        value = {"ok": False, "error": {"code": "INSTALL_FAILED", "message": str(exc)}}
    print(json.dumps(value, ensure_ascii=False, indent=2))
    raise SystemExit(0 if value["ok"] else 2)


if __name__ == "__main__":
    main()
