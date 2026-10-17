import functools
import inspect
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from .errors import KBError


def request(server, token, command, params):
    parsed = urlparse(server)
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username
        or parsed.password
    ):
        raise KBError("SERVER_INVALID", "server 必须是无嵌入凭据的 HTTP 或 HTTPS 地址")
    if not token:
        raise KBError("AUTH_CONFIG_INVALID", "客户端令牌环境变量未设置")
    req = Request(
        server.rstrip("/") + "/api/command",
        data=json.dumps({"command": command, "params": params}, ensure_ascii=False).encode(),
        headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(req, timeout=60) as response:
            return json.load(response)
    except HTTPError as exc:
        try:
            response = json.load(exc)
            error = response["error"]
        except Exception:
            raise KBError("SERVER_ERROR", "远端请求失败", status=exc.code) from exc
        raise KBError(error["code"], error["message"], **error.get("details", {})) from exc
    except (URLError, TimeoutError) as exc:
        raise KBError("SERVER_OFFLINE", "无法连接知识库服务", reason=str(exc)) from exc


def remote(name):
    """Forward supported CLI commands without creating a local Vault or writer."""

    def decorate(function):
        @functools.wraps(function)
        def wrapped(*args, **kwargs):
            bound = inspect.signature(function).bind(*args, **kwargs)
            bound.apply_defaults()
            params = dict(bound.arguments)
            ctx = params.get("ctx")
            options = ctx.find_root().obj if ctx else {}
            if not options.get("server"):
                return function(*args, **kwargs)
            from .cli import execute, metadata_json

            params.pop("ctx", None)
            params.pop("json_output", None)
            # Authentication comes from the server token, never a caller's actor string.
            params.pop("actor", None)

            def action():
                if "patch_file" in params:
                    params["change"] = metadata_json(params.pop("patch_file").read_text())
                if "metadata" in params:
                    params["metadata"] = metadata_json(params["metadata"])
                return request(
                    options["server"], os.environ.get(options["token_env"], ""), name, params
                )

            return execute(action)

        return wrapped

    return decorate
