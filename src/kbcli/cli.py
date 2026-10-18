from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path
from typing import Annotated

import typer
from filelock import Timeout

from . import __version__
from .client import remote
from .errors import KBError, result
from .vault import Vault

app = typer.Typer(no_args_is_help=True, help="Markdown 知识库工具；结果默认输出稳定 JSON。")
task_app = typer.Typer(no_args_is_help=True)
schema_app = typer.Typer(no_args_is_help=True)
template_app = typer.Typer(no_args_is_help=True)
review_app = typer.Typer(no_args_is_help=True)
app.add_typer(task_app, name="task")
app.add_typer(schema_app, name="schema")
app.add_typer(template_app, name="template")
app.add_typer(review_app, name="review")


def output(value):
    typer.echo(json.dumps(value, ensure_ascii=False, indent=2))


def execute(function):
    try:
        value = function()
        output(value)
        if value.get("errors", 0):
            raise typer.Exit(1)
    except KBError as exc:
        output(exc.result())
        raise typer.Exit(2) from exc
    except Timeout as exc:
        output(KBError("LOCK_TIMEOUT", "等待知识库写入锁超时").result())
        raise typer.Exit(2) from exc
    except (OSError, ValueError) as exc:
        output(KBError("INPUT_OR_IO_ERROR", str(exc)).result())
        raise typer.Exit(2) from exc


def vault(ctx):
    options = ctx.find_root().obj
    if options.get("server"):
        raise KBError("REMOTE_UNSUPPORTED", "此命令不支持远端模式，不会回退为本地写入")
    return Vault(options["vault"], options["state_dir"])


@app.callback()
def options(
    ctx: typer.Context,
    server: str | None = None,
    token_env: str = "KBCLI_TOKEN",
    vault_path: Annotated[Path, typer.Option("--vault", help="知识库根目录")] = Path("."),
    state_dir: Annotated[Path | None, typer.Option(help="知识库外的本机状态目录")] = None,
    json_output: Annotated[
        bool, typer.Option("--json", help="结果始终为 JSON；保留此标志供工具调用")
    ] = False,
):
    ctx.obj = {
        "vault": vault_path,
        "state_dir": state_dir,
        "server": server,
        "token_env": token_env,
    }


@app.command()
def version():
    output(result(version=__version__))


@app.command()
def init(
    ctx: typer.Context,
    path: Annotated[Path | None, typer.Argument()] = None,
    defaults: Annotated[Path | None, typer.Option(help="从已有知识库复制 .kb 契约")] = None,
):
    def action():
        options = ctx.find_root().obj
        if options.get("server"):
            raise KBError("REMOTE_UNSUPPORTED", "初始化仅支持明确的本地目录")
        return Vault.initialize(path or options["vault"], defaults)

    execute(action)


