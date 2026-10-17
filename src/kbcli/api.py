from __future__ import annotations

import asyncio
import hmac
from contextlib import asynccontextmanager, suppress

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from filelock import Timeout
from pydantic import BaseModel, ConfigDict, Field

from . import __version__
from .errors import KBError, result
from .indexing import Index
from .operations import Operations


class TaskCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1)
    due: str | None = None
    tags: list[str] = Field(default_factory=list)


class TaskUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expect_hash: str
    changes: dict


class CommandRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: str
    params: dict = Field(default_factory=dict)


def create_app(vault, user_token, *, agent_token=None, interval=3):
    if not user_token or (agent_token and agent_token == user_token):
        raise KBError("AUTH_CONFIG_INVALID", "需要非空用户令牌，agent 令牌必须与之不同")
    if interval < 0.2:
        raise KBError("CONFIG_INVALID", "索引轮询间隔至少 0.2 秒")
    idx = Index(vault)
    operations = Operations(vault)
    background_error = None

    async def refresh_loop():
        nonlocal background_error
        while True:
            try:
                await asyncio.to_thread(idx.refresh, verify=True)
                background_error = None
            except Exception as exc:
                background_error = str(exc)
            await asyncio.sleep(interval)

    @asynccontextmanager
    async def lifespan(app):
        task = asyncio.create_task(refresh_loop())
        try:
            yield
        finally:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task

    app = FastAPI(title="kbcli", version=__version__, lifespan=lifespan)

    def actor(authorization: str | None = Header(default=None)):
        token = (
            authorization.removeprefix("Bearer ")
            if authorization and authorization.startswith("Bearer ")
            else ""
        )
        if token and hmac.compare_digest(token.encode(), user_token.encode()):
            return "human"
        if agent_token and token and hmac.compare_digest(token.encode(), agent_token.encode()):
            return "ai"
        raise KBError("UNAUTHORIZED", "需要有效的 Bearer token")

    @app.exception_handler(KBError)
    async def error(request: Request, exc: KBError):
        code = (
            401
            if exc.code == "UNAUTHORIZED"
            else 409
            if exc.code in {"FILE_CHANGED", "INDEX_STALE", "DUPLICATE_ID"}
            else 403
            if exc.code in {"USER_ACTION_REQUIRED", "PATH_OUTSIDE_VAULT", "FIELD_PROTECTED"}
            else 400
        )
        return JSONResponse(exc.result(), status_code=code)

    @app.exception_handler(Timeout)
    async def lock_error(request: Request, exc: Timeout):
        return JSONResponse(KBError("LOCK_TIMEOUT", "等待写入锁超时").result(), status_code=409)

    @app.get("/api/tasks")
    def tasks(
        status: str | None = None,
        tag: str | None = None,
        overdue: bool = False,
        principal=Depends(actor),
    ):
        return operations.tasks(status, tag, overdue)

    @app.post("/api/tasks")
    def add_task(data: TaskCreate, principal=Depends(actor)):
        return operations.create(
            data.title,
            template="task",
            metadata={"tags": data.tags, **({"due": data.due} if data.due else {})},
            actor=principal,
        )

    @app.exception_handler(RequestValidationError)
    async def request_error(request: Request, exc: RequestValidationError):
        issues = [
            {"field": list(e["loc"]), "message": e["msg"], "type": e["type"]} for e in exc.errors()
        ]
        return JSONResponse(
            KBError("REQUEST_INVALID", "请求格式无效", issues=issues).result(), status_code=422
        )

    @app.post("/api/command")
    def execute_command(data: CommandRequest, principal=Depends(actor)):
        from .commands import command

        try:
            return command(vault, data.command, data.params, principal)
        except (TypeError, KeyError, ValueError) as exc:
            raise KBError("REQUEST_INVALID", "命令参数无效", reason=str(exc)) from exc

    @app.patch("/api/tasks/{identifier}")
    def update_task(identifier: str, data: TaskUpdate, principal=Depends(actor)):
        doc = vault.find(identifier)
        if not vault.resolve_schema(doc)[0].startswith("task-"):
            raise KBError("NOT_A_TASK", "目标不是待办")
        if data.changes == {"status": "done"}:
            return operations.task_done(identifier, expect_hash=data.expect_hash, actor=principal)
        return operations.patch(
            identifier, {"set": data.changes}, expect_hash=data.expect_hash, actor=principal
        )

    @app.get("/api/search")
    def search(
        q: str = "",
        tag: str | None = None,
        status: str | None = None,
        under: str | None = None,
        prop: str | None = None,
        limit: int = Query(default=10, ge=1, le=100),
        fresh: bool = False,
        literal: bool = False,
        principal=Depends(actor),
    ):
        return idx.search(
            q,
            tag=tag,
            status=status,
            under=under,
            prop=prop,
            limit=limit,
            fresh=fresh,
            literal=literal,
        )

    @app.get("/api/read")
    def read(path: str, expect_hash: str | None = None, principal=Depends(actor)):
        return vault.read(path, expect_hash)

    @app.get("/api/documents/{identifier}")
    def document(identifier: str, expect_hash: str | None = None, principal=Depends(actor)):
        return vault.read(identifier, expect_hash)

    @app.get("/api/recent")
    def recent(limit: int = Query(default=10, ge=1, le=100), principal=Depends(actor)):
        records = sorted(
            vault.documents(), key=lambda d: vault.safe(d.path).stat().st_mtime_ns, reverse=True
        )
        return result(
            records=[
                {
                    "path": d.path,
                    "title": d.title,
                    "file_hash": d.file_hash,
                    "updated_at": d.metadata.get("updated_at"),
                    "filesystem_mtime_ns": vault.safe(d.path).stat().st_mtime_ns,
                }
                for d in records[:limit]
            ]
        )

    @app.get("/api/status")
    def status(portable: bool = True, principal=Depends(actor)):
        from .status import snapshot

        value = snapshot(vault, portable=portable)
        value["index"]["background_error"] = background_error
        return value

    @app.get("/api/review")
    def review(principal=Depends(actor)):
        return operations.review_list()

    return app
