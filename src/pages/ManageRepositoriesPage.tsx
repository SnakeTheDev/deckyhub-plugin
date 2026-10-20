import { FileSelectionType, openFilePicker, toaster } from "@decky/api";
import { DialogButtonPrimary as Button, ConfirmModal, DropdownItem, Focusable, PanelSection, PanelSectionRow, showModal, TextField } from "@decky/ui";
import { FocusableGrid } from "../components/FocusableGrid";
import { KeepInView } from "../components/KeepInView";
import { Pager } from "../components/Pager";
import { RateLimitBanner } from "../components/RateLimitBanner";
import { useEffect, useState } from "react";
import { FaCheck, FaFileExport, FaFileImport, FaPlus, FaRedo, FaSearch, FaTimes, FaTrash } from "react-icons/fa";
import { addCustomRegistry, addCustomRepo, exportCustomRepos, getApps, getCustomRegistries, getCustomRepos, importCustomRepos, REGISTRY_UPDATED, refreshRegistry, removeCustomRegistry, removeCustomRepo } from "../api";
import { useT } from "../i18n";
import type { MessageKey } from "../i18n/en";
import type { ManagedRegistry, SearchRepo } from "../types";
import { compactButtonStyle, githubFetch, githubResponseError, isRepositoryName, log, registryLabel, registryUrlForRepo, sectionDividerStyle } from "../utils";

const RESULTS_PER_PAGE = 5;

// How the user points at a registry: a GitHub "owner/repo" (expanded to the raw
// URL by registryUrlForRepo), or any full HTTPS URL to a registry .json file.
type RegistrySource = "repo" | "url";

// The backend reports why an add didn't work as a reason code rather than raising,
// so a mistyped URL never surfaces a Python exception. Keys are literal so the
// map stays in step with MessageKey.
const REGISTRY_ERROR: Record<string, MessageKey> = {
  "invalid-url": "repos.errInvalidUrl",
  official: "repos.errOfficial",
  "already-added": "repos.registryAlreadyAdded",
  "too-many": "repos.errTooMany",
  "not-found": "repos.errNotFound",
  "not-registry": "repos.errNotRegistry",
  "ssl-error": "repos.errSsl",
  unreachable: "repos.errUnreachable",
  "nothing-new": "repos.errNothingNew",
};

