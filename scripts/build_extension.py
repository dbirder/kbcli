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
    "startup.js",
    "first-paint.mjs",
    "popup.html",
    "popup.css",
    "popup.mjs",
    "capture.mjs",
    "capture-image.mjs",
    "bookmark-icon.mjs",
    "style.css",
    "workbench.css",
    "workbench-ui.mjs",
    "motion-ui.mjs",
    "vendor/motion-14.6.0.mjs",
    "vendor/MOTION-LICENSE.md",
    "vendor/FRAMER-MOTION-LICENSE.md",
    "vendor/MOTION-DOM-LICENSE.md",
    "vendor/MOTION-UTILS-LICENSE.md",
    "app.mjs",
    "api.mjs",
    "controller.mjs",
    "background.mjs",
    "backup.mjs",
    "backup-ui.mjs",
    "workspace.mjs",
    "workspace-ui.mjs",
    "icon-batch.mjs",
    "icon-batch-ui.mjs",
    "site-audit.mjs",
    "site-audit-ui.mjs",
    "navigation.mjs",
    "navigation-ui.mjs",
    "icon-snapshots.mjs",
    "vendor/sortable-1.15.7.mjs",
    "vendor/sortable-LICENSE.txt",
    "ui.mjs",
    "controls.mjs",
    "appearance.mjs",
    "appearance-ui.mjs",
    "knowledge-ui.mjs",
    "shell.mjs",
    "assets/mist.svg",
    "assets/icons/icon-16.png",
    "assets/icons/icon-24.png",
    "assets/icons/icon-32.png",
    "assets/icons/icon-48.png",
    "assets/icons/icon-64.png",
    "assets/icons/icon-128.png",
    "assets/icons/icon-256.png",
    "assets/icons/icon-512.png",
    "assets/icons/favicon.ico",
    "markdown.mjs",
    "vendor/markdown-it-15.0.3.mjs",
    "vendor/markdown-it-LICENSE.txt",
    "vendor/THIRD-PARTY-NOTICES.txt",
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
            (output / relative).parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(file, output / relative)
        hashes = {name: hashlib.sha256((output / name).read_bytes()).hexdigest() for name in FILES}
        (output / "release.json").write_text(
            json.dumps({"version": manifest["version"], "files": hashes}, indent=2) + "\n"
        )
        with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as zipped:
            for name in sorted((*FILES, "release.json")):
                file = output / name
                info = zipfile.ZipInfo("chrome-kb/" + name)
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
