import http.client
import json
import logging
import sys
import types
import unittest
from unittest import mock

sys.modules.setdefault("decky", types.SimpleNamespace(logger=logging.getLogger("decky-test")))
import main as registry  # noqa: E402 - fetch_remote_registry lives in main.py

VALID = {
    "schemaVersion": 1,
    "apps": [{
        "id": "demo", "name": "Demo", "repo": "owner/demo", "category": "Test",
        "versionStrategy": "semver", "source": "releases", "asset": {"include": [".zip"], "exclude": []},
    }],
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


class RemoteRegistryTests(unittest.TestCase):
    def test_rejects_non_https_url(self):
        with self.assertRaises(ValueError):
            registry.fetch_remote_registry("http://example.com/apps.json")

    def test_parses_remote_payload(self):
        body = json.dumps(VALID).encode("utf-8")
        with mock.patch.object(registry._OPENER, "open", return_value=FakeResponse(body)):
            apps, text = registry.fetch_remote_registry("https://example.com/apps.json")
        self.assertEqual([app["repo"] for app in apps], ["owner/demo"])
        self.assertEqual(json.loads(text), VALID)

    def test_rejects_oversized_payload(self):
        body = b" " * (registry.MAX_REMOTE_REGISTRY_BYTES + 10)
        with mock.patch.object(registry._OPENER, "open", return_value=FakeResponse(body)):
            with self.assertRaises(ValueError):
                registry.fetch_remote_registry("https://example.com/apps.json")

    def test_invalid_payload_is_rejected(self):
        with mock.patch.object(registry._OPENER, "open", return_value=FakeResponse(b'{"schemaVersion": 2}')):
            with self.assertRaises(ValueError):
                registry.fetch_remote_registry("https://example.com/apps.json")

    def test_rejects_a_redirect_to_plain_http(self):
        # _HttpsOnlyRedirects raises RuntimeError mid-open; the fetch reports it as a network error.
        refused = RuntimeError("Refused a redirect to a non-HTTPS URL: http://example.com/apps.json")
        with mock.patch.object(registry._OPENER, "open", side_effect=refused):
            with self.assertRaises(registry.URLError):
                registry.fetch_remote_registry("https://example.com/apps.json")

    def test_a_truncated_response_is_a_network_error(self):
        with mock.patch.object(registry._OPENER, "open", side_effect=http.client.IncompleteRead(b"{")):
            with self.assertRaises(ConnectionError):
                registry.fetch_remote_registry("https://example.com/apps.json")


if __name__ == "__main__":
    unittest.main()
