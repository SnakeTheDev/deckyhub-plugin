import { DialogButtonPrimary as Button, DropdownItem, Focusable, Navigation } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaExternalLinkAlt, FaSync } from "react-icons/fa";
import type { TFunc } from "../i18n/en";
import type { UpdateChannel } from "../types";
import { modalButtonStyle, windowGap } from "../utils";
import { inChannel } from "../version";
import { keepInView } from "./KeepInView";

// Shared by both version pickers: the channel's releases and the selected one.
// A load keeps the current selection while it's still listed, except a forced
// "Check for Updates" (pinLatest), which jumps to the newest on purpose.
export function useReleasePicker<T extends { tag: string; prerelease: boolean }>(fetchReleases: (force: boolean) => Promise<{ items: T[]; error?: string }>, channel: UpdateChannel) {
  const [items, setItems] = useState<T[]>([]);
  const [selectedTag, setSelectedTag] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped per load() so a slower load for a channel switched away from can't
  // overwrite the newer one.
  const loadRun = useRef(0);

  const load = async (pinLatest = false) => {
    const run = ++loadRun.current;
    setLoading(true);
    const result = await fetchReleases(pinLatest);
    if (run !== loadRun.current) return;
    const filtered = result.items.filter((item) => inChannel(item, channel));
    setItems(filtered);
    setError(result.error ?? null);
    setSelectedTag((current) => (!pinLatest && filtered.some((item) => item.tag === current) ? current : filtered[0]?.tag ?? ""));
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, [channel]);

  return { items, selectedTag, setSelectedTag, loading, error, setError, load, selected: items.find((item) => item.tag === selectedTag) ?? null };
}

// The Release Page + Check for Updates row both version pickers end with.
export function ReleaseActions({ t, url, hideReleasePage, checking, disabled, onCheck, closeModal }: { t: TFunc; url?: string; hideReleasePage: boolean; checking: boolean; disabled: boolean; onCheck: () => void; closeModal?: () => void }) {
  return (
    <Focusable flow-children="right" style={{ display: "flex", gap: 8 }}>
      {url && !hideReleasePage && (
        <Button style={{ ...modalButtonStyle, flex: 1 }} onClick={() => {
            // Close first: Steam's browser otherwise opens underneath this modal.
            closeModal?.();
            Navigation.NavigateToExternalWeb(url);
          }}
        >
          <FaExternalLinkAlt /> {t("appcard.releasePage")}
        </Button>
      )}
      <Button style={{ ...modalButtonStyle, flex: 1 }} disabled={disabled} onClick={onCheck}>
        <FaSync /> {checking ? t("settings.checkingUpdate") : t("settings.checkUpdate")}
      </Button>
    </Focusable>
  );
}

// Shared by DeckyHubUpdateModal and AppDetailsModal: the title/subtitle
// header plus the channel+version dropdown box and its error/empty
// messages are identical between the two (one picks DeckyHub's own
// releases, the other a tracked app's) — only what surrounds this panel
// (the primary action buttons) actually differs between them.
export function VersionPickerPanel({
  t,
  title,
  subtitle,
  channel,
  onChannelChange,
  versionOptions,
  selectedTag,
  onVersionChange,
  disabled,
  error,
  isEmpty,
}: {
  t: TFunc;
  title: string;
  subtitle: string;
  channel: UpdateChannel;
  onChannelChange: (channel: UpdateChannel) => void;
  versionOptions: { data: string; label: string }[];
  selectedTag: string;
  onVersionChange: (tag: string) => void;
  disabled: boolean;
  error?: string | null;
  isEmpty: boolean;
}) {
  return (
    <>
      <div onFocus={keepInView} style={{ display: "grid", gap: windowGap }}>
        <strong style={{ fontSize: 16 }}>{title}</strong>
        <div style={{ fontSize: 13, opacity: 0.75 }}>{subtitle}</div>

        <div style={{ display: "grid", gap: 8, padding: 12, background: "rgba(0, 0, 0, 0.2)", borderRadius: 8 }}>
          {/* Inline label + no separator: Steam's dropdown height is fixed, so
              this is what keeps each row short. */}
          <DropdownItem
            layout="inline"
            bottomSeparator="none"
            label={t("settings.updateChannel")}
            rgOptions={[
              { label: t("settings.stableReleases"), data: "stable" },
              { label: t("settings.preReleases"), data: "prerelease" },
            ]}
            selectedOption={channel}
            disabled={disabled}
            onChange={({ data }) => onChannelChange(data as UpdateChannel)}
          />
          {versionOptions.length > 0 && (
            <DropdownItem layout="inline" bottomSeparator="none" label={t("settings.version")} rgOptions={versionOptions} selectedOption={selectedTag} disabled={disabled} onChange={({ data }) => onVersionChange(String(data))} />
          )}
        </div>
      </div>

      {error && <small style={{ color: "#ff6b6b" }}>{error}</small>}
      {isEmpty && <small style={{ color: "#ff6b6b" }}>{t("settings.noReleasesFound")}</small>}
    </>
  );
}
