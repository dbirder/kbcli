"""Strictly scoped, immutable Chrome workspace backups (never credentials)."""
from __future__ import annotations

import base64
import copy
import json
import re
from urllib.parse import urlsplit

from .errors import KBError, result
from .vault import sha

PREFIX = "assets/app-backups/chrome-kb"
UUID = r"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}"
HASH = r"[0-9a-f]{64}"
MAX_BYTES = 4 * 1024 * 1024


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def require(condition):
    if not condition:
        raise KBError("BACKUP_INVALID", "备份格式无效或包含不支持的字段")


def fields(obj, keys):
    require(isinstance(obj, dict) and set(obj) == set(keys.split()))


def text(value, size):
    require(isinstance(value, str) and 0 < len(value) <= size and bool(value.strip()))


def validate_payload(data, *, stored=False):
    fields(data, "navigation appearance")
    nav, app = data["navigation"], data["appearance"]
    fields(nav, "groups bookmarks preferences")
    require(isinstance(nav["groups"], list) and len(nav["groups"]) <= 100)
    require(isinstance(nav["bookmarks"], list) and len(nav["bookmarks"]) <= 2000)
    ids, names, sites = set(), set(), set()
    for group in nav["groups"]:
        fields(group, "id name")
        text(group["id"], 100)
        text(group["name"], 40)
        require(group["id"] not in ids and group["name"].strip() not in names)
        ids.add(group["id"])
        names.add(group["name"].strip())
    for site in nav["bookmarks"]:
        fields(site, "id title url groupId icon" if "icon" in site else "id title url groupId")
        if "icon" in site:
            validate_icon(site["icon"])
        text(site["id"], 100)
        text(site["title"], 100)
        text(site["url"], 4096)
        try:
            url = urlsplit(site["url"])
            require(url.scheme in {"https", "http"} and bool(url.hostname) and not url.username and not url.password)
        except ValueError as exc:
            raise KBError("BACKUP_INVALID", "备份网址无效") from exc
        require(site["id"] not in sites and site["groupId"] in ids)
        sites.add(site["id"])
    require(sum(len(s.get("icon", {}).get("dataURL", "")) for s in nav["bookmarks"]) <= 1024 * 1024)
    fields(nav["preferences"], "openInNewTab showKnowledge compact")
    require(all(isinstance(v, bool) for v in nav["preferences"].values()))
    fields(app, "theme dim blur position showClock engine wallpaper")
    require(app["theme"] in {"mist", "dusk", "night"})
    require(type(app["dim"]) is int and 0 <= app["dim"] <= 75)
    require(type(app["blur"]) is int and 0 <= app["blur"] <= 16)
    require(app["position"] in {"center", "top", "bottom"} and isinstance(app["showClock"], bool))
    require(app["engine"] in {"bing", "google", "baidu"})
    wallpaper = app["wallpaper"]
    if wallpaper is not None:
        fields(wallpaper, "name hash" if stored else "name dataURL")
        text(wallpaper["name"], 160)
        if stored:
            require(isinstance(wallpaper["hash"], str) and bool(re.fullmatch(HASH, wallpaper["hash"])))
        else:
            validate_wallpaper({"dataURL": wallpaper["dataURL"]})
    return data


def validate_icon(icon):
    require(isinstance(icon, dict))
    if icon.get("mode") == "text":
        fields(icon, "mode text color")
        text(icon["text"], 2)
        require(isinstance(icon["color"], str) and bool(re.fullmatch(r"#[0-9a-fA-F]{6}", icon["color"])))
        return
    require(icon.get("mode") in {"auto", "image"})
    fields(icon, "mode dataURL sourceURL" if "sourceURL" in icon else "mode dataURL")
    raw = icon["dataURL"]
    require(isinstance(raw, str) and len(raw) <= 32 * 1024 and raw.startswith("data:image/webp;base64,"))
    try:
        decoded = base64.b64decode(raw[23:], validate=True)
    except ValueError as exc:
        raise KBError("BACKUP_INVALID", "网站图标数据无效") from exc
    require(decoded[:4] == b"RIFF" and decoded[8:12] == b"WEBP")
    if "sourceURL" in icon:
        text(icon["sourceURL"], 4096)
        try:
            url = urlsplit(icon["sourceURL"])
            require(url.scheme in {"http", "https"} and bool(url.hostname) and not url.username and not url.password)
        except ValueError as exc:
            raise KBError("BACKUP_INVALID", "图标网址无效") from exc


def validate_wallpaper(value):
    fields(value, "dataURL")
    raw = value["dataURL"]
    require(isinstance(raw, str) and len(raw) <= 2 * 1024 * 1024 and raw.startswith("data:image/webp;base64,"))
    try:
        decoded = base64.b64decode(raw[23:], validate=True)
    except ValueError as exc:
        raise KBError("BACKUP_INVALID", "背景数据无效") from exc
    require(decoded[:4] == b"RIFF" and decoded[8:12] == b"WEBP")


