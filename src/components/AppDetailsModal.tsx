import { toaster } from "@decky/api";
import { DialogButtonPrimary as Button, ConfirmModal, ModalRoot, Navigation, showModal } from "@decky/ui";
import { useState } from "react";
import { FaArrowDown, FaArrowUp, FaFileArchive, FaPlus, FaRedo, FaTimes, FaTrash } from "react-icons/fa";
import { saveRepoSettings } from "../api";
import type { TFunc } from "../i18n/en";
import type { App, AppReleaseOption, Asset, HideableButton, RepoPreference, UpdateChannel } from "../types";
import { buildVersionOptions, getDeckyBackend, installAction, installDeckyPlugin, installTypeLabel, listAppReleases, modalButtonStyle, needsFreshInstall, PLUGIN_INSTALL_TYPE, readableBytes, sectionDividerStyle, uninstallDeckyPlugin, windowGap } from "../utils";
import { displayVersion } from "../version";
import { ReleaseActions, useReleasePicker, VersionPickerPanel } from "./VersionPickerPanel";

// Hands one release to Decky Loader's installer, shared by this window and the
// card's quick Install/Update. installDeckyPlugin() uninstalls fresh-install
// plugins first, before Decky's own dialog appears, so cancelling that dialog
// would leave the plugin uninstalled — say so before starting.
export function startPluginInstall(t: TFunc, appName: string, asset: Asset, tag: string, action: { name: string; type: 0 | 1 | 2 | 3 }, label: string, onStarted?: () => void): Promise<void> {
  if (!getDeckyBackend()) {
    toaster.toast({ title: "DeckyHub", body: t("settings.selfUpdateUnavailable") });
    return Promise.resolve();
  }
  // Settles once Decky has the request (its own dialog is up) or it failed.
  const start = () => {
    const request = installDeckyPlugin(asset, action.name, tag, action.type).then(
      () => undefined,
      (error: unknown) => void toaster.toast({ title: "DeckyHub", body: String(error) }),
    );
    onStarted?.();
    return request;
  };
  if (!needsFreshInstall(action.name, action.type)) return start();
  return new Promise((resolve) =>
    showModal(<ConfirmModal strTitle={`${label}?`} strDescription={t("appcard.freshInstallDescription", { name: appName })} strOKButtonText={label} onOK={() => void start().then(resolve)} onCancel={() => resolve()} />),
  );
}

