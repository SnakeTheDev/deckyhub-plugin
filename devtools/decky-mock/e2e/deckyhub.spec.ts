import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const deckyHubVersion = JSON.parse(readFileSync(new URL("../../../package.json", import.meta.url), "utf8")).version;
const deckyHubTag = `v${deckyHubVersion}`;

// Tags just above and below the installed version, derived from whatever the
// real installed version happens to be so they stay valid across version
// bumps. An installed "1.0.3-rc.3" gets its rc siblings ("-rc.2"/"-rc.4");
// a stable version (rc siblings of it would all be older) gets a far-future
// and a far-past rc pair instead.
const rcMatch = deckyHubVersion.match(/^(.*-rc\.)(\d+)$/);
const olderRcTag = rcMatch ? `v${rcMatch[1]}${Number(rcMatch[2]) - 1}` : "v0.0.1-rc.1";
const newerRcTag = rcMatch ? `v${rcMatch[1]}${Number(rcMatch[2]) + 1}` : "v999.0.0-rc.2";

const release = {
  tag_name: "plugin-v1.2.3",
  html_url: "https://github.com/example/project/releases/tag/plugin-v1.2.3",
  assets: Array.from({ length: 5 }, (_, index) => ({
    name: `mako-decky-${index + 1}.zip`,
    browser_download_url: `https://github.com/example/project/releases/download/plugin-v1.2.3/mako-decky-${index + 1}.zip`,
    size: 1024,
  })),
};

const mock = (page: Page) => page.frameLocator("iframe");

// GET /repos/eugeniosegala/MAKO/releases with one checksummed ZIP per release.
const makoRelease = (tag: string, sha256: string, day = "01") => ({
  tag_name: tag, prerelease: false, draft: false, published_at: `2026-01-${day}T00:00:00Z`, html_url: `https://github.com/eugeniosegala/MAKO/releases/tag/${tag}`,
  assets: [{ name: "mako-decky.zip", browser_download_url: `https://github.com/eugeniosegala/MAKO/releases/download/${tag}/mako-decky.zip`, size: 1024, digest: `sha256:${sha256}` }],
});
const mockMakoReleases = (page: Page, releases: unknown[]) =>
  page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases**", (route) => route.fulfill({ json: releases }));

// Stand-in for Decky Loader's own WS bridge: records install requests in the
// plugin frame's window.__installCalls.
const recordInstalls = (page: Page) =>
  page.addInitScript(() => {
    const calls: unknown[][] = [];
    Object.assign(window, { __installCalls: calls, DeckyBackend: { call: async (...args: unknown[]) => void calls.push(args), addEventListener() {}, removeEventListener() {} } });
  });

const BRIDGE_URL = "http://127.0.0.1:8643";

// Round-trips a request straight to the dev-server bridge (bypassing the
// app's own UI), used to seed or reset state — most often settings.json,
// which is a REAL SHARED FILE on disk across every test run and interactive
// preview session. Always await this before the test that used it finishes,
// since an unawaited call races Playwright's own page teardown.
function bridgeCall(page: Page, route: string, ...args: unknown[]) {
  return page.evaluate(
    ([bridge, route, args]) =>
      fetch(bridge, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ route, args }) }).then((res) => res.json()),
    [BRIDGE_URL, route, args] as const,
  );
}

test.beforeEach(async ({ page }) => {
  // Every release lookup hits GET /repos/{repo}/releases, which returns a list.
  await page.route("https://api.github.com/**", (route) => route.fulfill({ json: [release] }));
  await page.goto("/?bridge=http://127.0.0.1:8643");
});