def backup_path(vault, path, kind):
    pattern = (
        rf"{PREFIX}/devices/{UUID}/{UUID}\.json"
        if kind == "chrome_backup"
        else rf"{PREFIX}/wallpapers/{HASH}\.json"
        if kind == "chrome_wallpaper"
        else r"(?!)"
    )
    require(isinstance(path, str) and bool(re.fullmatch(pattern, path)))
    return vault.safe(path)


def validate_record(path, kind, raw):
    try:
        require(len(raw.encode()) <= MAX_BYTES)
        data = json.loads(raw)
        if kind == "chrome_wallpaper":
            validate_wallpaper(data)
            require(path.rsplit("/", 1)[-1] == sha(canonical(data))[7:] + ".json")
        else:
            fields(data, "format version device_id backup_id device_name saved_at payload")
            require(data["format"] == "kb-workspace-backup" and type(data["version"]) is int and data["version"] == 1)
            require(path.endswith(f'/devices/{data["device_id"]}/{data["backup_id"]}.json'))
            text(data["device_name"], 80)
            require(isinstance(data["saved_at"], str) and bool(re.fullmatch(r"\d{4}-\d\d-\d\dT.*", data["saved_at"])))
            validate_payload(data["payload"], stored=True)
        return data
    except (ValueError, TypeError, KeyError, RecursionError) as exc:
        raise KBError("BACKUP_INVALID", "备份文件无法校验") from exc


class Backups:
    def __init__(self, vault, operations):
        self.vault, self.operations = vault, operations

    def path(self, device, identifier):
        return f"{PREFIX}/devices/{device}/{identifier}.json"

    def save(self, value):
        fields(value, "device_id backup_id device_name payload")
        text(value["device_name"], 80)
        path = self.path(value["device_id"], value["backup_id"])
        backup_path(self.vault, path, "chrome_backup")
        try:
            require(len(canonical(value).encode()) <= MAX_BYTES)
            data = copy.deepcopy(validate_payload(value["payload"]))
        except (ValueError, TypeError, KeyError, RecursionError) as exc:
            raise KBError("BACKUP_INVALID", "备份内容无法校验") from exc
        with self.vault.writing():
            wallpaper = data["appearance"]["wallpaper"]
            if wallpaper:
                asset = {"dataURL": wallpaper["dataURL"]}
                digest = sha(canonical(asset))[7:]
                self.operations.write_backup(f"{PREFIX}/wallpapers/{digest}.json", canonical(asset), kind="chrome_wallpaper")
                data["appearance"]["wallpaper"] = {"name": wallpaper["name"], "hash": digest}
            target = backup_path(self.vault, path, "chrome_backup")
            if target.exists():
                old = validate_record(path, "chrome_backup", target.read_text())
                require(old["payload"] == data and old["device_name"] == value["device_name"])
                return result(saved=True, duplicate=True, backup=self.summary(old), path=path, pushed=False)
            stored = {"format": "kb-workspace-backup", "version": 1, **{k: value[k] for k in ("device_id", "backup_id", "device_name")}, "saved_at": self.vault.now(), "payload": data}
            self.operations.write_backup(path, canonical(stored), kind="chrome_backup")
            return result(saved=True, duplicate=False, backup=self.summary(stored), path=path, pushed=False)

    @staticmethod
    def summary(data):
        nav = data["payload"]["navigation"]
        return {k: data[k] for k in ("device_id", "backup_id", "device_name", "saved_at")} | {"groups": len(nav["groups"]), "bookmarks": len(nav["bookmarks"])}

    def list(self, limit=100):
        root = self.vault.safe(f"{PREFIX}/devices")
        records = []
        invalid = 0
        for p in root.glob("*/*.json"):
            try:
                path = str(p.relative_to(self.vault.root))
                target = backup_path(self.vault, path, "chrome_backup")
                require(target.stat().st_size <= MAX_BYTES)
                records.append(self.summary(validate_record(path, "chrome_backup", target.read_text())))
            except (KBError, OSError, UnicodeError):
                invalid += 1
        return result(backups=sorted(records, key=lambda r: (r["saved_at"], r["backup_id"]), reverse=True)[:limit], invalid_files=invalid)

    def read(self, device, identifier):
        path = self.path(device, identifier)
        target = backup_path(self.vault, path, "chrome_backup")
        if not target.is_file():
            raise KBError("BACKUP_NOT_FOUND", "找不到备份")
        require(target.stat().st_size <= MAX_BYTES)
        data = validate_record(path, "chrome_backup", target.read_text())
        wallpaper = data["payload"]["appearance"]["wallpaper"]
        if wallpaper:
            asset_path = f'{PREFIX}/wallpapers/{wallpaper["hash"]}.json'
            asset = backup_path(self.vault, asset_path, "chrome_wallpaper")
            require(asset.stat().st_size <= MAX_BYTES)
            value = validate_record(asset_path, "chrome_wallpaper", asset.read_text())
            data["payload"]["appearance"]["wallpaper"] = {"name": wallpaper["name"], **value}
        return result(backup=data)
