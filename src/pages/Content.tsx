import { toaster } from "@decky/api";
import { DialogButtonPrimary as Button, Dropdown, Focusable, Navigation, PanelSection, PanelSectionRow, Spinner, TextField } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaArrowCircleUp, FaArrowLeft, FaArrowRight, FaCog, FaFileExport, FaListUl, FaSearch, FaSync, FaTimes, FaArrowUp } from "react-icons/fa";
import { downloadAsset, exportLogs, getApps, getSettings, REGISTRY_UPDATED } from "../api";
import { useT } from "../i18n";
import type { App, Asset, HideableButton, RepoPreference, UpdateChannel, View } from "../types";
import { compactButtonStyle, DEFAULT_COLUMNS_PER_ROW, getDeckyBackend, hydrate, installAction, log, needsFreshInstall, notifyUpdates, PLUGIN_INSTALL_TYPE, sectionDividerStyle, updateDeckyPlugins } from "../utils";
import { AppCard } from "../components/AppCard";
import { CleanupSection } from "../components/CleanupSection";
import { showDownloadModal } from "../components/DownloadProgress";
import { FocusableGrid } from "../components/FocusableGrid";
import { RateLimitBanner } from "../components/RateLimitBanner";
import { DeckyHubUpdate } from "../components/DeckyHubUpdate";

// ponytail: fixed pool of 8 GitHub requests in flight; lower it if the registry grows
// big enough to trip GitHub's secondary (burst) rate limit.
const RELEASE_CONCURRENCY = 8;
const CARDS_PER_PAGE = 20;

const NAV_LINKS = [["updates", FaArrowCircleUp], ["discover", FaSearch], ["repositories", FaListUl], ["settings", FaCog]] as const;

const countBadgeStyle = { minWidth: "1.5em", padding: "0 6px", borderRadius: 999, background: "#f0c33c", color: "#1a1a1a", fontSize: "0.8em", fontWeight: 700, lineHeight: "1.5em", textAlign: "center" as const };