test("Quick Access navigation opens Discover", async ({ page }) => {
  const app = mock(page);
  const [updates, discover] = await Promise.all([
    app.getByRole("button", { name: "Updates", exact: true }).boundingBox(),
    app.getByRole("button", { name: "Discover", exact: true }).boundingBox(),
  ]);
  expect(discover!.y - (updates!.y + updates!.height)).toBeGreaterThanOrEqual(6);
  await app.getByRole("button", { name: "Discover", exact: true }).click();

  await expect(app.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await expect(app.getByText("STEAM", { exact: true })).toBeVisible();
  await expect(app.getByRole("heading", { name: "MAKO Decky" })).toBeVisible();
  await expect(app.getByText("Boosts frame rates with Lossless Scaling frame generation.")).toBeVisible();
});

test("Quick Access keeps its controller footer below its content", async ({ page }) => {
  const app = mock(page);
  const content = app.locator(".qam-content");
  const footer = app.locator(".qam-panel .steam-bottombar");
  const [contentBox, footerBox] = await Promise.all([content.boundingBox(), footer.boundingBox()]);
  expect(contentBox).not.toBeNull();
  expect(footerBox).not.toBeNull();
  expect(footerBox!.y).toBeGreaterThanOrEqual(contentBox!.y + contentBox!.height);
});

test("download modal actions use the full modal width", async ({ page }) => {
  const app = mock(page);
  const expectFullWidth = async (name: string) => {
    const [button, modal] = await Promise.all([app.getByRole("button", { name, exact: true }).boundingBox(), app.locator(".steam-modal").boundingBox()]);
    expect(button).not.toBeNull();
    expect(modal).not.toBeNull();
    expect(button!.width).toBeGreaterThanOrEqual(modal!.width - 48);
  };

  await app.getByRole("button", { name: "Download progress modal", exact: true }).click();
  await expectFullWidth("Cancel");
  await app.getByRole("button", { name: "Cancel", exact: true }).click();
  await app.getByRole("button", { name: "Download complete modal", exact: true }).click();
  await expectFullWidth("OK");
});

test("direct preview URLs render the requested page", async ({ page }) => {
  await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");

  await expect(mock(page).getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
});

test("Discover keeps search and status on one row", async ({ page }) => {
  await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  const search = app.getByLabel("Search");
  const status = app.getByLabel("Status");

  await expect(search).toBeVisible();
  await expect(status).toBeVisible();
  const [searchBox, statusBox] = await Promise.all([search.boundingBox(), status.boundingBox()]);
  expect(searchBox).not.toBeNull();
  expect(statusBox).not.toBeNull();
  expect(Math.abs(searchBox!.y - statusBox!.y)).toBeLessThan(20);
  expect(Math.abs(searchBox!.height - statusBox!.height)).toBeLessThan(20);
  expect(statusBox!.x).toBeGreaterThan(searchBox!.x);
});

test("Discover keeps its refresh action beside the description", async ({ page }) => {
  await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  const description = app.getByText("Browse supported GitHub projects and their ZIP releases.");
  const refresh = app.getByRole("button", { name: "Refresh", exact: true });

  const [descriptionBox, refreshBox] = await Promise.all([description.boundingBox(), refresh.boundingBox()]);
  expect(Math.abs(descriptionBox!.y - refreshBox!.y)).toBeLessThan(20);
  expect(refreshBox!.x).toBeGreaterThan(descriptionBox!.x);
});

test("Repositories page renders Add & Manage directly, with no tabs", async ({ page }) => {
  await page.goto("/?preview=/deckyhub/repositories&bridge=http://127.0.0.1:8643");
  const app = mock(page);

  await expect(app.getByLabel("Search GitHub")).toBeVisible();
  await expect(app.getByRole("button", { name: "Repository Settings", exact: true })).toHaveCount(0);
});

test("Repository search and action share one row", async ({ page }) => {
  await page.goto("/?preview=/deckyhub/repositories&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  const search = app.getByLabel("Search GitHub");
  const action = app.getByRole("button", { name: "Search", exact: true });
  const clear = app.getByRole("button", { name: "Clear", exact: true });

  await expect(search).toBeVisible();
  await expect(action).toBeVisible();
  await expect(clear).toBeVisible();
  const [searchBox, actionBox, clearBox] = await Promise.all([search.boundingBox(), action.boundingBox(), clear.boundingBox()]);
  expect(searchBox).not.toBeNull();
  expect(actionBox).not.toBeNull();
  expect(Math.abs(searchBox!.y - actionBox!.y)).toBeLessThan(20);
  expect(actionBox!.x).toBeGreaterThan(searchBox!.x);
  expect(Math.abs(actionBox!.y - clearBox!.y)).toBeLessThan(20);
  expect(clearBox!.x).toBeGreaterThan(actionBox!.x);
});

test("Repository search stays enabled but skips blank queries", async ({ page }) => {
  let requests = 0;
  await page.route("https://api.github.com/search/repositories**", (route) => {
    requests++;
    return route.fulfill({ json: { items: [] } });
  });
  await page.goto("/?preview=/deckyhub/repositories&bridge=http://127.0.0.1:8643");
  const search = mock(page).getByRole("button", { name: "Search", exact: true });

  await expect(search).toBeEnabled();
  await search.click();
  expect(requests).toBe(0);
});

test("Repository import and export share one row", async ({ page }) => {
  await page.goto("/?preview=/deckyhub/repositories&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  const exportButton = app.getByRole("button", { name: "Export", exact: true });
  const importButton = app.getByRole("button", { name: "Import", exact: true });

  const [exportBox, importBox] = await Promise.all([exportButton.boundingBox(), importButton.boundingBox()]);
  expect(Math.abs(exportBox!.y - importBox!.y)).toBeLessThan(20);
  expect(importBox!.x).toBeGreaterThan(exportBox!.x);
});

test("Cleanup shows only when the downloads folder has files, and clearing requires confirmation", async ({ page }) => {
  // dev-server.py points the bridge's download folder at .dev-data/downloads.
  const downloads = new URL("../.dev-data/downloads/", import.meta.url);
  rmSync(downloads, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  const app = mock(page);
  await page.goto("/?bridge=http://127.0.0.1:8643");
  await expect(app.getByRole("button", { name: "Updates", exact: true })).toBeVisible();
  await expect(app.getByText("Cleanup", { exact: true })).toHaveCount(0);

  mkdirSync(downloads, { recursive: true });
  writeFileSync(new URL("old-plugin.zip", downloads), "zip");
  await page.goto("/?bridge=http://127.0.0.1:8643");
  await app.locator(".qam-content").getByRole("button", { name: "Empty Folder", exact: true }).click();

  await expect(app.getByText("Permanently remove all files in /home/deck/Downloads/deckyhub?")).toBeVisible();
  // The two actions stack full-width, each on its own line.
  const modal = app.locator(".steam-modal");
  const [confirm, cancel] = await Promise.all([
    modal.getByRole("button", { name: "Empty Folder", exact: true }).boundingBox(),
    modal.getByRole("button", { name: "Cancel", exact: true }).boundingBox(),
  ]);
  expect(cancel!.y).toBeGreaterThanOrEqual(confirm!.y + confirm!.height);
  expect(Math.abs(cancel!.width - confirm!.width)).toBeLessThan(2);
  await expect(modal.getByText("old-plugin.zip")).toBeVisible();

  // Emptying it removes the file and the section with it.
  await modal.getByRole("button", { name: "Empty Folder", exact: true }).click();
  await expect(app.locator(".qam-content").getByRole("button", { name: "Empty Folder", exact: true })).toHaveCount(0);
  await expect(app.getByText("Cleanup", { exact: true })).toHaveCount(0);
});

test("Export Logs zips the backend log into Downloads", async ({ page }) => {
  // dev-server.py logs to .dev-data/logs/ and points Downloads at .dev-data/home/Downloads.
  const downloads = new URL("../.dev-data/home/Downloads/", import.meta.url);
  rmSync(downloads, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  const app = mock(page);
  const toast = page.waitForEvent("console", (message) => message.text().includes("Exported to"));
  await app.locator(".qam-content").getByRole("button", { name: "Export Logs", exact: true }).click();

  const name = (await toast).text().match(/DeckyHub-logs-\d{8}-\d{6}\.zip/)?.[0];
  expect(name).toBeTruthy();
  expect(readFileSync(new URL(name!, downloads)).subarray(0, 2).toString()).toBe("PK");
  // Backend actions land in the log the zip is built from.
  expect(readFileSync(new URL("../.dev-data/logs/deckyhub.log", import.meta.url), "utf8")).toContain("Listed");
  rmSync(downloads, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

test("DeckyHub offers to reinstall the matching version and keeps its release page", async ({ page }) => {
  const deckyHubRelease = {
    tag_name: deckyHubTag,
    prerelease: false,
    html_url: `https://github.com/mazillka/deckyhub-plugin/releases/tag/${deckyHubTag}`,
    assets: [{ name: `DeckyHub-${deckyHubTag}.zip`, browser_download_url: `https://github.com/mazillka/deckyhub-plugin/releases/download/${deckyHubTag}/DeckyHub-${deckyHubTag}.zip`, digest: `sha256:${"a".repeat(64)}` }],
  };
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) => route.fulfill({ json: [deckyHubRelease] }));
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.locator(".qam-content").getByRole("button", { name: "Check for Updates", exact: true }).click();
  await expect(app.getByRole("button", { name: `Reinstall v${deckyHubVersion}`, exact: true })).toBeVisible();
  await expect(app.getByRole("button", { name: "Download ZIP", exact: true })).toBeVisible();
  await expect(app.getByRole("button", { name: "Release Page", exact: true })).toBeVisible();
});

test("DeckyHub automatically notifies about an available update", async ({ page }) => {
  const newerRelease = {
    tag_name: "v9.9.9",
    prerelease: false,
    html_url: "https://github.com/mazillka/deckyhub-plugin/releases/tag/v9.9.9",
    assets: [{ name: "DeckyHub-v9.9.9.zip", browser_download_url: "https://github.com/mazillka/deckyhub-plugin/releases/download/v9.9.9/DeckyHub-v9.9.9.zip", digest: `sha256:${"b".repeat(64)}` }],
  };
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) => route.fulfill({ json: [newerRelease] }));
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await expect(app.getByText("DeckyHub: DeckyHub update v9.9.9 is available.")).toBeVisible();
  await app.getByRole("button", { name: "Update (v9.9.9 available)", exact: true }).click();
  await expect(app.getByRole("button", { name: "Update to v9.9.9", exact: true })).toBeVisible();
  await expect(app.getByRole("button", { name: "Release Page", exact: true })).toBeVisible();
});

test("DeckyHub doesn't advertise an older release as an available update", async ({ page }) => {
  // The installed version is a pre-release (package.json); the stable
  // channel's newest release is older, so it must not show as "available".
  const olderStable = {
    tag_name: "v0.9.0",
    prerelease: false,
    html_url: "https://github.com/mazillka/deckyhub-plugin/releases/tag/v0.9.0",
    assets: [{ name: "DeckyHub-v0.9.0.zip", browser_download_url: "https://github.com/mazillka/deckyhub-plugin/releases/download/v0.9.0/DeckyHub-v0.9.0.zip", digest: `sha256:${"c".repeat(64)}` }],
  };
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) => route.fulfill({ json: [olderStable] }));
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);

  await expect(app.locator(".qam-content").getByRole("button", { name: "Check for Updates", exact: true })).toBeVisible();
  await expect(app.getByText(/DeckyHub update v0\.9\.0 is available/)).toHaveCount(0);
  await app.locator(".qam-content").getByRole("button", { name: "Check for Updates", exact: true }).click();
  await expect(app.getByRole("button", { name: "Downgrade to v0.9.0", exact: true })).toBeVisible();
});

test("DeckyHub version picker offers to downgrade to an older release", async ({ page }) => {
  const installedRelease = {
    tag_name: deckyHubTag,
    prerelease: false,
    html_url: `https://github.com/mazillka/deckyhub-plugin/releases/tag/${deckyHubTag}`,
    assets: [{ name: `DeckyHub-${deckyHubTag}.zip`, browser_download_url: `https://github.com/mazillka/deckyhub-plugin/releases/download/${deckyHubTag}/DeckyHub-${deckyHubTag}.zip`, digest: `sha256:${"a".repeat(64)}` }],
  };
  const olderRelease = {
    tag_name: "v0.9.0",
    prerelease: false,
    html_url: "https://github.com/mazillka/deckyhub-plugin/releases/tag/v0.9.0",
    assets: [{ name: "DeckyHub-v0.9.0.zip", browser_download_url: "https://github.com/mazillka/deckyhub-plugin/releases/download/v0.9.0/DeckyHub-v0.9.0.zip", digest: `sha256:${"c".repeat(64)}` }],
  };
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) => route.fulfill({ json: [installedRelease, olderRelease] }));
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.locator(".qam-content").getByRole("button", { name: "Check for Updates", exact: true }).click();
  await expect(app.getByRole("button", { name: `Reinstall v${deckyHubVersion}`, exact: true })).toBeVisible();

  await app.getByLabel("Version").selectOption({ label: "v0.9.0" });

  await expect(app.getByRole("button", { name: "Downgrade to v0.9.0", exact: true })).toBeVisible();
});

