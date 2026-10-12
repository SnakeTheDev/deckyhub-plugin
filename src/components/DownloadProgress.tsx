import { DialogButtonPrimary as Button, ModalRoot, ProgressBar, showModal } from "@decky/ui";
import { useEffect, useRef, useState } from "react";
import { FaCheck, FaTimes } from "react-icons/fa";
import { cancelDownload, getDownload } from "../api";
import { useT } from "../i18n";
import type { TFunc } from "../i18n/en";
import type { Download } from "../types";
import { iconRow, readableBytes } from "../utils";

const ACTIVE_STATES = ["queued", "downloading"];

function DownloadModal({
  t,
  jobId,
  initial,
  onSettled,
  closeModal,
}: {
  t: TFunc;
  jobId: string;
  initial: Download;
  onSettled?: (state: Download) => void;
  closeModal?: () => void;
}) {
  const [state, setState] = useState(initial);
  const active = ACTIVE_STATES.includes(state.state);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(
      () => void getDownload(jobId).then(setState, (error) => setState((current) => ({ ...current, state: "error", error: String(error) }))),
      500,
    );
    return () => window.clearInterval(timer);
  }, [jobId, active]);

  // Report once: when the job settles, or when the window closes first (Cancel,
  // or B mid-download) — otherwise the caller's buttons would stay disabled.
  const settled = useRef(false);
  const latest = useRef(state);
  latest.current = state;
  const settle = () => {
    if (settled.current) return;
    settled.current = true;
    onSettled?.(latest.current);
  };

  useEffect(() => {
    if (!active) settle();
  }, [active]);

  useEffect(() => settle, []);

  const progress = state.total ? Math.min(100, (100 * (state.received ?? 0)) / state.total) : 0;

  return (
    <ModalRoot closeModal={closeModal}>
      <div style={{ display: "grid", gap: 14 }}>
          {active && (
            <div style={{ display: "grid", gap: 16 }}>
              <strong style={{ overflowWrap: "anywhere" }}>{t("dl.downloading", { filename: state.filename ?? "" })}</strong>
              <ProgressBar indeterminate={!state.total} nProgress={progress} />
              <small style={{ color: "#8fcef4" }}>{state.total ? t("dl.progress", { percent: Math.round(progress), received: readableBytes(state.received), total: readableBytes(state.total) }) : t("dl.preparing")}</small>
            </div>
          )}
          {state.state === "error" && (
            <>
              <strong style={{ color: "#ff6b6b" }}>{t("dl.failedTitle")}</strong>
              <div style={{ overflowWrap: "anywhere" }}>{state.error || t("dl.failedNoReason")}</div>
            </>
          )}
          {state.state === "complete" && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 10, color: "#d6f5ff" }}>
                <span style={{ alignItems: "center", background: "#1a9fff", borderRadius: "50%", color: "#fff", display: "inline-flex", fontSize: 18, fontWeight: 700, height: 28, justifyContent: "center", width: 28 }}>✓</span>
                <strong>{t("appcard.downloadComplete")}</strong>
              </div>
              <div>
                <div style={{ color: "#8fcef4", fontSize: "0.9em", marginBottom: 5 }}>{t("dl.savedTo")}</div>
                <div style={{ background: "rgba(26, 159, 255, 0.16)", border: "1px solid rgba(100, 200, 255, 0.5)", borderRadius: 4, color: "#fff", overflowWrap: "anywhere", padding: "8px 10px" }}>{state.path || t("dl.selectedFolder")}</div>
              </div>
              <div style={{ borderLeft: "3px solid #1a9fff", paddingLeft: 10 }}>
                <div style={{ color: "#8fcef4", fontSize: "0.9em", marginBottom: 3 }}>{t("dl.installInDecky")}</div>
                <strong style={{ color: "#fff" }}>{t("dl.installPath")}</strong>
              </div>
            </>
          )}
        <Button style={{ ...iconRow, margin: 0, width: "100%" }} onClick={() => {
          if (active) void cancelDownload(jobId);
          closeModal?.();
        }}>
          {active ? <FaTimes /> : <FaCheck />} {active ? t("content.cancel") : t("dl.ok")}
        </Button>
      </div>
    </ModalRoot>
  );
}

export function showDownloadModal(t: TFunc, jobId: string, initial: Download, onSettled?: (state: Download) => void) {
  showModal(<DownloadModal t={t} jobId={jobId} initial={initial} onSettled={onSettled} />);
}
