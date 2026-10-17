from __future__ import annotations

import copy
import fnmatch
import hashlib
import io
import json
import math
import re
import shutil
import tempfile
import tomllib
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import date, datetime
from importlib.resources import files
from pathlib import Path
from urllib.parse import unquote
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from filelock import FileLock
from jsonschema import Draft202012Validator, FormatChecker
from markdown_it import MarkdownIt
from platformdirs import user_state_path
from referencing import Registry, Resource
from ruamel.yaml import YAML

from .errors import KBError, result


def sha(data: bytes | str) -> str:
    return "sha256:" + hashlib.sha256(data.encode() if isinstance(data, str) else data).hexdigest()


def plain(value):
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, dict):
        if not all(isinstance(k, str) for k in value):
            raise ValueError("YAML 属性名必须是字符串")
        return {k: plain(v) for k, v in value.items()}
    if isinstance(value, list | tuple):
        return [plain(v) for v in value]
    if value is None or isinstance(value, str | bool | int):
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    raise ValueError("元数据必须能表示为 JSON，不能包含自定义 YAML 类型或非有限数字")


def yaml_parser():
    parser = YAML(typ="rt")
    parser.preserve_quotes = True
    parser.allow_duplicate_keys = False
    parser.width = 10000
    return parser


@dataclass
class Document:
    path: str
    raw: str
    body: str
    metadata: dict
    editable_metadata: dict
    body_offset: int
    file_hash: str
    has_frontmatter: bool = False
    parse_error: str | None = None

    @property
    def title(self):
        title = self.metadata.get("title")
        if isinstance(title, str) and title.strip():
            return title
        match = re.search(r"^#\s+(.+)$", self.body, re.M)
        return match[1] if match else Path(self.path).stem


def parse_document(path: str, raw: str):
    doc = Document(path, raw, raw, {}, {}, 0, sha(raw))
    if raw.startswith("---\n") or raw.startswith("---\r\n"):
        doc.has_frontmatter = True
        lines = raw.splitlines(keepends=True)
        closing = next((i for i in range(1, len(lines)) if lines[i].strip() == "---"), None)
        if closing is None:
            doc.parse_error = "YAML frontmatter 没有结束分隔符"
            return doc
        doc.body_offset = closing + 1
        doc.body = "".join(lines[closing + 1 :])
        try:
            meta = yaml_parser().load("".join(lines[1:closing]))
            if not isinstance(meta, dict):
                raise ValueError("frontmatter 必须是对象")
            doc.metadata = plain(meta)
            doc.editable_metadata = meta
        except Exception as exc:
            doc.parse_error = str(exc)
    return doc


def render_document(metadata, body):
    stream = io.StringIO()
    yaml_parser().dump(metadata, stream)
    return "---\n" + stream.getvalue() + "---\n" + body


