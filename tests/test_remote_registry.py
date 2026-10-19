import json
import unittest
from unittest import mock

from backend import registry

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
        with mock.patch.object(registry, "urlopen", return_value=FakeResponse(body)):
            apps, text = registry.fetch_remote_registry("https://example.com/apps.json")
        self.assertEqual([app["repo"] for app in apps], ["owner/demo"])
        self.assertEqual(json.loads(text), VALID)

    def test_rejects_oversized_payload(self):
        body = b" " * (registry.MAX_REMOTE_REGISTRY_BYTES + 10)
        with mock.patch.object(registry, "urlopen", return_value=FakeResponse(body)):
            with self.assertRaises(ValueError):
                registry.fetch_remote_registry("https://example.com/apps.json")

    def test_invalid_payload_is_rejected(self):
        with mock.patch.object(registry, "urlopen", return_value=FakeResponse(b'{"schemaVersion": 2}')):
            with self.assertRaises(ValueError):
                registry.fetch_remote_registry("https://example.com/apps.json")


if __name__ == "__main__":
    unittest.main()
