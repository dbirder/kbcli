"""Immutable shared workspace revisions with compare-and-swap publication."""
from __future__ import annotations

import copy
import re

from .backups import (
    HASH,
    MAX_BYTES,
    PREFIX,
    UUID,
    Backups,
    backup_path,
    canonical,
    fields,
    require,
    text,
    validate_payload,
    validate_record,
)
from .errors import KBError, result
from .vault import sha


def workspace_path(vault, path):
    require(isinstance(path, str) and bool(re.fullmatch(rf"{PREFIX}/shared/{UUID}\.json", path)))
    return vault.safe(path)


def validate_revision(path, raw):
    import json

    try:
        require(len(raw.encode()) <= MAX_BYTES)
        data = json.loads(raw)
        fields(data, "format version revision parent_revision device_id device_name saved_at content_hash payload")
        require(data["format"] == "kb-workspace-sync" and type(data["version"]) is int and data["version"] == 1)
        require(bool(re.fullmatch(UUID, data["revision"])) and path.endswith('/' + data["revision"] + '.json'))
        require(data["parent_revision"] is None or bool(re.fullmatch(UUID, data["parent_revision"])))
        require(bool(re.fullmatch(UUID, data["device_id"])))
        require(bool(re.fullmatch("sha256:" + HASH, data["content_hash"])))
        text(data["device_name"], 80)
        text(data["saved_at"], 80)
        validate_payload(data["payload"], stored=True)
        return data
    except (ValueError, TypeError, KeyError, RecursionError) as exc:
        raise KBError("WORKSPACE_INVALID", "共享版本格式无效，暂停同步") from exc


class Workspace:
    def __init__(self, vault, operations):
        self.vault, self.operations = vault, operations
        self.backups = Backups(vault, operations)
        self._metadata_cache = {}

    def history(self):
        records = {}
        root = self.vault.safe(f"{PREFIX}/shared")
        for file in root.glob("*.json"):
            path = str(file.relative_to(self.vault.root))
            target = workspace_path(self.vault, path)
            stat = target.stat()
            require(stat.st_size <= MAX_BYTES)
            stamp = (stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
            cached = self._metadata_cache.get(path)
            if cached and cached[0] == stamp:
                data = cached[1]
            else:
                data = self.summary(self.hydrate(validate_revision(path, target.read_text())))
                self._metadata_cache[path] = (stamp, data)
            records[data["revision"]] = data
        if not records:
            return records, None
        parents = {r["parent_revision"] for r in records.values() if r["parent_revision"]}
        tips = set(records) - parents
        if not parents.issubset(records) or len(tips) != 1:
            raise KBError("WORKSPACE_FORK", "共享历史缺失或出现分叉，保留内容并在 NAS 检查")
        tip = next(iter(tips))
        seen, current = set(), tip
        while current:
            if current in seen:
                raise KBError("WORKSPACE_FORK", "共享历史出现循环，暂停同步")
            seen.add(current)
            current = records[current]["parent_revision"]
        if len(seen) != len(records):
            raise KBError("WORKSPACE_FORK", "共享历史不连通，暂停同步")
        return records, records[tip]

    @staticmethod
    def summary(data):
        return {key: data[key] for key in ("revision", "parent_revision", "device_id", "device_name", "saved_at", "content_hash")}

    def hydrate(self, data):
        path = f'{PREFIX}/shared/{data["revision"]}.json'
        value = validate_revision(path, workspace_path(self.vault, path).read_text())
        wallpaper = value["payload"]["appearance"]["wallpaper"]
        if wallpaper:
            path = f'{PREFIX}/wallpapers/{wallpaper["hash"]}.json'
            target = backup_path(self.vault, path, "chrome_wallpaper")
            require(target.stat().st_size <= MAX_BYTES)
            asset = validate_record(path, "chrome_wallpaper", target.read_text())
            value["payload"]["appearance"]["wallpaper"] = {"name": wallpaper["name"], **asset}
        if sha(canonical(value["payload"])) != value["content_hash"]:
            raise KBError("WORKSPACE_INVALID", "共享内容哈希不匹配，暂停同步")
        return value

    def read(self, request_id=None, known_revision=None):
        if request_id is not None:
            require(isinstance(request_id, str) and bool(re.fullmatch(UUID, request_id)))
        if known_revision is not None:
            require(isinstance(known_revision, str) and bool(re.fullmatch(UUID, known_revision)))
        with self.vault.writing():
            records, head = self.history()
            unchanged = bool(head and head["revision"] == known_revision)
            return result(unchanged=unchanged, head=(self.summary(head) if unchanged else self.hydrate(head)) if head else None, acknowledged=self.summary(records[request_id]) if request_id in records else None)

    def publish(self, value):
        fields(value, "device_id request_id device_name base_revision payload")
        require(isinstance(value["request_id"], str) and bool(re.fullmatch(UUID, value["request_id"])))
        require(value["base_revision"] is None or (isinstance(value["base_revision"], str) and bool(re.fullmatch(UUID, value["base_revision"]))))
        try:
            require(len(canonical(value).encode()) <= MAX_BYTES)
            payload = copy.deepcopy(validate_payload(value["payload"]))
            digest = sha(canonical(payload))
        except (TypeError, ValueError, KeyError, RecursionError) as exc:
            raise KBError("WORKSPACE_INVALID", "共享数据校验失败") from exc
        with self.vault.writing():
            records, head = self.history()
            existing = records.get(value["request_id"])
            if existing:
                require(existing["device_id"] == value["device_id"] and existing["device_name"] == value["device_name"] and existing["parent_revision"] == value["base_revision"] and existing["content_hash"] == digest)
                return result(saved=True, duplicate=True, revision=self.summary(existing))
            # Every proposal is preserved, including rejected stale writes. This
            # also keeps all accepted shared versions available in the backup UI.
            saved = self.backups.save({"device_id": value["device_id"], "backup_id": value["request_id"], "device_name": value["device_name"], "payload": payload})
            if (head["revision"] if head else None) != value["base_revision"]:
                raise KBError("WORKSPACE_CHANGED", "共享版本已变化，本机提交已保存为保护备份，未覆盖共享内容", preserved_backup_id=value["request_id"], current_revision=head["revision"] if head else None)
            # Reuse the validated, deduplicated wallpaper reference from the backup.
            stored = validate_record(saved["path"], "chrome_backup", self.vault.safe(saved["path"]).read_text())
            record = {"format": "kb-workspace-sync", "version": 1, "revision": value["request_id"], "parent_revision": value["base_revision"], "device_id": value["device_id"], "device_name": value["device_name"], "saved_at": self.vault.now(), "content_hash": digest, "payload": stored["payload"]}
            self.operations.write_backup(f'{PREFIX}/shared/{value["request_id"]}.json', canonical(record), kind="chrome_workspace")
            return result(saved=True, duplicate=False, revision=self.summary(record))
