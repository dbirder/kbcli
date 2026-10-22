from __future__ import annotations

import os
import subprocess

from .errors import KBError, result
from .indexing import Index
from .operations import Operations
from .vault import sha


class Git:
    def __init__(self, vault):
        self.vault = vault

    def run(self, *args, check=True, binary=False):
        try:
            out = subprocess.run(
                ["git", "-C", str(self.vault.root), *args],
                capture_output=True,
                text=not binary,
                timeout=45,
                env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise KBError("GIT_UNAVAILABLE", str(exc)) from exc
        if check and out.returncode:
            raise KBError(
                "GIT_FAILED",
                "Git 操作失败",
                command=list(args),
                reason=out.stderr.decode(errors="replace") if binary else out.stderr.strip(),
            )
        return out

    def assert_root(self):
        out = self.run("rev-parse", "--show-toplevel", check=False)
        if out.returncode:
            raise KBError("GIT_NOT_INITIALIZED", "知识库尚未初始化 Git")
        if out.stdout.strip() != str(self.vault.root):
            raise KBError("GIT_ROOT_MISMATCH", "知识库不是所在 Git 仓库的根，拒绝操作父仓库")

    def configured_upstream(self, branch):
        if not branch:
            return None, None, None
        remote = self.run("config", "--get", f"branch.{branch}.remote", check=False)
        merge = self.run("config", "--get", f"branch.{branch}.merge", check=False)
        remote = remote.stdout.strip() if not remote.returncode else None
        merge = merge.stdout.strip() if not merge.returncode else None
        if not remote or not merge:
            return remote, merge, None
        name = merge.removeprefix("refs/heads/")
        return remote, merge, name if remote == "." else f"{remote}/{name}"

    def tracking_ref(self, branch, remote, merge):
        if not remote or not merge:
            return None
        if remote == ".":
            return merge
        configured = self.run(
            "for-each-ref", "--format=%(refname) %(upstream)", f"refs/heads/{branch}"
        ).stdout
        for line in configured.splitlines():
            name, _, tracked = line.partition(" ")
            if name == f"refs/heads/{branch}" and tracked:
                return tracked
        # An unborn branch has no local ref yet; map its configured fetch refspec.
        specs = self.run("config", "--get-all", f"remote.{remote}.fetch", check=False).stdout
        for spec in specs.splitlines():
            if spec.startswith("^") or ":" not in spec:
                continue
            source, destination = spec.removeprefix("+").split(":", 1)
            if "*" not in source and source == merge:
                return destination
            if source.count("*") == destination.count("*") == 1:
                prefix, suffix = source.split("*")
                if merge.startswith(prefix) and merge.endswith(suffix):
                    middle = merge[len(prefix) : len(merge) - len(suffix) if suffix else None]
                    return destination.replace("*", middle)
        return None

    def status(self, *, remote_checked=False):
        try:
            self.assert_root()
        except KBError as exc:
            return {
                "available": False,
                "code": exc.code,
                "message": str(exc),
                "state": "unavailable",
                "remote_checked": False,
            }
        branch = self.run("branch", "--show-current").stdout.strip()
        head = self.run("rev-parse", "--verify", "HEAD", check=False)
        remote, merge, configured = self.configured_upstream(branch)
        reference = self.tracking_ref(branch, remote, merge)
        present = bool(
            reference and self.run("rev-parse", "--verify", reference, check=False).returncode == 0
        )
        remote_exists = remote == "." or bool(
            remote and self.run("remote", "get-url", "--", remote, check=False).returncode == 0
        )
        raw = self.run("status", "--porcelain=v1", "-z").stdout
        pieces = raw.split("\0")
        dirty = []
        i = 0
        while i < len(pieces):
            record = pieces[i]
            i += 1
            if not record:
                continue
            item = {"status": record[:2], "path": record[3:]}
            if "R" in record[:2] or "C" in record[:2]:
                if i < len(pieces):
                    item["old_path"] = pieces[i]
                    i += 1
            dirty.append(item)
        ahead = behind = None
        if head.returncode == 0 and present:
            counts = self.run(
                "rev-list", "--left-right", "--count", f"HEAD...{reference}"
            ).stdout.split()
            ahead, behind = map(int, counts)
        state = (
            "unborn"
            if head.returncode
            else "detached"
            if not branch
            else "diverged"
            if ahead and behind
            else "dirty"
            if dirty
            else "clean"
        )
        try:
            last_sync = self.sync_time()
            observed = True
        except OSError:
            last_sync = None
            observed = False
        return {
            "available": True,
            "state": state,
            "branch": branch,
            "head": head.stdout.strip() if head.returncode == 0 else None,
            "upstream": configured,
            "configured_upstream": configured,
            "tracking_ref": reference,
            "upstream_ref_present": present,
            "remote": remote,
            "merge_ref": merge,
            "remote_configured": remote_exists,
            "ahead": ahead,
            "behind": behind,
            "dirty": dirty,
            "last_successful_sync": last_sync,
            "sync_state_observed": observed,
            "remote_checked": remote_checked,
        }

    def sync_time(self):
        path = self.vault.state / "last-sync.txt"
        return path.read_text().strip() if path.exists() else None

    def commit_tools(self):
        operations = Operations(self.vault)
        if operations.recovery_pending():
            raise KBError(
                "RECOVERY_REQUIRED",
                "存在未确认的写入记录，暂停自动提交",
                operations=operations.recovery_pending(),
            )
        writes = operations.pending_writes()
        if not writes:
            return None
        staged = self.run("diff", "--cached", "--name-only", "-z").stdout
        if staged:
            raise KBError("GIT_INDEX_DIRTY", "已有暂存内容，不合并提交未知修改")
        for entry in writes:
            p = operations.recorded_path(entry)
            if not p.is_file() or sha(p.read_bytes()) != entry["after_hash"]:
                raise KBError(
                    "UNKNOWN_MODIFICATION", "工具写入之后文件又被修改，暂停提交", path=entry["path"]
                )
            if entry.get("kind") == "chrome_workspace":
                from .workspace import validate_revision

                validate_revision(entry["path"], p.read_text())
            if entry.get("kind") in {"chrome_backup", "chrome_wallpaper"}:
                from .backups import validate_record

                validate_record(entry["path"], entry["kind"], p.read_text())
            previous = self.run("show", "HEAD:" + entry["path"], check=False, binary=True)
            baseline = sha(previous.stdout) if previous.returncode == 0 else None
            if baseline != entry["baseline_hash"] and baseline != entry["after_hash"]:
                raise KBError(
                    "UNKNOWN_MODIFICATION",
                    "工具修改前已有未提交的人工内容，暂停提交",
                    path=entry["path"],
                )
        check = self.vault.check()
        errors = [
            i
            for i in check["issues"]
            if i["severity"] == "error"
            and i["path"] in {x["path"] for x in writes}
            and i["code"] != "REVIEW_STALE"
        ]
        if errors:
            raise KBError("SCHEMA_INVALID", "待提交记录不符合规范", issues=errors)
        paths = [x["path"] for x in writes]
        self.run("add", "--", *paths)
        # Confirm the staged blobs are exactly the recorded tool writes.
        for entry in writes:
            staged_raw = self.run("show", ":" + entry["path"], binary=True).stdout
            if sha(staged_raw) != entry["after_hash"]:
                raise KBError("FILE_CHANGED", "暂存期间文件变化，未提交", path=entry["path"])
        if not self.run("diff", "--cached", "--quiet", check=False).returncode:
            head = self.run("rev-parse", "HEAD", check=False)
            if not head.returncode:
                operations.mark_committed(paths, head.stdout.strip())
            return None
        self.run("commit", "-m", "kbcli: save recorded knowledge-base operations")
        commit = self.run("rev-parse", "HEAD").stdout.strip()
        operations.mark_committed(paths, commit)
        return commit

    def sync(self, commit_tools=False):
        with self.vault.writing():
            self.assert_root()
            status = self.status()
            if not status["head"]:
                raise KBError(
                    "NO_INITIAL_COMMIT",
                    "尚无首次提交；请先明确提交规范与现有内容，不自动创建首次提交",
                )
            if not status["branch"]:
                raise KBError("DETACHED_HEAD", "分离 HEAD 下不自动同步")
            if not status["configured_upstream"]:
                raise KBError("UPSTREAM_NOT_CONFIGURED", "当前分支未配置上游，工具不会猜测分支")
            if not status["remote_configured"]:
                raise KBError("REMOTE_NOT_CONFIGURED", "上游远端尚未配置")
            remote = status["remote"]
            if remote == ".":
                raise KBError(
                    "LOCAL_UPSTREAM_UNSUPPORTED",
                    "本地分支上游仅提供状态观测，不自动修改其他本地分支",
                )
            expected_remote = self.vault.config.get("sync", {}).get("remote", remote)
            if remote != expected_remote:
                raise KBError(
                    "SYNC_REMOTE_MISMATCH",
                    "配置的同步远端与分支上游不同",
                    configured=expected_remote,
                    upstream_remote=remote,
                )
            commit = self.commit_tools() if commit_tools else None
            status = self.status()
            if status["dirty"]:
                raise KBError(
                    "DIRTY_WORKTREE",
                    "有未提交修改，暂停同步",
                    files=status["dirty"],
                    local_commit=commit,
                )
            baseline = (status["branch"], status["head"], status["configured_upstream"])
            fetched = self.run("fetch", "--", remote, check=False)
            if fetched.returncode:
                raise KBError(
                    "SYNC_OFFLINE",
                    "拉取失败，保留本地数据和提交",
                    reason=fetched.stderr.strip(),
                    local_commit=commit,
                )
            status = self.status(remote_checked=True)
            if (
                baseline != (status["branch"], status["head"], status["configured_upstream"])
                or status["dirty"]
            ):
                raise KBError(
                    "GIT_STATE_CHANGED",
                    "获取期间本地分支或内容变化，未自动整合",
                    local_commit=commit,
                )
            if not status["upstream_ref_present"]:
                raise KBError(
                    "UPSTREAM_REF_MISSING",
                    "已获取远端，但配置的上游跟踪引用仍不存在；请核对远端分支与 fetch 映射",
                    upstream=status["configured_upstream"],
                    remote_checked=True,
                )
            if status["ahead"] and status["behind"]:
                raise KBError(
                    "SYNC_CONFLICT",
                    "历史已分叉，请人工整合；不会自动合并",
                    ahead=status["ahead"],
                    behind=status["behind"],
                    local_commit=commit,
                )
            if status["behind"]:
                self.run("merge", "--ff-only", status["tracking_ref"])
            if status["ahead"]:
                pushed = self.run("push", "--", remote, "HEAD:" + status["merge_ref"], check=False)
                if pushed.returncode:
                    raise KBError(
                        "PUSH_PENDING",
                        "推送失败，本地提交已保留",
                        reason=pushed.stderr.strip(),
                        local_commit=commit,
                    )
            indexed = Index(self.vault).refresh(verify=True)
            (self.vault.state / "last-sync.txt").write_text(self.vault.now() + "\n")
            return result(
                git=self.status(remote_checked=True),
                index=indexed,
                local_commit=commit,
                synced=True,
            )
