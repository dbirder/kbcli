"""Run from a complete skill release, or from this repository's source checkout."""

import json
import os
import sys
from pathlib import Path

sys.dont_write_bytecode = True
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from skill_runtime import read_registry, verify_release  # noqa: E402


def fail(code, message):
    print(
        json.dumps(
            {"protocol_version": 1, "ok": False, "error": {"code": code, "message": message}},
            ensure_ascii=False,
        )
    )
    raise SystemExit(2)


def bootstrap():
    skill = SCRIPTS.parent
    try:
        installed = read_registry(skill)
        release_path = skill / "release.json"
        if installed and release_path.is_file():
            release = json.loads(release_path.read_text())
            if installed.get("release_fingerprint") != release.get(
                "fingerprint"
            ) or not verify_release(skill, release):
                fail(
                    "INSTALLATION_STALE",
                    "发布包已变化，请从 kbcli 仓库重新运行 install_skill.py --update",
                )
            interpreter = Path(installed["python"])
            if not interpreter.is_file():
                fail("RUNTIME_MISSING", "本机 Python 环境已移走，请重新安装 skill")
            if Path(sys.prefix).resolve() != Path(installed["environment"]).resolve():
                os.execv(
                    str(interpreter),
                    [str(interpreter), str(SCRIPTS / "run_kbcli.py"), *sys.argv[1:]],
                )
    except (OSError, ValueError, KeyError) as exc:
        fail("INSTALLATION_INVALID", f"本机安装记录无法读取：{exc}")

    if not (SCRIPTS / "kbcli/__init__.py").is_file():
        # Source skills remain runnable without duplicating the application source.
        source = next(
            (
                p / "src"
                for p in SCRIPTS.parents
                if (p / "pyproject.toml").is_file() and (p / "src/kbcli/__init__.py").is_file()
            ),
            None,
        )
        if source is None:
            fail(
                "SKILL_PACKAGE_INCOMPLETE",
                "缺少 kbcli 配套代码；请使用仓库安装器，不能只复制 skills 子目录",
            )
        sys.path.insert(0, str(source))
    try:
        from kbcli.cli import main
    except ModuleNotFoundError as exc:
        fail(
            "RUNTIME_DEPENDENCY_MISSING",
            f"缺少 Python 依赖 {exc.name}；请按仓库 README 安装完整 skill",
        )
    main()


if __name__ == "__main__":
    bootstrap()
