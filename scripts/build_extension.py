"""Package the Chrome new-tab extension from an explicit, credential-free file allowlist."""

import argparse
import hashlib
import json
import shutil
import zipfile
from pathlib import Path

FILES = (
    "manifest.json",
    "newtab.html",
    "style.css",
    "app.mjs",
    "api.mjs",
    "controller.mjs",
    "background.mjs",
    "navigation.mjs",
    "navigation-ui.mjs",
    "ui.mjs",
)


def build(output, source=None):
    root = Path(source) if source else Path(__file__).resolve().parents[1] / "extensions/chrome-kb"
    output = Path(output).resolve()
    manifest = json.loads((root / "manifest.json").read_text())
    if (
        manifest.get("manifest_version") != 3
        or manifest.get("chrome_url_overrides", {}).get("newtab") != "newtab.html"
    ):
        raise ValueError("Expected the KB Manifest V3 new-tab extension")
    archive = output.parent / f"chrome-kb-{manifest['version']}.zip"
    if output.exists() or archive.exists():
        raise FileExistsError("Use a new output directory; existing releases are preserved")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.mkdir()
    try:
        for relative in FILES:
            file = root / relative
            if not file.is_file() or file.is_symlink():
                raise ValueError(f"Missing or linked release input: {relative}")
            shutil.copyfile(file, output / relative)
        hashes = {name: hashlib.sha256((output / name).read_bytes()).hexdigest() for name in FILES}
        (output / "release.json").write_text(
            json.dumps({"version": manifest["version"], "files": hashes}, indent=2) + "\n"
        )
        with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as zipped:
            for file in sorted(output.iterdir()):
                info = zipfile.ZipInfo("chrome-kb/" + file.name)
                info.compress_type = zipfile.ZIP_DEFLATED
                info.external_attr = 0o100644 << 16
                zipped.writestr(info, file.read_bytes())
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        archive.unlink(missing_ok=True)
        raise
    return {
        "version": manifest["version"],
        "directory": str(output),
        "archive": str(archive),
        "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", default="dist/chrome-kb", type=Path)
    args = parser.parse_args()
    print(json.dumps(build(args.output), ensure_ascii=False, indent=2))