test("DeckyHub's Check for Updates snaps the version picker back to the channel's latest", async ({ page }) => {
  const installedRelease = {
    tag_name: deckyHubTag,
    prerelease: false,
    html_url: `https://github.com/mazillka/deckyhub-plugin/releases/tag/${deckyHubTag}`,
    assets: [{ name: `DeckyHub-${deckyHubTag}.zip`, browser_download_url: `https://github.com/mazillka/deckyhub-plugin/releases/download/${deckyHubTag}/DeckyHub-${deckyHubTag}.zip`, digest: `sha256:${"a".repeat(64)}` }],
  };
  const olderRelease = {
    tag_name: "v0.9.0",
    prerelease: false,
    html_url: "https://github.com/mazillka/deckyhub-plugin/releases/tag/v0.9.0",
    assets: [{ name: "DeckyHub-v0.9.0.zip", browser_download_url: "https://github.com/mazillka/deckyhub-plugin/releases/download/v0.9.0/DeckyHub-v0.9.0.zip", digest: `sha256:${"c".repeat(64)}` }],
  };
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) => route.fulfill({ json: [installedRelease, olderRelease] }));
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.locator(".qam-content").getByRole("button", { name: "Check for Updates", exact: true }).click();

  // Pick the older release to inspect a downgrade...
  await app.getByLabel("Version").selectOption({ label: "v0.9.0" });
  await expect(app.getByLabel("Version")).toHaveValue("v0.9.0");

  // ...then explicitly check for updates: the selection should jump back to
  // the channel's newest release (here, the installed one), not stay parked
  // on whatever was selected before.
  await app.locator(".steam-modal").getByRole("button", { name: "Check for Updates", exact: true }).click();

  await expect(app.getByLabel("Version")).toHaveValue(deckyHubTag);
  await expect(app.getByRole("button", { name: `Reinstall v${deckyHubVersion}`, exact: true })).toBeVisible();
});

test("DeckyHub distinguishes rc versions sharing the same release number", async ({ page }) => {
  // Regression test: versionNumbers()'s regex used to strip the "-rc.N"
  // suffix entirely, so "1.0.3-rc.1"/"-rc.2"/"-rc.3" all parsed as the same
  // "1.0.3" and switching between them in the version picker always showed
  // "Reinstall" — never "Update" or "Downgrade" — no matter which was picked.
  const makeRelease = (tag: string) => ({
    tag_name: tag,
    prerelease: false,
    html_url: `https://github.com/mazillka/deckyhub-plugin/releases/tag/${tag}`,
    assets: [{ name: `DeckyHub-${tag}.zip`, browser_download_url: `https://github.com/mazillka/deckyhub-plugin/releases/download/${tag}/DeckyHub-${tag}.zip`, digest: `sha256:${"a".repeat(64)}` }],
  });
  const installedRelease = makeRelease(deckyHubTag);
  const olderRcRelease = makeRelease(olderRcTag);
  const newerRcRelease = makeRelease(newerRcTag);
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) =>
    route.fulfill({ json: [newerRcRelease, installedRelease, olderRcRelease] })
  );
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.getByRole("button", { name: /^Update \(.* available\)$/ }).click();

  // The modal defaults to the channel's newest release (newerRcRelease is
  // versions[0] in the mocked list), not the installed one, so it shows
  // "Update to …" immediately rather than "Reinstall …".
  await expect(app.getByRole("button", { name: `Update to ${newerRcTag}`, exact: true })).toBeVisible();

  await app.getByLabel("Version").selectOption({ label: olderRcTag });
  await expect(app.getByRole("button", { name: `Downgrade to ${olderRcTag}`, exact: true })).toBeVisible();

  await app.getByLabel("Version").selectOption({ label: `${deckyHubTag} (installed)` });
  await expect(app.getByRole("button", { name: `Reinstall v${deckyHubVersion}`, exact: true })).toBeVisible();
});

test("DeckyHub picks the newest release by publish date even when GitHub returns the list out of order", async ({ page }) => {
  // Regression test: GitHub's list-releases endpoint has been observed
  // returning a just-published release sandwiched in the middle of the
  // array instead of first, so trusting array order for "latest" silently
  // pointed the version picker (and its "(latest)" tag) at a stale release.
  // The mock below deliberately places the truly-newest release (by
  // published_at) in the middle of the response to reproduce that.
  const makeRelease = (tag: string, publishedAt: string) => ({
    tag_name: tag,
    prerelease: false,
    published_at: publishedAt,
    html_url: `https://github.com/mazillka/deckyhub-plugin/releases/tag/${tag}`,
    assets: [{ name: `DeckyHub-${tag}.zip`, browser_download_url: `https://github.com/mazillka/deckyhub-plugin/releases/download/${tag}/DeckyHub-${tag}.zip`, digest: `sha256:${"a".repeat(64)}` }],
  });
  const installedRelease = makeRelease(deckyHubTag, "2026-01-01T00:00:00Z");
  const olderRcRelease = makeRelease(olderRcTag, "2026-01-02T00:00:00Z");
  const newerRcRelease = makeRelease(newerRcTag, "2026-01-03T00:00:00Z");
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) =>
    // Out-of-order on purpose: the newest release (by published_at) isn't array[0].
    route.fulfill({ json: [installedRelease, newerRcRelease, olderRcRelease] })
  );
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.getByRole("button", { name: /^Update \(.* available\)$/ }).click();

  await expect(app.getByRole("button", { name: `Update to ${newerRcTag}`, exact: true })).toBeVisible();
  await expect(app.locator(".steam-modal").getByLabel("Version")).toHaveValue(newerRcRelease.tag_name);
  const options = await app.locator(".steam-modal").getByLabel("Version").locator("option").allTextContents();
  expect(options.find((label) => label.includes("(latest)"))).toBe(`${newerRcTag} (latest)`);
});

test("DeckyHub falls back to a clear message when automatic update can't reach Decky Loader", async ({ page }) => {
  const deckyHubRelease = {
    tag_name: deckyHubTag,
    prerelease: false,
    html_url: `https://github.com/mazillka/deckyhub-plugin/releases/tag/${deckyHubTag}`,
    assets: [{ name: `DeckyHub-${deckyHubTag}.zip`, browser_download_url: `https://github.com/mazillka/deckyhub-plugin/releases/download/${deckyHubTag}/DeckyHub-${deckyHubTag}.zip`, digest: `sha256:${"a".repeat(64)}` }],
  };
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) => route.fulfill({ json: [deckyHubRelease] }));
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.locator(".qam-content").getByRole("button", { name: "Check for Updates", exact: true }).click();

  // The dev mock never defines window.DeckyBackend, mirroring a Decky Loader
  // build old enough not to expose it — the same fallback path real users hit.
  await app.getByRole("button", { name: `Reinstall v${deckyHubVersion}`, exact: true }).click();

  await expect(app.getByText("Automatic update is unavailable right now — use Download ZIP instead.")).toBeVisible();
});

test("DeckyHub's Reinstall closes its window and hands the release to Decky's installer", async ({ page }) => {
  const asset = { name: `DeckyHub-${deckyHubTag}.zip`, browser_download_url: `https://github.com/mazillka/deckyhub-plugin/releases/download/${deckyHubTag}/DeckyHub-${deckyHubTag}.zip`, digest: `sha256:${"a".repeat(64)}` };
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) =>
    route.fulfill({ json: [{ tag_name: deckyHubTag, prerelease: false, html_url: `https://github.com/mazillka/deckyhub-plugin/releases/tag/${deckyHubTag}`, assets: [asset] }] }),
  );
  await recordInstalls(page);
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.locator(".qam-content").getByRole("button", { name: "Check for Updates", exact: true }).click();
  await app.getByRole("button", { name: `Reinstall v${deckyHubVersion}`, exact: true }).click();

  // Decky's own confirm/progress dialog takes over, so this window gets out of the way.
  await expect(app.locator(".steam-modal")).toHaveCount(0);
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __installCalls: unknown[][] }).__installCalls)).toEqual([
    ["utilities/install_plugin", asset.browser_download_url, "DeckyHub", deckyHubVersion, "a".repeat(64), 1],
  ]);
});

