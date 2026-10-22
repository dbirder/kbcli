"""Export PNG sizes and a multi-frame ICO from the project branding master.

Uses macOS sips or ImageMagick for technical image resizing; no Python image
editing library or network call is required. The master is never overwritten.
"""
import shutil
import struct
import subprocess
from pathlib import Path

SIZES = (16, 24, 32, 48, 64, 128, 256, 512)


def png_size(data):
    if data[:8] != b"\x89PNG\r\n\x1a\n" or data[12:16] != b"IHDR":
        raise ValueError("Expected a PNG image")
    return struct.unpack(">II", data[16:24])


def build(root):
    master = root / "assets/branding/kb-icon-master.png"
    width, height = png_size(master.read_bytes())
    if width != height or width < 512:
        raise ValueError("Branding master must be square and at least 512px")
    output = root / "extensions/chrome-kb/assets/icons"
    output.mkdir(parents=True, exist_ok=True)
    sips, magick = shutil.which("sips"), shutil.which("magick")
    if not sips and not magick:
        raise RuntimeError("Install ImageMagick, or run on macOS with sips")
    for size in SIZES:
        target = output / f"icon-{size}.png"
        args = ([sips, "-s", "format", "png", "-z", str(size), str(size), str(master), "--out", str(target)]
                if sips else [magick, str(master), "-resize", f"{size}x{size}", str(target)])
        subprocess.run(args, check=True, capture_output=True)
        assert png_size(target.read_bytes()) == (size, size)
    # ICO is a container; each frame is an unchanged, already-resized PNG.
    sizes = (16, 32, 48, 128, 256)
    offset = 6 + 16 * len(sizes)
    directory, images = [], []
    for size in sizes:
        raw = (output / f"icon-{size}.png").read_bytes()
        bits = {0: 8, 2: 24, 3: 8, 4: 16, 6: 32}[raw[25]]
        directory.append(struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, bits, len(raw), offset))
        images.append(raw)
        offset += len(raw)
    ico = struct.pack("<HHH", 0, 1, len(sizes)) + b"".join(directory + images)
    (output / "favicon.ico").write_bytes(ico)
    (root / "assets/branding/kb.ico").write_bytes(ico)
    shutil.copyfile(output / "icon-512.png", root / "assets/branding/kb-icon.png")
    return output


if __name__ == "__main__":
    print(build(Path(__file__).resolve().parents[1]))
