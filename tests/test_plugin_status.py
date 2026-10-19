import asyncio
import hashlib
import json
import logging
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from unittest.mock import MagicMock, patch
from urllib.request import Request

sys.modules.setdefault("decky", types.SimpleNamespace(logger=logging.getLogger("decky-test")))
import main
from main import Plugin

ROOT = Path(__file__).resolve().parent.parent


class PluginStatusTests(unittest.TestCase):
    def test_decky_plugin_detection_reads_manifest_and_package_version(self):
        with tempfile.TemporaryDirectory() as home:
            plugin_dir = Path(home) / "plugins" / "mako"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "plugin.json").write_text(json.dumps({"name": "MAKO - Frame Generation"}), encoding="utf-8")
            (plugin_dir / "package.json").write_text(json.dumps({"version": "3.2.1"}), encoding="utf-8")
            sys.modules["decky"].DECKY_HOME = home
            plugin = Plugin()

            installed_plugins = plugin._scan_installed_plugins()
            self.assertEqual(plugin._decky_plugin_version(plugin._match_decky_plugin({"type": "decky-plugin", "names": ["MAKO - Frame Generation", "MAKO Decky"]}, installed_plugins)), "3.2.1")

    def test_get_apps_reports_the_installed_plugin_name(self):
        with tempfile.TemporaryDirectory() as home:
            plugin_dir = Path(home) / "plugins" / "mako"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "plugin.json").write_text(json.dumps({"name": "MAKO - Frame Generation", "version": "3.2.1"}), encoding="utf-8")
            sys.modules["decky"].DECKY_HOME = home
            plugin = Plugin()
            plugin.settings = {"customRepos": []}
            plugin.apps = [
                {"repo": "owner/mako", "detect": {"type": "decky-plugin", "names": ["MAKO Decky", "MAKO - Frame Generation"]}},
                {"repo": "owner/missing", "detect": {"type": "decky-plugin", "names": ["Missing"]}},
            ]

            apps = asyncio.run(plugin.get_apps())["apps"]
            self.assertEqual([(app["installedVersion"], app["pluginName"]) for app in apps], [("3.2.1", "MAKO - Frame Generation"), (None, None)])

    def test_bundled_decky_framegen_rule_matches_its_manifest_name(self):
        with tempfile.TemporaryDirectory() as home:
            plugin_dir = Path(home) / "plugins" / "decky-framegen"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "plugin.json").write_text(json.dumps({"name": "Decky-Framegen"}), encoding="utf-8")
            (plugin_dir / "package.json").write_text(json.dumps({"version": "1.2.3"}), encoding="utf-8")
            sys.modules["decky"].DECKY_HOME = home
            plugin = Plugin()

            registry = main.parse_registry(json.loads((ROOT / "registry" / "apps.json").read_text(encoding="utf-8")))
            rule = next(app["detect"] for app in registry if app["id"] == "decky-framegen")

            self.assertEqual(plugin._decky_plugin_version(plugin._match_decky_plugin(rule, plugin._scan_installed_plugins())), "1.2.3")

    def test_overwrite_defaults_to_true_and_unknown_settings_are_dropped(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"

            settings = asyncio.run(plugin.save_settings({}))

            self.assertTrue(settings["overwriteExisting"])
            saved = asyncio.run(plugin.save_settings({"downloadLocation": "downloads", "verifySha256": False}))
            self.assertNotIn("downloadLocation", saved)
            self.assertNotIn("verifySha256", plugin._load_settings())

    def test_github_token_is_trimmed_capped_and_persisted(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"

            for value, expected in (("  ghp_example  ", "ghp_example"), ("   ", ""), ("x" * 400, "x" * 255), (12345, ""), (None, ""), ([], "")):
                self.assertEqual(asyncio.run(plugin.save_settings({"githubToken": value}))["githubToken"], expected, msg=f"value: {value!r}")
            asyncio.run(plugin.save_settings({"githubToken": "ghp_example"}))
            self.assertEqual(plugin._load_settings()["githubToken"], "ghp_example")

    def test_corrupt_settings_file_loads_with_defaults_for_bad_fields(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"
            plugin.settings_path.write_text(json.dumps({
                "customRepos": 5,
                "repoSettings": {"owner/repo": {"channel": "prerelease", "assetFilter": "linux"}, "not a repo": {}, "owner/other": "bogus"},
            }), encoding="utf-8")

            loaded = plugin._load_settings()

            self.assertEqual(loaded["customRepos"], [])
            self.assertEqual(loaded["repoSettings"], {"owner/repo": {"channel": "prerelease", "assetFilter": []}, "owner/other": {"channel": "stable", "assetFilter": []}})

    def test_density_defaults_to_default_and_accepts_compact(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"

            self.assertEqual(asyncio.run(plugin.save_settings({}))["density"], "default")
            self.assertEqual(asyncio.run(plugin.save_settings({"density": "compact"}))["density"], "compact")
            self.assertEqual(asyncio.run(plugin.save_settings({"density": "tiny"}))["density"], "default")

    def test_hidden_buttons_keep_only_known_names(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"

            self.assertEqual(asyncio.run(plugin.save_settings({}))["hiddenButtons"], [])
            self.assertEqual(asyncio.run(plugin.save_settings({"hiddenButtons": ["releasePage", "bogus", 3, "install"]}))["hiddenButtons"], ["install", "releasePage"])
            self.assertEqual(asyncio.run(plugin.save_settings({"hiddenButtons": "downloadZipinstall"}))["hiddenButtons"], [])
            self.assertEqual(plugin._load_settings()["hiddenButtons"], [])

    def test_clear_downloads_only_removes_deckyhub_contents(self):
        with tempfile.TemporaryDirectory() as home:
            original_download_dir = main.PLUGIN_DOWNLOAD_DIR
            main.PLUGIN_DOWNLOAD_DIR = str(Path(home) / "Downloads" / "deckyhub")
            try:
                directory = Path(main.PLUGIN_DOWNLOAD_DIR)
                (directory / "nested").mkdir(parents=True)
                (directory / "nested" / "asset.zip").write_bytes(b"zip")
                (directory / "release.zip").write_bytes(b"zip")

                result = asyncio.run(Plugin().clear_downloads())

                self.assertEqual(result["removed"], 2)
                self.assertTrue(directory.exists())
                self.assertEqual(list(directory.iterdir()), [])
            finally:
                main.PLUGIN_DOWNLOAD_DIR = original_download_dir

    def test_clear_downloads_keeps_files_of_an_active_download(self):
        with tempfile.TemporaryDirectory() as home, patch.object(main, "PLUGIN_DOWNLOAD_DIR", home):
            (Path(home) / "active.zip.part").write_bytes(b"zip")
            (Path(home) / "old.zip").write_bytes(b"zip")
            plugin = Plugin()
            plugin.downloads = {"job": {"state": "downloading", "path": str(Path(home) / "active.zip")}}

            self.assertEqual(asyncio.run(plugin.clear_downloads())["removed"], 1)
            self.assertEqual([entry.name for entry in Path(home).iterdir()], ["active.zip.part"])

    def test_list_downloads_only_lists_deckyhub_contents(self):
        with tempfile.TemporaryDirectory() as home:
            original_download_dir = main.PLUGIN_DOWNLOAD_DIR
            main.PLUGIN_DOWNLOAD_DIR = str(Path(home) / "Downloads" / "deckyhub")
            try:
                directory = Path(main.PLUGIN_DOWNLOAD_DIR)
                (directory / "nested").mkdir(parents=True)
                (directory / "release.zip").write_bytes(b"zip")

                result = asyncio.run(Plugin().list_downloads())

                self.assertEqual(result["items"], [{"name": "nested", "directory": True}, {"name": "release.zip", "directory": False}])
            finally:
                main.PLUGIN_DOWNLOAD_DIR = original_download_dir

    def test_update_channel_defaults_to_stable_and_accepts_prerelease(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"

            self.assertEqual(asyncio.run(plugin.save_settings({}))["updateChannel"], "stable")
            self.assertEqual(asyncio.run(plugin.save_settings({"updateChannel": "prerelease"}))["updateChannel"], "prerelease")

    def test_deckyhub_version_is_unknown_when_package_is_not_extracted(self):
        with tempfile.TemporaryDirectory() as home, patch.object(sys.modules["decky"], "DECKY_PLUGIN_DIR", home, create=True), patch.object(main, "PLUGIN_DIR", home):
            self.assertEqual(asyncio.run(Plugin().get_deckyhub_info())["version"], "unknown")

    def test_urllib_download_counts_received_bytes(self):
        class Response:
            headers = {"Content-Length": "3"}
            reads = []

            def __enter__(self): return self
            def __exit__(self, *_): return False
            def read(self, size):
                self.reads.append(size)
                return b"abc" if len(self.reads) == 1 else b""

        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.downloads = {"job": {"received": 0, "total": 0}}
            plugin.cancelled = set()
            response = Response()
            with patch.object(main._OPENER, "open", return_value=response):
                plugin._download_with_urllib("job", {"url": "https://example.com/file.zip"}, Path(home) / "file.part")

            self.assertEqual(plugin.downloads["job"]["received"], 3)

    def test_downloads_refuse_redirects_off_https(self):
        handler = main._HttpsOnlyRedirects()
        request = Request("https://github.com/owner/repo/releases/download/v1/a.zip")

        with self.assertRaises(RuntimeError):
            handler.redirect_request(request, None, 302, "Found", {}, "http://example.com/a.zip")
        self.assertEqual(handler.redirect_request(request, None, 302, "Found", {}, "https://example.com/a.zip").full_url, "https://example.com/a.zip")

    def test_curl_download_uses_system_libraries(self):
        class Process:
            returncode = 0
            def poll(self): return 0

        with tempfile.TemporaryDirectory() as home:
            temp = Path(home) / "file.part"
            temp.write_bytes(b"zip")
            plugin = Plugin()
            plugin.downloads = {"job": {"received": 0}}
            plugin.cancelled = set()
            with patch("main.shutil.which", return_value="/usr/bin/curl"), patch("main.subprocess.Popen", return_value=Process()) as popen, patch.dict("main.os.environ", {"LD_LIBRARY_PATH": "/tmp/_MEI"}, clear=True):
                plugin._download_with_curl("job", {"url": "https://example.com/file.zip"}, temp)

            command = popen.call_args.args[0]
            environment = popen.call_args.kwargs["env"]
            self.assertEqual(command[0], "/usr/bin/curl")
            self.assertIn("--connect-timeout", command)
            self.assertIn("--max-time", command)
            self.assertEqual(command[command.index("--proto-redir") + 1], "=https")
            self.assertNotIn("LD_LIBRARY_PATH", environment)

    def test_cancelled_curl_download_waits_for_curl_to_exit(self):
        process = MagicMock()
        process.poll.return_value = None
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.downloads = {"job": {"received": 0}}
            plugin.cancelled = {"job"}
            with patch("main.shutil.which", return_value="/usr/bin/curl"), patch("main.subprocess.Popen", return_value=process), self.assertRaises(InterruptedError):
                plugin._download_with_curl("job", {"url": "https://example.com/file.zip"}, Path(home) / "file.part")

        process.terminate.assert_called_once()
        process.wait.assert_called()

    def test_custom_repository_is_saved(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"
            plugin.settings = {"overwriteExisting": False, "customRepos": []}
            plugin.apps = []

            result = asyncio.run(plugin.add_custom_repo("owner/repository"))

            self.assertTrue(result["added"])
            self.assertEqual(plugin._custom_apps()[0]["repo"], "owner/repository")
            self.assertEqual(plugin._load_settings()["customRepos"], ["owner/repository"])

    def test_get_apps_includes_default_and_custom_repositories(self):
        with tempfile.TemporaryDirectory() as home:
            Path(home, "plugins").mkdir()
            sys.modules["decky"].DECKY_HOME = home
            plugin = Plugin()
            plugin.settings = {"customRepos": ["owner/custom"]}
            plugin.apps = [{"repo": "owner/default", "detect": {"type": "decky-plugin", "repo": "owner/default"}}]

            self.assertEqual([app["repo"] for app in asyncio.run(plugin.get_apps())["apps"]], ["owner/default", "owner/custom"])

    def test_removing_a_custom_repository_ignores_case_and_drops_its_settings(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"
            plugin.settings = {"customRepos": ["Owner/Repo"], "repoSettings": {"Owner/Repo": {"channel": "prerelease", "assetFilter": []}}}

            self.assertTrue(asyncio.run(plugin.remove_custom_repo("owner/repo"))["removed"])
            self.assertEqual(plugin.settings, {"customRepos": [], "repoSettings": {}})

    def test_download_asset_drops_finished_jobs(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings = {"overwriteExisting": True}
            plugin.downloads = {"old": {"state": "complete"}, "running": {"state": "downloading", "repo": "owner/other", "url": "x"}}
            plugin.download_queue = asyncio.Queue()

            with patch("main.PLUGIN_DOWNLOAD_DIR", home):
                result = asyncio.run(plugin.download_asset({"name": "a.zip", "url": "https://github.com/owner/repo/releases/download/v1/a.zip"}, "owner/repo"))

            self.assertEqual(set(plugin.downloads), {"running", result["jobId"]})

    def test_custom_repository_export_and_import(self):
        with tempfile.TemporaryDirectory() as home:
            original_download_dir = main.DEFAULT_DOWNLOAD_DIR
            main.DEFAULT_DOWNLOAD_DIR = str(Path(home) / "Downloads")
            try:
                plugin = Plugin()
                plugin.settings_path = Path(home) / "settings.json"
                plugin.settings = {"overwriteExisting": False, "customRepos": ["owner/one"]}
                plugin.apps = []

                exported = Path(asyncio.run(plugin.export_custom_repos())["path"])
                exported.write_text(json.dumps({"schemaVersion": 1, "repos": ["owner/one", "owner/two", "bad"]}), encoding="utf-8")
                result = asyncio.run(plugin.import_custom_repos(str(exported)))

                self.assertEqual(result["added"], ["owner/two"])
                self.assertEqual(plugin.settings["customRepos"], ["owner/one", "owner/two"])
            finally:
                main.DEFAULT_DOWNLOAD_DIR = original_download_dir

    def test_add_custom_repo_rejects_invalid_repo_format(self):
        plugin = Plugin()
        plugin.settings = {"customRepos": []}
        plugin.apps = []

        with self.assertRaises(ValueError):
            asyncio.run(plugin.add_custom_repo("not-a-repo"))

    def test_add_custom_repo_rejects_duplicate(self):
        plugin = Plugin()
        plugin.settings = {"customRepos": ["owner/repo"]}
        plugin.apps = []

        result = asyncio.run(plugin.add_custom_repo("owner/repo"))

        self.assertFalse(result["added"])

    def test_save_repo_settings_validates_and_caps_asset_filter(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"
            plugin.settings = {"repoSettings": {}}

            result = asyncio.run(
                plugin.save_repo_settings(
                    "owner/repo",
                    {"channel": "prerelease", "downloadLocation": "downloads", "assetFilter": ["linux", "  ", 42, *[f"x{i}" for i in range(15)]]},
                )
            )

            self.assertEqual(result["channel"], "prerelease")
            self.assertNotIn("downloadLocation", result)
            self.assertEqual(len(result["assetFilter"]), 10)
            self.assertEqual(plugin.settings["repoSettings"]["owner/repo"], result)

    def test_save_repo_settings_ignores_a_non_list_asset_filter(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings_path = Path(home) / "settings.json"
            plugin.settings = {"repoSettings": {}}

            self.assertEqual(asyncio.run(plugin.save_repo_settings("owner/repo", {"assetFilter": "linux"}))["assetFilter"], [])

    def test_save_repo_settings_rejects_invalid_repo(self):
        plugin = Plugin()
        plugin.settings = {"repoSettings": {}}

        with self.assertRaises(ValueError):
            asyncio.run(plugin.save_repo_settings("not-a-repo", {}))

    def test_import_rejects_files_outside_home(self):
        with tempfile.TemporaryDirectory() as outside:
            plugin = Plugin()
            plugin.apps = []
            plugin.settings = {"customRepos": []}
            source = Path(outside) / "repos.json"
            source.write_text(json.dumps({"schemaVersion": 1, "repos": ["owner/repo"]}), encoding="utf-8")

            with self.assertRaises(ValueError):
                asyncio.run(plugin.import_custom_repos(str(source)))

    def test_export_logs_zips_plugin_logs_into_downloads(self):
        with tempfile.TemporaryDirectory() as home, patch.object(sys.modules["decky"], "DECKY_PLUGIN_LOG_DIR", str(Path(home) / "logs"), create=True), patch.object(main, "DEFAULT_DOWNLOAD_DIR", str(Path(home) / "Downloads")):
            (Path(home) / "logs").mkdir()
            (Path(home) / "logs" / "2026-09-26.log").write_text("hello", encoding="utf-8")

            first = asyncio.run(Plugin().export_logs())["path"]
            second = asyncio.run(Plugin().export_logs())["path"]

            self.assertRegex(Path(first).name, r"^DeckyHub-logs-\d{8}-\d{6}\.zip$")
            self.assertNotEqual(first, second)
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(archive.read("2026-09-26.log"), b"hello")

    def test_import_rejects_non_json_file(self):
        with tempfile.TemporaryDirectory() as home:
            original_download_dir = main.DEFAULT_DOWNLOAD_DIR
            main.DEFAULT_DOWNLOAD_DIR = str(Path(home) / "Downloads")
            try:
                plugin = Plugin()
                plugin.apps = []
                plugin.settings = {"customRepos": []}
                source = Path(home) / "Downloads" / "repos.txt"
                source.parent.mkdir(parents=True, exist_ok=True)
                source.write_text("owner/repo", encoding="utf-8")

                with self.assertRaises(ValueError):
                    asyncio.run(plugin.import_custom_repos(str(source)))
            finally:
                main.DEFAULT_DOWNLOAD_DIR = original_download_dir

    def test_download_asset_refuses_urls_outside_the_repositorys_releases(self):
        plugin = Plugin()
        plugin.settings = {"overwriteExisting": True, "repoSettings": {}}
        plugin.downloads = {}
        plugin.download_queue = asyncio.Queue()

        for url in ("http://github.com/owner/repo/releases/download/v1/a.zip", "https://example.com/a.zip", "https://github.com/other/repo/releases/download/v1/a.zip"):
            with self.subTest(url=url):
                result = asyncio.run(plugin.download_asset({"name": "a.zip", "url": url}, "owner/repo"))
                self.assertEqual(result["error"], "Can't start a.zip: Only GitHub release assets for the selected repository can be downloaded")

    def test_download_asset_returns_error_for_dotdot_filename(self):
        plugin = Plugin()
        plugin.settings = {"downloadLocation": "plugins", "overwriteExisting": True, "repoSettings": {}}
        plugin.downloads = {}
        plugin.download_queue = asyncio.Queue()

        result = asyncio.run(plugin.download_asset({"name": "..", "url": "https://github.com/owner/repo/releases/download/v1/a.zip"}, "owner/repo"))
        self.assertEqual(result["error"], "Can't start ..: Invalid asset filename")

    def test_download_asset_sanitizes_traversal_in_filename(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings = {"downloadLocation": "plugins", "overwriteExisting": True, "repoSettings": {}}
            plugin.downloads = {}
            plugin.download_queue = asyncio.Queue()
            target_dir = Path(home) / "plugins"

            with patch("main.PLUGIN_DOWNLOAD_DIR", str(target_dir)):
                result = asyncio.run(plugin.download_asset({"name": "../../etc/passwd", "url": "https://github.com/owner/repo/releases/download/v1/a.zip"}, "owner/repo"))

            self.assertEqual(plugin.downloads[result["jobId"]]["path"], str(target_dir / "passwd"))

    def test_download_asset_avoids_overwrite_when_disabled(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings = {"downloadLocation": "plugins", "overwriteExisting": False, "repoSettings": {}}
            plugin.downloads = {}
            plugin.download_queue = asyncio.Queue()
            target_dir = Path(home) / "plugins"
            target_dir.mkdir(parents=True)
            (target_dir / "asset.zip").write_bytes(b"x")

            with patch("main.PLUGIN_DOWNLOAD_DIR", str(target_dir)):
                result = asyncio.run(plugin.download_asset({"name": "asset.zip", "url": "https://github.com/owner/repo/releases/download/v1/asset.zip"}, "owner/repo"))

            self.assertEqual(plugin.downloads[result["jobId"]]["path"], str(target_dir / "asset (1).zip"))

    def test_download_asset_reuses_an_active_matching_job(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings = {"downloadLocation": "plugins", "overwriteExisting": True, "repoSettings": {}}
            plugin.downloads = {}
            plugin.download_queue = asyncio.Queue()
            asset = {"name": "asset.zip", "url": "https://github.com/owner/repo/releases/download/v1/asset.zip"}

            with patch("main.PLUGIN_DOWNLOAD_DIR", str(Path(home))):
                first = asyncio.run(plugin.download_asset(asset, "owner/repo"))
                second = asyncio.run(plugin.download_asset(asset, "owner/repo"))

            self.assertEqual(second["jobId"], first["jobId"])
            self.assertEqual(len(plugin.downloads), 1)

    def test_download_marks_error_on_checksum_mismatch(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings = {}
            plugin.downloads = {"job": {"state": "queued", "received": 0, "total": 0}}
            plugin.cancelled = set()
            target = Path(home) / "asset.zip"

            def fake_download(job_id, asset, temp):
                temp.write_bytes(b"data")

            with patch.object(plugin, "_download_with_urllib", side_effect=fake_download):
                plugin._download("job", {"url": "https://example.com/a", "sha256": "0" * 64}, target)

            self.assertEqual(plugin.downloads["job"]["state"], "error")
            self.assertIn("SHA256", plugin.downloads["job"]["error"])
            self.assertFalse(target.exists())

    def test_download_completes_when_checksum_matches(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.settings = {}
            plugin.downloads = {"job": {"state": "queued", "received": 0, "total": 0}}
            plugin.cancelled = set()
            target = Path(home) / "asset.zip"
            digest = hashlib.sha256(b"data").hexdigest()

            def fake_download(job_id, asset, temp):
                temp.write_bytes(b"data")

            with patch.object(plugin, "_download_with_urllib", side_effect=fake_download):
                plugin._download("job", {"url": "https://example.com/a", "sha256": digest}, target)

            self.assertEqual(plugin.downloads["job"]["state"], "complete")
            self.assertEqual(target.read_bytes(), b"data")

    def test_cancelling_a_queued_download_stops_it_before_it_starts(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = Plugin()
            plugin.cancelled = set()
            plugin.downloads = {"job": {"state": "queued", "received": 0, "total": 0}}
            target = Path(home) / "asset.zip"

            self.assertTrue(asyncio.run(plugin.cancel_download("job"))["ok"])
            with patch.object(plugin, "_download_with_urllib") as download:
                plugin._download("job", {"url": "https://example.com/a"}, target)

            download.assert_not_called()
            self.assertEqual(plugin.downloads["job"]["state"], "cancelled")
            self.assertEqual(plugin.cancelled, set())

    def test_cancelling_a_finished_or_unknown_download_does_nothing(self):
        plugin = Plugin()
        plugin.cancelled = set()
        plugin.downloads = {"done": {"state": "complete"}}

        self.assertEqual(asyncio.run(plugin.get_download("missing"))["state"], "missing")
        self.assertFalse(asyncio.run(plugin.cancel_download("done"))["ok"])
        self.assertFalse(asyncio.run(plugin.cancel_download("missing"))["ok"])
        self.assertEqual(plugin.cancelled, set())

    def test_decky_plugin_detection_matches_custom_repo_by_repository_field(self):
        with tempfile.TemporaryDirectory() as home:
            plugin_dir = Path(home) / "plugins" / "custom"
            plugin_dir.mkdir(parents=True)
            (plugin_dir / "plugin.json").write_text(json.dumps({"name": "Something Else", "version": "9.9.9"}), encoding="utf-8")
            (plugin_dir / "package.json").write_text(json.dumps({"repository": "https://github.com/owner/repo"}), encoding="utf-8")
            sys.modules["decky"].DECKY_HOME = home
            plugin = Plugin()

            installed_plugins = plugin._scan_installed_plugins()
            self.assertEqual(plugin._decky_plugin_version(plugin._match_decky_plugin({"type": "decky-plugin", "repo": "owner/repo"}, installed_plugins)), "9.9.9")


if __name__ == "__main__":
    unittest.main()
