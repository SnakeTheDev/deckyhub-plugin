import { DialogButtonPrimary as Button, DropdownItem, Focusable, Navigation, PanelSection, PanelSectionRow, TextField, ToggleField } from "@decky/ui";
import { useEffect, useState, type ReactNode } from "react";
import { FaExternalLinkAlt, FaSave, FaFolderOpen, FaInfoCircle, FaLock } from "react-icons/fa";
import { getSettings, saveSettings } from "../api";
import { KeepInView } from "../components/KeepInView";
import { LOCALE_CHANGED, LOCALES, useT } from "../i18n";
import type { MessageKey } from "../i18n/en";
import type { HideableButton, Settings } from "../types";
import { DEFAULT_COLUMNS_PER_ROW, compactButtonStyle, githubCoreQuota, sectionDividerStyle, setGithubToken } from "../utils";

// Each hideable Manage-window button, labelled with its own translation.
const HIDEABLE_BUTTONS: [HideableButton, MessageKey][] = [
  ["downloadZip", "settings.downloadUpdate"],
  ["install", "appcard.install"],
  ["update", "appcard.update"],
  ["releasePage", "appcard.releasePage"],
];

// Explanatory text with a leading icon, bright enough to read at a glance.
function IconNote({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div style={{ alignItems: "flex-start", color: "#d6f5ff", display: "flex", fontSize: "0.9em", gap: 8 }}>
      <span style={{ color: "#8fcef4", display: "flex", flexShrink: 0, marginTop: 2 }}>{icon}</span>
      <span>{children}</span>
    </div>
  );
}

