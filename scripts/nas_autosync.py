"""NAS scheduler for the existing authenticated kbcli sync API (standard library only)."""

from __future__ import annotations

import argparse
import fcntl
import json
import os
import re
import signal
import sqlite3
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

RETRYABLE = {"SYNC_OFFLINE", "PUSH_PENDING", "GIT_UNAVAILABLE", "LOCK_TIMEOUT", "API_UNAVAILABLE"}


def timestamp():
    return datetime.now(timezone.utc).isoformat()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".autosync-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


class SyncError(Exception):
    def __init__(self, error):
        # Git may include a configured URL in its stderr; never retain embedded credentials.
        raw = json.dumps(error, ensure_ascii=False)
        raw = re.sub(r"(https?://)[^\s/@]+:[^\s/@]+@", r"\1***@", raw)
        self.error = json.loads(raw)
        self.code = self.error.get("code", "UNEXPECTED_ERROR")
        super().__init__(self.error.get("message", self.code))


class API:
    def __init__(self, server, token_file=None, *, token_env=None):
        self.server = server.rstrip("/")
        self.token_file = Path(token_file) if token_file else None
        self.token_env = token_env

    def __call__(self, command, params):
        try:
            token = (
                self.token_file.read_text()
                if self.token_file
                else os.environ.get(self.token_env or "", "")
            ).strip()
            if not token:
                raise OSError("Configured authentication token is empty")
        except OSError as exc:
            raise SyncError({"code": "AUTH_CONFIG_INVALID", "message": str(exc)}) from exc
        request = Request(
            self.server + "/api/command",
            data=json.dumps({"command": command, "params": params}).encode(),
            headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=180) as response:
                value = json.load(response)
        except HTTPError as exc:
            if exc.code >= 500:
                raise SyncError({"code": "API_UNAVAILABLE", "message": f"HTTP {exc.code}"}) from exc
            try:
                value = json.load(exc)
            except (ValueError, OSError) as parse_error:
                raise SyncError(
                    {"code": "API_INVALID_RESPONSE", "message": f"HTTP {exc.code}"}
                ) from parse_error
        except (URLError, TimeoutError, OSError) as exc:
            raise SyncError({"code": "API_UNAVAILABLE", "message": str(exc)}) from exc
        except ValueError as exc:
            raise SyncError({"code": "API_INVALID_RESPONSE", "message": "Invalid JSON"}) from exc
        if not isinstance(value, dict) or not isinstance(value.get("ok"), bool):
            raise SyncError({"code": "API_INVALID_RESPONSE", "message": "Invalid result envelope"})
        if not value["ok"]:
            raise SyncError(value.get("error", {"code": "API_INVALID_RESPONSE"}))
        return value