// showModal() mounts onto a separate root from the caller's tree (see the
// same note on DeckyHubUpdateModal), so `t` must be a resolved function
// passed in from AppCard — calling useT() here throws on mount.
export function AppDetailsModal({
  t,
  app,
  preference: initialPreference,
  downloadDisabled,
  hiddenButtons,
  onDownload,
  onChannelChange,
  onUninstalled,
  closeModal,
}: {
  t: TFunc;
  app: App;
  preference: RepoPreference;
  downloadDisabled?: boolean;
  hiddenButtons: HideableButton[];
  onDownload: (asset: Asset) => Promise<void>;
  onChannelChange: (channel: UpdateChannel) => void;
  onUninstalled: () => void;
  closeModal?: () => void;
}) {
  const [channel, setChannel] = useState<UpdateChannel>(initialPreference.channel);
  const { items: releases, selectedTag, setSelectedTag, loading, error: fetchError, load, selected: selectedRelease } = useReleasePicker((force) => listAppReleases(app, initialPreference, force), channel);
  // Every action but Check for Updates and Download ZIP closes this window.
  // This modal was rendered once by showModal(), so the downloadDisabled prop
  // never updates — track downloads started from here locally.
  const [downloading, setDownloading] = useState(Boolean(downloadDisabled));
  const download = (asset: Asset) => {
    setDownloading(true);
    void onDownload(asset).finally(() => setDownloading(false));
  };

  const changeChannel = (next: UpdateChannel) => {
    setChannel(next);
    onChannelChange(next);
    setSelectedTag("");
    void saveRepoSettings(app.repo, { ...initialPreference, channel: next });
  };

  const versionOptions = buildVersionOptions(releases, app.installedVersion, t);

  // Hands the selected release to Decky Loader's installer, which shows its own
  // confirm/progress dialog; Content reloads the list once the loader finishes.
  const install = selectedRelease && installAction(app, selectedRelease);
  const installIcons = { [PLUGIN_INSTALL_TYPE.INSTALL]: <FaPlus />, [PLUGIN_INSTALL_TYPE.REINSTALL]: <FaRedo />, [PLUGIN_INSTALL_TYPE.UPDATE]: <FaArrowUp />, [PLUGIN_INSTALL_TYPE.DOWNGRADE]: <FaArrowDown /> };
  const installLabel = install && selectedRelease ? installTypeLabel(t, install.type, displayVersion(selectedRelease.tag).replace(/^v/, ""), t("appcard.update")) : "";
  const runInstall = (release: AppReleaseOption, action: NonNullable<typeof install>) =>
    // Decky's own confirm/progress dialog would otherwise open behind this
    // window; the Updates/Discover page behind it is left too.
    void startPluginInstall(t, app.name, release.assets[0], release.tag, action, installLabel, () => {
      closeModal?.();
      Navigation.NavigateBack();
    });

  // Installed Decky plugins can be removed through Decky Loader — never
  // DeckyHub itself from here. The loader doesn't confirm, so we do.
  const canUninstall = Boolean(app.pluginName && app.pluginName !== "DeckyHub");
  const confirmUninstall = () =>
    showModal(
      <ConfirmModal
        strTitle={t("appcard.uninstallTitle", { name: app.name })}
        strDescription={t("appcard.uninstallDescription")}
        strOKButtonText={t("appcard.uninstall")}
        bDestructiveWarning
        onOK={() => {
          closeModal?.();
          void uninstallDeckyPlugin(app.pluginName!).then(
            () => {
              toaster.toast({ title: "DeckyHub", body: t("appcard.uninstalled", { name: app.name }) });
              onUninstalled();
            },
            (error: unknown) => toaster.toast({ title: "DeckyHub", body: String(error) }),
          );
        }}
      />,
    );

  return (
    <ModalRoot closeModal={closeModal}>
      <div style={{ display: "grid", gap: windowGap }}>
        <VersionPickerPanel
          t={t}
          title={app.name}
          subtitle={t("settings.installedVersion", { version: app.installedVersion ? displayVersion(app.installedVersion) : "—" })}
          channel={channel}
          onChannelChange={changeChannel}
          versionOptions={versionOptions}
          selectedTag={selectedTag}
          onVersionChange={setSelectedTag}
          disabled={loading}
          error={fetchError}
          isEmpty={!loading && !fetchError && releases.length === 0}
        />

        <div aria-hidden style={sectionDividerStyle} />

        {selectedRelease && (
          <>
            {install && !hiddenButtons.includes(install.type === PLUGIN_INSTALL_TYPE.INSTALL ? "install" : "update") && (
              <Button style={modalButtonStyle} onClick={() => runInstall(selectedRelease, install)}>
                {installIcons[install.type]} {installLabel}
              </Button>
            )}
            {hiddenButtons.includes("downloadZip") ? null : selectedRelease.assets[0] ? (
              <Button style={modalButtonStyle} disabled={downloading} onClick={() => download(selectedRelease.assets[0])}>
                <FaFileArchive /> {t("settings.downloadUpdate")}
              </Button>
            ) : (
              <small style={{ color: "#ff6b6b" }}>{t("appcard.noMatchingAsset")}</small>
            )}
            {!hiddenButtons.includes("downloadZip") && selectedRelease.assets.slice(1).map((asset) => (
              <Button key={asset.name} style={modalButtonStyle} disabled={downloading} onClick={() => download(asset)}>
                <FaFileArchive /> {`${asset.name} (${readableBytes(asset.size)})`}
              </Button>
            ))}
          </>
        )}

        <ReleaseActions t={t} url={selectedRelease?.url} hideReleasePage={hiddenButtons.includes("releasePage")} checking={loading} disabled={loading} onCheck={() => void load(true)} closeModal={closeModal} />

        {canUninstall && (
          <Button style={{ ...modalButtonStyle, color: "#ff6b6b" }} onClick={confirmUninstall}>
            <FaTrash /> {t("appcard.uninstall")}
          </Button>
        )}

        <Button style={modalButtonStyle} onClick={closeModal}>
          <FaTimes /> {t("settings.close")}
        </Button>
      </div>
    </ModalRoot>
  );
}
