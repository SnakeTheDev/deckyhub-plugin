import { fetchNoCors, toaster } from "@decky/api";
import { getSettings, logFrontend } from "./api";
import { en, type MessageKey, type TFunc } from "./i18n/en";
import type { App, AppReleaseOption, Asset, DeckyHubRelease, DeckyHubReleaseOption, RepoPreference, UpdateChannel } from "./types";

// GitHub's unauthenticated core API allows 60 requests/hour per IP, easy to
// burn through when Discover/Updates check every tracked app. Release lists
// are cached for 30 minutes (one shared entry per repo, see fetchReleases);
// every cache read is bypassed by force=true wherever the user explicitly asks
// to check (Refresh, Check for Updates).
export const CACHE_TTL = 30 * 60 * 1000;
const UPDATE_NOTICE_KEY = "deckyhub-update-notice";
export const DEFAULT_COLUMNS_PER_ROW = 3;
export const pageStyle = { boxSizing: "border-box" as const, height: "100%", overflowY: "auto" as const, padding: "64px 12px 96px", scrollPaddingBottom: 96, scrollPaddingTop: 64, width: "100%" };
// Sizes read CSS variables that fall back to the Default density; the Compact
// setting overrides them on the page root (see applyDensity).
// Centers an icon and its label on one line, whatever the button's width.
export const iconRow = { display: "flex", alignItems: "center", justifyContent: "center", gap: 8 } as const;
export const compactButtonStyle = { ...iconRow, width: "100%", minHeight: "var(--dh-button-height, 36px)", marginBottom: "var(--dh-button-gap, 8px)", padding: "var(--dh-button-padding, 6px 10px)" };
export const modalButtonStyle = { ...iconRow, width: "100%", minHeight: "var(--dh-button-height, 36px)", padding: "var(--dh-button-padding, 6px 10px)" };
export const sectionDividerStyle = { borderTop: "1px solid rgba(255, 255, 255, 0.14)", margin: "var(--dh-divider-margin, 16px) 0" };
export const windowGap = "var(--dh-window-gap, 10px)";
export const gridGap = "var(--dh-grid-gap, 12px)";

const COMPACT_SIZES: Record<string, string> = {
  "--dh-button-height": "28px",
  "--dh-button-padding": "2px 10px",
  "--dh-button-gap": "4px",
  "--dh-divider-margin": "8px",
  "--dh-window-gap": "6px",
  "--dh-grid-gap": "8px",
};

// Applies Display Settings' density to this window and, in Gaming Mode, to the
// main window the Quick Access popup was opened from (where modals render).
export function applyDensity(density: string) {
  let opener: Document | undefined;
  try {
    opener = window.opener?.document;
  } catch {
    // A cross-origin opener isn't ours to style.
  }
  for (const root of [document.documentElement, opener?.documentElement]) {
    if (!root) continue;
    for (const [name, value] of Object.entries(COMPACT_SIZES)) {
      if (density === "compact") root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
  }
}
// Reserves a fixed two-line height so cards in the same grid row stay aligned regardless of description length.
export const cardDescriptionStyle = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical" as const,
  overflow: "hidden",
  minHeight: "2.6em",
  lineHeight: "1.3em",
};

export function substitute(template: string, vars?: Record<string, string | number>) {
  return template.replace(/\{(\w+)\}/g, (match, name) => String(vars?.[name] ?? match));
}

// Messages built outside any component tree (GitHub errors, the updates
// toast) use the locale I18nProvider last resolved — English until then.
let tr: TFunc = (key, vars) => substitute(en[key], vars);

export function setTranslator(t: TFunc) {
  tr = t;
}

// GitHub's unauthenticated REST API allows only 60 requests/hour (10/min for
// search) per device, versus 5,000/hour once a personal access token is set
// in Settings — see setGithubToken(). Held in module scope (not React state)
// since it's read from plain async functions with no component tree of
// their own; every route's I18nProvider primes it from getSettings() on
// mount and re-primes it whenever Settings saves a new one (see i18n/index.tsx).
let githubToken = "";