test("DeckyHub version picker re-filters by channel and leaves the channel as it found it", async ({ page }) => {
  const stableRelease = {
    tag_name: deckyHubTag,
    prerelease: false,
    html_url: `https://github.com/mazillka/deckyhub-plugin/releases/tag/${deckyHubTag}`,
    assets: [{ name: `DeckyHub-${deckyHubTag}.zip`, browser_download_url: `https://github.com/mazillka/deckyhub-plugin/releases/download/${deckyHubTag}/DeckyHub-${deckyHubTag}.zip`, digest: `sha256:${"a".repeat(64)}` }],
  };
  const prereleaseRelease = {
    tag_name: "v999.0.0-beta",
    prerelease: true,
    html_url: "https://github.com/mazillka/deckyhub-plugin/releases/tag/v999.0.0-beta",
    assets: [{ name: "DeckyHub-v999.0.0-beta.zip", browser_download_url: "https://github.com/mazillka/deckyhub-plugin/releases/download/v999.0.0-beta/DeckyHub-v999.0.0-beta.zip", digest: `sha256:${"d".repeat(64)}` }],
  };
  await page.route("https://api.github.com/repos/mazillka/deckyhub-plugin/releases?per_page=20", (route) => route.fulfill({ json: [stableRelease, prereleaseRelease] }));
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.locator(".qam-content").getByRole("button", { name: "Check for Updates", exact: true }).click();
  await expect(app.getByLabel("Version")).toHaveValue(deckyHubTag);

  await app.getByLabel("Update Channel").selectOption({ label: "Pre-releases" });

  await expect(app.getByLabel("Version")).toHaveValue("v999.0.0-beta");
  await expect(app.getByRole("button", { name: "Update to v999.0.0-beta", exact: true })).toBeVisible();

  // changeChannel() persists to the real (shared) settings.json via the dev
  // bridge, fire-and-forget from the UI's perspective — clicking the dropdown
  // back to "Stable" wouldn't reliably outlast the test (Playwright tears the
  // page down as soon as this function returns, racing the unawaited save).
  // Round-trip the bridge directly and await it so the reset actually lands
  // before this test — and the suite — finishes.
  const { result: settings } = await bridgeCall(page, "get_settings");
  await bridgeCall(page, "save_settings", { ...settings, updateChannel: "stable" });
});

test("DeckyHub update modal's Close button is full width and dismisses the modal", async ({ page }) => {
  await page.goto("/?bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.locator(".qam-content").getByRole("button", { name: "Check for Updates", exact: true }).click();

  const [closeBox, modalBox] = await Promise.all([
    app.getByRole("button", { name: "Close", exact: true }).boundingBox(),
    app.locator(".steam-modal").boundingBox(),
  ]);
  expect(closeBox).not.toBeNull();
  expect(modalBox).not.toBeNull();
  expect(closeBox!.width).toBeGreaterThanOrEqual(modalBox!.width - 48);

  await app.getByRole("button", { name: "Close", exact: true }).click();
  await expect(app.getByText("DeckyHub Update", { exact: true })).toBeHidden();
});

test("Repository pagination stays on one row", async ({ page }) => {
  await page.route("https://api.github.com/search/repositories**", (route) =>
    route.fulfill({
      json: {
        items: Array.from({ length: 6 }, (_, index) => ({
          full_name: `example/repo-${index}`,
          description: "Test repository",
          stargazers_count: index,
        })),
      },
    })
  );
  await page.goto("/?preview=/deckyhub/repositories&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await app.getByLabel("Search GitHub").fill("example");
  await app.getByRole("button", { name: "Search", exact: true }).click();

  const previous = app.getByRole("button", { name: "Previous", exact: true });
  const next = app.getByRole("button", { name: "Next", exact: true });
  const pageOf = app.getByText("Page 1 of 2", { exact: true });
  await expect(previous).toBeVisible();
  await expect(pageOf).toBeVisible();
  await expect(next).toBeVisible();
  const [previousBox, pageOfBox, nextBox] = await Promise.all([previous.boundingBox(), pageOf.boundingBox(), next.boundingBox()]);
  expect(Math.abs(previousBox!.y - pageOfBox!.y)).toBeLessThan(20);
  expect(Math.abs(pageOfBox!.y - nextBox!.y)).toBeLessThan(20);
  expect(pageOfBox!.x).toBeGreaterThan(previousBox!.x);
  expect(nextBox!.x).toBeGreaterThan(pageOfBox!.x);
});

test("Discover reports an empty filtered result", async ({ page }) => {
  const app = mock(page);
  await app.getByRole("button", { name: "/deckyhub/discover" }).click();
  await app.getByLabel("Search").fill("does-not-exist");

  await expect(app.getByRole("heading", { name: "No repositories are available." })).toBeVisible();
  // Clear resets the filters straight from the empty state.
  await app.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(app.getByLabel("Search")).toHaveValue("");
  await expect(app.getByRole("heading", { name: "MAKO Decky" })).toBeVisible();
});

test("A GitHub rate limit surfaces a friendly message instead of a raw status code", async ({ page }) => {
  const resetInTwoMinutes = Math.floor(Date.now() / 1000) + 120;
  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases?per_page=20", (route) =>
    route.fulfill({
      status: 403,
      // GitHub exposes these to browsers via CORS; without this header the
      // mock's cross-origin fetch can't read them and the wait time is lost.
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetInTwoMinutes), "access-control-expose-headers": "x-ratelimit-remaining, x-ratelimit-reset" },
      json: { message: "API rate limit exceeded" },
    })
  );
  const app = mock(page);
  await app.getByRole("button", { name: "/deckyhub/discover" }).click();

  const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
  await expect(makoCard.getByText(/GitHub rate limit reached./)).toBeVisible();
  await expect(makoCard.getByText("GitHub API returned 403", { exact: true })).toBeHidden();

  // Without a token, the limit also raises one header banner (even though
  // several apps hit it) that links straight to the token setting.
  const banner = app.locator(".deckyhub-rate-limit");
  await expect(banner).toHaveCount(1);
  await expect(banner.getByText("GitHub rate limit reached")).toBeVisible();
  await expect(banner.getByText(/Try again in about \d+ min\. Add a GitHub token in Settings/)).toBeVisible();

  // It follows the user to other GitHub-backed screens until dismissed.
  await app.getByRole("button", { name: "/deckyhub/repositories" }).click();
  await expect(banner).toHaveCount(1);
  await banner.getByRole("button", { name: "Dismiss", exact: true }).click();
  await expect(banner).toHaveCount(0);

  await app.getByRole("button", { name: "/deckyhub/discover" }).click();
  await expect(banner).toHaveCount(1);
  await banner.getByRole("button", { name: "Open Settings", exact: true }).click();
  await expect(app.getByText("GitHub Token")).toBeVisible();
});

test("The rate-limit message suggests adding a GitHub token only when none is configured", async ({ page }) => {
  const resetInTwoMinutes = Math.floor(Date.now() / 1000) + 120;
  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases?per_page=20", (route) =>
    route.fulfill({
      status: 403,
      headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetInTwoMinutes) },
      json: { message: "API rate limit exceeded" },
    })
  );

  try {
    const app = mock(page);
    await app.getByRole("button", { name: "/deckyhub/discover" }).click();
    const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
    await expect(makoCard.getByText(/Add a GitHub token in Settings/)).toBeVisible();

    // A fresh route mount re-primes the token from backend settings (same
    // mechanism proven by the "Saving a GitHub token" test below) — no
    // reload needed. 403 responses are never cached (see hydrate()'s
    // catch block), so this navigation re-fetches for real either way.
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "ghp_already_set" });
    await app.getByRole("button", { name: "/deckyhub/settings" }).click();
    await app.getByRole("button", { name: "/deckyhub/discover" }).click();

    await expect(makoCard.getByText(/GitHub rate limit reached./)).toBeVisible();
    await expect(makoCard.getByText(/Add a GitHub token in Settings/)).toBeHidden();
    await expect(app.locator(".deckyhub-rate-limit")).toHaveCount(0);
  } finally {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "" });
  }
});

