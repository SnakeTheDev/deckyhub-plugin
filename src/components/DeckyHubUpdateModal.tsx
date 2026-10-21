import { toaster } from "@decky/api";
import { DialogButtonPrimary as Button, ModalRoot } from "@decky/ui";
import { useState } from "react";
import { FaDownload, FaFileArchive, FaTimes } from "react-icons/fa";
import { downloadAsset, getSettings, saveSettings } from "../api";
import type { TFunc } from "../i18n/en";
import type { Asset, DeckyHubInfo, DeckyHubReleaseOption, UpdateChannel, HideableButton } from "../types";
import { PLUGIN_INSTALL_TYPE, buildVersionOptions, getDeckyBackend, installDeckyPlugin, installTypeLabel, listDeckyHubReleases, modalButtonStyle, resolveDeckyHubInstallType, sectionDividerStyle, windowGap } from "../utils";
import { normalizeVersion } from "../version";
import { showDownloadModal } from "./DownloadProgress";
import { ReleaseActions, useReleasePicker, VersionPickerPanel } from "./VersionPickerPanel";

const PLUGIN_NAME = "DeckyHub";

// showModal() mounts onto a separate root from the QAM panel (Decky's own
// MAIN-window modal manager in production; a fresh React root in the local
// mock), so it never inherits I18nProvider's context — `t` must be a resolved
// function passed in from a caller that does have it, not `useT()` called here.
export function DeckyHubUpdateModal({
  t,
  info,
  channel: initialChannel,
  onCheckUpdate,
  onChannelChange,
  hiddenButtons,
  closeModal,
}: {
  t: TFunc;
  info: DeckyHubInfo;
  channel: UpdateChannel;
  onCheckUpdate: (channel: UpdateChannel) => void;
  onChannelChange: (channel: UpdateChannel) => void;
  hiddenButtons: HideableButton[];
  closeModal?: () => void;
}) {
  const [channel, setChannel] = useState(initialChannel);
  const { items: versions, selectedTag, setSelectedTag, loading: loadingVersions, error: fetchError, load, selected: selectedRelease } = useReleasePicker(listDeckyHubReleases, channel);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selfUpdateError, setSelfUpdateError] = useState<string | null>(null);

  const busy = checking || downloading || loadingVersions;

  const refresh = async () => {
    setChecking(true);
    try {
      await load(true);
    } finally {
      setChecking(false);
    }
    // Reads the release list load(true) just cached, to update the panel button.
    onCheckUpdate(channel);
  };

  const changeChannel = async (next: UpdateChannel) => {
    setChannel(next);
    onChannelChange(next);
    setSelectedTag("");
    void getSettings().then((settings) => saveSettings({ ...settings, updateChannel: next }));
  };

  // Every action but Check for Updates and Download ZIP closes this window;
  // Decky's own confirm/progress dialog takes over the install.
  const selfUpdate = (release: DeckyHubReleaseOption) => {
    if (!release.asset) return;
    if (!getDeckyBackend()) {
      setSelfUpdateError(t("settings.selfUpdateUnavailable"));
      return;
    }
    closeModal?.();
    installDeckyPlugin(release.asset, PLUGIN_NAME, release.tag, resolveDeckyHubInstallType(release.tag, info.version)).catch((error: unknown) =>
      toaster.toast({ title: "DeckyHub", body: String(error) }),
    );
  };

  const downloadZip = async (asset: Asset) => {
    try {
      const result = await downloadAsset(asset, "mazillka/deckyhub-plugin");
      if (result.error) throw new Error(result.error);
      if (result.jobId) {
        setDownloading(true);
        showDownloadModal(t, result.jobId, { state: "queued", filename: asset.name, total: asset.size }, () => setDownloading(false));
      }
    } catch (error) {
      setSelfUpdateError(String(error));
    }
  };

  const versionOptions = buildVersionOptions(versions, info.version, t);

  const displayVersion = selectedRelease ? normalizeVersion(selectedRelease.tag) : "";
  const installType = selectedRelease ? resolveDeckyHubInstallType(selectedRelease.tag, info.version) : PLUGIN_INSTALL_TYPE.UPDATE;
  const primaryLabel = installTypeLabel(t, installType, displayVersion);

  return (
    <ModalRoot closeModal={closeModal}>
      <div style={{ display: "grid", gap: windowGap }}>
        <VersionPickerPanel
          t={t}
          title={t("settings.deckyhubUpdate")}
          subtitle={`${t("settings.current")} - v${info.version}`}
          channel={channel}
          onChannelChange={(next) => void changeChannel(next)}
          versionOptions={versionOptions}
          selectedTag={selectedTag}
          onVersionChange={setSelectedTag}
          disabled={busy}
          error={fetchError || selfUpdateError}
          isEmpty={!loadingVersions && !fetchError && versions.length === 0}
        />

        <div aria-hidden style={sectionDividerStyle} />

        {selectedRelease && (
          <>
            {/* Display Settings' "Hide Update" covers Update/Reinstall/Downgrade. */}
            {!hiddenButtons.includes("update") && (
              <Button
                style={modalButtonStyle}
                disabled={busy || !selectedRelease.asset}
                onClick={() => void selfUpdate(selectedRelease)}
              >
                <FaDownload /> {primaryLabel}
              </Button>
            )}
            {!hiddenButtons.includes("downloadZip") && (
              <Button style={modalButtonStyle} disabled={busy || !selectedRelease.asset} onClick={() => void downloadZip(selectedRelease.asset!)}>
                <FaFileArchive /> {t("settings.downloadUpdate")}
              </Button>
            )}
          </>
        )}

        <ReleaseActions t={t} url={selectedRelease?.url} hideReleasePage={hiddenButtons.includes("releasePage")} checking={checking} disabled={busy} onCheck={() => void refresh()} closeModal={closeModal} />

        <Button style={modalButtonStyle} onClick={closeModal}>
          <FaTimes /> {t("settings.close")}
        </Button>
      </div>
    </ModalRoot>
  );
}
