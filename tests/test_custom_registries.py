import asyncio
import json
import logging
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import URLError

sys.modules.setdefault("decky", types.SimpleNamespace(logger=logging.getLogger("decky-test")))
import main
from backend.registry import REMOTE_REGISTRY_URL, parse_registry, validate_registry_url
from main import Plugin

ROOT = Path(__file__).resolve().parent.parent
CUSTOM_URL = "https://raw.githubusercontent.com/someone/their-registry/refs/heads/main/registry/apps.json"
OTHER_URL = "https://example.com/apps.json"


def payload(*repos: str) -> dict:
    return {
        "schemaVersion": 1,
        "apps": [
            {
                "id": repo,
                "name": repo,
                "repo": repo,
                "category": "Test",
                "versionStrategy": "semver",
                "source": "releases",
                "asset": {"include": [".zip"], "exclude": []},
            }
            for repo in repos
        ],
    }


class FakeResponse:
    def __init__(self, body: bytes):
        self.body = body

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def read(self, size=-1):
        return self.body if size < 0 else self.body[:size]


def fake_fetch(responses: dict):
    """Stand in for fetch_remote_registry: map URL -> payload, Exception to raise, or a FakeResponse."""

    def fetch(url, *args, **kwargs):
        result = responses[url]
        if isinstance(result, Exception):
            raise result
        if isinstance(result, FakeResponse):
            return parse_registry(json.loads(result.body.decode("utf-8"))), result.body.decode("utf-8")
        return parse_registry(result), json.dumps(result)

    return fetch