export function setGithubToken(token: string) {
  githubToken = token.trim();
  // A token lifts the limit that the banner is warning about.
  if (githubToken) reportRateLimit(null, 0);
}

// Latest unauthenticated rate-limit hit, shown by RateLimitBanner on every
// screen that calls GitHub. Module state + a window event rather than React
// state, since githubResponseError() below has no component tree.
export const RATE_LIMIT_CHANGED = "deckyhub-rate-limit-changed";
export let rateLimit = { until: 0, minutesKnown: false };

export function reportRateLimit(minutes: number | null, until = Date.now() + (minutes ?? 15) * 60_000) {
  rateLimit = { until, minutesKnown: minutes !== null };
  window.dispatchEvent(new Event(RATE_LIMIT_CHANGED));
}

// No headers unless a token is set: any header makes fetchNoCors a CORS
// preflight to Decky Loader, and on a real Deck those preflights have been
// seen to stall forever (loader never reads them; Chrome's 6-socket pool for
// them fills up), hanging every GitHub call until its timeout. GitHub's
// default response is the same JSON the vnd.github+json Accept asked for.
function githubHeaders(): Record<string, string> {
  return githubToken ? { Authorization: `Bearer ${githubToken}` } : {};
}

// React runs a child's effects before its parent's, so the first GitHub call
// on a route fires before I18nProvider has loaded the saved token. Wait for
// it once here instead of spending that call unauthenticated.
let tokenLoaded: Promise<void> | null = null;

export async function githubFetch(url: string) {
  tokenLoaded ??= getSettings().then((settings) => setGithubToken(settings.githubToken || ""), () => undefined);
  await tokenLoaded;
  return fetchNoCors(url, { headers: githubHeaders(), signal: AbortSignal.timeout(15_000) });
}

// GitHub's REST API is what every fetch in this file hits — unauthenticated
// by default, so a 403/429 here is almost always its rate limit (60 req/hr
// for the core API, 10/min for search; 5,000/hr and 30/min once a token is
// set), not a real access error. The raw "GitHub API returned 403" that
// used to surface gave no indication of that, so pull whatever wait-time
// hint the response actually offers (some responses omit these headers
// entirely — that's fine, the message just degrades to a generic one)
// instead of guessing, and nudge toward adding a token when none is set.
// Writes to DeckyHub's backend log (see Export Logs); never throws.
export const log = (message: string) => void logFrontend(message).catch(() => undefined);

export async function githubResponseError(response: Response): Promise<Error> {
  if (response.status !== 403 && response.status !== 429) return new Error(tr("github.error", { status: response.status }));
  const minutesUntil = (epochSeconds: number) => Math.max(1, Math.ceil((epochSeconds * 1000 - Date.now()) / 60_000));
  const retryAfter = Number(response.headers.get("retry-after"));
  const resetAt = Number(response.headers.get("x-ratelimit-reset"));
  const remaining = response.headers.get("x-ratelimit-remaining");
  const minutes = Number.isFinite(retryAfter) && retryAfter > 0
    ? Math.max(1, Math.ceil(retryAfter / 60))
    : remaining === "0" && Number.isFinite(resetAt) && resetAt > 0
    ? minutesUntil(resetAt)
    : null;
  if (!githubToken) reportRateLimit(minutes);
  const parts = [`${tr("rateLimit.title")}.`, minutes ? tr("rateLimit.retryIn", { minutes }) : tr("rateLimit.retryLater")];
  if (!githubToken) parts.push(tr("rateLimit.howToAvoid"));
  return new Error(parts.join(" "));
}