test("Settings' GitHub Access intro is a controller focus stop above the token field", async ({ page }) => {
  await page.goto("/?preview=/deckyhub/settings&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  await expect(app.getByLabel("GitHub Token")).toBeVisible();

  // Steam only scrolls to follow focus, so the intro must be focusable or the
  // controller can never scroll back up to it from the token field.
  const intro = app.locator("[tabindex]", { hasText: "Without a token, GitHub limits this device" });
  await intro.focus();
  await expect(intro).toBeFocused();
  await intro.press("ArrowDown");
  await expect(app.locator(".deckyhub-token-link")).toBeFocused();
  await app.locator(".deckyhub-token-link").press("ArrowDown");
  await expect(app.getByLabel("GitHub Token")).toBeFocused();
});

test("Settings' token link opens GitHub's token page", async ({ page, context }) => {
  await context.route("https://github.com/**", (route) => route.fulfill({ body: "tokens page" }));
  await page.goto("/?preview=/deckyhub/settings&bridge=http://127.0.0.1:8643");
  const popupPromise = page.waitForEvent("popup");
  await mock(page).locator(".deckyhub-token-link").click();
  expect((await popupPromise).url()).toBe("https://github.com/settings/tokens");
});

test("An outdated Decky plugin's card offers Update and hands it to Decky's installer", async ({ page }) => {
  // dev-server.py scans .dev-data/plugins/*/plugin.json as the installed
  // Decky plugins, so seed an old MAKO there for the length of this test.
  const pluginDir = new URL("../.dev-data/plugins/e2e-mako/", import.meta.url);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(new URL("plugin.json", pluginDir), JSON.stringify({ name: "MAKO - Frame Generation", version: "1.0.0" }));
  const sha256 = "c".repeat(64);
  const url = "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.2.3/mako-decky.zip";
  await mockMakoReleases(page, [makoRelease("plugin-v1.2.3", sha256)]);
  // Stand-in for Decky Loader's own WS bridge: records install requests.
  await recordInstalls(page);

  try {
    await page.goto("/?preview=/deckyhub/updates&bridge=http://127.0.0.1:8643");
    const app = mock(page);
    const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
    await makoCard.getByRole("button", { name: "Update to latest", exact: true }).click();
    // Decky's own dialog takes over, so the page is left.
    await expect(mock(page).locator(".qam-content")).toBeVisible();

    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
    await expect.poll(() => frame.evaluate(() => (window as unknown as { __installCalls: unknown[][] }).__installCalls)).toEqual([
      ["utilities/install_plugin", url, "MAKO - Frame Generation", "1.2.3", sha256, 2],
    ]);
  } finally {
    // Retries: on Windows the bridge's plugin scan can briefly lock the folder.
    rmSync(pluginDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("The Manage window offers Install for a Decky plugin that isn't installed yet", async ({ page }) => {
  const sha256 = "d".repeat(64);
  const url = "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.2.3/mako-decky.zip";
  await mockMakoReleases(page, [makoRelease("plugin-v1.2.3", sha256)]);
  await recordInstalls(page);
  await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
  await makoCard.getByRole("button", { name: "Manage", exact: true }).click();
  const modal = app.locator(".steam-modal");
  // Every version shows as v*.*.*, whatever the tag's prefix.
  await expect(modal.getByLabel("Version").locator("option")).toHaveText(["v1.2.3 (latest)"]);
  await expect(modal.getByRole("button", { name: "Update", exact: true })).toHaveCount(0);
  await modal.getByRole("button", { name: "Install", exact: true }).click();
  // Decky's own dialog takes over, so the page is left.
  await expect(mock(page).locator(".qam-content")).toBeVisible();

  // A fresh install is named after the registry's first detection name, the
  // plugin's own manifest name, with Decky's INSTALL (0) type.
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __installCalls: unknown[][] }).__installCalls)).toEqual([
    ["utilities/install_plugin", url, "MAKO - Frame Generation", "1.2.3", sha256, 0],
  ]);
});

test("Discover's card installs the latest release of a Decky plugin that isn't installed yet", async ({ page }) => {
  const sha256 = "a".repeat(64);
  const url = "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.2.3/mako-decky.zip";
  await mockMakoReleases(page, [makoRelease("plugin-v1.2.3", sha256)]);
  await recordInstalls(page);
  await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
  const makoCard = mock(page).getByRole("heading", { name: "MAKO Decky" }).locator("..");
  await makoCard.getByRole("button", { name: "Install latest", exact: true }).click();
  // Decky's own dialog takes over, so the page is left.
  await expect(mock(page).locator(".qam-content")).toBeVisible();

  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __installCalls: unknown[][] }).__installCalls)).toEqual([
    ["utilities/install_plugin", url, "MAKO - Frame Generation", "1.2.3", sha256, 0],
  ]);
});

test("A release without a GitHub checksum installs as unverified, with an empty hash", async ({ page }) => {
  const url = "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.2.3/mako-decky.zip";
  const { digest: _, ...asset } = makoRelease("plugin-v1.2.3", "").assets[0];
  await mockMakoReleases(page, [{ ...makoRelease("plugin-v1.2.3", ""), assets: [asset] }]);
  await recordInstalls(page);
  await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
  const makoCard = mock(page).getByRole("heading", { name: "MAKO Decky" }).locator("..");
  await makoCard.getByRole("button", { name: "Install latest (unverified)", exact: true }).click();

  // Decky Loader skips its SHA-256 check when the hash is empty.
  const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
  await expect.poll(() => frame.evaluate(() => (window as unknown as { __installCalls: unknown[][] }).__installCalls)).toEqual([
    ["utilities/install_plugin", url, "MAKO - Frame Generation", "1.2.3", "", 0],
  ]);
});