export function SettingsPage() {
  const t = useT();
  const [settings, setSettings] = useState<Settings>({ overwriteExisting: true, updateChannel: "stable", language: "auto", columnsPerRow: DEFAULT_COLUMNS_PER_ROW, githubToken: "", density: "default", hiddenButtons: [] });
  // The token field saves on an explicit button (below), not per keystroke
  // like the other settings — typing a 40+ character token would otherwise
  // fire a save on every keystroke. This tracks the field independently of
  // the committed `settings.githubToken` until that button is pressed.
  const [tokenDraft, setTokenDraft] = useState("");
  const [quota, setQuota] = useState<Awaited<ReturnType<typeof githubCoreQuota>>>(null);
  // Same green/yellow/red as the app cards' status colors.
  const quotaColor = !quota || quota.remaining > quota.limit / 2 ? "#6bcb6b" : quota.remaining > quota.limit / 10 ? "#f0c33c" : "#ff6b6b";
  const openTokenPage = () => Navigation.NavigateToExternalWeb("https://github.com/settings/tokens");
  const refreshQuota = () => void githubCoreQuota().then(setQuota, () => setQuota(null));

  useEffect(() => {
    void getSettings().then((loaded) => {
      setSettings(loaded);
      // Keep anything typed before this load resolved instead of clobbering it.
      setTokenDraft((draft) => draft || loaded.githubToken);
      // Prime the token here too so the quota reflects it, rather than racing
      // I18nProvider's own priming of the same value.
      setGithubToken(loaded.githubToken);
      refreshQuota();
    });
  }, []);

  const update = (next: Partial<Settings>) => {
    const merged = { ...settings, ...next };
    setSettings(merged);
    void saveSettings(merged).then((saved) => {
      setSettings(saved);
      if ("githubToken" in next) {
        setTokenDraft(saved.githubToken);
        setGithubToken(saved.githubToken);
        refreshQuota();
      }
      // Every mounted I18nProvider (one per route) re-syncs both the locale
      // and the GitHub token off this event — see i18n/index.tsx.
      if ("language" in next || "githubToken" in next || "density" in next) window.dispatchEvent(new Event(LOCALE_CHANGED));
    });
  };

  return (
    <>
      <KeepInView>
        <PanelSection title={t("settings.githubAccess")}>
          <PanelSectionRow>
            <div style={{ display: "grid", gap: 8 }}>
              {/* Focusable (via onActivate) so the controller can move up onto
                  this text: Steam only scrolls to follow focus. */}
              <Focusable onActivate={() => {}} style={{ display: "grid", gap: 8 }}>
                <IconNote icon={<FaInfoCircle />}>{t("settings.githubTokenIntro")}</IconNote>
                {quota && (
                  <strong className="deckyhub-github-quota" style={{ borderLeft: `3px solid ${quotaColor}`, color: quotaColor, paddingLeft: 10 }}>
                    {t("settings.githubQuota", { remaining: quota.remaining, limit: quota.limit, minutes: Math.max(1, Math.ceil((quota.reset * 1000 - Date.now()) / 60_000)) })}
                  </strong>
                )}
              </Focusable>
              {/* A button (A / tap) that opens the token page in Steam's browser. */}
              <Focusable
                className="deckyhub-token-link"
                onActivate={openTokenPage}
                onClick={openTokenPage}
                style={{ borderLeft: "3px solid #1a9fff", cursor: "pointer", paddingLeft: 10 }}
              >
                <div style={{ color: "#8fcef4", fontSize: "0.9em", marginBottom: 3 }}>{t("settings.githubTokenHowTo")}</div>
                <strong style={{ alignItems: "center", color: "#fff", display: "inline-flex", gap: 6, textDecoration: "underline" }}>
                  github.com/settings/tokens <FaExternalLinkAlt size="0.8em" />
                </strong>
              </Focusable>
              <IconNote icon={<FaLock />}>{t("settings.githubTokenNote")}</IconNote>
            </div>
          </PanelSectionRow>
          <div aria-hidden style={sectionDividerStyle} />
          <PanelSectionRow>
            <TextField label={t("settings.githubToken")} value={tokenDraft} bIsPassword bShowClearAction onChange={(event) => setTokenDraft(event.currentTarget.value)} />
          </PanelSectionRow>
          <PanelSectionRow>
            <Button style={compactButtonStyle} disabled={tokenDraft.trim() === settings.githubToken} onClick={() => update({ githubToken: tokenDraft.trim() })}>
              <FaSave /> {t("settings.saveSettings")}
            </Button>
          </PanelSectionRow>
        </PanelSection>
      </KeepInView>

      <div aria-hidden style={sectionDividerStyle} />

      <KeepInView>
        <PanelSection title={t("settings.downloadSettings")}>
          <PanelSectionRow>
            <div style={{ display: "grid", gap: 8 }}>
              <IconNote icon={<FaFolderOpen />}>{t("settings.whereZipsSaved")}</IconNote>
              <div style={{ borderLeft: "3px solid #1a9fff", paddingLeft: 10 }}>
                <div style={{ color: "#8fcef4", fontSize: "0.9em", marginBottom: 3 }}>{t("dl.installInDecky")}</div>
                <strong style={{ color: "#fff" }}>{t("dl.installPath")}</strong>
              </div>
            </div>
          </PanelSectionRow>
          <div aria-hidden style={sectionDividerStyle} />
          <PanelSectionRow>
            <ToggleField label={t("settings.overwriteExisting")} checked={settings.overwriteExisting} onChange={(checked) => update({ overwriteExisting: checked })} />
          </PanelSectionRow>
        </PanelSection>
      </KeepInView>

      <div aria-hidden style={sectionDividerStyle} />

      <KeepInView>
        <PanelSection title={t("settings.language")}>
          <PanelSectionRow>
            <DropdownItem
              label={t("settings.language")}
              rgOptions={[{ label: t("settings.autoDetect"), data: "auto" }, ...LOCALES.map((locale) => ({ label: locale.label, data: locale.code }))]}
              selectedOption={settings.language}
              onChange={({ data }) => update({ language: data })}
            />
          </PanelSectionRow>
        </PanelSection>
      </KeepInView>

      <div aria-hidden style={sectionDividerStyle} />

      <KeepInView>
        <PanelSection title={t("settings.displaySettings")}>
          <PanelSectionRow>
            <DropdownItem
              label={t("settings.density")}
              rgOptions={[
                { label: t("settings.densityDefault"), data: "default" },
                { label: t("settings.densityCompact"), data: "compact" },
              ]}
              selectedOption={settings.density}
              onChange={({ data }) => update({ density: data })}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <DropdownItem
              label={t("settings.itemsPerRow")}
              rgOptions={[1, 2, 3].map((count) => ({ label: String(count), data: count }))}
              selectedOption={settings.columnsPerRow}
              onChange={({ data }) => update({ columnsPerRow: data })}
            />
          </PanelSectionRow>
          {HIDEABLE_BUTTONS.map(([name, label]) => (
            <PanelSectionRow key={name}>
              <ToggleField
                label={t("settings.hideButton", { button: t(label) })}
                checked={settings.hiddenButtons.includes(name)}
                onChange={(checked) => update({ hiddenButtons: checked ? [...settings.hiddenButtons, name] : settings.hiddenButtons.filter((hidden) => hidden !== name) })}
              />
            </PanelSectionRow>
          ))}
        </PanelSection>
      </KeepInView>
    </>
  );
}
