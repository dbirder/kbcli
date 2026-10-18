"""Build a credential-free Docker context with locked runtime requirements."""
import argparse
import hashlib
import json
import shutil
import subprocess
import tempfile
import tomllib
from pathlib import Path


def build(destination):
    root = Path(__file__).resolve().parents[1]
    destination = Path(destination).resolve()
    if destination.exists():
        raise FileExistsError("Use a fresh Docker context; existing files are preserved")
    destination.mkdir(parents=True)
    try:
        version = tomllib.loads((root / "pyproject.toml").read_text())["project"]["version"]
        # uv also creates build-directory metadata. Copy only its one application
        # wheel, never a whole output tree, into the Docker context.
        with tempfile.TemporaryDirectory(prefix="kbcli-nas-wheel-") as wheel_dir:
            subprocess.run(["uv", "build", "--wheel", "--out-dir", wheel_dir], cwd=root, check=True)
            wheels = list(Path(wheel_dir).glob("*.whl"))
            if len(wheels) != 1 or not wheels[0].name.startswith(f"kbcli-{version}-"):
                raise ValueError("Expected exactly one wheel matching the project version")
            wheel = destination / wheels[0].name
            shutil.copyfile(wheels[0], wheel)
        requirements = subprocess.check_output([
            "uv", "export", "--locked", "--no-dev", "--no-emit-project", "--no-header",
            "--format", "requirements-txt",
        ], cwd=root, text=True)
        (destination / "requirements.txt").write_text(requirements)
        for name in ("Dockerfile", "healthcheck.py"):
            shutil.copyfile(root / "deploy/nas/image" / name, destination / name)
        shutil.copyfile(root / "scripts/nas_autosync.py", destination / "nas_autosync.py")
        names = ["Dockerfile", "requirements.txt", wheel.name, "nas_autosync.py", "healthcheck.py"]
        (destination / ".dockerignore").write_text("*\n" + "".join(f"!{name}\n" for name in names))
        names.append(".dockerignore")
        files = {name: hashlib.sha256((destination / name).read_bytes()).hexdigest() for name in sorted(names)}
        (destination / "context.json").write_text(json.dumps({"version": version, "files": files}, indent=2) + "\n")
        return destination
    except Exception:
        shutil.rmtree(destination)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    print(build(parser.parse_args().output))