test("The Manage window reinstalls or downgrades an installed Decky plugin to the selected version", async ({ page }) => {
  const pluginDir = new URL("../.dev-data/plugins/e2e-mako/", import.meta.url);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(new URL("plugin.json", pluginDir), JSON.stringify({ name: "MAKO - Frame Generation", version: "1.2.3" }));
  const sha = "b".repeat(64);
  await mockMakoReleases(page, [makoRelease("plugin-v1.2.3", sha, "02"), makoRelease("plugin-v1.0.0", sha, "01")]);
  await recordInstalls(page);

  try {
    await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
    const app = mock(page);
    const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
    // Absence checks pass on a card whose release hasn't loaded yet, so wait for it first.
    await expect(makoCard.getByText(/^Latest: /)).not.toHaveText("Latest: —");
    await expect(makoCard.getByRole("button", { name: "Install latest", exact: true })).toHaveCount(0);
    // Up to date, so the card offers no Update either.
    await expect(makoCard.getByRole("button", { name: "Update to latest", exact: true })).toHaveCount(0);
    await makoCard.getByRole("button", { name: "Manage", exact: true }).click();
    const modal = app.locator(".steam-modal");
    await expect(modal.getByRole("button", { name: "Reinstall v1.2.3", exact: true })).toBeVisible();

    await modal.getByLabel("Version").selectOption({ label: "v1.0.0" });
    await modal.getByRole("button", { name: "Downgrade to v1.0.0", exact: true }).click();

    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
    await expect.poll(() => frame.evaluate(() => (window as unknown as { __installCalls: unknown[][] }).__installCalls)).toEqual([
      ["utilities/install_plugin", "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.0.0/mako-decky.zip", "MAKO - Frame Generation", "1.0.0", sha, 3],
    ]);
  } finally {
    rmSync(pluginDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Unifideck updates by uninstalling first and installing fresh, after a warning", async ({ page }) => {
  // Decky's in-place update starts Unifideck mid-install and then stops it,
  // which froze the Deck, so DeckyHub removes it first and installs fresh (0).
  const pluginDir = new URL("../.dev-data/plugins/e2e-unifideck/", import.meta.url);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(new URL("plugin.json", pluginDir), JSON.stringify({ name: "Unifideck", version: "0.7.0" }));
  const sha = "f".repeat(64);
  const url = "https://github.com/mubaraknumann/unifideck/releases/download/Release-0.7.6/unifideck.prod.v0.7.6.zip";
  await page.route("https://api.github.com/repos/mubaraknumann/unifideck/releases**", (route) =>
    route.fulfill({ json: [{ tag_name: "Release-0.7.6", prerelease: false, draft: false, published_at: "2026-10-04T00:00:00Z", html_url: "https://github.com/mubaraknumann/unifideck/releases/tag/Release-0.7.6", assets: [{ name: "unifideck.prod.v0.7.6.zip", browser_download_url: url, size: 1024, digest: `sha256:${sha}` }] }] }),
  );
  await recordInstalls(page);

  try {
    await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
    const app = mock(page);
    // The card's quick Update goes through the same warning as the Manage window's.
    await app.getByRole("heading", { name: "Unifideck" }).locator("..").getByRole("button", { name: "Update to latest", exact: true }).click();

    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
    const calls = () => frame.evaluate(() => (window as unknown as { __installCalls: unknown[][] }).__installCalls);
    // Nothing reaches Decky until the uninstall-first warning is confirmed.
    const confirm = app.locator(".steam-modal", { hasText: "Update to latest?" });
    await expect(confirm.getByText("removes the installed version first", { exact: false })).toBeVisible();
    expect(await calls()).toEqual([]);
    await confirm.getByRole("button", { name: "Update to latest", exact: true }).click();

    await expect.poll(calls).toEqual([
      ["utilities/uninstall_plugin", "Unifideck"],
      ["utilities/install_plugin", url, "Unifideck", "0.7.6", sha, 0],
    ]);
  } finally {
    rmSync(pluginDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Update All sends every outdated Decky plugin to Decky's installer in one request, leaving fresh-install ones out", async ({ page }) => {
  const plugins = { "e2e-mako": ["MAKO - Frame Generation", "1.0.0"], "e2e-lsfg": ["Decky LSFG-VK", "0.1.0"], "e2e-unifideck": ["Unifideck", "0.7.0"] };
  const dirs = Object.entries(plugins).map(([dir, [name, version]]) => {
    const pluginDir = new URL(`../.dev-data/plugins/${dir}/`, import.meta.url);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(new URL("plugin.json", pluginDir), JSON.stringify({ name, version }));
    return pluginDir;
  });
  const sha = "9".repeat(64);
  const releaseOf = (repo: string, tag: string, file: string) => ({
    tag_name: tag, prerelease: false, draft: false, published_at: "2026-10-01T00:00:00Z", html_url: `https://github.com/${repo}/releases/tag/${tag}`,
    assets: [{ name: file, browser_download_url: `https://github.com/${repo}/releases/download/${tag}/${file}`, size: 1024, digest: `sha256:${sha}` }],
  });
  await mockMakoReleases(page, [makoRelease("plugin-v1.2.3", sha)]);
  await page.route("https://api.github.com/repos/xXJSONDeruloXx/decky-lsfg-vk/releases**", (route) => route.fulfill({ json: [releaseOf("xXJSONDeruloXx/decky-lsfg-vk", "v0.2.0", "decky-lsfg-vk.zip")] }));
  await page.route("https://api.github.com/repos/mubaraknumann/unifideck/releases**", (route) => route.fulfill({ json: [releaseOf("mubaraknumann/unifideck", "Release-0.7.6", "unifideck.zip")] }));
  await recordInstalls(page);

  try {
    await page.goto("/?preview=/deckyhub/updates&bridge=http://127.0.0.1:8643");
    const app = mock(page);
    await expect(app.getByRole("heading", { name: "Unifideck" })).toBeVisible();
    await app.getByRole("button", { name: "Update All (2)", exact: true }).click();
    // Decky's own dialog takes over, so the page is left.
    await expect(mock(page).locator(".qam-content")).toBeVisible();

    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
    const calls = () => frame.evaluate(() => (window as unknown as { __installCalls: unknown[][] }).__installCalls);
    await expect.poll(calls).toHaveLength(1);
    const [[route, requests]] = (await calls()) as [string, { name: string; version: string; install_type: number }[]][];
    expect(route).toBe("utilities/install_plugins");
    expect(requests.map(({ name, version, install_type }) => [name, version, install_type]).sort()).toEqual([
      ["Decky LSFG-VK", "0.2.0", 2],
      ["MAKO - Frame Generation", "1.2.3", 2],
    ]);
  } finally {
    for (const pluginDir of dirs) rmSync(pluginDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Display Settings can hide the Manage window's buttons", async ({ page }) => {
  await mockMakoReleases(page, [makoRelease("plugin-v1.2.3", "e".repeat(64))]);
  const app = mock(page);
  const openManage = async () => {
    await app.getByRole("button", { name: "/deckyhub/discover" }).click();
    await app.getByRole("heading", { name: "MAKO Decky" }).locator("..").getByRole("button", { name: "Manage", exact: true }).click();
    return app.locator(".steam-modal");
  };

  try {
    // settings.json is shared with any interactive mock session; start clean.
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "" });
    let modal = await openManage();
    for (const name of ["Install", "Download ZIP", "Release Page"]) await expect(modal.getByRole("button", { name, exact: true })).toBeVisible();
    await modal.getByRole("button", { name: "Close", exact: true }).click();

    await app.getByRole("button", { name: "/deckyhub/settings" }).click();
    for (const name of ["Download ZIP", "Install", "Release Page"]) await app.getByText(`Hide “${name}”`, { exact: true }).click();
    await expect(app.getByLabel("Hide “Release Page”")).toBeChecked();

    modal = await openManage();
    await expect(modal.getByLabel("Version").locator("option").first()).toBeAttached();
    for (const name of ["Install", "Download ZIP", "Release Page"]) await expect(modal.getByRole("button", { name, exact: true })).toHaveCount(0);
    await modal.getByRole("button", { name: "Close", exact: true }).click();

    // DeckyHub's own update window honours the same toggles ("Hide Update"
    // covers its Update/Reinstall/Downgrade button).
    await app.getByRole("button", { name: "/deckyhub/settings" }).click();
    await app.getByText("Hide “Update”", { exact: true }).click();
    await expect(app.getByLabel("Hide “Update”")).toBeChecked();
    await app.getByRole("button", { name: "Quick Access widget" }).click();
    await app.locator(".qam-content").getByRole("button", { name: /^(Update \(.*\)|Check for Updates)$/ }).click();
    modal = app.locator(".steam-modal");
    await expect(modal.getByLabel("Version").locator("option").first()).toBeAttached();
    await expect(modal.getByRole("button", { name: /^(Update to|Reinstall|Downgrade to|Download ZIP|Release Page)/ })).toHaveCount(0);
  } finally {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "" });
  }
});

test("The Manage window uninstalls an installed Decky plugin after confirming", async ({ page }) => {
  const pluginDir = new URL("../.dev-data/plugins/e2e-mako-uninstall/", import.meta.url);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(new URL("plugin.json", pluginDir), JSON.stringify({ name: "MAKO - Frame Generation", version: "1.0.0" }));
  // Stand-in for Decky Loader's WS bridge: records calls without deleting anything.
  await page.addInitScript(() => {
    const calls: unknown[][] = [];
    Object.assign(window, { __loaderCalls: calls, DeckyBackend: { call: async (...args: unknown[]) => void calls.push(args), addEventListener() {}, removeEventListener() {} } });
  });

  try {
    await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
    const app = mock(page);
    await app.getByRole("heading", { name: "MAKO Decky" }).locator("..").getByRole("button", { name: "Manage", exact: true }).click();
    await app.locator(".steam-modal").getByRole("button", { name: "Uninstall", exact: true }).click();

    // Decky Loader deletes without asking, so DeckyHub confirms first.
    const confirm = app.locator(".steam-modal", { hasText: "Uninstall MAKO Decky?" });
    await expect(confirm.getByText("This removes the plugin and its settings from this device.", { exact: false })).toBeVisible();
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame())!;
    const calls = () => frame.evaluate(() => (window as unknown as { __loaderCalls: unknown[][] }).__loaderCalls);
    expect(await calls()).toEqual([]);
    await confirm.getByRole("button", { name: "Uninstall", exact: true }).click();

    await expect.poll(calls).toEqual([["utilities/uninstall_plugin", "MAKO - Frame Generation"]]);
  } finally {
    // Retries: on Windows the bridge's plugin scan can briefly lock the folder.
    rmSync(pluginDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("Release Page closes the Manage window before opening the page", async ({ page, context }) => {
  await context.route("https://github.com/**", (route) => route.fulfill({ body: "release page" }));
  const app = mock(page);
  await app.getByRole("button", { name: "/deckyhub/discover" }).click();
  await app.getByRole("heading", { name: "MAKO Decky" }).locator("..").getByRole("button", { name: "Manage", exact: true }).click();
  const popupPromise = page.waitForEvent("popup");
  await app.locator(".steam-modal").getByRole("button", { name: "Release Page", exact: true }).click();

  // Steam's browser would otherwise open underneath the still-open modal.
  expect((await popupPromise).url()).toBe(release.html_url);
  await expect(app.locator(".steam-modal")).toHaveCount(0);
});

test("Compact interface shrinks DeckyHub's buttons and spacing, Default restores them", async ({ page }) => {
  const app = mock(page);
  const minHeight = (locator: ReturnType<typeof app.locator>) => locator.evaluate((el) => getComputedStyle(el).minHeight);
  try {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "" });
    await app.getByRole("button", { name: "/deckyhub/settings" }).click();
    const save = app.getByRole("button", { name: "Save Settings", exact: true });
    await expect.poll(() => minHeight(save)).toBe("36px");

    await app.getByLabel("Interface").selectOption({ label: "Compact" });
    await expect.poll(() => minHeight(save)).toBe("28px");

    // Modals follow too: they render in the same document as the variables.
    await app.getByRole("button", { name: "/deckyhub/discover" }).click();
    await app.getByRole("heading", { name: "MAKO Decky" }).locator("..").getByRole("button", { name: "Manage", exact: true }).click();
    const close = app.locator(".steam-modal").getByRole("button", { name: "Close", exact: true });
    await expect.poll(() => minHeight(close)).toBe("28px");
    await close.click();

    await app.getByRole("button", { name: "/deckyhub/settings" }).click();
    await app.getByLabel("Interface").selectOption({ label: "Default" });
    await expect.poll(() => minHeight(app.getByRole("button", { name: "Save Settings", exact: true }))).toBe("36px");
  } finally {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "" });
  }
});

test("Settings shows how many GitHub requests are left", async ({ page }) => {
  const resetInTenMinutes = Math.floor(Date.now() / 1000) + 600;
  await page.route("https://api.github.com/rate_limit", (route) =>
    route.fulfill({ json: { resources: { core: { limit: 60, remaining: 42, reset: resetInTenMinutes }, search: { limit: 10, remaining: 10, reset: resetInTenMinutes } } } })
  );
  const app = mock(page);
  await app.getByRole("button", { name: "/deckyhub/settings" }).click();

  await expect(app.locator(".deckyhub-github-quota")).toHaveText(/^GitHub requests left: 42 of 60 \(resets in (10|11) min\)$/);
});

test("Discover's Details modal exposes every matching release asset", async ({ page }) => {
  const multiAssetRelease = {
    tag_name: "plugin-v1.2.3",
    prerelease: false,
    draft: false,
    html_url: "https://github.com/eugeniosegala/MAKO/releases/tag/plugin-v1.2.3",
    assets: Array.from({ length: 5 }, (_, index) => ({
      name: `mako-decky-${index + 1}.zip`,
      browser_download_url: `https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.2.3/mako-decky-${index + 1}.zip`,
      size: 1024,
    })),
  };
  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases?per_page=20", (route) => route.fulfill({ json: [multiAssetRelease] }));
  const app = mock(page);
  await app.getByRole("button", { name: "/deckyhub/discover" }).click();

  const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
  await makoCard.getByRole("button", { name: "Manage", exact: true }).click();

  const modal = app.locator(".steam-modal");
  await expect(modal.getByRole("button", { name: "Download ZIP", exact: true })).toBeVisible();
  await expect(modal.getByRole("button", { name: "mako-decky-5.zip (1 KB)" })).toBeVisible();
});

test("Reopening Details within the cache window doesn't re-fetch its release list", async ({ page }) => {
  let requests = 0;
  const release = {
    tag_name: "plugin-v1.2.3",
    prerelease: false,
    draft: false,
    html_url: "https://github.com/eugeniosegala/MAKO/releases/tag/plugin-v1.2.3",
    assets: [{ name: "mako-decky-1.zip", browser_download_url: "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.2.3/mako-decky-1.zip", size: 1024 }],
  };
  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases?per_page=20", (route) => {
    requests++;
    return route.fulfill({ json: [release] });
  });
  const app = mock(page);
  await app.getByRole("button", { name: "/deckyhub/discover" }).click();
  const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");

  await makoCard.getByRole("button", { name: "Manage", exact: true }).click();
  await expect(app.locator(".steam-modal").getByRole("button", { name: "Download ZIP", exact: true })).toBeVisible();
  await app.locator(".steam-modal").getByRole("button", { name: "Close", exact: true }).click();

  // The card (hydrate) and the modal (listAppReleases) share fetchReleases()'s
  // per-repo cache, so the whole flow costs one request — and reopening the
  // modal adds none while it's still within CACHE_TTL.
  const requestsAfterFirstOpen = requests;
  expect(requestsAfterFirstOpen).toBe(1);
  await makoCard.getByRole("button", { name: "Manage", exact: true }).click();
  await expect(app.locator(".steam-modal").getByRole("button", { name: "Download ZIP", exact: true })).toBeVisible();

  expect(requests).toBe(requestsAfterFirstOpen);
});