export function ManageRepositoriesPage() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchRepo[]>([]);
  const [page, setPage] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [customRepos, setCustomRepos] = useState<string[]>([]);
  const [existingRepos, setExistingRepos] = useState<Set<string>>(new Set());
  const [registries, setRegistries] = useState<ManagedRegistry[]>([]);
  const [registrySource, setRegistrySource] = useState<RegistrySource>("repo");
  const [registryValue, setRegistryValue] = useState("");
  const [registryBusy, setRegistryBusy] = useState(false);
  const [showUrls, setShowUrls] = useState(false);


  const refreshRepos = () => {
    void getCustomRepos().then((result) => setCustomRepos(result.repos));
    void getCustomRegistries().then((result) => setRegistries(result.registries));
    void getApps().then((result) => setExistingRepos(new Set(result.apps.map((app) => app.repo.toLowerCase()))));
  };

  useEffect(() => {
    refreshRepos();
  }, []);

  const search = async () => {
    if (!query.trim() || searching) return;
    setSearching(true);
    try {
      setSearchError(null);
      const response = await githubFetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=25`);
      if (!response.ok) throw await githubResponseError(response);
      setResults((await response.json()).items || []);
      setPage(0);
    } catch (error) {
      log(`Repository search failed: ${error}`);
      setSearchError(String(error));
    } finally {
      setSearching(false);
    }
  };

  // Backend refusals (e.g. a file outside /home/deck) come back as errors
  // carrying their reason; show it instead of failing silently.
  const showError = (error: unknown) => {
    log(`Repository action failed: ${error}`);
    toaster.toast({ title: "DeckyHub", body: String(error) });
  };

  const add = async (repo: string) => {
    const result = await addCustomRepo(repo);
    if (result.added) {
      setExistingRepos((current) => new Set(current).add(repo.toLowerCase()));
      refreshRepos();
      window.dispatchEvent(new Event(REGISTRY_UPDATED));
    }
    toaster.toast({ title: "DeckyHub", body: t(result.added ? "repos.addedToast" : "repos.alreadyAdded", { repo }) });
  };

  const remove = async (repo: string) => {
    await removeCustomRepo(repo);
    refreshRepos();
    window.dispatchEvent(new Event(REGISTRY_UPDATED));
  };

  const confirmRemove = (repo: string) =>
    showModal(
      <ConfirmModal
        strTitle={t("repos.removeRepositoryTitle")}
        strDescription={t("repos.removeRepositoryDesc", { repo })}
        strOKButtonText={t("repos.removeConfirm")}
        bDestructiveWarning
        onOK={() => void remove(repo).catch(showError)}
      />
    );

  const addRegistry = async () => {
    const value = registryValue.trim();
    if (!value || registryBusy) return;
    if (registrySource === "repo" && !isRepositoryName(value)) {
      toaster.toast({ title: "DeckyHub", body: t("repos.badRepoFormat", { value }) });
      return;
    }
    setRegistryBusy(true);
    try {
      const url = registrySource === "repo" ? registryUrlForRepo(value) : value;
      const result = await addCustomRegistry(url);
      if (result.added) {
        setRegistryValue("");
        refreshRepos();
        window.dispatchEvent(new Event(REGISTRY_UPDATED));
        toaster.toast({ title: "DeckyHub", body: t("repos.registryAdded", { apps: result.apps ?? 0 }) });
        return;
      }
      const key = REGISTRY_ERROR[result.reason ?? ""];
      // Decky's toaster truncates a long body, so the toast stays a short sentence and
      // the technical reason goes to the DeckyHub log instead (see log_frontend).
      if (result.detail) log(`Registry add rejected (${result.reason}) for ${url}: ${result.detail}`);
      toaster.toast({ title: "DeckyHub", body: key ? t(key, { limit: result.detail ?? "10" }) : t("repos.registryFailed") });
    } catch (error) {
      log(`Adding registry failed: ${error}`);
      toaster.toast({ title: "DeckyHub", body: t("repos.registryFailed") });
    } finally {
      setRegistryBusy(false);
    }
  };

  const removeRegistry = async (url: string) => {
    try {
      await removeCustomRegistry(url);
    } catch (error) {
      log(`Removing registry failed: ${error}`);
      toaster.toast({ title: "DeckyHub", body: t("repos.registryFailed") });
    }
    refreshRepos();
    window.dispatchEvent(new Event(REGISTRY_UPDATED));
  };

  const confirmRemoveRegistry = (url: string) =>
    showModal(
      <ConfirmModal
        strTitle={t("repos.removeRegistryTitle")}
        strDescription={t("repos.removeRegistryDesc", { url })}
        strOKButtonText={t("repos.removeConfirm")}
        bDestructiveWarning
        onOK={() => void removeRegistry(url)}
      />
    );

  const reloadRegistries = async () => {
    if (registryBusy) return;
    setRegistryBusy(true);
    try {
      await refreshRegistry();
      refreshRepos();
      window.dispatchEvent(new Event(REGISTRY_UPDATED));
    } catch (error) {
      log(`Refreshing registries failed: ${error}`);
      toaster.toast({ title: "DeckyHub", body: t("repos.registryFailed") });
    } finally {
      setRegistryBusy(false);
    }
  };

  const exportList = async () => {
    const result = await exportCustomRepos();
    toaster.toast({ title: "DeckyHub", body: t("repos.exportedTo", { path: result.path }) });
  };

  const importList = async () => {
    let file: { realpath: string };
    try {
      file = await openFilePicker(FileSelectionType.FILE, "/home/deck/Downloads", true, false, undefined, ["json"]);
    } catch {
      return; // Picker closed without a file.
    }
    const result = await importCustomRepos(file.realpath);
    refreshRepos();
    if (result.added.length) window.dispatchEvent(new Event(REGISTRY_UPDATED));
    toaster.toast({ title: "DeckyHub", body: result.added.length ? t("repos.imported", { repos: result.added.join(", ") }) : t("repos.nothingToImport") });
  };

  return (
    <>
      <RateLimitBanner />
      <KeepInView>
        <PanelSection title={t("repos.addGithubRepository")}>
          <PanelSectionRow>
            <Focusable flow-children="right" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TextField label={t("repos.searchGithub")} value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
              </div>
              <div style={{ flex: "0 0 160px", paddingTop: 24 }}>
                <Button style={compactButtonStyle} onClick={() => void search()} disabled={searching}>
                  <FaSearch /> {searching ? t("repos.searching") : t("filter.search")}
                </Button>
              </div>
              <div style={{ flex: "0 0 120px", paddingTop: 24 }}>
                <Button
                  style={compactButtonStyle}
                  onClick={() => {
                    setQuery("");
                    setResults([]);
                    setSearchError(null);
                    setPage(0);
                  }}
                >
                  <FaTimes /> {t("repos.clear")}
                </Button>
              </div>
            </Focusable>
          </PanelSectionRow>
          {searchError && <PanelSectionRow>{searchError}</PanelSectionRow>}
          {results.length > RESULTS_PER_PAGE && (
            <PanelSectionRow>
              <Pager page={page} total={Math.ceil(results.length / RESULTS_PER_PAGE)} onChange={setPage} />
            </PanelSectionRow>
          )}
        </PanelSection>
      </KeepInView>
      {results.length > 0 && (
        <>
          <div aria-hidden style={sectionDividerStyle} />
          <FocusableGrid items={results.slice(page * RESULTS_PER_PAGE, page * RESULTS_PER_PAGE + RESULTS_PER_PAGE)} columns={2} keyFor={(repo) => repo.full_name}>
            {(repo) => {
              const added = existingRepos.has(repo.full_name.toLowerCase());
              return (
                <PanelSection title={repo.full_name}>
                  <PanelSectionRow>
                    <small>
                      {repo.description || t("repos.noDescription")} · ★ {repo.stargazers_count ?? 0}
                    </small>
                  </PanelSectionRow>
                  <PanelSectionRow>
                    <Button style={compactButtonStyle} disabled={added} onClick={() => void add(repo.full_name).catch(showError)}>
                      {added ? <FaCheck /> : <FaPlus />} {added ? t("repos.added") : t("repos.add")}
                    </Button>
                  </PanelSectionRow>
                </PanelSection>
              );
            }}
          </FocusableGrid>
        </>
      )}

      <div aria-hidden style={sectionDividerStyle} />

      <KeepInView>
        <PanelSection title={t("repos.managedRepositories")}>
          <PanelSectionRow>
            <Focusable flow-children="right" style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Button style={compactButtonStyle} onClick={() => void exportList().catch(showError)}>
                  <FaFileExport /> {t("repos.export")}
                </Button>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Button style={compactButtonStyle} onClick={() => void importList().catch(showError)}>
                  <FaFileImport /> {t("repos.import")}
                </Button>
              </div>
            </Focusable>
          </PanelSectionRow>
          {customRepos.map((repo) => (
            <PanelSectionRow key={repo}>
              <Button style={compactButtonStyle} onClick={() => confirmRemove(repo)}>
                <FaTrash /> {t("repos.remove", { repo })}
              </Button>
            </PanelSectionRow>
          ))}
          {!customRepos.length && <PanelSectionRow>{t("repos.noCustomRepos")}</PanelSectionRow>}
        </PanelSection>
      </KeepInView>

      <div aria-hidden style={sectionDividerStyle} />

      <KeepInView>
        <PanelSection title={t("repos.customRegistries")}>
          <PanelSectionRow>
            <DropdownItem
              layout="inline"
              bottomSeparator="none"
              label={t("repos.addFrom")}
              rgOptions={[
                { label: t("repos.addFromRepo"), data: "repo" },
                { label: t("repos.addFromUrl"), data: "url" },
              ]}
              selectedOption={registrySource}
              onChange={({ data }) => setRegistrySource(String(data) as RegistrySource)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <Focusable flow-children="right" style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TextField
                  label={registrySource === "repo" ? t("repos.registryRepo") : t("repos.registryUrl")}
                  value={registryValue}
                  onChange={(event) => setRegistryValue(event.currentTarget.value)}
                />
              </div>
              <div style={{ flex: "0 0 160px", paddingTop: 24 }}>
                <Button style={compactButtonStyle} onClick={() => void addRegistry()} disabled={registryBusy}>
                  <FaPlus /> {registryBusy ? t("repos.registryLoading") : t("repos.addRegistry")}
                </Button>
              </div>
            </Focusable>
          </PanelSectionRow>
          {registries.length > 0 && (
            <PanelSectionRow>
              <Focusable flow-children="right" style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Button style={compactButtonStyle} disabled={registryBusy} onClick={() => void reloadRegistries()}>
                    <FaRedo /> {t("repos.refreshRegistries")}
                  </Button>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <DropdownItem
                    layout="inline"
                    bottomSeparator="none"
                    label={t("repos.showAs")}
                    rgOptions={[
                      { label: t("repos.showAsName"), data: "name" },
                      { label: t("repos.showAsUrl"), data: "url" },
                    ]}
                    selectedOption={showUrls ? "url" : "name"}
                    onChange={({ data }) => setShowUrls(String(data) === "url")}
                  />
                </div>
              </Focusable>
            </PanelSectionRow>
          )}
          {registries.map((item) => (
            <PanelSectionRow key={item.url}>
              <Focusable flow-children="right" style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{showUrls ? item.url : registryLabel(item.url)}</div>
                <div style={{ flex: "0 0 120px" }}>
                  <Button style={compactButtonStyle} onClick={() => confirmRemoveRegistry(item.url)}>
                    <FaTrash /> {t("repos.removeRegistry")}
                  </Button>
                </div>
              </Focusable>
            </PanelSectionRow>
          ))}
          {!registries.length && <PanelSectionRow>{t("repos.noCustomRegistries")}</PanelSectionRow>}
        </PanelSection>
      </KeepInView>
    </>
  );
}
