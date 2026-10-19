import json
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
from pathlib import Path

from backend.tls import verifying_ssl_context


def parse_registry(payload: object) -> list[dict]:
    """Validate the portable registry format and ignore malformed records."""
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1 or not isinstance(payload.get("apps"), list):
        raise ValueError("Unsupported registry format")
    required = {"id", "name", "repo", "category", "versionStrategy", "source", "asset"}
    return [app for app in payload["apps"] if required <= app.keys() and "/" in app["repo"]]


def load_registry(plugin_dir: str) -> list[dict]:
    """Load the editable bundled registry."""
    path = Path(plugin_dir) / "registry" / "apps.json"
    return parse_registry(json.loads(path.read_text(encoding="utf-8")))


REMOTE_REGISTRY_URL = "https://raw.githubusercontent.com/mazillka/deckyhub-plugin/refs/heads/main/registry/apps.json"
REMOTE_REGISTRY_TIMEOUT = 10
MAX_REMOTE_REGISTRY_BYTES = 512 * 1024
# How many user-added registries one install will track, so a bad list can't
# turn startup into an unbounded sequence of network fetches.
MAX_CUSTOM_REGISTRIES = 10


def fetch_remote_registry(url: str = REMOTE_REGISTRY_URL, timeout: float = REMOTE_REGISTRY_TIMEOUT) -> tuple[list[dict], str]:
    """Download the registry over HTTPS. Returns (apps, raw_text); raises on any failure."""
    if not url.startswith("https://"):
        raise ValueError("Registry URL must use HTTPS")
    request = Request(url, headers={"User-Agent": "DeckyHub"})
    with urlopen(request, timeout=timeout, context=verifying_ssl_context()) as response:
        raw = response.read(MAX_REMOTE_REGISTRY_BYTES + 1)
    if len(raw) > MAX_REMOTE_REGISTRY_BYTES:
        raise ValueError("Remote registry is too large")
    text = raw.decode("utf-8")
    return parse_registry(json.loads(text)), text


def validate_registry_url(url: str) -> str:
    """Normalize a registry URL the user typed; raise ValueError if it can't be used.

    HTTPS only, and only paths that end in `.json`, so a mistyped URL fails with
    a clear message here instead of an opaque JSON parse error at load time.
    """
    url = url.strip() if isinstance(url, str) else ""
    if not url.startswith("https://"):
        raise ValueError("Registry URL must use HTTPS")
    if len(url) > 2048:
        raise ValueError("Registry URL is too long")
    if not urlsplit(url).path.lower().endswith(".json"):
        raise ValueError("Registry URL must point to a .json file")
    return url