class Worker:
    def __init__(self, api, journal, state_dir, *, poll=5, pull=60, retry_base=15, retry_max=300):
        self.api = api
        self.journal = Path(journal)
        self.directory = Path(state_dir)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.poll = poll
        self.pull = pull
        self.retry_base = retry_base
        self.retry_max = retry_max
        self.next_sync = 0.0
        self.retry_until = 0.0
        self.failures = 0
        self.value = self.read_status()
        self.value.update(poll_seconds=poll, pull_seconds=pull)

    def read_status(self):
        try:
            return json.loads((self.directory / "status.json").read_text())
        except (OSError, ValueError):
            return {}

    def pause_reason(self):
        path = self.directory / "pause.json"
        try:
            value = json.loads(path.read_text())
            if not isinstance(value, dict) or not isinstance(value.get("error"), dict):
                raise ValueError("Invalid pause marker")
            return value
        except FileNotFoundError:
            return None
        except (ValueError, OSError):
            return {"error": {"code": "PAUSE_STATE_INVALID", "message": "Inspect pause.json"}}

    def event(self, event, **values):
        path = self.directory / "events.jsonl"
        if path.exists() and path.stat().st_size > 1024 * 1024:
            for number in range(3, 0, -1):
                previous = self.directory / f"events.jsonl.{number}"
                if previous.exists():
                    previous.replace(self.directory / f"events.jsonl.{number + 1}")
            path.replace(self.directory / "events.jsonl.1")
        data = json.dumps({"at": timestamp(), "event": event, **values}, ensure_ascii=False)
        with path.open("a") as stream:
            stream.write(data + "\n")
        print(data, flush=True)

    def save(self, state, now):
        self.value.update(state=state, heartbeat=time.time(), updated_at=timestamp())
        remaining = max(0, self.next_sync - now)
        self.value["next_attempt_at"] = (
            (datetime.now(timezone.utc) + timedelta(seconds=remaining)).isoformat()
            if state != "paused"
            else None
        )
        atomic_json(self.directory / "status.json", self.value)
        return self.value

    def pending(self):
        if not self.journal.exists():
            return False
        try:
            with sqlite3.connect(
                self.journal.resolve().as_uri() + "?mode=ro", uri=True, timeout=1
            ) as db:
                row = db.execute(
                    "SELECT COUNT(*) FROM operations WHERE state='saved' AND commit_id IS NULL"
                ).fetchone()
                recovery = db.execute(
                    "SELECT COUNT(*) FROM operations WHERE state IN ('prepared','recovery_needed')"
                ).fetchone()
                return bool(row[0] or recovery[0])
        except (OSError, sqlite3.Error) as exc:
            raise SyncError({"code": "JOURNAL_STATE_UNREADABLE", "message": str(exc)}) from exc

    def pause(self, error):
        atomic_json(self.directory / "pause.json", {"paused_at": timestamp(), "error": error})
        self.event("paused", error=error)

    def resume(self):
        # Clearing the latch is explicit; do not hide an unresolved local conflict.
        status = self.api("status", {"portable": True})
        git = status.get("git", {})
        if (
            git.get("state") != "clean"
            or not git.get("configured_upstream")
            or not git.get("upstream_ref_present")
            or not status.get("journal", {}).get("observed")
            or status.get("recovery_pending")
            or status.get("schema", {}).get("errors", 0)
        ):
            raise SyncError(
                {"code": "RESUME_BLOCKED", "message": "Resolve Git/content state first"}
            )
        (self.directory / "pause.json").unlink(missing_ok=True)
        self.event("resume_requested")

    def tick(self, now=None):
        supplied_now = now is not None
        now = time.monotonic() if now is None else now
        paused = self.pause_reason()
        if paused is not None:
            self.value["pause"] = paused
            return self.save("paused", now)
        self.value.pop("pause", None)
        if self.value.get("state") == "paused":
            self.next_sync = self.retry_until = 0
            self.failures = 0
        if now < self.retry_until:
            return self.save("retrying", now)
        try:
            if now < self.next_sync and not self.pending():
                return self.save("idle", now)
            self.save("syncing", now)
            result = self.api("sync", {"commit_tools": True})
            if not result.get("synced"):
                raise SyncError({"code": "SYNC_NOT_CONFIRMED", "message": "Sync not confirmed"})
            now = now if supplied_now else time.monotonic()
            self.failures = 0
            self.retry_until = 0
            self.next_sync = now + self.pull
            self.value.update(
                last_success_at=timestamp(),
                last_error=None,
                consecutive_failures=0,
                head=result.get("git", {}).get("head"),
                local_commit=result.get("local_commit"),
            )
            self.event("synced", head=self.value["head"], local_commit=self.value["local_commit"])
            return self.save("idle", now)
        except SyncError as exc:
            now = now if supplied_now else time.monotonic()
            self.value["last_error"] = exc.error
            rejected = exc.code == "PUSH_PENDING" and re.search(
                r"\[rejected\]|\[remote rejected\]|non-fast-forward|fetch first",
                str(exc.error.get("details", {}).get("reason", "")),
                re.I,
            )
            if exc.code in RETRYABLE and not rejected:
                self.failures += 1
                delay = min(self.retry_max, self.retry_base * 2 ** min(self.failures - 1, 12))
                self.retry_until = self.next_sync = now + delay
                self.value["consecutive_failures"] = self.failures
                self.event("retry_scheduled", delay_seconds=delay, error=exc.error)
                return self.save("retrying", now)
            self.pause(exc.error)
            self.value["pause"] = self.pause_reason()
            return self.save("paused", now)

    def run(self):
        stop = threading.Event()
        signal.signal(signal.SIGTERM, lambda *_: stop.set())
        signal.signal(signal.SIGINT, lambda *_: stop.set())
        with (self.directory / "worker.lock").open("a") as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise SystemExit(
                    "Another autosync worker already owns this state directory"
                ) from None
            self.event("started")
            while not stop.is_set():
                self.tick()
                stop.wait(self.poll)
            self.event("stopped")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server", default="http://kbcli:8765")
    auth = parser.add_mutually_exclusive_group(required=True)
    auth.add_argument("--token-file", type=Path)
    auth.add_argument(
        "--token-env", help="Owner token environment variable; never pass a token value"
    )
    parser.add_argument("--journal", type=Path, required=True)
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--poll", type=float, default=5)
    parser.add_argument("--pull", type=float, default=60)
    parser.add_argument("--reason", default="Operator paused automatic synchronization")
    parser.add_argument("action", choices=["run", "once", "status", "pause", "resume", "health"])
    args = parser.parse_args()
    if args.poll < 1 or args.pull < args.poll:
        parser.error("Require 1 <= poll <= pull")
    worker = Worker(
        API(args.server, args.token_file, token_env=args.token_env),
        args.journal,
        args.state_dir,
        poll=args.poll,
        pull=args.pull,
    )
    try:
        if args.action == "run":
            worker.run()
            return
        if args.action == "once":
            value = worker.tick()
        elif args.action == "pause":
            worker.pause({"code": "OPERATOR_PAUSED", "message": args.reason})
            value = {"state": "paused", "pause": worker.pause_reason()}
        elif args.action == "resume":
            worker.resume()
            value = {"state": "resume_requested"}
        else:
            value = worker.read_status()
            paused = worker.pause_reason()
            if paused is not None:
                value.update(state="paused", pause=paused)
        print(json.dumps(value, ensure_ascii=False, indent=2))
        if args.action == "health":
            raise SystemExit(
                not value
                or value.get("state") == "paused"
                or time.time() - value.get("heartbeat", 0) > 240
            )
        if args.action == "once" and value["state"] != "idle":
            raise SystemExit(2)
    except SyncError as exc:
        print(json.dumps({"ok": False, "error": exc.error}, ensure_ascii=False))
        raise SystemExit(2) from None


if __name__ == "__main__":
    main()