const makoReleases = [
  {
    tag_name: "plugin-v1.3.0",
    prerelease: false,
    draft: false,
    html_url: "https://github.com/eugeniosegala/MAKO/releases/tag/plugin-v1.3.0",
    assets: [{ name: "mako-decky-1.zip", browser_download_url: "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.3.0/mako-decky-1.zip", size: 2048 }],
  },
  {
    tag_name: "plugin-v1.2.3",
    prerelease: false,
    draft: false,
    html_url: "https://github.com/eugeniosegala/MAKO/releases/tag/plugin-v1.2.3",
    assets: [{ name: "mako-decky-1.zip", browser_download_url: "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.2.3/mako-decky-1.zip", size: 1024 }],
  },
  {
    tag_name: "plugin-v1.4.0-beta",
    prerelease: true,
    draft: false,
    html_url: "https://github.com/eugeniosegala/MAKO/releases/tag/plugin-v1.4.0-beta",
    assets: [{ name: "mako-decky-1.zip", browser_download_url: "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.4.0-beta/mako-decky-1.zip", size: 4096 }],
  },
];

test("Discover's Details modal lists versions for the selected channel", async ({ page }) => {
  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases?per_page=20", (route) => route.fulfill({ json: makoReleases }));
  await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
  await makoCard.getByRole("button", { name: "Manage", exact: true }).click();

  // Every card on the page also has its own "Installed: —" line, so scope
  // assertions to the modal itself rather than the whole (iframe) document.
  const modal = app.locator(".steam-modal");
  await expect(modal.getByText("Installed: —", { exact: true })).toBeVisible();
  await expect(modal.getByLabel("Version")).toHaveValue("plugin-v1.3.0");
  await expect(modal.getByRole("button", { name: "Download ZIP", exact: true })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Release Page", exact: true })).toBeVisible();

  await modal.getByLabel("Version").selectOption({ label: "v1.2.3" });
  await expect(modal.getByLabel("Version")).toHaveValue("plugin-v1.2.3");

  await modal.getByRole("button", { name: "Close", exact: true }).click();
  await expect(modal).toBeHidden();
});

test("Discover's Details modal channel picker updates the card's Channel label", async ({ page }) => {
  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases?per_page=20", (route) => route.fulfill({ json: makoReleases }));
  await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");

  await expect(makoCard.getByText("Channel: Stable", { exact: true })).toBeVisible();

  try {
    await makoCard.getByRole("button", { name: "Manage", exact: true }).click();
    await app.getByLabel("Update Channel").selectOption({ label: "Pre-releases" });
    await expect(app.getByLabel("Version")).toHaveValue("plugin-v1.4.0-beta");

    await app.getByRole("button", { name: "Close", exact: true }).click();
    await expect(makoCard.getByText("Channel: Pre-release", { exact: true })).toBeVisible();
  } finally {
    // save_repo_settings persists to the real (shared) settings.json via the
    // dev bridge — round-trip it back to the default directly so this test
    // doesn't leave MAKO's channel overridden for later tests/runs.
    await bridgeCall(page, "save_repo_settings", "eugeniosegala/MAKO", { channel: "stable", assetFilter: [] });
  }
});

test("Discover's card picks the newest pre-release by publish date, not array order", async ({ page }) => {
  // Regression test for the same GitHub list-order bug as the DeckyHub
  // version-picker fix, but for hydrate() — the function driving every
  // card's own "Latest: …" line and update status, not just a picker. The
  // mock deliberately puts the truly-newest pre-release second in the
  // array to reproduce GitHub returning the list out of order.
  const olderBeta = {
    tag_name: "plugin-v1.4.0-beta.1",
    prerelease: true,
    draft: false,
    published_at: "2026-01-01T00:00:00Z",
    html_url: "https://github.com/eugeniosegala/MAKO/releases/tag/plugin-v1.4.0-beta.1",
    assets: [{ name: "mako-decky-1.zip", browser_download_url: "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.4.0-beta.1/mako-decky-1.zip", size: 1024 }],
  };
  const newerBeta = {
    tag_name: "plugin-v1.4.0-beta.2",
    prerelease: true,
    draft: false,
    published_at: "2026-01-02T00:00:00Z",
    html_url: "https://github.com/eugeniosegala/MAKO/releases/tag/plugin-v1.4.0-beta.2",
    assets: [{ name: "mako-decky-1.zip", browser_download_url: "https://github.com/eugeniosegala/MAKO/releases/download/plugin-v1.4.0-beta.2/mako-decky-1.zip", size: 1024 }],
  };
  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases?per_page=20", (route) =>
    // Out-of-order on purpose: the newest pre-release (by published_at) isn't array[0].
    route.fulfill({ json: [olderBeta, newerBeta] })
  );
  await bridgeCall(page, "save_repo_settings", "eugeniosegala/MAKO", { channel: "prerelease", assetFilter: [] });
  try {
    await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
    const app = mock(page);
    const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
    await expect(makoCard.getByText("Latest: v1.4.0-beta.2", { exact: true })).toBeVisible();
  } finally {
    await bridgeCall(page, "save_repo_settings", "eugeniosegala/MAKO", { channel: "stable", assetFilter: [] });
  }
});

