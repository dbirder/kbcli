import importlib.util
import json
import zipfile
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "extension_builder", ROOT / "scripts/build_extension.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def test_package_allowlist_excludes_credentials_and_test_shims(tmp_path):
    source = tmp_path / "source"
    source.mkdir()
    for name in builder.FILES:
        (source / name).write_bytes((ROOT / "extensions/chrome-kb" / name).read_bytes())
    (source / "service.env").write_text("NEVER_SHIP=private")
    (source / "chrome-shim.mjs").write_text("test-only chrome mock")
    (source / ".DS_Store").write_text("machine metadata")
    report = builder.build(tmp_path / "release", source)
    with zipfile.ZipFile(report["archive"]) as archive:
        assert set(archive.namelist()) == {
            "chrome-kb/" + name for name in (*builder.FILES, "release.json")
        }
        assert all(b"NEVER_SHIP" not in archive.read(name) for name in archive.namelist())
        assert json.loads(archive.read("chrome-kb/manifest.json"))["manifest_version"] == 3
    with pytest.raises(FileExistsError):
        builder.build(tmp_path / "release", source)