@app.command()
@remote("check")
def check(
    ctx: typer.Context,
    schema: str | None = None,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    execute(lambda: vault(ctx).check(schema))


@app.command()
@remote("index")
def index(
    ctx: typer.Context,
    verify: bool = False,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .indexing import Index

    execute(lambda: Index(vault(ctx)).refresh(verify))


@app.command()
@remote("search")
def search(
    ctx: typer.Context,
    query: Annotated[str, typer.Argument()] = "",
    tag: str | None = None,
    status: str | None = None,
    under: str | None = None,
    prop: str | None = None,
    limit: int = 10,
    fresh: bool = False,
    literal: bool = False,
    timeout: float = 15,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .indexing import Index

    execute(
        lambda: Index(vault(ctx)).search(
            query,
            tag=tag,
            status=status,
            under=under,
            prop=prop,
            limit=limit,
            fresh=fresh,
            literal=literal,
            timeout=timeout,
        )
    )


@app.command()
@remote("grep")
def grep(
    ctx: typer.Context,
    expression: str,
    limit: int = 100,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .indexing import Index

    execute(lambda: Index(vault(ctx)).grep(expression, limit))


@app.command()
@remote("read")
def read(
    ctx: typer.Context,
    identifier: str,
    expect_hash: str | None = None,
    start: int | None = None,
    end: int | None = None,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    execute(lambda: vault(ctx).read(identifier, expect_hash, start, end))


def metadata_json(text):
    value = json.loads(text)
    if not isinstance(value, dict):
        raise KBError("INPUT_INVALID", "metadata JSON 必须是对象")
    return value


@app.command()
@remote("create")
def create(
    ctx: typer.Context,
    title: str,
    template: str = "note",
    path: str | None = None,
    metadata: str = "{}",
    actor: str = "human",
    dry_run: bool = False,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .operations import Operations

    execute(
        lambda: Operations(vault(ctx)).create(
            title,
            template=template,
            path=path,
            metadata=metadata_json(metadata),
            actor=actor,
            dry_run=dry_run,
        )
    )


@app.command()
@remote("patch")
def patch(
    ctx: typer.Context,
    identifier: str,
    patch_file: Path,
    expect_hash: str,
    actor: str = "human",
    dry_run: bool = False,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .operations import Operations

    execute(
        lambda: Operations(vault(ctx)).patch(
            identifier,
            metadata_json(patch_file.read_text()),
            expect_hash=expect_hash,
            actor=actor,
            dry_run=dry_run,
        )
    )


@app.command()
@remote("fix")
def fix(
    ctx: typer.Context,
    identifier: str,
    apply: Annotated[bool, typer.Option("--apply")] = False,
    expect_hash: str | None = None,
    dry_run: bool = False,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .operations import Operations

    execute(
        lambda: Operations(vault(ctx)).fix(
            identifier, apply=apply and not dry_run, expect_hash=expect_hash
        )
    )


@task_app.command("list")
@remote("task.list")
def task_list(
    ctx: typer.Context,
    status: str | None = None,
    tag: str | None = None,
    overdue: bool = False,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .operations import Operations

    execute(lambda: Operations(vault(ctx), readonly=True).tasks(status, tag, overdue))


@task_app.command("add")
@remote("task.add")
def task_add(
    ctx: typer.Context,
    title: str,
    due: str | None = None,
    tag: Annotated[list[str] | None, typer.Option("--tag")] = None,
    actor: str = "human",
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .operations import Operations

    execute(
        lambda: Operations(vault(ctx)).create(
            title,
            template="task",
            metadata={"tags": tag or [], **({"due": due} if due else {})},
            actor=actor,
        )
    )


@task_app.command("done")
@remote("task.done")
def task_done(
    ctx: typer.Context,
    identifier: str,
    expect_hash: str | None = None,
    actor: str = "human",
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .operations import Operations

    execute(lambda: Operations(vault(ctx)).task_done(identifier, expect_hash, actor))


@task_app.command("update")
@remote("task.update")
def task_update(
    ctx: typer.Context,
    identifier: str,
    metadata: str,
    expect_hash: str,
    actor: str = "human",
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .operations import Operations

    def action():
        v = vault(ctx)
        doc = v.find(identifier)
        if not v.resolve_schema(doc)[0].startswith("task-"):
            raise KBError("NOT_A_TASK", "目标不是待办")
        return Operations(v).patch(
            identifier, {"set": metadata_json(metadata)}, expect_hash=expect_hash, actor=actor
        )

    execute(action)


@schema_app.command("list")
@remote("schema.list")
def schemas(ctx: typer.Context):
    execute(lambda: result(schemas=list(vault(ctx).schemas)))


@schema_app.command("show")
@remote("schema.show")
def schema_show(ctx: typer.Context, name: str):
    def action():
        value = vault(ctx).schemas.get(name)
        if not value:
            raise KBError("SCHEMA_UNKNOWN", "找不到规范", schema=name)
        return result(schema=value)

    execute(action)


@template_app.command("list")
@remote("template.list")
def templates(ctx: typer.Context):
    execute(lambda: result(templates=vault(ctx).config["templates"]))


@template_app.command("show")
@remote("template.show")
def template_show(ctx: typer.Context, name: str):
    def action():
        v = vault(ctx)
        path = v.config["templates"].get(name)
        if not path:
            raise KBError("TEMPLATE_UNKNOWN", "找不到模板")
        return result(template=v.safe(path).read_text())

    execute(action)


@review_app.command("list")
@remote("review.list")
def review_list(ctx: typer.Context, json_output: Annotated[bool, typer.Option("--json")] = False):
    from .operations import Operations

    execute(lambda: Operations(vault(ctx), readonly=True).review_list())


@review_app.command("show")
@remote("review.show")
def review_show(ctx: typer.Context, identifier: str):
    execute(lambda: vault(ctx).read(identifier))


@app.command()
@remote("status")
def status(
    ctx: typer.Context,
    portable: bool = False,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .status import snapshot

    execute(lambda: snapshot(vault(ctx), portable=portable))


@app.command()
@remote("sync")
def sync(
    ctx: typer.Context,
    commit_tools: bool = False,
    json_output: Annotated[bool, typer.Option("--json")] = False,
):
    from .git_sync import Git

    execute(lambda: Git(vault(ctx)).sync(commit_tools))


@app.command()
def doctor(ctx: typer.Context):
    from .indexing import Index

    def action():
        v = vault(ctx)
        idx = Index(v)
        import sqlite3

        with sqlite3.connect(":memory:") as db:
            db.execute("CREATE VIRTUAL TABLE probe USING fts5(body)")
            sqlite_version = db.execute("SELECT sqlite_version()").fetchone()[0]
        return result(
            version=__version__,
            python=sys.version.split()[0],
            sqlite=sqlite_version,
            fts5=True,
            vault=str(v.root),
            state_dir=str(v.state),
            schemas=list(v.schemas),
            index=idx.status(),
            state_location=v.state_location(),
        )

    execute(action)


@app.command()
def watch(ctx: typer.Context, interval: float = 3):
    from .indexing import Index

    if interval < 0.2:
        execute(lambda: (_ for _ in ()).throw(KBError("INPUT_INVALID", "轮询间隔至少 0.2 秒")))
    idx = Index(vault(ctx))
    try:
        while True:
            update = idx.refresh(verify=True)
            if update["changed"] or update["removed"]:
                output(update)
            time.sleep(interval)
    except KeyboardInterrupt:
        raise typer.Exit(0) from None


@app.command()
def serve(ctx: typer.Context, host: str = "127.0.0.1", port: int = 8765, interval: float = 3):
    import uvicorn

    from .api import create_app

    v = vault(ctx)
    token = os.environ.get("KBCLI_USER_TOKEN", "")
    agent_token = os.environ.get("KBCLI_AGENT_TOKEN")
    uvicorn.run(
        create_app(
            v,
            token,
            agent_token=agent_token,
            interval=interval,
            autosync_dir=os.environ.get("KBCLI_AUTOSYNC_STATE_DIR"),
        ),
        host=host,
        port=port,
        workers=1,
    )


def main():
    try:
        app()
    except KBError as exc:
        output(exc.result())
        raise SystemExit(2) from exc