export function Content({ fullPage }: { fullPage?: View }) {
  const t = useT();
  const [apps, setApps] = useState<App[]>([]);
  const view: View = fullPage ?? "updates";
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [query, setQuery] = useState("");
  const [installedFilter, setInstalledFilter] = useState("All");
  const [cardPage, setCardPage] = useState(0);
  const [columnsPerRow, setColumnsPerRow] = useState(DEFAULT_COLUMNS_PER_ROW);
  const [repoPreferences, setRepoPreferences] = useState<Record<string, RepoPreference>>({});
  const [hiddenButtons, setHiddenButtons] = useState<HideableButton[]>([]);
  const [updatingAll, setUpdatingAll] = useState(false);
  const quickAccessRef = useRef<HTMLDivElement>(null);

  const info = view === "updates"
    ? { title: t("nav.updates"), description: t("view.updatesDescription"), empty: t("view.updatesEmpty") }
    : { title: t("nav.discover"), description: t("view.discoverDescription"), empty: t("view.discoverEmpty") };

  // Bumped per load() so a slower, older load can't overwrite a newer one.
  const loadRun = useRef(0);

  const load = async (force = false) => {
    const run = ++loadRun.current;
    setLoading(true);
    try {
      const [appData, settings] = await Promise.all([getApps(), getSettings()]);
      const local = appData.apps;
      const preferences = settings.repoSettings || {};
      setRepoPreferences(preferences);
      setColumnsPerRow(settings.columnsPerRow || DEFAULT_COLUMNS_PER_ROW);
      setHiddenButtons(settings.hiddenButtons ?? []);
      const tracked = view === "updates" ? local.filter((app) => app.installedVersion) : local;
      setCardPage(0);
      setApps(tracked);
      setLoadError(null);
      // Discover shows every card straight away and fills each in as its
      // release arrives; Updates waits, since it lists only apps with an update.
      if (view === "discover") setLoading(false);
      const hydrated = [...tracked];
      let next = 0;
      // A rolling pool: each finished request starts the next, rather than
      // waiting for the slowest one in a fixed batch.
      const worker = async () => {
        while (next < tracked.length) {
          const index = next++;
          hydrated[index] = await hydrate(tracked[index], force, preferences[tracked[index].repo]);
          if (run === loadRun.current) setApps((current) => current.map((app) => (app.id === hydrated[index].id ? hydrated[index] : app)));
        }
      };
      await Promise.all(Array.from({ length: Math.min(RELEASE_CONCURRENCY, tracked.length) }, worker));
      if (run !== loadRun.current) return;
      setLoading(false);
      notifyUpdates(hydrated);
    } catch (error) {
      log(`Loading apps failed: ${error}`);
      setLoadError(String(error));
      setLoading(false);
    }
  };

  useEffect(() => {
    // Automatic refreshes go through the release cache; only the Refresh and
    // Check for Updates buttons force a fresh fetch.
    const refresh = () => void load();
    void load();
    const timer = window.setInterval(refresh, 15 * 60 * 1000);
    window.addEventListener(REGISTRY_UPDATED, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(REGISTRY_UPDATED, refresh);
    };
  }, []);

  // Decky Loader reports when an install it ran finishes; reload so the card
  // picks up the new installed version (release data stays cached).
  useEffect(() => {
    const backend = getDeckyBackend();
    if (!backend) return;
    const onFinish = () => void load();
    backend.addEventListener("loader/plugin_download_finish", onFinish);
    return () => backend.removeEventListener("loader/plugin_download_finish", onFinish);
  }, []);

  useEffect(() => {
    if (!fullPage) requestAnimationFrame(() => quickAccessRef.current?.scrollIntoView({ block: "start" }));
  }, [fullPage]);

  // Resolves once the download settles (or its window closes), so the Manage
  // window, which can't see this component's state, can re-enable its buttons.
  const startDownload = async (asset: Asset, repo?: string) => {
    try {
      const result = await downloadAsset(asset, repo);
      if (result.error) throw new Error(result.error);
      if (!result.jobId) return;
      setDownloading(true);
      await new Promise<void>((resolve) =>
        showDownloadModal(t, result.jobId!, { state: "queued", filename: asset.name, total: asset.size }, (state) => {
          setDownloading(false);
          if (state.state === "error") toaster.toast({ title: t("dl.failedTitle"), body: state.error || t("dl.failedNoReason") });
          resolve();
        }),
      );
    } catch (error) {
      toaster.toast({ title: "DeckyHub", body: String(error) });
    }
  };

  // AppDetailsModal persists the change itself (saveRepoSettings); this just
  // keeps the card's "Channel: …" label and the cached preference in sync
  // without a full reload.
  const changeAppChannel = (repo: string, channel: UpdateChannel) => {
    setRepoPreferences((current) => ({ ...current, [repo]: { channel, assetFilter: current[repo]?.assetFilter ?? [] } }));
    setApps((current) => current.map((app) => (app.repo === repo ? { ...app, channel } : app)));
  };

  const discoverFilters = view === "discover" && (
    <PanelSection>
      <PanelSectionRow>
        <Focusable flow-children="right" style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <TextField label={t("filter.search")} value={query} onChange={(event) => { setQuery(event.currentTarget.value); setCardPage(0); }} />
          </div>
          <div style={{ flex: "0 0 220px" }}>
            <div style={{ fontSize: "0.85em" }}>
              <div style={{ marginBottom: 4 }}>{t("filter.status")}</div>
              <Dropdown
                {...({ "aria-label": t("filter.status"), style: { width: "100%" } } as any)}
                menuLabel={t("filter.status")}
              rgOptions={[
                { label: t("filter.all"), data: "All" },
                { label: t("filter.installed"), data: "Installed" },
                { label: t("filter.notInstalled"), data: "Not Installed" },
              ]}
              selectedOption={installedFilter}
              onChange={({ data }) => { setInstalledFilter(data); setCardPage(0); }}
              />
            </div>
          </div>
        </Focusable>
      </PanelSectionRow>
    </PanelSection>
  );

  const visibleApps = apps.filter((app) =>
    view === "updates"
      ? app.updateAvailable === true
      : (!query || `${app.name} ${app.repo}`.toLowerCase().includes(query.toLowerCase())) &&
        (installedFilter === "All" || (installedFilter === "Installed") === Boolean(app.installedVersion)),
  );
  // Decky plugins the Updates page can update in one batch (see updateDeckyPlugins).
  const batchUpdates = view === "updates" && !hiddenButtons.includes("update")
    ? visibleApps.flatMap((app) => {
        const action = app.latestVersion ? installAction(app, { tag: app.latestVersion, assets: app.assets }) : null;
        return action?.type === PLUGIN_INSTALL_TYPE.UPDATE && !needsFreshInstall(action.name, action.type) ? [{ asset: app.assets[0], name: action.name, version: app.latestVersion! }] : [];
      })
    : [];
  const updateAll = () => {
    setUpdatingAll(true);
    void updateDeckyPlugins(batchUpdates)
      .catch((error: unknown) => toaster.toast({ title: "DeckyHub", body: String(error) }))
      .finally(() => setUpdatingAll(false));
  };
  const pageCount = Math.max(1, Math.ceil(visibleApps.length / CARDS_PER_PAGE));
  const currentPage = Math.min(cardPage, pageCount - 1);
  const displayedApps = visibleApps.slice(currentPage * CARDS_PER_PAGE, (currentPage + 1) * CARDS_PER_PAGE);
  const page = (
      <>
      {loading && (
        <PanelSection>
          <PanelSectionRow>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, minHeight: "50vh" }}>
              <Spinner style={{ width: "1.1em" }} /> {t("content.loading")}
            </div>
          </PanelSectionRow>
        </PanelSection>
      )}
      {loadError && (
        <PanelSection title={t("content.loadErrorTitle")}>
          <PanelSectionRow>{loadError}</PanelSectionRow>
          <PanelSectionRow>
            <Button style={compactButtonStyle} onClick={() => void load(true)}>
              <FaSync /> {t("content.tryAgain")}
            </Button>
          </PanelSectionRow>
        </PanelSection>
      )}
      {!loading && !loadError && (
        <>
          <PanelSection title={info.title}>
            <PanelSectionRow>
              <Focusable flow-children="right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                {info.description && <div style={{ flex: 1, minWidth: 0 }}>{info.description}</div>}
                <div style={{ flex: info.description ? "0 0 180px" : 1 }}>
                  <Button style={compactButtonStyle} onClick={() => void load(true)}>
                    <FaSync /> {t("content.refresh")}
                  </Button>
                </div>
                {batchUpdates.length > 1 && (
                  <div style={{ flex: 1 }}>
                    <Button style={compactButtonStyle} disabled={updatingAll} onClick={updateAll}>
                      <FaArrowUp /> {t("content.updateAll", { count: batchUpdates.length })}
                    </Button>
                  </div>
                )}
              </Focusable>
            </PanelSectionRow>
          </PanelSection>
          <div aria-hidden style={sectionDividerStyle} />
          {discoverFilters}
          {discoverFilters && <div aria-hidden style={sectionDividerStyle} />}
          <FocusableGrid
            items={displayedApps}
            columns={fullPage ? columnsPerRow : 1}
            keyFor={(app) => app.id}
          >
            {(app) => (
              <AppCard
                app={app}
                preference={repoPreferences[app.repo] ?? { channel: "stable", assetFilter: [] }}
                downloadDisabled={downloading}
                hiddenButtons={hiddenButtons}
                onDownload={(asset) => startDownload(asset, app.repo)}
                onChannelChange={changeAppChannel}
                onUninstalled={() => void load()}
              />
            )}
          </FocusableGrid>
          {visibleApps.length > CARDS_PER_PAGE && (
            <PanelSection>
              <PanelSectionRow>
                <Focusable flow-children="right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <Button style={compactButtonStyle} disabled={currentPage === 0} onClick={() => setCardPage((current) => current - 1)}>
                      <FaArrowLeft /> {t("repos.previous")}
                    </Button>
                  </div>
                  <span style={{ whiteSpace: "nowrap" }}>{t("repos.pageOf", { page: currentPage + 1, total: pageCount })}</span>
                  <div style={{ flex: 1 }}>
                    <Button style={compactButtonStyle} disabled={currentPage + 1 === pageCount} onClick={() => setCardPage((current) => current + 1)}>
                      {t("repos.next")} <FaArrowRight />
                    </Button>
                  </div>
                </Focusable>
              </PanelSectionRow>
            </PanelSection>
          )}
          {!visibleApps.length && (
            <div className="deckyhub-empty" style={{ textAlign: "center" }}>
              {/* Decky's section title is a left-aligned flex row; center it too. */}
              <style>{".deckyhub-empty div { text-align: center; justify-content: center; }"}</style>
              <PanelSection title={info.empty}>
                {view === "updates" ? (
                  <PanelSectionRow>
                    <Button style={compactButtonStyle} onClick={() => Navigation.Navigate("/deckyhub/discover")}>
                      <FaSearch /> {t("nav.discover")}
                    </Button>
                  </PanelSectionRow>
                ) : (query || installedFilter !== "All") && (
                  <PanelSectionRow>
                    <Button style={compactButtonStyle} onClick={() => { setQuery(""); setInstalledFilter("All"); }}>
                      <FaTimes /> {t("repos.clear")}
                    </Button>
                  </PanelSectionRow>
                )}
              </PanelSection>
            </div>
          )}
        </>
      )}
      </>
  );

  // The Quick Access view loads installed apps the same way the Updates page does.
  const updateCount = apps.filter((app) => app.updateAvailable).length;
  const navigation = (
    <>
      <PanelSection>
        {NAV_LINKS.map(([page, Icon]) => (
          <PanelSectionRow key={page}>
            <Button style={compactButtonStyle} onClick={() => Navigation.Navigate(`/deckyhub/${page}`)}>
              <Icon /> {t(`nav.${page}`)}
              {page === "updates" && updateCount > 0 && <span style={countBadgeStyle}>{updateCount}</span>}
            </Button>
          </PanelSectionRow>
        ))}
      </PanelSection>
      <div aria-hidden style={sectionDividerStyle} />
      <DeckyHubUpdate />
      <CleanupSection />
      <div aria-hidden style={sectionDividerStyle} />
      <PanelSection title={t("settings.troubleshooting")}>
        <PanelSectionRow>
          <Button style={compactButtonStyle} onClick={() => void exportLogs().then(({ path }) => toaster.toast({ title: "DeckyHub", body: t("repos.exportedTo", { path }) }))}>
            <FaFileExport /> {t("settings.exportLogs")}
          </Button>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={{ color: "#8fcef4", fontSize: "0.85em" }}>{t("settings.exportLogsNote")}</div>
        </PanelSectionRow>
      </PanelSection>
    </>
  );

  return fullPage ? (
    <>
      <RateLimitBanner />
      {page}
    </>
  ) : (
    <div ref={quickAccessRef}>
      <RateLimitBanner />
      {navigation}
    </div>
  );
}
