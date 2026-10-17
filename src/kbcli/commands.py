from .errors import KBError, result
from .git_sync import Git
from .indexing import Index
from .operations import Operations

PARAMETERS = {
    "check": {"schema"},
    "index": {"verify"},
    "search": {"query", "tag", "status", "under", "prop", "limit", "fresh", "literal", "timeout"},
    "grep": {"expression", "limit"},
    "read": {"identifier", "expect_hash", "start", "end"},
    "create": {"title", "template", "path", "metadata", "dry_run"},
    "patch": {"identifier", "change", "expect_hash", "dry_run"},
    "fix": {"identifier", "apply", "expect_hash", "dry_run"},
    "task.list": {"status", "tag", "overdue"},
    "task.add": {"title", "due", "tag"},
    "task.done": {"identifier", "expect_hash"},
    "task.update": {"identifier", "metadata", "expect_hash"},
    "review.list": set(),
    "review.show": {"identifier"},
    "schema.list": set(),
    "schema.show": {"name"},
    "template.list": set(),
    "template.show": {"name"},
    "status": {"portable"},
    "sync": {"commit_tools"},
}


def command(vault, name, params, actor):
    if name not in PARAMETERS or set(params) - PARAMETERS[name]:
        raise KBError("COMMAND_INVALID", "命令或参数不在允许范围", command=name)
    operations = Operations(
        vault,
        readonly=name not in {"create", "patch", "fix", "task.add", "task.done", "task.update"},
    )
    idx = Index(vault)
    p = dict(params)
    string_fields = {
        "query",
        "status",
        "under",
        "prop",
        "identifier",
        "expect_hash",
        "title",
        "template",
        "path",
        "expression",
        "name",
        "schema",
    }
    for key, value in p.items():
        if key in string_fields and value is not None and not isinstance(value, str):
            raise KBError("REQUEST_INVALID", f"{key} 必须是字符串")
        if key in {"metadata", "change"} and value is not None and not isinstance(value, dict):
            raise KBError("REQUEST_INVALID", f"{key} 必须是对象")
        if key in {
            "verify",
            "fresh",
            "literal",
            "apply",
            "dry_run",
            "commit_tools",
            "overdue",
            "portable",
        } and not isinstance(value, bool):
            raise KBError("REQUEST_INVALID", f"{key} 必须是布尔值")
        if key == "limit" and (not isinstance(value, int) or isinstance(value, bool)):
            raise KBError("REQUEST_INVALID", "limit 必须是整数")
        if key == "timeout" and (not isinstance(value, int | float) or isinstance(value, bool)):
            raise KBError("REQUEST_INVALID", "timeout 必须是数字")
        if key == "tag" and value is not None:
            if name == "task.add" and (
                not isinstance(value, list) or not all(isinstance(t, str) for t in value)
            ):
                raise KBError("REQUEST_INVALID", "task.add 的 tag 必须是字符串数组")
            if name != "task.add" and not isinstance(value, str):
                raise KBError("REQUEST_INVALID", "tag 必须是字符串")
    if name == "check":
        return vault.check(p.get("schema"))
    if name == "index":
        return idx.refresh(p.get("verify", False))
    if name == "search":
        return idx.search(**p)
    if name == "grep":
        return idx.grep(**p)
    if name in {"read", "review.show"}:
        return vault.read(**p)
    if name == "create":
        return operations.create(actor=actor, **p)
    if name == "patch":
        return operations.patch(actor=actor, **p)
    if name == "fix":
        if actor != "human":
            raise KBError("USER_ACTION_REQUIRED", "自动修复需用户直接调用")
        if p.pop("dry_run", False):
            p["apply"] = False
        return operations.fix(**p)
    if name == "task.list":
        return operations.tasks(**p)
    if name == "task.add":
        title = p.pop("title")
        meta = {"tags": p.pop("tag", None) or []}
        if p.get("due"):
            meta["due"] = p["due"]
        return operations.create(title, template="task", metadata=meta, actor=actor)
    if name == "task.done":
        if not p.get("expect_hash"):
            raise KBError("EXPECTED_HASH_REQUIRED", "远端完成操作必须携带读取时的哈希")
        return operations.task_done(actor=actor, **p)
    if name == "task.update":
        doc = vault.find(p["identifier"])
        if not vault.resolve_schema(doc)[0].startswith("task-"):
            raise KBError("NOT_A_TASK", "目标不是待办")
        return operations.patch(
            p["identifier"], {"set": p["metadata"]}, expect_hash=p["expect_hash"], actor=actor
        )
    if name == "review.list":
        return operations.review_list()
    if name == "schema.list":
        return result(schemas=list(vault.schemas))
    if name == "schema.show":
        if p["name"] not in vault.schemas:
            raise KBError("SCHEMA_UNKNOWN", "找不到规范")
        return result(schema=vault.schemas[p["name"]])
    if name == "template.list":
        return result(templates=vault.config["templates"])
    if name == "template.show":
        path = vault.config["templates"].get(p["name"])
        if not path:
            raise KBError("TEMPLATE_UNKNOWN", "找不到模板")
        return result(template=vault.safe(path).read_text())
    if name == "status":
        from .status import snapshot

        return snapshot(vault, portable=p.get("portable", True))
    if name == "sync":
        if p.get("commit_tools") and actor != "human":
            raise KBError("USER_ACTION_REQUIRED", "提交并推送需用户直接调用")
        return Git(vault).sync(**p)
    raise KBError("COMMAND_INVALID", "未实现命令")