// GitHub's own quota report for this device (or token). Querying it doesn't
// count against the limit. Only the hourly "core" bucket is returned — that's
// the one release checks drain; search has its own tiny per-minute bucket.
export async function githubCoreQuota(): Promise<{ limit: number; remaining: number; reset: number } | null> {
  const response = await githubFetch("https://api.github.com/rate_limit");
  if (!response.ok) throw await githubResponseError(response);
  return (await response.json()).resources?.core ?? null;
}

export const readableBytes = (bytes = 0) => (bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`);

export const statusKey = (app: App): MessageKey =>
  !app.installedVersion ? "filter.notInstalled" : app.updateAvailable ? "status.updateAvailable" : app.updateAvailable === false ? "status.upToDate" : "filter.installed";

export const statusColor = (app: App) => (app.error ? "#ff6b6b" : !app.installedVersion ? "#8b929a" : app.updateAvailable ? "#f0c33c" : app.updateAvailable === false ? "#6bcb6b" : undefined);

// fetchReleases' localStorage envelope: when it was fetched (for CACHE_TTL)
// and the data. Only successful results are ever written, so a failure never
// "poisons" it. No ETag re-check: If-None-Match is a header, see githubHeaders().
type CacheEntry<T> = { at: number; data: T };

function readCache<T>(key: string): CacheEntry<T> | null {
  try {
    return JSON.parse(localStorage.getItem(key) || "null");
  } catch {
    return null;
  }
}

function writeCache(key: string, data: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // Quota exceeded or storage disabled (private browsing) — caching is a
    // nice-to-have, never worth failing the fetch that already succeeded.
  }
}

export const normalizeVersion = (value: string) => value.trim().replace(/^v/i, "");

// One display format for every version: "v" + the version number, keeping a
// pre-release suffix — "plugin-v3.3.0" → v3.3.0, "Release-0.7.5" → v0.7.5,
// "1.0.3-rc.2" → v1.0.3-rc.2. Anything without a version number is shown as is.
export function displayVersion(value: string) {
  const match = value.match(/(\d+(?:\.\d+)+)(-[0-9A-Za-z.-]+)?/);
  return match ? `v${match[1]}${match[2] ?? ""}` : value;
}

// Shared by both version pickers: label each release with "v" plus
// an "(installed)"/"(latest)" suffix — items[0] is the newest since every
// release-list fetch above sorts by publish date before returning.
export function buildVersionOptions<T extends { tag: string }>(items: T[], installedVersion: string | null | undefined, t: TFunc): { data: string; label: string }[] {
  return items.map((item) => {
    const version = normalizeVersion(item.tag);
    const isInstalled = Boolean(installedVersion) && version === normalizeVersion(installedVersion!);
    const isLatest = items[0]?.tag === item.tag;
    const suffix = isInstalled ? ` (${t("settings.installedLabel")})` : isLatest ? ` (${t("settings.latestLabel")})` : "";
    return { data: item.tag, label: `${displayVersion(item.tag)}${suffix}` };
  });
}

// Decky Loader's PluginInstallType enum (backend enums.py) — passed to the
// global `utilities/install_plugin` route to tell its native installer what
// kind of operation this is.
export const PLUGIN_INSTALL_TYPE = { INSTALL: 0, REINSTALL: 1, UPDATE: 2, DOWNGRADE: 3 } as const;

// The version number and pre-release suffix inside a tag or version string —
// the same part displayVersion() shows: "plugin-v3.3.0" → 3.3.0,
// "1.0.3-rc.2" → 1.0.3 + "rc.2". Null when there's no dotted version number.
function parseVersion(value: string) {
  const match = value.match(/(\d+(?:\.\d+)+)(?:-([0-9A-Za-z.-]+))?/);
  return match ? { release: match[1].split(".").map(Number), prerelease: match[2] ?? null } : null;
}

// A version with no pre-release suffix outranks the same release number with
// one ("1.0.3" > "1.0.3-rc.9"); between two suffixed versions, compare their
// trailing number ("rc.2" > "rc.1"), falling back to plain string order if a
// suffix doesn't end in one (covers anything other than "-rc.N" gracefully).
function comparePrerelease(target: string | null, current: string | null): number {
  if (target === current) return 0;
  if (target === null) return 1;
  if (current === null) return -1;
  const targetNumber = Number(target.match(/(\d+)$/)?.[1]);
  const currentNumber = Number(current.match(/(\d+)$/)?.[1]);
  if (!Number.isNaN(targetNumber) && !Number.isNaN(currentNumber) && targetNumber !== currentNumber) return targetNumber > currentNumber ? 1 : -1;
  return target > current ? 1 : target < current ? -1 : 0;
}

// 1 / -1 / 0 as target is newer / older / the same as current, or null when
// either has no version number. Used for DeckyHub itself and every tracked
// app, so pre-release suffixes count everywhere (rc.1 → rc.2 → final).
function compareVersions(target: string, current: string): number | null {
  const a = parseVersion(target), b = parseVersion(current);
  if (!a || !b) return null;
  for (let i = 0; i < Math.max(a.release.length, b.release.length); i++) {
    const diff = (a.release[i] || 0) - (b.release[i] || 0);
    if (diff) return Math.sign(diff);
  }
  return comparePrerelease(a.prerelease, b.prerelease);
}

export function resolveDeckyHubInstallType(latestVersion: string, installedVersion: string): 1 | 2 | 3 {
  const cmp = compareVersions(latestVersion, installedVersion) ?? 1;
  return cmp > 0 ? PLUGIN_INSTALL_TYPE.UPDATE : cmp < 0 ? PLUGIN_INSTALL_TYPE.DOWNGRADE : PLUGIN_INSTALL_TYPE.REINSTALL;
}

// window.DeckyBackend is Decky Loader's own internal WS bridge, separate from
// this plugin's `@decky/api` connection (which is scoped to this plugin's own
// backend and cannot reach loader-global routes like `utilities/install_plugin`).
// In Gaming Mode the Quick Access Menu renders in its own popup window opened
// via window.open(), where DeckyBackend lives only on window.opener.
declare global {
  interface Window {
    DeckyBackend?: {
      call<Args extends unknown[] = unknown[], Return = unknown>(route: string, ...args: Args): Promise<Return>;
      addEventListener<Args extends unknown[] = unknown[]>(event: string, listener: (...args: Args) => void): void;
      removeEventListener<Args extends unknown[] = unknown[]>(event: string, listener: (...args: Args) => void): void;
    };
  }
}

export const getDeckyBackend = () => window.DeckyBackend ?? window.opener?.DeckyBackend ?? null;

// Hands a verified release ZIP to Decky Loader's own installer — the route the
// Decky Store uses. The loader shows its native confirm/progress dialog and
// does the download, SHA-256 check and install itself.
//
// Plugins that are uninstalled first and then installed fresh instead of
// updated in place. Decky Loader's in-place update uninstalls the old version
// mid-install, which turns its file watcher back on: the watcher starts the new
// version while it's still being installed, and the installer then stops that
// copy seconds into its startup. Unifideck hangs there, and Decky grew to 9.6 GB
// and froze the Deck. A fresh install keeps the watcher off throughout.
const FRESH_INSTALL_PLUGINS = ["Unifideck"];

export const needsFreshInstall = (pluginName: string, installType: number) => installType !== PLUGIN_INSTALL_TYPE.INSTALL && FRESH_INSTALL_PLUGINS.includes(pluginName);

export async function installDeckyPlugin(asset: Asset, pluginName: string, version: string, installType: 0 | 1 | 2 | 3) {
  if (needsFreshInstall(pluginName, installType)) {
    await uninstallDeckyPlugin(pluginName);
    log(`Decky Loader uninstalled ${pluginName} before a fresh install`);
    installType = PLUGIN_INSTALL_TYPE.INSTALL;
  }
  traceDeckyInstall(pluginName);
  return callDeckyLoader("utilities/install_plugin", asset.url, pluginName, normalizeVersion(displayVersion(version)), asset.sha256 ?? "", installType).then((result: unknown) => {
    log(`Decky Loader install_plugin ${pluginName} accepted, waiting for confirm/progress`);
    return result;
  });
}

// Several updates in one go: Decky Loader shows one confirm dialog listing them
// all and installs them in order. Fresh-install plugins need their uninstall
// first, so callers leave them out.
export function updateDeckyPlugins(updates: { asset: Asset; name: string; version: string }[]) {
  return callDeckyLoader(
    "utilities/install_plugins",
    updates.map(({ asset, name, version }) => ({ artifact: asset.url, name, version: normalizeVersion(displayVersion(version)), hash: asset.sha256 ?? "", install_type: PLUGIN_INSTALL_TYPE.UPDATE })),
  );
}

// Logs every stage Decky Loader reports for this install, with elapsed time,
// so deckyhub.log shows where a stuck install stopped. Decky's progress events
// carry no plugin name, so all of them are logged while this one is watched.
function traceDeckyInstall(pluginName: string) {
  const backend = getDeckyBackend();
  if (!backend) return;
  const started = Date.now();
  const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
  // Decky can fail an install without ever sending finish (e.g. a remote_binary
  // download error leaves it at 95%), so warn once its events go quiet.
  // Remote binaries download with no progress events, so that stage gets longer.
  let idleTimer = 0;
  const armIdle = (stage?: string) => {
    window.clearTimeout(idleTimer);
    idleTimer = window.setTimeout(() => {
      log(`Decky install ${pluginName}: no progress after ${elapsed()} — check journalctl -u plugin_loader`);
      toaster.toast({ title: tr("toast.installStalledTitle", { name: pluginName }), body: tr("toast.installStalledBody") });
      stop();
    }, stage?.endsWith("download_remote") ? 120_000 : 45_000);
  };
  const onStart = (name: string) => {
    log(`Decky install start ${name} at ${elapsed()}`);
    if (name === pluginName) armIdle();
  };
  const onInfo = (progress: number, stage: string) => {
    log(`Decky install ${pluginName} ${progress}% ${stage} at ${elapsed()}`);
    armIdle(stage);
  };
  const stop = () => {
    window.clearTimeout(timer);
    window.clearTimeout(idleTimer);
    backend.removeEventListener("loader/plugin_download_start", onStart);
    backend.removeEventListener("loader/plugin_download_info", onInfo);
    backend.removeEventListener("loader/plugin_download_finish", onFinish);
  };
  const onFinish = (name: string) => {
    log(`Decky install finish ${name} at ${elapsed()}`);
    if (name === pluginName) stop();
  };
  // ponytail: fixed 10 min cap; Decky never sends finish after a silent failure.
  const timer = window.setTimeout(() => {
    log(`Decky install ${pluginName}: no finish after ${elapsed()} — check journalctl -u plugin_loader`);
    stop();
  }, 10 * 60 * 1000);
  backend.addEventListener("loader/plugin_download_start", onStart);
  backend.addEventListener("loader/plugin_download_info", onInfo);
  backend.addEventListener("loader/plugin_download_finish", onFinish);
}

// Decky Loader's uninstall deletes the plugin's folder and its settings right
// away, with no dialog of its own — callers must confirm first.
export function uninstallDeckyPlugin(pluginName: string) {
  return callDeckyLoader("utilities/uninstall_plugin", pluginName);
}

function callDeckyLoader(route: string, ...args: unknown[]) {
  const backend = getDeckyBackend();
  log(`Decky Loader ${route} ${JSON.stringify(args)}${backend ? "" : " (loader unavailable)"}`);
  if (!backend) return Promise.reject(new Error(tr("error.loaderUnavailable")));
  return backend.call(route, ...args).catch((error: unknown) => {
    log(`Decky Loader ${route} failed: ${error}`);
    throw error;
  });
}

// What the Manage window can hand to Decky Loader's installer for the selected
// release, if anything: "Update" for an installed Decky plugin when
// the release is newer, "Install" for a registry Decky plugin that isn't
// installed yet. A fresh install has no installed manifest to name it, so it
// uses the detection rule's first name (the plugin's manifest name).
// Releases without a GitHub checksum (assets uploaded before mid-2025) can
// still be installed; Decky Loader skips verification for an empty hash.
export function installAction(app: App, release: { tag: string; assets: Asset[] }): { type: 0 | 1 | 2 | 3; name: string } | null {
  if (!release.assets[0]) return null;
  if (app.pluginName) return { type: resolveDeckyHubInstallType(release.tag, app.installedVersion ?? ""), name: app.pluginName };
  if (!app.installedVersion && app.detect?.type === "decky-plugin") return { type: PLUGIN_INSTALL_TYPE.INSTALL, name: app.detect.names?.[0] ?? app.name };
  return null;
}

function isUpdate(app: App, latest: string | null) {
  if (!app.installedVersion || !latest) return null;
  const cmp = compareVersions(latest, app.installedVersion);
  return cmp === null ? null : cmp > 0;
}

export function installTypeLabel(t: TFunc, type: number, version: string, updateLabel = t("settings.updateTo", { version })) {
  return type === PLUGIN_INSTALL_TYPE.INSTALL
    ? t("appcard.installVersion", { version })
    : type === PLUGIN_INSTALL_TYPE.REINSTALL
    ? t("settings.reinstallTo", { version })
    : type === PLUGIN_INSTALL_TYPE.DOWNGRADE
    ? t("settings.downgradeTo", { version })
    : updateLabel;
}

function matchingAssets(app: App, assets: Asset[], extraInclude: string[] = []): Asset[] {
  const include = [...app.asset.include, ...extraInclude].map((word) => word.toLowerCase());
  const exclude = app.asset.exclude.map((word) => word.toLowerCase());
  return assets.filter((asset) => {
    const name = asset.name.toLowerCase();
    return name.endsWith(".zip") && !exclude.some((word) => name.includes(word)) && (!include.length || include.every((word) => name.includes(word)));
  });
}

export function notifyUpdates(apps: App[]) {
  const updates = apps.filter((app) => app.updateAvailable && app.latestVersion);
  const notice = updates.map((app) => `${app.repo}:${app.latestVersion}`).sort().join("|");
  if (!notice || localStorage.getItem(UPDATE_NOTICE_KEY) === notice) return;
  localStorage.setItem(UPDATE_NOTICE_KEY, notice);
  toaster.toast({ title: tr("toast.updatesAvailable", { count: updates.length }), body: updates.map((app) => `${app.name} (${app.latestVersion})`).join(", ") });
}

// A repo's recent non-draft releases with every asset, newest first — the one
// GitHub fetch behind the cards (hydrate), both version pickers and DeckyHub's
// own update check, cached per repo so they share it. Callers apply their own
// tag/asset filters on top, so a changed filter never serves stale results.
// GitHub's list endpoint isn't reliably sorted newest-first (a just-published
// release has been seen mid-array), so sort by published date here.
type Release = { tag: string; prerelease: boolean; publishedAt: string | null; url: string; assets: Asset[] };

// Lookups for the same repo that overlap share one request.
const inFlight = new Map<string, Promise<Release[]>>();

function fetchReleases(repo: string, force: boolean): Promise<Release[]> {
  const key = `${repo}:${force}`;
  let request = inFlight.get(key);
  if (!request) {
    request = requestReleases(repo, force).finally(() => inFlight.delete(key));
    inFlight.set(key, request);
  }
  return request;
}

async function requestReleases(repo: string, force: boolean): Promise<Release[]> {
  const cacheKey = `deckyhub-releases:${repo}`;
  const cached = readCache<Release[]>(cacheKey);
  if (cached && !force && Date.now() - cached.at < CACHE_TTL) return cached.data;
  let response: Response;
  try {
    response = await githubFetch(`https://api.github.com/repos/${repo}/releases?per_page=20`);
    if (!response.ok) throw await githubResponseError(response);
  } catch (error) {
    // Older releases beat an error card; a rate limit still raises the banner.
    if (cached) return cached.data;
    throw error;
  }
  const body = await response.json();
  const releases: Release[] = (Array.isArray(body) ? body : [])
    .filter((item: any) => !item.draft)
    .map((item: any) => ({
      tag: String(item.tag_name || item.name),
      prerelease: Boolean(item.prerelease),
      publishedAt: item.published_at || null,
      url: item.html_url || `https://github.com/${repo}/releases`,
      assets: (item.assets || []).map((asset: any) => ({ name: String(asset.name || ""), url: asset.browser_download_url, size: asset.size || 0, sha256: String(asset.digest || "").replace(/^sha256:/, "") || undefined })),
    }))
    .sort((a: Release, b: Release) => (Date.parse(b.publishedAt || "") || 0) - (Date.parse(a.publishedAt || "") || 0));
  writeCache(cacheKey, releases);
  return releases;
}

