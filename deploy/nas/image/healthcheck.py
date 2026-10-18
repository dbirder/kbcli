"""Authenticated readiness probe; credentials and response bodies are never printed."""
import json
import os
import urllib.request

request = urllib.request.Request(
    "http://127.0.0.1:8765/api/status",
    headers={"Authorization": "Bearer " + os.environ["KBCLI_AGENT_TOKEN"]},
)
with urllib.request.urlopen(request, timeout=8) as response:
    data = json.load(response)
assert data.get("ok") is True and data.get("role") == "ai"
