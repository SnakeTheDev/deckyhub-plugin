import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import time
import re
import zipfile
from pathlib import Path
from urllib.error import URLError
from urllib.request import Request, urlopen

import decky

PLUGIN_DIR = str(Path(__file__).resolve().parent)
DEFAULT_DOWNLOAD_DIR = "/home/deck/Downloads"
PLUGIN_DOWNLOAD_DIR = f"{DEFAULT_DOWNLOAD_DIR}/deckyhub"
REPOSITORY_NAME = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$")
HIDEABLE_BUTTONS = ("downloadZip", "install", "update", "releasePage")
SUPPORTED_LANGUAGES = {"auto", "en", "uk", "ru", "es", "de", "fr", "ja", "zh"}
DEFAULT_COLUMNS_PER_ROW = 3


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


def parse_registry(payload: object) -> list[dict]:
    """Validate the portable registry format and ignore malformed records."""
    if not isinstance(payload, dict) or payload.get("schemaVersion") != 1 or not isinstance(payload.get("apps"), list):
        raise ValueError("Unsupported registry format")
    required = {"id", "name", "repo", "category", "asset"}
    return [app for app in payload["apps"] if required <= app.keys() and "/" in app["repo"]]


class Plugin:
    async def _main(self):
        self.settings_path = Path(decky.DECKY_PLUGIN_SETTINGS_DIR) / "settings.json"
        self.settings = self._load_settings()
        self.apps = parse_registry(json.loads((Path(decky.DECKY_PLUGIN_DIR) / "registry" / "apps.json").read_text(encoding="utf-8")))
        self.downloads: dict[str, dict] = {}
        self.cancelled: set[str] = set()
        self.download_queue: asyncio.Queue = asyncio.Queue()
        self.queue_worker = asyncio.create_task(self._run_download_queue())
        decky.logger.info("DeckyHub %s started", (await self.get_deckyhub_info())["version"])

    def _load_settings(self) -> dict:
        try:
            settings = json.loads(self.settings_path.read_text(encoding="utf-8"))
            repos = settings.get("customRepos", [])
            return {
                **_coerce_settings(settings),
                "customRepos": [repo for repo in repos if isinstance(repo, str) and REPOSITORY_NAME.fullmatch(repo)],
                "repoSettings": settings.get("repoSettings", {}) if isinstance(settings.get("repoSettings"), dict) else {},
            }
        except (AttributeError, OSError, json.JSONDecodeError) as error:
            if self.settings_path.exists():
                decky.logger.error("Can't read %s, using defaults: %s", self.settings_path, error)
            return {**_coerce_settings({}), "customRepos": [], "repoSettings": {}}

    def _save_settings(self):
        self.settings_path.parent.mkdir(parents=True, exist_ok=True)
        self.settings_path.write_text(json.dumps(self.settings), encoding="utf-8")

    def _scan_installed_plugins(self) -> list[tuple[Path, dict, str | None]]:
        plugins_dir = Path(decky.DECKY_HOME) / "plugins"
        scanned = []
        for manifest_path in plugins_dir.glob("*/plugin.json"):
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            scanned.append((manifest_path, manifest, self._plugin_repository(manifest_path, manifest)))
        return scanned

    def _installed_version(self, app: dict) -> str | None:
        rule = app.get("detect", {})
        command = rule.get("command")
        if not command or not shutil.which(command):
            return None
        try:
            result = subprocess.run([command, *rule.get("args", ["--version"])], capture_output=True, text=True, timeout=4, check=False)
            output = (result.stdout + result.stderr).strip()
            return output[:200] or "installed"
        except (OSError, subprocess.SubprocessError) as error:
            decky.logger.warning("Version check %s failed: %s", command, error)
            return "installed"

    def _match_decky_plugin(self, rule: dict, installed_plugins: list[tuple[Path, dict, str | None]]) -> tuple[Path, dict] | None:
        names = {name.casefold() for name in rule.get("names", [])}
        expected_repo = str(rule.get("repo", "")).casefold()
        for manifest_path, manifest, repo in installed_plugins:
            if manifest.get("name", "").casefold() in names or (expected_repo and repo == expected_repo):
                return manifest_path, manifest
        return None

    def _decky_plugin_version(self, match: tuple[Path, dict] | None) -> str | None:
        if not match:
            return None
        manifest_path, manifest = match
        if manifest.get("version"):
            return str(manifest["version"])
        try:
            package = json.loads((manifest_path.parent / "package.json").read_text(encoding="utf-8"))
            return str(package.get("version") or "installed")
        except (OSError, json.JSONDecodeError):
            return "installed"

    def _plugin_repository(self, manifest_path: Path, manifest: dict) -> str | None:
        try:
            package = json.loads((manifest_path.parent / "package.json").read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            package = {}
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
        command_checks = []
        for index, app in enumerate(apps):
            if app.get("detect", {}).get("type") == "decky-plugin":
                match = self._match_decky_plugin(app["detect"], installed_plugins)
                installed[index] = self._decky_plugin_version(match)
                plugin_names[index] = match[1].get("name") if match else None
            else:
                command_checks.append((index, app))
        command_versions = await asyncio.gather(*(asyncio.to_thread(self._installed_version, app) for _, app in command_checks))
        for (index, _), version in zip(command_checks, command_versions):
            installed[index] = version
        decky.logger.info("Listed %d apps, %d installed", len(apps), sum(version is not None for version in installed))
        return {"apps": [{**app, "installedVersion": version, "pluginName": name, "latestVersion": None, "publishedAt": None, "releaseUrl": None, "assets": [], "updateAvailable": None, "error": None} for app, version, name in zip(apps, installed, plugin_names)]}

    async def save_repo_settings(self, repo: str, values: dict):
        if not REPOSITORY_NAME.fullmatch(repo):
            decky.logger.error("Refused settings for invalid repository %r", repo)
            raise ValueError("Repository must be owner/name")
        item = {
            "channel": "prerelease" if values.get("channel") == "prerelease" else "stable",
            "assetFilter": [value for value in values.get("assetFilter", []) if isinstance(value, str) and value.strip()][:10],
        }
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
            "repoSettings": getattr(self, "settings", {}).get("repoSettings", {}),
        }
        self._save_settings()
        decky.logger.info("Saved settings: %s", {**self.settings, "githubToken": bool(self.settings["githubToken"])})
        return self.settings

    async def clear_downloads(self):
        directory = Path(PLUGIN_DOWNLOAD_DIR)

        def clear():
            if not directory.is_dir():
                return 0
            removed = 0
            for entry in directory.iterdir():
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

    async def download_asset(self, asset: dict, repo: str | None = None):
        try:
            name = self._validate_download_asset(asset, repo)
            for job_id, job in self.downloads.items():
                if job.get("repo") == repo and job.get("url") == asset["url"] and job["state"] in ("queued", "downloading"):
                    return {"jobId": job_id}
            target_dir = Path(PLUGIN_DOWNLOAD_DIR)
            target_dir.mkdir(parents=True, exist_ok=True)
            target = target_dir / name
            if target.exists() and not self.settings.get("overwriteExisting"):
                target = self._next_name(target)
            # Finished jobs are only read by their own progress window, which stops
            # polling once it has seen the final state, so drop them here.
            self.downloads = {key: job for key, job in self.downloads.items() if job["state"] in ("queued", "downloading")}
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
        with urlopen(request, timeout=30) as response, open(temp, "wb") as file:
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
        process = subprocess.Popen([curl, "--fail", "--location", "--silent", "--show-error", "--connect-timeout", "15", "--max-time", "300", "--output", str(temp), asset["url"]], stderr=subprocess.PIPE, text=True, env=environment)
        while process.poll() is None:
            if job_id in self.cancelled:
                process.terminate()
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
        self.cancelled.add(job_id)
        return {"ok": True}
