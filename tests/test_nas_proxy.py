import importlib.util
import io
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("nas_proxy", ROOT / "tests/extension/serve_proxy.py")
proxy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(proxy)


def request(path, method="GET", headers=None, body=b""):
    cls = proxy.handler("http://127.0.0.1:18770")
    instance = object.__new__(cls)
    instance.path = path
    instance.command = method
    instance.headers = headers or {}
    instance.rfile = io.BytesIO(body)
    instance.wfile = io.BytesIO()
    instance.status = None
    instance.response_headers = {}
    instance.send_response = lambda status: setattr(instance, "status", status)
    instance.send_header = lambda key, value: instance.response_headers.update({key: value})
    instance.end_headers = lambda: None
    instance.send_error = lambda status: setattr(instance, "status", status)
    instance.handle_request()
    return instance


@pytest.mark.parametrize("path", ["/assets/mist.svg", "/vendor/markdown-it-15.0.3.mjs", "/markdown.mjs"])
def test_proxy_serves_new_nested_release_assets_from_the_allowlist(path):
    response = request(path)
    assert response.status == 200
    assert response.wfile.getvalue() == (proxy.ASSETS / path[1:]).read_bytes()
    assert response.response_headers["Cache-Control"] == "no-store"


@pytest.mark.parametrize("path", ["/../.env", "/%2e%2e/.env", "/vendor/README.md", "/service.env"])
def test_proxy_does_not_serve_files_outside_the_release_allowlist(path):
    assert request(path).status == 404


@pytest.mark.parametrize("path", ["/api/recent?limit=20", "/api/search?q=NAS", "/api/read?path=notes%2Fexample.md"])
def test_knowledge_reads_forward_only_fixture_credentials(path, monkeypatch):
    calls = []

    def reply(upstream_request, **kwargs):
        calls.append(upstream_request)
        response = io.BytesIO(b'{"ok":true}')
        response.code = 200
        return response

    monkeypatch.setattr(proxy.OPENER, "open", reply)
    response = request(path, headers={"Authorization": "Bearer ui-test-user"})
    assert response.status == 200
    assert calls[0].full_url == "http://127.0.0.1:18770" + path
    assert calls[0].get_method() == "GET"
    assert calls[0].get_header("Authorization") == "Bearer ui-test-user"
    assert request(path, headers={"Authorization": "Bearer production-like-fixture"}).status == 401
    assert request(path, "POST", {"Authorization": "Bearer ui-test-user"}).status == 405
    assert len(calls) == 1


@pytest.mark.parametrize("length,status", [("bad", 400), ("-1", 400), ("65537", 413)])
def test_invalid_request_length_is_rejected_before_reading_or_forwarding(length, status):
    assert request("/api/tasks", "POST", {"Authorization": "Bearer ui-test-user", "Content-Length": length}).status == status


def test_proxy_redirect_handler_does_not_forward_authentication_to_another_host():
    handler = proxy.NoRedirect()
    assert handler.redirect_request(None, None, 302, "Found", {}, "https://example.invalid") is None
