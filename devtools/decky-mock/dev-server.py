"""Local dev bridge for DeckyHub's UI mock: exposes main.py's Plugin over HTTP.

Fakes just enough of the `decky` module (paths, a logger writing to
.dev-data/logs/ like Decky's per-plugin log) so main.py's
Plugin class can run outside the real Decky Loader, then serves POST /
{"route": "get_apps", "args": []} -> {"ok": true, "result": ...}, calling the
real Plugin method on a persistent background event loop. Stdlib only, no
extra pip installs, matching the rest of this project's backend.

Run from the repo root: python devtools/decky-mock/dev-server.py
"""

import asyncio
import json
import logging
import sys
import threading
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MOCK_DIR = Path(__file__).resolve().parent
REPO_ROOT = MOCK_DIR.parent.parent
DEV_DATA = MOCK_DIR / ".dev-data"
(DEV_DATA / "settings").mkdir(parents=True, exist_ok=True)
(DEV_DATA / "plugins").mkdir(parents=True, exist_ok=True)
(DEV_DATA / "logs").mkdir(parents=True, exist_ok=True)

fake_decky = types.ModuleType("decky")
fake_decky.DECKY_PLUGIN_SETTINGS_DIR = str(DEV_DATA / "settings")
fake_decky.DECKY_PLUGIN_DIR = str(REPO_ROOT)
fake_decky.DECKY_HOME = str(DEV_DATA)
fake_decky.DECKY_PLUGIN_LOG_DIR = str(DEV_DATA / "logs")
# A real logger so Export Logs (Quick Access panel) has a file to zip; also echoed to the console.
fake_decky.logger = logging.getLogger("DeckyHub")
fake_decky.logger.setLevel(logging.INFO)
for handler in (logging.FileHandler(DEV_DATA / "logs" / "deckyhub.log", encoding="utf-8"), logging.StreamHandler()):
    handler.setFormatter(logging.Formatter("[%(asctime)s][%(levelname)s]: %(message)s"))
    fake_decky.logger.addHandler(handler)


async def _emit(event, *args):
    fake_decky.logger.info("emit %s %s", event, args)


fake_decky.emit = _emit
sys.modules["decky"] = fake_decky

sys.path.insert(0, str(REPO_ROOT))
from main import Plugin  # noqa: E402

import main  # noqa: E402

# Keep the mock's downloads inside .dev-data instead of a real /home/deck path
# (which on Windows resolves to <drive>:\home\deck, outside the repo).
main.DEFAULT_DOWNLOAD_DIR = str(DEV_DATA / "home" / "Downloads")
main.PLUGIN_DOWNLOAD_DIR = str(DEV_DATA / "downloads")

# Fixture registries on the reserved .test TLD, so E2E can add one without the
# network, and the official list served from the bundled file so a refresh is
# offline and deterministic too; every other URL still goes to the real fetch.
FIXTURE_REGISTRY_HOST = "https://registry.test/"
FIXTURE_APP = {"id": "fixture-app", "name": "Fixture App", "repo": "example/fixture-app", "category": "Test", "versionStrategy": "semver", "source": "releases", "detect": {"type": "decky-plugin", "names": ["Fixture App"]}, "asset": {"include": [".zip"], "exclude": []}}
FIXTURE_REGISTRIES = {"good.json": [FIXTURE_APP], "empty.json": []}
_real_fetch_registry = main.fetch_remote_registry


def _fetch_registry(url, *args, **kwargs):
    if url == main.REMOTE_REGISTRY_URL:
        text = (REPO_ROOT / "registry" / "apps.json").read_text(encoding="utf-8")
        return main.parse_registry(json.loads(text)), text
    if not url.startswith(FIXTURE_REGISTRY_HOST):
        return _real_fetch_registry(url, *args, **kwargs)
    name = url.removeprefix(FIXTURE_REGISTRY_HOST)
    if name not in FIXTURE_REGISTRIES:
        raise main.HTTPError(url, 404, "Not Found", {}, None)
    text = json.dumps({"schemaVersion": 1, "apps": FIXTURE_REGISTRIES[name]})
    return main.parse_registry(json.loads(text)), text


main.fetch_remote_registry = _fetch_registry

loop = asyncio.new_event_loop()
plugin = Plugin()


def _run_loop():
    asyncio.set_event_loop(loop)
    loop.run_forever()


threading.Thread(target=_run_loop, daemon=True, name="decky-mock-loop").start()
asyncio.run_coroutine_threadsafe(plugin._main(), loop).result()
print(f"[decky-mock] Plugin ready. Fake DECKY_HOME: {fake_decky.DECKY_HOME}")

# Fixed, never-completing job for the DevShell's "Download progress modal" preview button.
plugin.downloads["preview-job"] = {"state": "downloading", "filename": "Decky-Framegen.zip", "received": 60_100_000, "total": 199_600_000, "path": None, "error": None}


def call_route(route: str, args: list):
    method = getattr(plugin, route, None)
    if method is None or not callable(method) or route.startswith("_"):
        raise ValueError(f"Unknown route: {route}")
    return asyncio.run_coroutine_threadsafe(method(*args), loop).result(timeout=30)


# Only the mock UI (vite on :5183) may call the bridge. A cross-site page can
# still send a "simple" POST without a preflight, so check Origin before
# running anything, not just in the CORS response headers.
ALLOWED_ORIGINS = {"http://127.0.0.1:5183", "http://localhost:5183"}


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        origin = self.headers.get("Origin")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        body = b'{"ok": true}'
        self.send_response(200)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.headers.get("Origin") not in ALLOWED_ORIGINS:
            self.send_error(403, "Origin not allowed")
            return
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length) or b"{}")
        try:
            result = call_route(payload["route"], payload.get("args", []))
            body = json.dumps({"ok": True, "result": result}).encode("utf-8")
            status = 200
        except Exception as error:  # dev tool: surface any backend error straight to the browser
            body = json.dumps({"ok": False, "error": str(error)}).encode("utf-8")
            status = 500
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):  # noqa: A002 - matches BaseHTTPRequestHandler's signature
        pass


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8642
    print(f"[decky-mock] Backend bridge listening on http://127.0.0.1:{port}")
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
