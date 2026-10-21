import asyncio
import hashlib
import json
import os
import shutil
import ssl
import subprocess
import threading
import time
import re
import zipfile
from pathlib import Path
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener

import decky

PLUGIN_DIR = str(Path(__file__).resolve().parent)
DEFAULT_DOWNLOAD_DIR = "/home/deck/Downloads"
PLUGIN_DOWNLOAD_DIR = f"{DEFAULT_DOWNLOAD_DIR}/deckyhub"
# owner/name, where neither part is only dots: the frontend puts this straight into
# api.github.com/repos/<repo>/releases with the user's token, so "../.." must not pass.
REPOSITORY_NAME = re.compile(r"(?!\.+/)[A-Za-z0-9_.-]+/(?!\.+$)[A-Za-z0-9_.-]+")
HIDEABLE_BUTTONS = ("downloadZip", "install", "update", "releasePage")
SUPPORTED_LANGUAGES = {"auto", "en", "uk", "ru", "es", "de", "fr", "ja", "zh"}
DEFAULT_COLUMNS_PER_ROW = 3
ACTIVE_DOWNLOAD_STATES = ("queued", "downloading")


# GitHub's release URLs redirect to its asset CDN; never follow one off HTTPS.
class _HttpsOnlyRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not newurl.startswith("https://"):
            raise RuntimeError(f"Refused a redirect to a non-HTTPS URL: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


# Where the major Linux distributions keep their CA bundle. SteamOS is Arch-based
# and uses the first one; the rest are here so the same plugin works elsewhere.
CA_BUNDLE_PATHS = (
    "/etc/ssl/cert.pem",
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
)


def verifying_ssl_context() -> ssl.SSLContext:
    """A verifying SSL context, with the trust store pointed at a real CA bundle.

    Decky Loader runs plugins under a PyInstaller-bundled Python whose OpenSSL was
    compiled on a Debian-style system and looks for certificates under
    /usr/lib/ssl. SteamOS is Arch-based, so that directory does not exist, the
    default context ends up trusting nobody, and every fetch fails with
    "CERTIFICATE_VERIFY_FAILED: unable to get local issuer certificate".

    So: build the normal verifying context, and only when it came up with no
    certificates at all, load a CA bundle from a known location. Verification
    stays on - this fixes where the trusted roots are read from, not whether
    they are checked. An expired, self-signed or hostname-mismatched certificate
    still fails, exactly as before.
    """
    context = ssl.create_default_context()
    if context.get_ca_certs():
        return context
    for path in CA_BUNDLE_PATHS:
        try:
            context.load_verify_locations(cafile=path)
        except (OSError, ssl.SSLError):
            continue
        if context.get_ca_certs():
            return context
    return context


_OPENER = build_opener(_HttpsOnlyRedirects, HTTPSHandler(context=verifying_ssl_context()))


def _coerce_columns_per_row(value) -> int:
    try:
        columns = int(value)
    except (TypeError, ValueError):
        return DEFAULT_COLUMNS_PER_ROW
    return columns if columns in (1, 2, 3) else DEFAULT_COLUMNS_PER_ROW


# The frontend sends this straight to api.github.com's Authorization header
# (see githubHeaders() in src/utils.ts) — it never touches the backend's own
# network calls, which only hit raw.githubusercontent.com/release-asset CDN
# URLs and aren't subject to the api.github.com rate limit this is for.
def _coerce_github_token(value) -> str:
    return value.strip()[:255] if isinstance(value, str) else ""


# User-added registry URLs, normalized, de-duplicated and capped. Invalid entries
# are dropped rather than raised on: a settings file edited by hand shouldn't stop
# the plugin from starting, and add_custom_registry() is where typos get reported.
def _coerce_registry_urls(values) -> list[str]:
    if not isinstance(values, list):
        return []
    urls: list[str] = []
    for value in values:
        try:
            url = validate_registry_url(value)
        except ValueError:
            continue
        if url not in urls:
            urls.append(url)
    return urls[:MAX_CUSTOM_REGISTRIES]


# A user mistyping a registry URL is ordinary, not exceptional: add_custom_registry
# reports these as a reason code for the UI to translate instead of raising, so a
# Python exception never reaches the frontend. See CONTRIBUTING.md's error pattern
# on download_asset, which returns {"error": ...} for the same reason.
def _registry_failure_reason(error: Exception) -> tuple[str, str]:
    if isinstance(error, HTTPError):
        return ("not-found", f"HTTP {error.code}") if error.code == 404 else ("unreachable", f"HTTP {error.code}")
    # urlopen wraps the real cause in URLError.reason, so unwrap before looking for TLS.
    cause = getattr(error, "reason", None) or error
    if isinstance(cause, ssl.SSLError):
        # verify_message is what makes this actionable when OpenSSL sets it: "certificate
        # has expired" points at the system clock, "self signed certificate" at a proxy or
        # a missing CA bundle. It isn't present on every verification error, so fall back.
        detail = getattr(cause, "verify_message", "") or "certificate could not be verified"
        return ("ssl-error", detail)
    if isinstance(error, ValueError):
        return ("not-registry", str(error))
    return ("unreachable", str(error))


def _coerce_settings(settings: dict) -> dict:
    return {
        "overwriteExisting": bool(settings.get("overwriteExisting", True)),
        "updateChannel": "prerelease" if settings.get("updateChannel") == "prerelease" else "stable",
        "language": settings.get("language") if settings.get("language") in SUPPORTED_LANGUAGES else "auto",
        "columnsPerRow": _coerce_columns_per_row(settings.get("columnsPerRow")),
        "githubToken": _coerce_github_token(settings.get("githubToken")),
        "density": "compact" if settings.get("density") == "compact" else "default",
        # Manage-window buttons the user chose to hide (Display Settings).
        "hiddenButtons": [name for name in HIDEABLE_BUTTONS if isinstance(settings.get("hiddenButtons"), list) and name in settings["hiddenButtons"]],
    }


def _coerce_repo_settings(values) -> dict:
    values = values if isinstance(values, dict) else {}
    asset_filter = values.get("assetFilter")
    return {
        "channel": "prerelease" if values.get("channel") == "prerelease" else "stable",
        "assetFilter": [value for value in asset_filter if isinstance(value, str) and value.strip()][:10] if isinstance(asset_filter, list) else [],
    }


REQUIRED_FIELDS = {"id", "name", "repo", "category", "asset"}
STRING_FIELDS = ("id", "name", "repo", "category")
OPTIONAL_STRING_FIELDS = ("description", "releaseTagInclude", "versionStrategy", "source")


def _string_list(value: object) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


def _valid_app(app: object) -> bool:
    # The frontend renders and lowercases these fields as-is, so a wrong type in
    # one entry would otherwise break the page for every app.
    if not isinstance(app, dict) or not REQUIRED_FIELDS <= app.keys():
        return False
    if not all(isinstance(app[key], str) for key in STRING_FIELDS):
        return False
    if not all(isinstance(app.get(key, ""), str) for key in OPTIONAL_STRING_FIELDS):
        return False
    if not REPOSITORY_NAME.fullmatch(app["repo"]):
        return False
    asset = app["asset"]
    if not isinstance(asset, dict) or not _string_list(asset.get("include")) or not _string_list(asset.get("exclude")):
        return False
    detect = app.get("detect", {})
    if not isinstance(detect, dict):
        return False
    return _string_list(detect.get("names", []))


def parse_registry(payload: object) -> list[dict]:
    """Validate the portable registry format and ignore malformed records."""
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1 or not isinstance(payload.get("apps"), list):
        raise ValueError("Unsupported registry format")
    return [app for app in payload["apps"] if _valid_app(app)]


REMOTE_REGISTRY_URL = "https://raw.githubusercontent.com/mazillka/deckyhub-plugin/refs/heads/main/registry/apps.json"
MAX_REMOTE_REGISTRY_BYTES = 512 * 1024
# How many user-added registries one install will track, so a bad list can't
# turn startup into an unbounded sequence of network fetches.
MAX_CUSTOM_REGISTRIES = 10


def fetch_remote_registry(url: str) -> tuple[list[dict], str]:
    """Download the registry over HTTPS. Returns (apps, raw_text); raises on any failure."""
    if not url.startswith("https://"):
        raise ValueError("Registry URL must use HTTPS")
    request = Request(url, headers={"User-Agent": "DeckyHub"})
    try:
        with _OPENER.open(request, timeout=10) as response:
            raw = response.read(MAX_REMOTE_REGISTRY_BYTES + 1)
    except RuntimeError as error:
        # _HttpsOnlyRedirects refused a redirect off HTTPS. A URLError (not ValueError),
        # so the UI says "couldn't reach" rather than "not a registry".
        raise URLError(str(error)) from error
    except HTTPException as error:
        # IncompleteRead and friends aren't OSError; report them as the network errors they are.
        raise ConnectionError(f"{type(error).__name__}: {error}") from error
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

class Plugin:
    async def _main(self):
        self.settings_path = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"
        self.settings = self._load_settings()
        # Start from the cached/bundled lists so startup never waits on the network,
        # then refresh from GitHub in the background (see _refresh_registry_in_background).
        self.apps = await asyncio.to_thread(self._load_registry, None, False)
        self.downloads: dict[str, dict] = {}
        self.cancelled: set[str] = set()
        self.download_queue: asyncio.Queue = asyncio.Queue()
        self.queue_worker = asyncio.create_task(self._run_download_queue())
        self.registry_task = asyncio.create_task(self._refresh_registry_in_background())
        decky.logger.info("DeckyHub %s started", (await self.get_deckyhub_info())["version"])

    def _load_settings(self) -> dict:
        try:
            settings = json.loads(self.settings_path.read_text(encoding="utf-8"))
            repos = settings.get("customRepos")
            repo_settings = settings.get("repoSettings")
            return {
                **_coerce_settings(settings),
                "customRepos": [repo for repo in repos if isinstance(repo, str) and REPOSITORY_NAME.fullmatch(repo)] if isinstance(repos, list) else [],
                "customRegistries": _coerce_registry_urls(settings.get("customRegistries", [])),
                "repoSettings": {repo: _coerce_repo_settings(values) for repo, values in repo_settings.items() if REPOSITORY_NAME.fullmatch(repo)} if isinstance(repo_settings, dict) else {},
            }
        except (AttributeError, OSError, json.JSONDecodeError) as error:
            if self.settings_path.exists():
                decky.logger.error("Can't read %s, using defaults: %s", self.settings_path, error)
            return {**_coerce_settings({}), "customRepos": [], "customRegistries": [], "repoSettings": {}}

    async def _refresh_registry_in_background(self):
        try:
            before = self.apps
            await self.refresh_registry()
            # Pages already open loaded the cached list; tell them to reload (index.tsx),
            # but only on a real change - the reload resets their page and every card.
            if self.apps != before:
                await decky.emit("registry_updated")
        except Exception as error:
            decky.logger.error("Background registry refresh failed: %s", error)

    def _load_registry(self, prefetched: tuple[str, tuple[list[dict], str]] | None = None, network: bool = True) -> list[dict]:
        """Official registry first (GitHub -> cached copy -> bundled file), then any user-added ones.

        `prefetched` is a (url, payload) already downloaded this call, so adding a
        registry reuses the fetch that validated it instead of asking for it twice.
        `network=False` skips the downloads and reads only the caches and bundled file.
        """
        def given(url):
            return prefetched[1] if prefetched and prefetched[0] == url else None

        apps = self._fetch_registry(REMOTE_REGISTRY_URL, bundled=True, prefetched=given(REMOTE_REGISTRY_URL), network=network)
        # First source wins: a user-added registry can add apps but never override
        # the detect rules or asset filters of an entry from the official registry,
        # nor reuse its id (the frontend matches cards by id).
        seen = {app["repo"].casefold() for app in apps}
        seen_ids = {app["id"] for app in apps}
        # A copy: add/remove can change the list while this runs in a worker thread.
        for url in list(self.settings.get("customRegistries", [])):
            for app in self._fetch_registry(url, prefetched=given(url), network=network):
                if app["repo"].casefold() not in seen and app["id"] not in seen_ids:
                    seen.add(app["repo"].casefold())
                    seen_ids.add(app["id"])
                    apps.append(app)
        return apps

    def _fetch_registry(self, url: str, bundled: bool = False, prefetched: tuple[list[dict], str] | None = None, network: bool = True) -> list[dict]:
        """One registry source: fetch it, cache it, else fall back to the cache and then the bundled file."""
        cache_path = self._registry_cache_path(url)
        if prefetched is not None:
            apps, text = prefetched
            self._cache_registry(cache_path, text, url)
            return apps
        if network:
            try:
                apps, text = fetch_remote_registry(url)
                # An empty official list is a broken publish, not "no apps": keep the
                # last good cache (or the bundled file) rather than overwrite it.
                if bundled and not apps:
                    raise ValueError("Registry has no usable apps")
            except (OSError, ValueError) as error:
                decky.logger.warning("Registry %s unavailable (%s); trying cached copy", url, error)
            else:
                # Removed while this download was in flight: don't recreate its cache.
                if bundled or url in self.settings.get("customRegistries", []):
                    self._cache_registry(cache_path, text, url)
                decky.logger.info("Loaded %d repositories from %s", len(apps), url)
                return apps
        try:
            return parse_registry(json.loads(cache_path.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            decky.logger.warning("No cached copy of %s", url)
        if not bundled:
            return []
        decky.logger.warning("Using bundled registry")
        return parse_registry(json.loads((Path(decky.DECKY_PLUGIN_DIR) / "registry" / "apps.json").read_text(encoding="utf-8")))

    def _cache_registry(self, cache_path: Path, text: str, url: str) -> None:
        """Best-effort: a registry that won't cache still works this session."""
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            temp = cache_path.with_name(f"{cache_path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
            temp.write_text(text, encoding="utf-8")
            os.replace(temp, cache_path)
        except OSError as error:
            decky.logger.warning("Could not cache registry %s: %s", url, error)

    def _registry_cache_path(self, url: str) -> Path:
        # The official registry keeps the plain documented name; user-added ones get
        # their own file per URL so one bad registry can't clobber another's cache.
        directory = Path(decky.DECKY_PLUGIN_SETTINGS_DIR)
        if url == REMOTE_REGISTRY_URL:
            return directory / "registry-cache.json"
        return directory / "registries" / f"{hashlib.sha256(url.encode('utf-8')).hexdigest()[:16]}.json"

    def _save_settings(self):
        # Write-then-rename, so a Deck losing power mid-save keeps the old file.
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        temp = self.settings_path.with_name(self.settings_path.name + ".tmp")
        with open(temp, "w", encoding="utf-8") as file:
            json.dump(self.settings, file)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp, self.settings_path)

    # Each plugin's (plugin.json, package.json or {}, repository), read once per scan.
    def _scan_installed_plugins(self) -> list[tuple[dict, dict, str | None]]:
        plugins_dir = Path(decky.DECKY_HOME) / "plugins"
        scanned = []
        for manifest_path in plugins_dir.glob("*/plugin.json"):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            try:
                package = json.loads((manifest_path.parent / "package.json").read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                package = {}
            scanned.append((manifest, package, self._plugin_repository(manifest, package)))
        return scanned

    def _match_decky_plugin(self, rule: dict, installed_plugins: list[tuple[dict, dict, str | None]]) -> tuple[dict, dict] | None:
        names = {name.casefold() for name in rule.get("names", [])}
        expected_repo = str(rule.get("repo", "")).casefold()
        for manifest, package, repo in installed_plugins:
            if manifest.get("name", "").casefold() in names or (expected_repo and repo == expected_repo):
                return manifest, package
        return None

    def _decky_plugin_version(self, match: tuple[dict, dict] | None) -> str | None:
        if not match:
            return None
        manifest, package = match
        return str(manifest.get("version") or package.get("version") or "installed")

    def _plugin_repository(self, manifest: dict, package: dict) -> str | None:
        value = package.get("repository", manifest.get("repository"))
        if isinstance(value, dict):
            value = value.get("url")
        if not isinstance(value, str):
            return None
        match = re.search(r"(?:github\.com[/:]|github:)([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)", value)
        repo = (match.group(1) if match else value).removesuffix(".git")
        return repo.casefold() if REPOSITORY_NAME.fullmatch(repo) else None

    async def get_apps(self):
        apps = [*self.apps, *self._custom_apps()]
        installed_plugins = await asyncio.to_thread(self._scan_installed_plugins)
        installed = [None] * len(apps)
        # The installed plugin's own name, which Decky Loader's install_plugin
        # route needs to update it in place (see "Install update" on the cards).
        plugin_names = [None] * len(apps)
        for index, app in enumerate(apps):
            if app.get("detect", {}).get("type") == "decky-plugin":
                match = self._match_decky_plugin(app["detect"], installed_plugins)
                installed[index] = self._decky_plugin_version(match)
                plugin_names[index] = match[0].get("name") if match else None
        decky.logger.info("Listed %d apps, %d installed", len(apps), sum(version is not None for version in installed))
        return {"apps": [{**app, "installedVersion": version, "pluginName": name, "latestVersion": None, "publishedAt": None, "releaseUrl": None, "assets": [], "updateAvailable": None, "error": None} for app, version, name in zip(apps, installed, plugin_names)]}

    async def save_repo_settings(self, repo: str, values: dict):
        if not REPOSITORY_NAME.fullmatch(repo):
            decky.logger.error("Refused settings for invalid repository %r", repo)
            raise ValueError("Repository must be owner/name")
        item = _coerce_repo_settings(values)
        self.settings["repoSettings"][repo] = item
        self._save_settings()
        decky.logger.info("Saved settings for %s: %s", repo, item)
        return item

    def _custom_apps(self) -> list[dict]:
        bundled = {app["repo"].casefold() for app in self.apps}
        return [{"id": f"custom-{repo.replace('/', '-')}", "name": repo, "repo": repo, "category": "Custom", "detect": {"type": "decky-plugin", "repo": repo}, "asset": {"include": [], "exclude": ["source"]}} for repo in self.settings["customRepos"] if repo.casefold() not in bundled]

    async def get_settings(self):
        return self.settings

    async def get_deckyhub_info(self):
        try:
            return {"version": str(json.loads((Path(PLUGIN_DIR) / "package.json").read_text(encoding="utf-8"))["version"])}
        except (KeyError, OSError, json.JSONDecodeError):
            return {"version": "unknown"}

    async def save_settings(self, settings: dict):
        self.settings = {
            **_coerce_settings(settings),
            "customRepos": getattr(self, "settings", {}).get("customRepos", []),
            "customRegistries": getattr(self, "settings", {}).get("customRegistries", []),
            "repoSettings": getattr(self, "settings", {}).get("repoSettings", {}),
        }
        self._save_settings()
        decky.logger.info("Saved settings: %s", {**self.settings, "githubToken": bool(self.settings["githubToken"])})
        return self.settings

    async def clear_downloads(self):
        directory = Path(PLUGIN_DOWNLOAD_DIR)
        # Files an active download is writing or about to write stay put.
        active = {Path(path) for job in getattr(self, "downloads", {}).values() if job["state"] in ACTIVE_DOWNLOAD_STATES and job.get("path") for path in (job["path"], job["path"] + ".part")}

        def clear():
            if not directory.is_dir():
                return 0
            removed = 0
            for entry in directory.iterdir():
                if entry in active:
                    continue
                if entry.is_dir() and not entry.is_symlink():
                    shutil.rmtree(entry)
                else:
                    entry.unlink()
                removed += 1
            return removed

        removed = await asyncio.to_thread(clear)
        decky.logger.info("Emptied %s: removed %d items", directory, removed)
        return {"removed": removed}

    async def list_downloads(self):
        directory = Path(PLUGIN_DOWNLOAD_DIR)

        def list_items():
            if not directory.is_dir():
                return []
            return [{"name": entry.name, "directory": entry.is_dir() and not entry.is_symlink()} for entry in sorted(directory.iterdir(), key=lambda entry: entry.name.casefold())]

        return {"items": await asyncio.to_thread(list_items)}

    async def add_custom_repo(self, repo: str):
        repo = repo.strip()
        if not REPOSITORY_NAME.fullmatch(repo):
            decky.logger.error("Refused to add invalid repository %r", repo)
            raise ValueError("Repository must be owner/name")
        existing = {app["repo"].casefold() for app in self.apps} | {item.casefold() for item in self.settings["customRepos"]}
        if repo.casefold() in existing:
            return {"added": False, "repo": repo}
        self.settings["customRepos"].append(repo)
        self._save_settings()
        decky.logger.info("Added repository %s", repo)
        return {"added": True, "repo": repo}

    async def get_custom_repos(self):
        return {"repos": self.settings["customRepos"]}

    async def remove_custom_repo(self, repo: str):
        repo = repo.strip()
        # Case-insensitive, like add/import; also drops the repo's saved channel/filter.
        stored = next((item for item in self.settings["customRepos"] if item.casefold() == repo.casefold()), None)
        if stored is None:
            return {"removed": False, "repo": repo}
        self.settings["customRepos"].remove(stored)
        self.settings.get("repoSettings", {}).pop(stored, None)
        self._save_settings()
        decky.logger.info("Removed repository %s", stored)
        return {"removed": True, "repo": repo}

    def _export_target(self, name: str) -> Path:
        target = Path(DEFAULT_DOWNLOAD_DIR) / name
        target.parent.mkdir(parents=True, exist_ok=True)
        return self._next_name(target) if target.exists() else target

    async def export_custom_repos(self):
        target = self._export_target("DeckyHub-repositories.json")
        target.write_text(json.dumps({"schemaVersion": 1, "repos": self.settings["customRepos"]}, indent=2), encoding="utf-8")
        decky.logger.info("Exported %d repositories to %s", len(self.settings["customRepos"]), target)
        return {"path": str(target)}

    # Frontend errors (GitHub lookups, installs) only reach the CEF console
    # otherwise, so they're forwarded here to land in the exported log.
    async def log_frontend(self, message: str):
        decky.logger.warning("[frontend] %s", str(message)[:2000])

    async def export_logs(self):
        target = self._export_target(f"DeckyHub-logs-{time.strftime('%Y%m%d-%H%M%S')}.zip")
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for log in sorted(Path(decky.DECKY_PLUGIN_LOG_DIR).glob("*.log")):
                archive.write(log, log.name)
        return {"path": str(target)}

    async def import_custom_repos(self, path: str):
        source = Path(path).resolve()
        deck_home = Path(DEFAULT_DOWNLOAD_DIR).parent.resolve()
        if source.suffix.lower() != ".json" or not source.is_relative_to(deck_home):
            decky.logger.error("Refused to import %s: not a JSON file inside /home/deck", source)
            raise ValueError("Choose a JSON file inside /home/deck")
        try:
            payload = json.loads(source.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            decky.logger.error("Can't import %s: %s", source, error)
            raise ValueError("Invalid repository export") from error
        repos = payload.get("repos", []) if isinstance(payload, dict) else payload
        if not isinstance(repos, list):
            decky.logger.error("Can't import %s: no repository list", source)
            raise ValueError("Invalid repository export")
        existing = {app["repo"].casefold() for app in self.apps} | {repo.casefold() for repo in self.settings["customRepos"]}
        added = []
        for repo in repos:
            if isinstance(repo, str) and REPOSITORY_NAME.fullmatch(repo) and repo.casefold() not in existing:
                existing.add(repo.casefold())
                added.append(repo)
        if added:
            self.settings["customRepos"].extend(added)
            self._save_settings()
        decky.logger.info("Imported %s from %s", added or "nothing new", source)
        return {"added": added}

    async def get_custom_registries(self):
        return {"registries": [{"url": url} for url in self.settings.get("customRegistries", [])]}

    async def add_custom_registry(self, url: str):
        """Never raises for user input: returns added=False plus a reason code for the UI."""
        try:
            url = validate_registry_url(url)
        except ValueError as error:
            decky.logger.error("Refused to add invalid registry URL %r", url)
            return {"added": False, "url": url, "reason": "invalid-url", "detail": str(error)}
        if url in self.settings.get("customRegistries", []):
            return {"added": False, "url": url, "reason": "already-added", "detail": ""}
        if len(self.settings.get("customRegistries", [])) >= MAX_CUSTOM_REGISTRIES:
            return {"added": False, "url": url, "reason": "too-many", "detail": str(MAX_CUSTOM_REGISTRIES)}
        # Load it once before saving, so a dead or non-registry URL is reported here,
        # while the user is watching, instead of being skipped on every later start.
        try:
            apps, text = await asyncio.to_thread(fetch_remote_registry, url)
        except (OSError, ValueError) as error:
            reason, detail = _registry_failure_reason(error)
            decky.logger.error("Can't load registry %s: %s", url, error)
            return {"added": False, "url": url, "reason": reason, "detail": detail}
        # Checked again: another add may have finished while this one was downloading.
        if url in self.settings.get("customRegistries", []):
            return {"added": False, "url": url, "reason": "already-added", "detail": ""}
        if len(self.settings.get("customRegistries", [])) >= MAX_CUSTOM_REGISTRIES:
            return {"added": False, "url": url, "reason": "too-many", "detail": str(MAX_CUSTOM_REGISTRIES)}
        # A list whose every entry is already shown (the official one pinned to a
        # commit, say) would be saved and fetched on every refresh for nothing.
        repos = {app["repo"].casefold() for app in self.apps}
        ids = {app["id"] for app in self.apps}
        if not any(app["repo"].casefold() not in repos and app["id"] not in ids for app in apps):
            return {"added": False, "url": url, "reason": "nothing-new", "detail": str(len(apps))}
        self.settings.setdefault("customRegistries", []).append(url)
        self._save_settings()
        # Hand the payload we already have to the reload and read the rest from their
        # caches, so adding costs exactly one request.
        self.apps = await asyncio.to_thread(self._load_registry, (url, (apps, text)), False)
        # Report what it actually contributed: entries already listed by an earlier
        # source are skipped, so "added with 12 repositories" could mean none showed up.
        # The prefetched entries are passed through as-is, so identity tells them apart.
        mine = {id(app) for app in apps}
        added = sum(id(app) in mine for app in self.apps)
        decky.logger.info("Added registry %s: %d entries, %d new", url, len(apps), added)
        return {"added": True, "url": url, "apps": added}

    async def remove_custom_registry(self, url: str):
        wanted = url.strip() if isinstance(url, str) else ""
        stored = next((item for item in self.settings.get("customRegistries", []) if item == wanted), None)
        if stored is None:
            return {"removed": False, "url": wanted}
        self.settings["customRegistries"].remove(stored)
        self._save_settings()
        try:
            self._registry_cache_path(stored).unlink(missing_ok=True)
        except OSError as error:
            decky.logger.warning("Could not delete cache for %s: %s", stored, error)
        # Dropping a source needs no downloads: the rest come from their caches.
        self.apps = await asyncio.to_thread(self._load_registry, None, False)
        decky.logger.info("Removed registry %s", stored)
        return {"removed": True, "url": stored}

    async def refresh_registry(self):
        sources = list(self.settings.get("customRegistries", []))
        apps = await asyncio.to_thread(self._load_registry)
        if sources != self.settings.get("customRegistries", []):
            # A registry was added or removed mid-download, so `apps` reflects the old
            # list. Rebuild from the caches, which already hold what was just fetched.
            apps = await asyncio.to_thread(self._load_registry, None, False)
        self.apps = apps
        decky.logger.info("Reloaded %d registry entries", len(self.apps))
        return {"apps": len(self.apps)}

    async def download_asset(self, asset: dict, repo: str | None = None):
        try:
            name = self._validate_download_asset(asset, repo)
            for job_id, job in self.downloads.items():
                if job.get("repo") == repo and job.get("url") == asset["url"] and job["state"] in ACTIVE_DOWNLOAD_STATES:
                    return {"jobId": job_id}
            target_dir = Path(PLUGIN_DOWNLOAD_DIR)
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / name
            if target.exists() and not self.settings.get("overwriteExisting"):
                target = self._next_name(target)
            # Finished jobs are only read by their own progress window, which stops
            # polling once it has seen the final state, so drop them here.
            self.downloads = {key: job for key, job in self.downloads.items() if job["state"] in ACTIVE_DOWNLOAD_STATES}
            job_id = f"{name}-{time.monotonic_ns()}"
            self.downloads[job_id] = {"state": "queued", "filename": target.name, "received": 0, "total": asset.get("size") or 0, "path": str(target), "error": None, "repo": repo, "url": asset["url"]}
            self.download_queue.put_nowait((job_id, asset, target))
            decky.logger.info("Queued download of %s to %s", asset["url"], target)
            return {"jobId": job_id}
        except (OSError, ValueError) as error:
            name = asset.get("name", "download") if isinstance(asset, dict) else "download"
            decky.logger.error("Can't start %s from %s: %s", name, repo, error)
            return {"error": f"Can't start {name}: {error}"}

    @staticmethod
    def _validate_download_asset(asset: dict, repo: str | None) -> str:
        prefix = f"https://github.com/{repo}/releases/download/" if isinstance(repo, str) and REPOSITORY_NAME.fullmatch(repo) else ""
        if not isinstance(asset, dict) or not prefix or not isinstance(asset.get("url"), str) or not asset["url"].startswith(prefix):
            raise ValueError("Only GitHub release assets for the selected repository can be downloaded")
        name = Path(asset.get("name", "download")).name
        if not name or name in (".", ".."):
            raise ValueError("Invalid asset filename")
        return name

    async def _run_download_queue(self):
        while True:
            job_id, asset, target = await self.download_queue.get()
            try:
                await asyncio.to_thread(self._download, job_id, asset, target)
            finally:
                self.download_queue.task_done()

    def _next_name(self, target: Path) -> Path:
        for number in range(1, 1000):
            candidate = target.with_name(f"{target.stem} ({number}){target.suffix}")
            if not candidate.exists():
                return candidate
        raise RuntimeError("Too many files with this name")

    def _download(self, job_id: str, asset: dict, target: Path):
        job, temp = self.downloads[job_id], target.with_name(target.name + ".part")
        try:
            if job_id in self.cancelled:
                raise InterruptedError("Download cancelled")
            job["state"] = "downloading"
            try:
                self._download_with_urllib(job_id, asset, temp)
            except URLError as error:
                decky.logger.warning("urllib failed for %s (%s), retrying with curl", asset["url"], error)
                self._download_with_curl(job_id, asset, temp)
            if asset.get("sha256") and self._sha256(temp) != asset["sha256"].lower():
                raise RuntimeError("SHA256 verification failed")
            os.replace(temp, target)
            job["state"] = "complete"
            decky.logger.info("Downloaded %s to %s", asset["url"], target)
        except InterruptedError:
            job["state"] = "cancelled"
            temp.unlink(missing_ok=True)
            decky.logger.info("Cancelled download of %s", asset["url"])
        except Exception as error:
            job.update({"state": "error", "error": str(error)})
            decky.logger.error("Download of %s failed: %s", asset["url"], error)
            temp.unlink(missing_ok=True)
        finally:
            self.cancelled.discard(job_id)

    def _download_with_urllib(self, job_id: str, asset: dict, temp: Path):
        job = self.downloads[job_id]
        request = Request(asset["url"], headers={"User-Agent": "DeckyHub/0.2"})
        with _OPENER.open(request, timeout=30) as response, open(temp, "wb") as file:
            job["total"] = int(response.headers.get("Content-Length") or job["total"] or 0)
            while chunk := response.read(64 * 1024):
                if job_id in self.cancelled:
                    raise InterruptedError("Download cancelled")
                file.write(chunk)
                job["received"] += len(chunk)

    def _download_with_curl(self, job_id: str, asset: dict, temp: Path):
        job = self.downloads[job_id]
        curl = shutil.which("curl", path="/usr/bin:/bin")
        if not curl:
            raise RuntimeError("System curl is unavailable")
        environment = os.environ.copy()
        environment.pop("LD_LIBRARY_PATH", None)
        environment.pop("LD_PRELOAD", None)
        process = subprocess.Popen([curl, "--fail", "--location", "--proto", "=https", "--proto-redir", "=https", "--silent", "--show-error", "--connect-timeout", "15", "--max-time", "300", "--output", str(temp), asset["url"]], stderr=subprocess.PIPE, text=True, env=environment)
        while process.poll() is None:
            if job_id in self.cancelled:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
                raise InterruptedError("Download cancelled")
            job["received"] = temp.stat().st_size if temp.exists() else 0
            time.sleep(0.2)
        if process.returncode:
            raise RuntimeError((process.stderr.read() or "curl download failed").strip())
        job["received"] = temp.stat().st_size

    def _sha256(self, path: Path) -> str:
        with open(path, "rb") as file:
            return hashlib.file_digest(file, "sha256").hexdigest()

    async def get_download(self, job_id: str):
        return self.downloads.get(job_id, {"state": "missing"})

    async def cancel_download(self, job_id: str):
        # Only active jobs: a finished job's id would otherwise stay in the set.
        if self.downloads.get(job_id, {}).get("state") not in ACTIVE_DOWNLOAD_STATES:
            return {"ok": False}
        self.cancelled.add(job_id)
        return {"ok": True}
