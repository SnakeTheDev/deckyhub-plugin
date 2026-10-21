import { DialogButtonPrimary as Button, Navigation, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { useState } from "react";
import { FaArrowUp, FaCog, FaPlus } from "react-icons/fa";
import { useT } from "../i18n";
import type { App, Asset, HideableButton, RepoPreference, UpdateChannel } from "../types";
import { compactButtonStyle, cardDescriptionStyle, installAction, PLUGIN_INSTALL_TYPE, statusKey, statusColor } from "../utils";
import { displayVersion } from "../version";
import { AppDetailsModal, startPluginInstall } from "./AppDetailsModal";

export function AppCard({
  app,
  preference,
  downloadDisabled,
  hiddenButtons,
  onDownload,
  onChannelChange,
  onUninstalled,
}: {
  app: App;
  preference: RepoPreference;
  downloadDisabled?: boolean;
  hiddenButtons: HideableButton[];
  onDownload: (asset: Asset) => Promise<void>;
  onChannelChange: (repo: string, channel: UpdateChannel) => void;
  onUninstalled: () => void;
}) {
  const t = useT();
  // Quick install/update to the latest release of a Decky plugin;
  // Manage still offers other versions/channels.
  const install = app.latestVersion ? installAction(app, { tag: app.latestVersion, assets: app.assets }) : null;
  // Only offer Update when the card's own status says one is available.
  const isUpdate = install?.type === PLUGIN_INSTALL_TYPE.UPDATE && app.updateAvailable === true;
  const quickAction = install && (isUpdate || install.type === PLUGIN_INSTALL_TYPE.INSTALL) && !hiddenButtons.includes(isUpdate ? "update" : "install");
  // Installs hand over to Decky's own dialog, so leave the Updates/Discover page.
  const leavePage = () => Navigation.NavigateBack();
  // Blocks a second tap from starting a second install while the first is handed over.
  const [installing, setInstalling] = useState(false);
  const latest = app.latestVersion ? displayVersion(app.latestVersion).replace(/^v/, "") : "";
  const quickLabel = t(isUpdate ? "settings.updateTo" : "appcard.installVersion", { version: latest });
  return (
    <PanelSection title={app.name}>
      <PanelSectionRow>
        <div>
          <small style={cardDescriptionStyle}>{app.description || " "}</small>
          <span style={{ color: statusColor(app) }}>{t(statusKey(app))}</span>
          {app.installedVersion && (
            <>
              <br />
              <small>{t("settings.installedVersion", { version: displayVersion(app.installedVersion) })}</small>
            </>
          )}
          <br />
          {/* No release and no error yet: its GitHub check is still running. */}
          <small>{t("settings.latestVersion", { version: app.latestVersion ? displayVersion(app.latestVersion) : app.error ? "—" : t("settings.checkingUpdate") })}</small>
          {/* Stable is the default, so only a pre-release override earns a line. */}
          {app.channel === "prerelease" && (
            <>
              <br />
              <small style={{ color: "#ffa94d" }}>{t("appcard.channel", { channel: t("appcard.channelPrerelease") })}</small>
            </>
          )}
          {app.error && (
            <>
              <br />
              <small style={{ color: "#ff6b6b" }}>{app.error}</small>
            </>
          )}
        </div>
      </PanelSectionRow>
      {install && quickAction && (
        <PanelSectionRow>
          <Button
            style={compactButtonStyle}
            disabled={installing}
            onClick={() => {
              setInstalling(true);
              void startPluginInstall(t, app.name, app.assets[0], app.latestVersion!, install, quickLabel, leavePage).finally(() => setInstalling(false));
            }}
          >
            {isUpdate ? <FaArrowUp /> : <FaPlus />} {quickLabel}
          </Button>
        </PanelSectionRow>
      )}
      <PanelSectionRow>
        <Button
          style={compactButtonStyle}
          onClick={() =>
            showModal(
              <AppDetailsModal
                t={t}
                app={app}
                preference={preference}
                downloadDisabled={downloadDisabled}
                hiddenButtons={hiddenButtons}
                onDownload={onDownload}
                onChannelChange={(channel) => onChannelChange(app.repo, channel)}
                onUninstalled={onUninstalled}
              />
            )
          }
        >
          <FaCog /> {t("appcard.manage")}
        </Button>
      </PanelSectionRow>
    </PanelSection>
  );
}