class CustomRegistryTests(unittest.TestCase):
    def plugin(self, home: str, registries: list[str] | None = None) -> Plugin:
        sys.modules["decky"].DECKY_PLUGIN_SETTINGS_DIR = home
        sys.modules["decky"].DECKY_PLUGIN_DIR = str(ROOT)
        plugin = Plugin()
        plugin.settings_path = Path(home) / "settings.json"
        plugin.settings = {**main._coerce_settings({}), "customRepos": [], "customRegistries": list(registries or []), "repoSettings": {}}
        # Persist, so _load_settings() sees the same state as the live object.
        plugin.settings_path.write_text(json.dumps(plugin.settings), encoding="utf-8")
        return plugin

    # validate_registry_url

    def test_rejects_non_https_and_non_json_urls(self):
        for url in ("http://example.com/apps.json", "ftp://example.com/a.json", "https://example.com/apps.txt", "https://example.com/", "not a url", ""):
            with self.assertRaises(ValueError):
                validate_registry_url(url)

    def test_accepts_and_trims_an_https_json_url(self):
        self.assertEqual(validate_registry_url(f"  {CUSTOM_URL}  "), CUSTOM_URL)

    def test_rejects_absurdly_long_urls(self):
        with self.assertRaises(ValueError):
            validate_registry_url("https://example.com/" + "a" * 4000 + ".json")

    # settings coercion

    def test_settings_keep_only_valid_unique_registries(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home)
            plugin.settings_path.write_text(json.dumps({"customRegistries": [f" {CUSTOM_URL} ", CUSTOM_URL, "http://bad/a.json", "https://example.com/x.txt", OTHER_URL, 42]}), encoding="utf-8")
            self.assertEqual(plugin._load_settings()["customRegistries"], [CUSTOM_URL, OTHER_URL])

    def test_save_settings_keeps_registries(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home, [CUSTOM_URL])
            asyncio.run(plugin.save_settings({"language": "de"}))
            self.assertEqual(plugin._load_settings()["customRegistries"], [CUSTOM_URL])

    # add / remove

    def test_add_verifies_the_registry_then_persists_and_reloads(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home)
            with patch.object(main, "fetch_remote_registry", fake_fetch({REMOTE_REGISTRY_URL: payload("owner/official"), CUSTOM_URL: payload("owner/custom")})):
                result = asyncio.run(plugin.add_custom_registry(CUSTOM_URL))
            self.assertEqual((result["added"], result["apps"]), (True, 1))
            self.assertEqual([app["repo"] for app in plugin.apps], ["owner/official", "owner/custom"])
            self.assertEqual(plugin._load_settings()["customRegistries"], [CUSTOM_URL])

    def test_add_maps_tls_failures_to_ssl_error(self):
        from urllib.error import URLError
        import ssl

        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home)
            # urlopen wraps the real cause in URLError.reason, so that path must unwrap.
            cases = {URLError(ssl.SSLCertVerificationError("self signed certificate")): "certificate could not be verified", URLError(ssl.SSLError("wrong version number")): "TLS handshake failed"}
            for error, detail in cases.items():
                with self.subTest(detail=detail):
                    with patch.object(main, "fetch_remote_registry", fake_fetch({CUSTOM_URL: error})):
                        result = asyncio.run(plugin.add_custom_registry(CUSTOM_URL))
                    self.assertEqual((result["added"], result["reason"], result["detail"]), (False, "ssl-error", detail))

    def test_add_downloads_the_new_registry_only_once(self):
        # Adding used to fetch to validate, discard the payload, then re-download it
        # during the reload - two requests, and a flaky second one lost the registry.
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home)
            calls = []

            def counting(url, *args, **kwargs):
                calls.append(url)
                return parse_registry(payload("owner/custom")), json.dumps(payload("owner/custom"))

            with patch.object(main, "fetch_remote_registry", counting):
                result = asyncio.run(plugin.add_custom_registry(CUSTOM_URL))
            self.assertTrue(result["added"])
            self.assertEqual(calls.count(CUSTOM_URL), 1)
            self.assertEqual(calls.count(REMOTE_REGISTRY_URL), 1)
            # And the payload we already had is cached, so an offline restart still works.
            self.assertEqual(json.loads(plugin._registry_cache_path(CUSTOM_URL).read_text(encoding="utf-8")), payload("owner/custom"))
            self.assertEqual([app["repo"] for app in plugin.apps], ["owner/custom"])

    def test_add_reports_an_unloadable_url_without_raising(self):
        # A mistyped URL is ordinary user error: it must never reach the frontend
        # as a Python exception, or Decky wraps it as "PythonException: ...".
        cases = {URLError("no route to host"): "unreachable", ValueError("Unsupported registry format"): "not-registry"}
        for error, reason in cases.items():
            with self.subTest(reason=reason), tempfile.TemporaryDirectory() as home:
                plugin = self.plugin(home)
                with patch.object(main, "fetch_remote_registry", fake_fetch({CUSTOM_URL: error})):
                    result = asyncio.run(plugin.add_custom_registry(CUSTOM_URL))
                self.assertEqual((result["added"], result["reason"]), (False, reason))
                self.assertEqual(plugin._load_settings()["customRegistries"], [])

    def test_add_maps_a_404_to_not_found(self):
        from urllib.error import HTTPError

        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home)
            missing = HTTPError(CUSTOM_URL, 404, "Not Found", {}, None)
            with patch.object(main, "fetch_remote_registry", fake_fetch({CUSTOM_URL: missing})):
                result = asyncio.run(plugin.add_custom_registry(CUSTOM_URL))
            self.assertEqual((result["added"], result["reason"], result["detail"]), (False, "not-found", "HTTP 404"))

    def test_add_maps_a_server_error_to_unreachable(self):
        from urllib.error import HTTPError

        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home)
            broken = HTTPError(CUSTOM_URL, 503, "Service Unavailable", {}, None)
            with patch.object(main, "fetch_remote_registry", fake_fetch({CUSTOM_URL: broken})):
                result = asyncio.run(plugin.add_custom_registry(CUSTOM_URL))
            self.assertEqual((result["added"], result["reason"]), (False, "unreachable"))

    def test_add_reports_an_unusable_url_shape_without_raising(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home)
            for url in ("http://example.com/apps.json", "https://example.com/apps.txt"):
                result = asyncio.run(plugin.add_custom_registry(url))
                self.assertEqual((result["added"], result["reason"]), (False, "invalid-url"))
            self.assertEqual(plugin._load_settings()["customRegistries"], [])

    def test_add_ignores_a_repeat_and_the_official_url(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home, [CUSTOM_URL])
            with patch.object(main, "fetch_remote_registry", fake_fetch({REMOTE_REGISTRY_URL: payload()})):
                self.assertEqual(asyncio.run(plugin.add_custom_registry(CUSTOM_URL))["reason"], "already-added")
                official = asyncio.run(plugin.add_custom_registry(REMOTE_REGISTRY_URL))
                self.assertEqual((official["added"], official["reason"]), (False, "official"))
            self.assertEqual(plugin._load_settings()["customRegistries"], [CUSTOM_URL])

    def test_add_stops_at_the_registr_cap(self):
        with tempfile.TemporaryDirectory() as home, patch.object(main, "MAX_CUSTOM_REGISTRIES", 1):
            plugin = self.plugin(home, [CUSTOM_URL])
            result = asyncio.run(plugin.add_custom_registry(OTHER_URL))
            self.assertEqual((result["added"], result["reason"], result["detail"]), (False, "too-many", "1"))
            self.assertEqual(plugin._load_settings()["customRegistries"], [CUSTOM_URL])

    def test_remove_drops_the_url_and_reloads(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home, [CUSTOM_URL])
            with patch.object(main, "fetch_remote_registry", fake_fetch({REMOTE_REGISTRY_URL: payload("owner/official")})):
                self.assertTrue(asyncio.run(plugin.remove_custom_registry(CUSTOM_URL))["removed"])
                self.assertEqual([app["repo"] for app in plugin.apps], ["owner/official"])
            self.assertEqual(plugin._load_settings()["customRegistries"], [])
            self.assertFalse(asyncio.run(plugin.remove_custom_registry(CUSTOM_URL))["removed"])

    def test_get_lists_the_added_registries(self):
        with tempfile.TemporaryDirectory() as home:
            self.assertEqual(asyncio.run(self.plugin(home, [CUSTOM_URL]).get_custom_registries()), {"registries": [{"url": CUSTOM_URL}]})

    # merging and fallbacks

    def test_official_entries_win_over_a_custom_duplicate(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home, [CUSTOM_URL])
            responses = {
                REMOTE_REGISTRY_URL: payload("owner/shared", "owner/official"),
                CUSTOM_URL: payload("owner/shared", "owner/custom"),
            }
            with patch.object(main, "fetch_remote_registry", fake_fetch(responses)):
                apps = plugin._load_registry()
            self.assertEqual([app["repo"] for app in apps], ["owner/shared", "owner/official", "owner/custom"])

    def test_each_registry_gets_its_own_cache_file(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home)
            official = plugin._registry_cache_path(REMOTE_REGISTRY_URL)
            first = plugin._registry_cache_path(CUSTOM_URL)
            second = plugin._registry_cache_path(OTHER_URL)
            self.assertEqual(official.name, "registry-cache.json")
            self.assertEqual(len({official, first, second}), 3)
            self.assertEqual(first, plugin._registry_cache_path(CUSTOM_URL))

    def test_offline_registry_falls_back_to_its_own_cache(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home, [CUSTOM_URL])
            cache = plugin._registry_cache_path(CUSTOM_URL)
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(payload("owner/cached")), encoding="utf-8")
            # The official registry has no cache here, so it lands on the bundled
            # file; the point is that the custom registry still contributes its own.
            with patch.object(main, "fetch_remote_registry", fake_fetch({REMOTE_REGISTRY_URL: URLError("offline"), CUSTOM_URL: URLError("offline")})):
                apps = plugin._load_registry()
            self.assertEqual(apps[-1]["repo"], "owner/cached")
            self.assertEqual(len(apps), len(main.load_registry(str(ROOT))) + 1)

    def test_a_broken_custom_registry_is_skipped_not_fatal(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home, [CUSTOM_URL])
            with patch.object(main, "fetch_remote_registry", fake_fetch({REMOTE_REGISTRY_URL: payload("owner/official"), CUSTOM_URL: URLError("gone")})):
                self.assertEqual([app["repo"] for app in plugin._load_registry()], ["owner/official"])

    def test_successful_fetch_is_cached_for_next_time(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home, [CUSTOM_URL])
            responses = {REMOTE_REGISTRY_URL: payload("owner/official"), CUSTOM_URL: payload("owner/custom")}
            with patch.object(main, "fetch_remote_registry", fake_fetch(responses)):
                plugin._load_registry()
            self.assertEqual(json.loads(plugin._registry_cache_path(CUSTOM_URL).read_text(encoding="utf-8")), payload("owner/custom"))
            with patch.object(main, "fetch_remote_registry", fake_fetch({REMOTE_REGISTRY_URL: URLError("offline"), CUSTOM_URL: URLError("offline")})):
                self.assertEqual([app["repo"] for app in plugin._load_registry()], ["owner/official", "owner/custom"])

    def test_bundled_registry_is_the_last_resort(self):
        with tempfile.TemporaryDirectory() as home:
            plugin = self.plugin(home)
            offline = {REMOTE_REGISTRY_URL: URLError("offline")}
            with patch.object(main, "fetch_remote_registry", fake_fetch(offline)):
                bundled = plugin._load_registry()
                self.assertTrue(bundled)
                with self.assertRaises(ValueError):
                    validate_registry_url("http://nope")
                self.assertEqual(asyncio.run(plugin.refresh_registry())["apps"], len(bundled))


if __name__ == "__main__":
    unittest.main()
