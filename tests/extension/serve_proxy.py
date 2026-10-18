"""Loopback-bound extension page fixture against an isolated NAS API; test credentials only."""
import argparse
import ipaddress
import re
import runpy
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "extensions/chrome-kb"
ASSET_PATHS = frozenset("/" + name for name in runpy.run_path(str(ROOT / "scripts/build_extension.py"))["FILES"])
READ_APIS = {"/api/tasks", "/api/status", "/api/autosync", "/api/recent", "/api/search", "/api/read"}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())


def handler(upstream):
    class Handler(BaseHTTPRequestHandler):
        def handle_request(self):
            path = urlsplit(self.path).path
            if path in READ_APIS or re.fullmatch(r"/api/tasks/[a-f0-9-]{36}", path):
                if self.headers.get("Authorization") not in {"Bearer ui-test-user", "Bearer ui-test-agent"}:
                    self.send_error(401)
                    return
                methods = {"GET", "POST"} if path == "/api/tasks" else {"GET"} if path in READ_APIS else {"PATCH"}
                if self.command not in methods:
                    self.send_error(405)
                    return
                try:
                    length = int(self.headers.get("Content-Length", "0"))
                    if length < 0:
                        raise ValueError
                except ValueError:
                    self.send_error(400)
                    return
                if length > 65536:
                    self.send_error(413)
                    return
                request = urllib.request.Request(upstream + self.path, method=self.command,
                    data=self.rfile.read(length) if length else None,
                    headers={"Authorization": self.headers.get("Authorization", ""), "Content-Type": "application/json"})
                try:
                    response = OPENER.open(request, timeout=20)
                except urllib.error.HTTPError as error:
                    response = error
                except (urllib.error.URLError, OSError):
                    self.send_error(502)
                    return
                with response:
                    data = response.read()
                    self.send_response(response.code)
                    self.send_header("Content-Type", "application/json")
                    self.send_header("Cache-Control", "no-store")
                    self.end_headers()
                    self.wfile.write(data)
                return
            if self.command != "GET":
                self.send_error(405)
                return
            if path in {"/", "/newtab.html"}:
                data = (ASSETS / "newtab.html").read_text().replace('src="app.mjs"', 'src="/__test_bootstrap.mjs"').encode()
                content_type = "text/html; charset=utf-8"
            elif path == "/__test_bootstrap.mjs":
                data = (ROOT / "tests/extension/chrome-shim.mjs").read_bytes()
                content_type = "text/javascript"
            elif path in ASSET_PATHS and (ASSETS / path[1:]).is_file():
                data = (ASSETS / path[1:]).read_bytes()
                content_type = {".css": "text/css", ".mjs": "text/javascript", ".svg": "image/svg+xml", ".json": "application/json"}.get(Path(path).suffix, "text/plain; charset=utf-8")
            else:
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        do_GET = do_POST = do_PATCH = handle_request

        def log_message(self, *_):
            pass
    return Handler


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upstream", default="http://127.0.0.1:18770")
    parser.add_argument("--port", type=int, default=18771)
    parser.add_argument("--allow-lan-isolated", action="store_true", help="Permit a private-IP NAS test API; only fixture credentials are forwarded")
    args = parser.parse_args()
    url = urlsplit(args.upstream)
    allowed = url.hostname == "127.0.0.1"
    if args.allow_lan_isolated:
        try:
            allowed = ipaddress.ip_address(url.hostname).is_private
        except ValueError:
            allowed = False
    if url.scheme != "http" or not allowed or url.port == args.port or url.path or url.query or url.fragment or url.username:
        parser.error("Use a loopback upstream, or explicitly permit a private-IP isolated API")
    probe = urllib.request.Request(args.upstream + "/api/status", headers={"Authorization": "Bearer ui-test-user"})
    with OPENER.open(probe, timeout=10) as response:
        if response.code != 200:
            parser.error("The upstream must accept the fixture test identity")
    ThreadingHTTPServer(("127.0.0.1", args.port), handler(args.upstream)).serve_forever()
