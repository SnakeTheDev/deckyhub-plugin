import { toaster } from "@decky/api";
import { DialogButtonPrimary as Button, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { useEffect, useState } from "react";
import { FaArrowCircleUp, FaSync } from "react-icons/fa";
import { getDeckyHubInfo, getSettings } from "../api";
import { useT } from "../i18n";
import type { DeckyHubInfo, DeckyHubRelease, UpdateChannel } from "../types";
import { compactButtonStyle, latestDeckyHubRelease, log, normalizeVersion, PLUGIN_INSTALL_TYPE, resolveDeckyHubInstallType } from "../utils";
import { DeckyHubUpdateModal } from "./DeckyHubUpdateModal";

// Deliberately thin: a header naming the installed version and a single
// button, "Update to vX" or "Check for Updates". Everything else (latest version, self-update progress,
// download-zip fallback, release page, re-check) lives in DeckyHubUpdateModal.
export function DeckyHubUpdate() {
  const t = useT();
  const [channel, setChannel] = useState<UpdateChannel>("stable");
  const [info, setInfo] = useState<DeckyHubInfo>({ version: "unknown" });
  const [release, setRelease] = useState<DeckyHubRelease>({});

  // Only a strictly newer release counts as available — e.g. a pre-release
  // install on the stable channel mustn't be offered the older stable one.
  const isNewer = (version?: string) =>
    Boolean(version && info.version !== "unknown" && resolveDeckyHubInstallType(version, info.version) === PLUGIN_INSTALL_TYPE.UPDATE);

  const checkForUpdate = (force = false) =>
    void latestDeckyHubRelease(channel, force).then((next) => {
      setRelease(next);
      if (next.version && !next.error && isNewer(next.version)) {
        toaster.toast({ title: "DeckyHub", body: t("settings.updateAvailable", { version: next.version }) });
      }
    });

  useEffect(() => {
    void Promise.all([getSettings(), getDeckyHubInfo()]).then(([settings, nextInfo]) => {
      setChannel(settings.updateChannel);
      setInfo(nextInfo);
    }).catch((error) => {
      log(`Loading DeckyHub info failed: ${error}`);
      setRelease({ error: String(error) });
    });
  }, []);

  useEffect(() => {
    if (info.version !== "unknown") checkForUpdate();
  }, [channel, info.version]);

  const loading = info.version === "unknown";
  const title = loading ? `${t("settings.checkingVersion")}…` : `${t("settings.current")} - v${info.version}`;
  const hasUpdate = Boolean(release.asset && release.version && isNewer(release.version));

  return (
    <PanelSection title={title}>
      <PanelSectionRow>
        <Button
          style={compactButtonStyle}
          // Read settings on open so Display Settings' hidden buttons are current.
          onClick={() => void getSettings().then((settings) => showModal(<DeckyHubUpdateModal t={t} info={info} channel={channel} onCheckUpdate={() => checkForUpdate(true)} onChannelChange={setChannel} hiddenButtons={settings.hiddenButtons} />))}
        >
          {hasUpdate ? <FaArrowCircleUp /> : <FaSync />} {hasUpdate ? t("settings.updateTo", { version: normalizeVersion(release.version!) }) : t("settings.checkUpdate")}
        </Button>
      </PanelSectionRow>
    </PanelSection>
  );
}