def merge_config(base, override):
    merged = copy.deepcopy(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = merge_config(merged[key], value)
        else:
            merged[key] = value
    return merged


class Vault:
    def __init__(self, root: str | Path, state_dir: str | Path | None = None):
        self.root = Path(root).expanduser().resolve()
        config_path = self.root / ".kb/config.toml"
        if not config_path.is_file():
            raise KBError("CONFIG_MISSING", "找不到 .kb/config.toml", vault=str(self.root))
        try:
            self.config = tomllib.loads(config_path.read_text())
            local = self.root / ".kb/config.local.toml"
            if local.is_file():
                self.config = merge_config(self.config, tomllib.loads(local.read_text()))
            if self.config.get("vault", {}).get("schema_version") != 1:
                raise ValueError("仅支持配置 schema_version=1")
            self.timezone = ZoneInfo(self.config.get("vault", {}).get("timezone", "Asia/Shanghai"))
        except (ValueError, ZoneInfoNotFoundError) as exc:
            raise KBError("CONFIG_INVALID", str(exc)) from exc
        identity = hashlib.sha256(str(self.root).encode()).hexdigest()[:24]
        configured = self.config.get("runtime", {}).get("state_dir")
        self.state = Path(state_dir or configured or user_state_path("kbcli") / identity)
        self.state = self.state.expanduser().resolve()
        self.state_source = "explicit" if state_dir else "configured" if configured else "default"
        if self.state.is_relative_to(self.root):
            raise KBError("CONFIG_INVALID", "运行状态目录必须位于知识库之外")
        self.lock = FileLock(self.state / "vault.lock", timeout=10)
        self.roots = self.config.get("discovery", {}).get("roots", [])
        if not self.roots or len(set(self.roots)) != len(self.roots):
            raise KBError("CONFIG_INVALID", "discovery.roots 不能为空或重复")
        for root_name in self.roots:
            self.safe(root_name)
        self.schemas = {}
        self.registry = Registry()
        self.schema_dir = self.safe(self.config.get("schemas", {}).get("directory", ".kb/schemas"))
        try:
            for p in sorted(self.schema_dir.iterdir()):
                if p.suffix not in {".json", ".yaml", ".yml"}:
                    continue
                self.safe(p)
                schema = (
                    json.loads(p.read_text())
                    if p.suffix == ".json"
                    else plain(yaml_parser().load(p.read_text()))
                )
                Draft202012Validator.check_schema(schema)
                self.schemas[p.stem] = schema
                self.registry = self.registry.with_resource(
                    schema["$id"], Resource.from_contents(schema)
                )
            if not self.schemas:
                raise ValueError("没有可用的规范")
            self.validators = {
                name: Draft202012Validator(
                    schema, registry=self.registry, format_checker=FormatChecker()
                )
                for name, schema in self.schemas.items()
            }
        except Exception as exc:
            raise KBError("CONFIG_INVALID", "无法加载本地 Schema", reason=str(exc)) from exc

    @classmethod
    def initialize(cls, root, defaults=None):
        root = Path(root).expanduser().resolve()
        if (root / ".kb").exists():
            raise KBError("ALREADY_INITIALIZED", "已有 .kb 目录，不覆盖")
        if defaults:
            source = Path(defaults).resolve() / ".kb"
        else:
            source = Path(str(files("kbcli").joinpath("defaults/.kb")))
        if not (source / "config.toml").is_file():
            raise KBError("CONFIG_MISSING", "初始化来源缺少配置")
        root.mkdir(parents=True, exist_ok=True)
        shutil.copytree(
            source,
            root / ".kb",
            ignore=shutil.ignore_patterns(
                "config.local.toml", "local", "cache", "state", "logs", "locks"
            ),
        )
        config = tomllib.loads((root / ".kb/config.toml").read_text())
        for directory in config["paths"].values():
            path = (root / directory).resolve()
            if not path.is_relative_to(root):
                raise KBError("PATH_OUTSIDE_VAULT", "初始化目录越界")
            path.mkdir(parents=True, exist_ok=True)
        return result(vault=str(root), initialized=True, git_initialized=False)

    def now(self):
        return datetime.now(self.timezone).isoformat(timespec="seconds")

    def ensure_state(self):
        try:
            self.state.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            raise KBError(
                "STATE_UNWRITABLE",
                "运行状态目录不可写；只读检查无需写入，可为索引或修改配置其他库外目录",
                reason=str(exc),
            ) from exc

    @contextmanager
    def writing(self):
        self.ensure_state()
        with self.lock:
            yield

    def state_location(self, portable=False):
        temporary = any(
            self.state.is_relative_to(p.resolve())
            for p in [Path(tempfile.gettempdir()), Path("/tmp")]
        )
        return {
            "source": self.state_source,
            "temporary": temporary,
            **({"path": str(self.state)} if not portable else {}),
        }

    def safe(self, value, *, business=False):
        p = Path(value)
        candidate = p if p.is_absolute() else self.root / p
        resolved = candidate.resolve()
        if not resolved.is_relative_to(self.root):
            raise KBError("PATH_OUTSIDE_VAULT", "路径超出知识库", path=str(value))
        relative = candidate.relative_to(self.root)
        check = self.root
        for part in relative.parts:
            check = check / part
            if check.is_symlink():
                raise KBError("SYMLINK_NOT_ALLOWED", "不通过符号链接读写知识库", path=str(value))
        if business and (
            resolved.suffix != ".md" or self.excluded(resolved.relative_to(self.root).as_posix())
        ):
            raise KBError("PATH_NOT_RECORD", "路径不是可管理的业务 Markdown", path=str(value))
        return resolved

    def excluded(self, relative):
        if relative.split("/")[0] not in self.roots:
            return True
        return any(
            fnmatch.fnmatchcase(relative, pattern)
            for pattern in self.config.get("discovery", {}).get("exclude", [])
        )

    def discover(self):
        paths = []
        for root in self.roots:
            folder = self.safe(root)
            if not folder.exists():
                continue
            for p in folder.rglob("*.md"):
                rel = p.relative_to(self.root).as_posix()
                if not self.excluded(rel):
                    paths.append(self.safe(p, business=True))
        return sorted(set(paths))

    def load(self, path):
        p = self.safe(path, business=True)
        if not p.is_file():
            raise KBError("FILE_NOT_FOUND", "找不到记录", path=str(path))
        try:
            raw = p.read_bytes().decode("utf-8")
        except (UnicodeError, OSError) as exc:
            raise KBError("FILE_UNREADABLE", str(exc), path=str(path)) from exc
        return parse_document(p.relative_to(self.root).as_posix(), raw)

    def documents(self):
        return [self.load(p) for p in self.discover()]

    def resolve_schema(self, doc, explicit=None):
        root = doc.path.split("/")[0]
        bindings = [b for b in self.config["schemas"]["bindings"] if b["root"] == root]
        if len(bindings) != 1:
            raise KBError("SCHEMA_AMBIGUOUS", "目录绑定缺失或重复", path=doc.path)
        rules = [
            p
            for p in self.config["schemas"].get("path_rules", [])
            if p["root"] == root and p["basename"] == Path(doc.path).name
        ]
        if len(rules) > 1:
            raise KBError("SCHEMA_AMBIGUOUS", "路径规则重复", path=doc.path)
        rule = rules[0] if rules else bindings[0]
        selected = (
            explicit
            or doc.metadata.get("schema")
            or rule.get("schema")
            or self.config["schemas"].get("default")
        )
        if selected not in rule.get("allowed", [rule["schema"]]):
            raise KBError(
                "SCHEMA_NOT_ALLOWED", "文档规范不属于目录允许的类型", path=doc.path, schema=selected
            )
        if selected not in self.validators:
            raise KBError("SCHEMA_UNKNOWN", "找不到所选规范", schema=selected)
        return selected, bool(rule.get("strict") or explicit or doc.metadata.get("schema"))

    def content_hash(self, doc):
        options = self.config.get("review", {}).get("content_hash", {})
        omitted = set(
            options.get(
                "exclude_fields",
                [
                    "review_status",
                    "reviewed_by",
                    "reviewed_at",
                    "reviewed_content_hash",
                    "updated_at",
                ],
            )
        )
        schema, _ = self.resolve_schema(doc)
        if schema.startswith("task-"):
            omitted.update(options.get("task_exclude_fields", ["status", "completed_at"]))
        payload = {
            "frontmatter": {k: v for k, v in doc.metadata.items() if k not in omitted},
            "body": doc.body.replace("\r\n", "\n").replace("\r", "\n"),
        }
        return sha(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")))

    def review_effective(self, doc):
        state = doc.metadata.get("review_status")
        if state != "approved":
            return state
        if any(i["code"] not in {"REVIEW_UNVERIFIED", "REVIEW_STALE"} for i in self.validate(doc)):
            return "invalid"
        if not doc.metadata.get("reviewed_content_hash"):
            return "unverified"
        try:
            return (
                "approved"
                if doc.metadata["reviewed_content_hash"] == self.content_hash(doc)
                else "stale"
            )
        except KBError:
            return "invalid"

    def validate(self, doc, explicit=None):
        issues = []

        def issue(code, message, severity="error", field=None):
            issues.append(
                {
                    "path": doc.path,
                    "code": code,
                    "message": message,
                    "severity": severity,
                    "field": field,
                }
            )

        if doc.parse_error:
            issue("YAML_INVALID", doc.parse_error)
            return issues
        try:
            schema, strict = self.resolve_schema(doc, explicit)
        except KBError as exc:
            issue(exc.code, str(exc))
            return issues
        try:
            for error in self.validators[schema].iter_errors(doc.metadata):
                issue(
                    "SCHEMA_INVALID",
                    error.message,
                    "error" if strict else "warning",
                    ".".join(str(k) for k in error.absolute_path),
                )
        except Exception as exc:
            issue("SCHEMA_REF_INVALID", str(exc))
        if doc.metadata.get("review_status") == "approved":
            expected = doc.metadata.get("reviewed_content_hash")
            if not expected:
                issue("REVIEW_UNVERIFIED", "审核没有绑定内容哈希", "warning")
            elif expected != self.content_hash(doc):
                issue("REVIEW_STALE", "内容变化，旧审核已失效")
        original = doc.metadata.get("original_path")
        if isinstance(original, str):
            try:
                p = self.safe(original)
                if not p.is_file():
                    issue("SOURCE_FILE_MISSING", "原文快照不存在")
                elif (
                    doc.metadata.get("original_sha256")
                    and sha(p.read_bytes()) != doc.metadata["original_sha256"]
                ):
                    issue("SOURCE_HASH_CHANGED", "原文快照哈希不一致")
            except KBError as exc:
                issue(exc.code, str(exc))
        schema, _ = self.resolve_schema(doc, explicit)
        if schema.startswith("daily-") and "date" in doc.metadata:
            expected = f"{self.config['paths']['daily']}/{str(doc.metadata['date'])[:4]}/{str(doc.metadata['date'])[5:7]}/{doc.metadata['date']}.md"
            if doc.path != expected:
                issue("DATE_PATH_MISMATCH", f"日记路径应为 {expected}")
        return issues

    def check(self, explicit=None, *, documents=None):
        docs = self.documents() if documents is None else documents
        issues = [item for doc in docs for item in self.validate(doc, explicit)]
        by_id = {}
        for doc in docs:
            key = doc.metadata.get("id")
            if isinstance(key, str):
                by_id.setdefault(key, []).append(doc)
        for key, matches in by_id.items():
            if len(matches) > 1:
                for doc in matches:
                    issues.append(
                        {
                            "path": doc.path,
                            "code": "DUPLICATE_ID",
                            "severity": "error",
                            "message": f"重复 ID: {key}",
                        }
                    )
        for doc in docs:
            if doc.parse_error:
                continue
            for field, kind in [("projects", "project-"), ("sources", "source-")]:
                values = doc.metadata.get(field, [])
                if not isinstance(values, list):
                    continue
                for key in values:
                    matches = by_id.get(key, []) if isinstance(key, str) else []
                    message = None
                    if key == doc.metadata.get("id"):
                        message = "关联不能指向自身"
                    elif len(matches) != 1:
                        message = "关联 ID 不存在或有歧义"
                    else:
                        try:
                            if not self.resolve_schema(matches[0])[0].startswith(kind):
                                message = "关联目标类型错误"
                        except KBError:
                            message = "关联目标规范错误"
                    if message:
                        issues.append(
                            {
                                "path": doc.path,
                                "code": "REFERENCE_INVALID",
                                "severity": "error",
                                "field": field,
                                "message": message,
                                "target": key,
                            }
                        )
            for target in markdown_links(doc.body):
                if ":" in target or target.startswith("#"):
                    continue
                path = unquote(target.split("#", 1)[0])
                if not path:
                    continue
                try:
                    p = self.safe(Path(doc.path).parent / path)
                    if not p.exists():
                        issues.append(
                            {
                                "path": doc.path,
                                "code": "LINK_MISSING",
                                "severity": "warning",
                                "message": "相对链接目标不存在",
                                "target": target,
                            }
                        )
                except KBError as exc:
                    issues.append(
                        {
                            "path": doc.path,
                            "code": exc.code,
                            "severity": "error",
                            "message": str(exc),
                            "target": target,
                        }
                    )
        return result(
            documents=len(docs),
            errors=sum(i["severity"] == "error" for i in issues),
            warnings=sum(i["severity"] == "warning" for i in issues),
            issues=issues,
        )

    def find(self, identifier):
        if identifier.endswith(".md") or "/" in identifier:
            return self.load(identifier)
        matches = [d for d in self.documents() if d.metadata.get("id") == identifier]
        if len(matches) != 1:
            raise KBError(
                "ID_NOT_FOUND" if not matches else "DUPLICATE_ID",
                "记录 ID 不存在或有歧义",
                id=identifier,
            )
        return matches[0]

    def read(self, identifier, expect_hash=None, start=None, end=None):
        doc = self.find(identifier)
        if expect_hash and doc.file_hash != expect_hash:
            raise KBError(
                "FILE_CHANGED", "文件已变化，请重新读取", expected=expect_hash, actual=doc.file_hash
            )
        lines = doc.raw.splitlines()
        if start is not None and (start < 1 or (end is not None and end < start)):
            raise KBError("RANGE_INVALID", "行号范围无效")
        try:
            content_hash = self.content_hash(doc) if not doc.parse_error else None
        except KBError:
            content_hash = None
        return result(
            path=doc.path,
            metadata=doc.metadata,
            file_hash=doc.file_hash,
            content_hash=content_hash,
            line_start=start or 1,
            line_end=min(end or len(lines), len(lines)),
            content="\n".join(lines[(start or 1) - 1 : end]),
            parse_error=doc.parse_error,
            review_effective=self.review_effective(doc),
        )

    def contract_hash(self):
        return sha(
            json.dumps(
                {"config": self.config, "schemas": self.schemas}, ensure_ascii=False, sort_keys=True
            )
        )


def markdown_links(body):
    targets = []
    for token in MarkdownIt().parse(body):
        for child in token.children or []:
            if child.type == "link_open":
                targets.append(child.attrGet("href") or "")
            elif child.type == "image":
                targets.append(child.attrGet("src") or "")
    return targets