// A failed lookup becomes an empty list plus the error, for the caller to show.
function listOrError<T>(items: Promise<T[]>): Promise<{ items: T[]; error?: string }> {
  return items.then((items) => ({ items }), (error) => {
    log(`Release lookup failed: ${error}`);
    return { items: [], error: String(error) };
  });
}

// DeckyHub's own recent releases (both channels) for its update window's
// version picker, each with its DeckyHub-*.zip only when it carries a SHA-256
// — Decky Loader's installer needs one to verify the download.
export function listDeckyHubReleases(force = false): Promise<{ items: DeckyHubReleaseOption[]; error?: string }> {
  return listOrError(fetchReleases("mazillka/deckyhub-plugin", force).then((releases) => releases.map(({ assets, ...release }) => ({
    ...release,
    asset: assets.find((asset) => /^DeckyHub-.*\.zip$/i.test(asset.name) && /^[0-9a-f]{64}$/i.test(asset.sha256 ?? "")),
  }))));
}

// Newest release on the given channel for the QAM "Update" button.
export async function latestDeckyHubRelease(channel: UpdateChannel): Promise<DeckyHubRelease> {
  const { items, error } = await listDeckyHubReleases();
  const release = items.find((item) => item.prerelease === (channel === "prerelease"));
  return release?.asset ? { version: release.tag, asset: release.asset } : { error: error ?? tr("release.noChecksum") };
}