test("A newer pre-release of an installed pre-release counts as an update", async ({ page }) => {
  // Regression: only the numeric part used to be compared, so rc.1 → rc.2 was "Up To Date".
  const pluginDir = new URL("../.dev-data/plugins/e2e-mako-rc/", import.meta.url);
  mkdirSync(pluginDir, { recursive: true });
  writeFileSync(new URL("plugin.json", pluginDir), JSON.stringify({ name: "MAKO - Frame Generation", version: "1.4.0-rc.1" }));
  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases?per_page=20", (route) =>
    route.fulfill({ json: [{ tag_name: "plugin-v1.4.0-rc.2", prerelease: true, draft: false, published_at: "2026-01-02T00:00:00Z", html_url: "https://github.com/eugeniosegala/MAKO/releases/tag/plugin-v1.4.0-rc.2", assets: [] }] })
  );
  await bridgeCall(page, "save_repo_settings", "eugeniosegala/MAKO", { channel: "prerelease", assetFilter: [] });
  try {
    await page.goto("/?preview=/deckyhub/updates&bridge=http://127.0.0.1:8643");
    const makoCard = mock(page).getByRole("heading", { name: "MAKO Decky" }).locator("..");
    await expect(makoCard.getByText("Update Available", { exact: true })).toBeVisible();
  } finally {
    await bridgeCall(page, "save_repo_settings", "eugeniosegala/MAKO", { channel: "stable", assetFilter: [] });
    rmSync(pluginDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
});

test("A failed release check falls back to the cached releases", async ({ page }) => {
  const app = mock(page);
  await app.getByRole("button", { name: "/deckyhub/discover" }).click();
  const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
  await expect(makoCard.getByText("Latest: v1.2.3", { exact: true })).toBeVisible();

  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases?per_page=20", (route) =>
    route.fulfill({ status: 403, headers: { "x-ratelimit-remaining": "0" }, json: { message: "API rate limit exceeded" } })
  );
  await app.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(app.locator(".deckyhub-rate-limit")).toHaveCount(1);
  await expect(makoCard.getByText("Latest: v1.2.3", { exact: true })).toBeVisible();
  await expect(makoCard.getByText(/GitHub rate limit reached/)).toBeHidden();
});

test("Saving a GitHub token in Settings adds it to GitHub API requests", async ({ page }) => {
  let authHeader: string | undefined;
  await page.route("https://api.github.com/**", (route) => {
    authHeader = route.request().headers()["authorization"];
    return route.fulfill({ json: [release] });
  });

  try {
    const app = mock(page);
    await app.getByRole("button", { name: "/deckyhub/settings" }).click();
    await app.getByLabel("GitHub Token").fill("ghp_test_token_abc123");
    const saveButton = app.getByRole("button", { name: "Save Settings", exact: true });
    await saveButton.click();
    // The button re-disables only once the save round-trip resolves and
    // settings state updates, so waiting for that avoids racing the
    // navigation below against an in-flight save (see save_repo_settings'
    // channel-reset tests above for the same race under a different route).
    await expect(saveButton).toBeDisabled();

    // /deckyhub/discover mounts a brand-new I18nProvider (one per route, see
    // AGENTS.md), which re-primes the GitHub token from backend settings on
    // mount — same mechanism as its locale refresh — so no reload is needed.
    await app.getByRole("button", { name: "/deckyhub/discover" }).click();
    await expect(app.getByText("Latest: v1.2.3", { exact: true }).first()).toBeVisible();

    expect(authHeader).toBe("Bearer ghp_test_token_abc123");
  } finally {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "" });
  }
});

test("Settings loads a previously saved GitHub token and keeps Save disabled until it changes", async ({ page }) => {
  try {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "ghp_preexisting_token" });

    const app = mock(page);
    await app.getByRole("button", { name: "/deckyhub/settings" }).click();
    const tokenField = app.getByLabel("GitHub Token");
    const saveButton = app.getByRole("button", { name: "Save Settings", exact: true });

    await expect(tokenField).toHaveValue("ghp_preexisting_token");
    await expect(saveButton).toBeDisabled();

    await tokenField.fill("ghp_preexisting_token_edited");
    await expect(saveButton).toBeEnabled();
  } finally {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "" });
  }
});

test("Clearing a previously-saved GitHub token removes it from GitHub API requests", async ({ page }) => {
  // "Saving a GitHub token" above already proves the "token set → header
  // sent" half in CI, so this only exercises the other direction, and seeds
  // the starting token via the bridge instead of the Settings UI to keep
  // the step count down. An earlier, heavier version of this test (proving
  // both directions in one test, via full Discover-grid navigation) passed
  // locally every time but hit CI's 30s test timeout twice in a row — this
  // is deliberately the leanest version that still forces a real re-fetch
  // (via "Check for Updates") rather than risking a cache hit that would
  // make the final assertion trivially true regardless of the real fix.
  let authHeader: string | undefined;
  await page.route("https://api.github.com/repos/eugeniosegala/MAKO/releases**", (route) => {
    authHeader = route.request().headers()["authorization"];
    return route.fulfill({ json: [release] });
  });

  try {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "ghp_temp_token" });

    const app = mock(page);
    await app.getByRole("button", { name: "/deckyhub/settings" }).click();
    // Wait for the seeded token to load; clearing the field before that
    // leaves nothing to save, and Save stays disabled.
    await expect(app.getByLabel("GitHub Token")).toHaveValue("ghp_temp_token");
    await app.getByLabel("GitHub Token").fill("");
    const saveButton = app.getByRole("button", { name: "Save Settings", exact: true });
    await saveButton.click();
    await expect(saveButton).toBeDisabled();

    await app.getByRole("button", { name: "/deckyhub/discover" }).click();
    const makoCard = app.getByRole("heading", { name: "MAKO Decky" }).locator("..");
    await makoCard.getByRole("button", { name: "Manage", exact: true }).click();
    const modal = app.locator(".steam-modal");
    await modal.getByRole("button", { name: "Check for Updates", exact: true }).click();
    await expect(modal.getByRole("button", { name: "Download ZIP", exact: true })).toBeVisible();

    expect(authHeader).toBeUndefined();
  } finally {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "" });
  }
});

test("GitHub repository search also sends the saved token", async ({ page }) => {
  let authHeader: string | undefined;
  await page.route("https://api.github.com/search/repositories**", (route) => {
    authHeader = route.request().headers()["authorization"];
    return route.fulfill({ json: { items: [] } });
  });

  try {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "ghp_search_token" });

    const app = mock(page);
    await app.getByRole("button", { name: "/deckyhub/repositories" }).click();
    await app.getByLabel("Search GitHub").fill("some-repo");
    await app.getByRole("button", { name: "Search", exact: true }).click();

    await expect.poll(() => authHeader).toBe("Bearer ghp_search_token");
  } finally {
    await bridgeCall(page, "save_settings", { overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: 3, githubToken: "" });
  }
});

test("Arrow keys move focus through Discover", async ({ page }) => {
  await page.goto("/?preview=/deckyhub/discover&bridge=http://127.0.0.1:8643");
  const app = mock(page);
  const refresh = app.getByRole("button", { name: "Refresh", exact: true });

  await refresh.focus();
  await refresh.press("ArrowDown");
  await expect(app.locator(":focus")).not.toHaveText("Refresh");
  await app.locator(":focus").press("ArrowRight");
  await expect(app.locator(":focus")).toBeVisible();
  await app.locator(":focus").press("ArrowLeft");
  await expect(app.locator(":focus")).toBeVisible();
  await app.locator(":focus").press("ArrowUp");
  await expect(app.locator(":focus")).toBeVisible();
});
