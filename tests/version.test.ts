// Run with `pnpm run test:frontend` (Node's built-in runner strips the types).
import assert from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, displayVersion, inChannel } from "../src/version.ts";

test("release numbers compare numerically, not as text", () => {
  assert.equal(compareVersions("1.10.0", "1.9.0"), 1);
  assert.equal(compareVersions("v2.0", "2.0.0"), 0);
  assert.equal(compareVersions("plugin-v1.2.3", "1.2.4"), -1);
});

test("a final release outranks its own pre-releases", () => {
  assert.equal(compareVersions("1.0.3", "1.0.3-rc.9"), 1);
  assert.equal(compareVersions("1.0.3-rc.9", "1.0.3"), -1);
});

test("pre-release suffixes compare by label, then number", () => {
  assert.equal(compareVersions("1.0.0-rc.10", "1.0.0-rc.9"), 1);
  assert.equal(compareVersions("1.0.0-rc10", "1.0.0-rc9"), 1);
  assert.equal(compareVersions("1.0.0-beta.1", "1.0.0-alpha.5"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0-beta.9"), 1);
  assert.equal(compareVersions("1.0.0-rc.1", "1.0.0-rc"), 1);
  assert.equal(compareVersions("1.0.0-RC.2", "1.0.0-rc.2"), 0);
});

test("versions without a dotted number can't be compared", () => {
  assert.equal(compareVersions("nightly", "1.0.0"), null);
  assert.equal(compareVersions("1.0.0", "installed"), null);
});

test("displayVersion keeps the number and suffix only", () => {
  assert.equal(displayVersion("Release-0.7.5"), "v0.7.5");
  assert.equal(displayVersion("plugin-v1.4.0-beta.2"), "v1.4.0-beta.2");
  assert.equal(displayVersion("nightly"), "nightly");
});

test("the pre-release channel includes stable releases, the stable channel doesn't include pre-releases", () => {
  assert.equal(inChannel({ prerelease: false }, "prerelease"), true);
  assert.equal(inChannel({ prerelease: true }, "prerelease"), true);
  assert.equal(inChannel({ prerelease: false }, "stable"), true);
  assert.equal(inChannel({ prerelease: true }, "stable"), false);
});
