import json
import logging
import sys
import types
import unittest
from pathlib import Path

sys.modules.setdefault("decky", types.SimpleNamespace(logger=logging.getLogger("decky-test")))
from main import parse_registry  # noqa: E402

REGISTRY = Path(__file__).resolve().parent.parent / "registry" / "apps.json"

# Every released DeckyHub reads registry/apps.json from main, so this pins what
# schemaVersion 1 means. If this test fails on your change:
# - adding an optional key older versions can safely ignore -> add it to OPTIONAL;
# - anything else (renaming, retyping, removing, new required meaning) -> bump
#   schemaVersion instead, so older versions reject it and keep their own list.
REQUIRED = {"id": str, "name": str, "repo": str, "category": str, "detect": dict, "asset": dict}
OPTIONAL = {"description": str, "releaseTagInclude": str, "versionStrategy": str, "source": str}


def _string_list(value) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) for item in value)


class RegistrySchemaV1Tests(unittest.TestCase):
    def setUp(self):
        self.payload = json.loads(REGISTRY.read_text(encoding="utf-8"))
        self.apps = self.payload["apps"]

    def test_is_schema_version_1(self):
        self.assertEqual(self.payload["schemaVersion"], 1)
        self.assertEqual(set(self.payload), {"schemaVersion", "apps"})

    def test_no_entry_is_silently_dropped_by_the_parser(self):
        self.assertEqual(len(parse_registry(self.payload)), len(self.apps))

    def test_entries_match_the_v1_shape(self):
        for app in self.apps:
            with self.subTest(app=app.get("id")):
                self.assertLessEqual(set(REQUIRED), set(app), "missing required key")
                self.assertLessEqual(set(app), set(REQUIRED) | set(OPTIONAL), "unknown key - see the note at the top of this file")
                for key, kind in {**REQUIRED, **OPTIONAL}.items():
                    if key in app:
                        self.assertIsInstance(app[key], kind, key)
                self.assertEqual(app["repo"].count("/"), 1)
                # The only values the v1 frontend understands, when given.
                self.assertEqual((app.get("versionStrategy", "semver"), app.get("source", "releases")), ("semver", "releases"))
                self.assertEqual(set(app["detect"]), {"type", "names"})
                self.assertEqual(app["detect"]["type"], "decky-plugin")
                self.assertTrue(app["detect"]["names"] and _string_list(app["detect"]["names"]))
                self.assertEqual(set(app["asset"]), {"include", "exclude"})
                self.assertTrue(_string_list(app["asset"]["include"]) and _string_list(app["asset"]["exclude"]))

    def test_ids_and_repos_are_unique(self):
        self.assertEqual(len({app["id"] for app in self.apps}), len(self.apps))
        self.assertEqual(len({app["repo"].casefold() for app in self.apps}), len(self.apps))


if __name__ == "__main__":
    unittest.main()
