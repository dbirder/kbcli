"""Read-only, portable view of the external NAS scheduler; never clears its pause latch."""

import json
import math
import time
from pathlib import Path

from .errors import KBError, result

MESSAGES = {
    "SYNC_CONFLICT": "两端历史出现分叉，自动同步已暂停",
    "DIRTY_WORKTREE": "发现未确认的工作区修改，自动同步已暂停",
    "GIT_INDEX_DIRTY": "存在人工暂存内容，自动同步已暂停",
    "UNKNOWN_MODIFICATION": "发现未知修改，自动同步已暂停",
    "RECOVERY_REQUIRED": "存在需要人工确认的操作记录",
    "SCHEMA_INVALID": "待提交记录未通过规范检查",
    "OPERATOR_PAUSED": "自动同步已由操作者暂停",
    "PAUSE_STATE_INVALID": "暂停记录无法读取，需要检查 NAS 日志",
    "SYNC_OFFLINE": "远端暂不可达，本地内容和提交已保留",
    "PUSH_PENDING": "推送尚未成功，本地提交已保留",
    "API_UNAVAILABLE": "知识库服务暂不可达，调度器将重试",
}


def public_error(value):
    if not isinstance(value, dict):
        return None
    code = value.get("code")
    if not isinstance(code, str):
        return None
    return {"code": code, "message": MESSAGES.get(code, "自动同步出现问题，请检查 NAS 同步日志")}


def observe(directory, *, vault_root=None, now=None):
    if not directory:
        return result(configured=False, observed=False, state="not_configured")
    directory = Path(directory).expanduser().resolve()
    if vault_root and directory.is_relative_to(Path(vault_root).resolve()):
        raise KBError("CONFIG_INVALID", "自动同步状态目录必须在知识库之外")
    value = result(configured=True, observed=True, state="not_started")
    try:
        try:
            saved = json.loads((directory / "status.json").read_text())
            if not isinstance(saved, dict):
                raise ValueError("Invalid status")
        except FileNotFoundError:
            saved = {}
        for key in ("updated_at", "last_success_at", "next_attempt_at"):
            if isinstance(saved.get(key), str):
                value[key] = saved[key]
        for key in ("heartbeat", "poll_seconds", "pull_seconds", "consecutive_failures"):
            number = saved.get(key)
            if (
                isinstance(number, (float, int))
                and not isinstance(number, bool)
                and math.isfinite(number)
            ):
                value[key] = number
        state = saved.get("state", "not_started")
        value["state"] = (
            state
            if state in {"idle", "syncing", "retrying", "paused", "not_started"}
            else "unavailable"
        )
        value["last_error"] = public_error(saved.get("last_error"))
        heartbeat = value.get("heartbeat")
        current = time.time() if now is None else now
        value["worker_alive"] = bool(heartbeat and -60 <= current - heartbeat <= 240)
        if saved and not value["worker_alive"]:
            value["state"] = "stale"
        # A separate marker is authoritative, including between CLI pause and the next tick.
        try:
            pause = json.loads((directory / "pause.json").read_text())
            if not isinstance(pause, dict) or not isinstance(pause.get("error"), dict):
                raise ValueError("Invalid pause marker")
            value["state"] = "paused"
            value["pause"] = {"error": public_error(pause["error"])}
            if isinstance(pause.get("paused_at"), str):
                value["pause"]["paused_at"] = pause["paused_at"]
        except FileNotFoundError:
            if value["state"] == "paused":
                value["state"] = "resuming" if value["worker_alive"] else "stale"
        value["paused"] = value["state"] == "paused"
        return value
    except (OSError, ValueError):
        # Do not echo raw files, paths or exception text to remote clients.
        return result(
            configured=True,
            observed=False,
            state="unavailable",
            error={
                "code": "AUTOSYNC_STATE_UNREADABLE",
                "message": "无法读取自动同步状态，请检查 NAS 配置",
            },
        )
