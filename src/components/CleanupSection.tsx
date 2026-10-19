import { toaster } from "@decky/api";
import { DialogButtonPrimary as Button, ModalRoot, PanelSection, PanelSectionRow, showModal } from "@decky/ui";
import { useEffect, useState } from "react";
import { FaExclamationTriangle, FaTimes, FaTrash } from "react-icons/fa";
import { clearDownloads, listDownloads } from "../api";
import { useT } from "../i18n";
import type { TFunc } from "../i18n/en";
import { compactButtonStyle, modalButtonStyle, sectionDividerStyle, windowGap } from "../utils";
import { KeepInView } from "./KeepInView";

const CLEAR_LIST_LIMIT = 50;

type DownloadEntry = { name: string; directory: boolean };

// Own modal instead of ConfirmModal so the actions stack full-width on their
// own lines like DeckyHub's other windows. Rendered via showModal(), so it
// gets `t` as a prop (no I18nProvider there) and closeModal from Decky.
function ClearDownloadsModal({ t, downloads, onConfirm, closeModal }: { t: TFunc; downloads: DownloadEntry[]; onConfirm: () => void; closeModal?: () => void }) {
  return (
    <ModalRoot closeModal={closeModal}>
      <div style={{ display: "grid", gap: windowGap }}>
        <strong style={{ fontSize: 16 }}>{t("settings.clearDownloadsTitle")}</strong>
        {/* Deletion can't be undone, so the question reads as a warning. */}
        <div style={{ alignItems: "flex-start", color: "#ff6b6b", display: "flex", fontSize: "1.1em", fontWeight: 700, gap: 8 }}>
          <FaExclamationTriangle style={{ flexShrink: 0, marginTop: 3 }} />
          <span>{t("settings.clearDownloadsDescription")}</span>
        </div>
        {downloads.length > 0 && (
          <div style={{ color: "#6bcb6b" }}>
            {downloads.slice(0, CLEAR_LIST_LIMIT).map((item, index) => (
              <span key={item.name}>{index ? " · " : ""}{item.name}{item.directory ? "/" : ""}</span>
            ))}
            {downloads.length > CLEAR_LIST_LIMIT && <span> · +{downloads.length - CLEAR_LIST_LIMIT} more</span>}
          </div>
        )}
        <Button
          style={{ ...modalButtonStyle, color: "#ff6b6b" }}
          onClick={() => {
            closeModal?.();
            onConfirm();
          }}
        >
          <FaTrash /> {t("settings.emptyFolder")}
        </Button>
        <Button style={modalButtonStyle} onClick={closeModal}>
          <FaTimes /> {t("content.cancel")}
        </Button>
      </div>
    </ModalRoot>
  );
}

export function CleanupSection() {
  const t = useT();
  const [downloads, setDownloads] = useState<DownloadEntry[]>([]);

  // Re-read when the panel comes back into view, so downloads finished since
  // it mounted show up.
  useEffect(() => {
    const refresh = () => void listDownloads().then(({ items }) => setDownloads(items), () => undefined);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    refresh();
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const clear = () =>
    void clearDownloads().then(({ removed }) => {
      setDownloads([]);
      toaster.toast({ title: "DeckyHub", body: t("settings.downloadsCleared", { count: removed }) });
    });

  // Nothing to clean up: hide the whole section (and its divider).
  if (!downloads.length) return null;

  return (
    <>
      <div aria-hidden style={sectionDividerStyle} />
      <KeepInView>
        <PanelSection title={t("settings.cleanup")}>
          <PanelSectionRow>
            <Button style={compactButtonStyle} onClick={() => showModal(<ClearDownloadsModal t={t} downloads={downloads} onConfirm={clear} />)}>
              <FaTrash /> {t("settings.emptyFolder")}
            </Button>
          </PanelSectionRow>
        </PanelSection>
      </KeepInView>
    </>
  );
}