// A tracked app's recent releases (tag-filtered, assets matched to its
// filters) for its version picker in AppDetailsModal.
export function listAppReleases(app: App, preference?: RepoPreference, force = false): Promise<{ items: AppReleaseOption[]; error?: string }> {
  const tagInclude = app.releaseTagInclude?.toLowerCase();
  return listOrError(fetchReleases(app.repo, force).then((releases) => releases
    .filter((release) => !tagInclude || release.tag.toLowerCase().includes(tagInclude))
    .map((release) => ({ ...release, assets: matchingAssets(app, release.assets, preference?.assetFilter) }))));
}

// Fills in a card's latest release for its channel and whether it's newer
// than what's installed.
export async function hydrate(app: App, force: boolean, preference?: RepoPreference): Promise<App> {
  const channel: UpdateChannel = preference?.channel ?? "stable";
  const { items, error } = await listAppReleases(app, preference, force);
  const release = items.find((item) => item.prerelease === (channel === "prerelease"));
  if (!release) return { ...app, channel, error: error ?? tr("release.noMatch") };
  return {
    ...app,
    channel,
    latestVersion: release.tag,
    publishedAt: release.publishedAt,
    releaseUrl: release.url,
    assets: release.assets,
    updateAvailable: isUpdate(app, release.tag),
  };
}
