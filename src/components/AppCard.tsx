import { toaster } from "@decky/api";
import { DialogButtonPrimary as Button, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { FaArrowUp, FaCog, FaPlus } from "react-icons/fa";
import { useT } from "../i18n";
import type { App, Asset, HideableButton, RepoPreference, UpdateChannel } from "../types";
import { compactButtonStyle, cardDescriptionStyle, displayVersion, installAction, installDeckyPlugin, PLUGIN_INSTALL_TYPE, statusKey, statusColor, unverifiedLabel } from "../utils";
import { AppDetailsModal } from "./AppDetailsModal";

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
  const isUpdate = install?.type === PLUGIN_INSTALL_TYPE.UPDATE;
  const quickAction = install && (isUpdate || install.type === PLUGIN_INSTALL_TYPE.INSTALL) && !hiddenButtons.includes(isUpdate ? "update" : "install");
  return (
    <PanelSection title={app.name}>
      <PanelSectionRow>
        <div>
          <small style={cardDescriptionStyle}>{app.description || " "}</small>
          <span style={{ color: statusColor(app) }}>{t(statusKey(app))}</span>
          <br />
          <small>{t("settings.installedVersion", { version: app.installedVersion ? displayVersion(app.installedVersion) : "—" })}</small>
          <br />
          <small>{t("settings.latestVersion", { version: app.latestVersion ? displayVersion(app.latestVersion) : "—" })}</small>
          <br />
          <small style={{ color: app.channel === "prerelease" ? "#ffa94d" : undefined }}>
            {t("appcard.channel", { channel: t(app.channel === "prerelease" ? "appcard.channelPrerelease" : "appcard.channelStable") })}
          </small>
          {app.error && (
            <>
              <br />
              <small>{app.error}</small>
            </>
          )}
        </div>
      </PanelSectionRow>
      {install && quickAction && (
        <PanelSectionRow>
          <Button
            style={compactButtonStyle}
            onClick={() =>
              installDeckyPlugin(app.assets[0], install.name, app.latestVersion!, install.type).catch((error: unknown) =>
                toaster.toast({ title: "DeckyHub", body: String(error) }),
              )
            }
          >
            {isUpdate ? <FaArrowUp /> : <FaPlus />} {unverifiedLabel(t, t(isUpdate ? "appcard.update" : "appcard.install"), install.verified)}
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
