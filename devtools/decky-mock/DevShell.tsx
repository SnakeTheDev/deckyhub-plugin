import { useEffect, useState } from "react";
import { showDownloadModal } from "../../src/components/DownloadProgress";
import { en, type MessageKey } from "../../src/i18n/en";
import pluginFactory from "../../src/index";
import { reportRateLimit, substitute } from "../../src/utils";
import { routerHook } from "./api";

const previewText = (key: MessageKey, vars?: Record<string, string | number>) => substitute(en[key], vars);

export default function DevShell() {
  const [, forceUpdate] = useState(0);
  const [descriptor, setDescriptor] = useState<{ name: string; content?: React.ReactElement; onDismount?: () => void } | null>(null);
  const [activePath, setActivePath] = useState<string | null>(() => new URLSearchParams(window.location.search).get("preview"));

  useEffect(() => {
    const onRoutesChanged = () => forceUpdate((value) => value + 1);
    const onNavigate = (event: Event) => setActivePath((event as CustomEvent<string>).detail);
    window.addEventListener("decky-mock-routes-changed", onRoutesChanged);
    window.addEventListener("decky-mock-navigate", onNavigate);
    const result = pluginFactory();
    setDescriptor(result);
    return () => {
      window.removeEventListener("decky-mock-routes-changed", onRoutesChanged);
      window.removeEventListener("decky-mock-navigate", onNavigate);
      result.onDismount?.();
    };
  }, []);

  useEffect(() => {
    const moveFocus = (direction: string) => {
      if (!(["Up", "Down", "Left", "Right"] as string[]).includes(direction)) return;
      const current = document.activeElement as HTMLElement;
      if (current instanceof HTMLInputElement || current instanceof HTMLSelectElement || current instanceof HTMLTextAreaElement) return;
      const targets = Array.from(document.querySelectorAll<HTMLElement>(
        ".steam-screen button:not(:disabled), .steam-screen a[href], .steam-screen input:not(:disabled):not([type=hidden]), .steam-screen select:not(:disabled), .steam-screen textarea:not(:disabled), .steam-screen [role=button]:not([aria-disabled=true]), .steam-screen [onclick], .steam-screen [tabindex]:not([tabindex='-1'])",
      )).filter((target) => target.getClientRects().length).map((target) => {
        if (target.tabIndex < 0) target.tabIndex = 0;
        return target;
      });
      if (!targets.length) return;
      if (!targets.includes(current)) {
        targets[0].focus();
        return true;
      }
      const origin = current.getBoundingClientRect();
      const center = (rect: DOMRect, axis: "x" | "y") => axis === "x" ? rect.left + rect.width / 2 : rect.top + rect.height / 2;
      const axis = direction === "Left" || direction === "Right" ? "x" : "y";
      const sign = direction === "Left" || direction === "Up" ? -1 : 1;
      const candidates = targets
        .filter((target) => target !== current)
        .map((target) => {
          const rect = target.getBoundingClientRect();
          const primary = (center(rect, axis) - center(origin, axis)) * sign;
          const secondary = Math.abs(center(rect, axis === "x" ? "y" : "x") - center(origin, axis === "x" ? "y" : "x"));
          const overlap = axis === "x"
            ? Math.min(rect.bottom, origin.bottom) > Math.max(rect.top, origin.top)
            : Math.min(rect.right, origin.right) > Math.max(rect.left, origin.left);
          return { target, primary, secondary, overlap };
        })
        .filter(({ primary }) => primary > 1);
      const next = (candidates.some(({ overlap }) => overlap) ? candidates.filter(({ overlap }) => overlap) : candidates)
        .sort((a, b) => a.primary - b.primary || a.secondary - b.secondary)[0]?.target;
      if (next) {
        next.focus();
        return true;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const moved = moveFocus(event.key.replace("Arrow", ""));
      if (moved) event.preventDefault();
    };
    let lastDirection = "";
    let pollTimer = 0;
    const pollController = () => {
      const controller = navigator.getGamepads?.().find(Boolean);
      const buttons = controller?.buttons;
      const direction = buttons?.[12]?.pressed ? "Up" : buttons?.[13]?.pressed ? "Down" : buttons?.[14]?.pressed ? "Left" : buttons?.[15]?.pressed ? "Right" : Math.abs(controller?.axes[0] ?? 0) > Math.abs(controller?.axes[1] ?? 0) ? (controller!.axes[0] > .5 ? "Right" : controller!.axes[0] < -.5 ? "Left" : "") : controller?.axes[1] > .5 ? "Down" : controller?.axes[1] < -.5 ? "Up" : "";
      if (direction && direction !== lastDirection) moveFocus(direction);
      lastDirection = direction;
      pollTimer = window.setTimeout(pollController, 100);
    };
    document.addEventListener("keydown", onKeyDown);
    pollController();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(pollTimer);
    };
  }, []);

  if (!descriptor) return null;
  const routes = Array.from(routerHook._routes.entries());
  const ActivePage = activePath ? routerHook._routes.get(activePath) : null;

  return (
    <div className="steam-mock">
      <div className={`steam-deck${ActivePage ? " steam-deck-full" : ""}`}>
        <nav className="preview-nav" aria-label="Developer preview routes">
          <p className="preview-title">Preview</p>
          <button className={`preview-route ${activePath === null ? "preview-route-active" : ""}`} onClick={() => setActivePath(null)}>
            Quick Access widget
          </button>
          <button className="preview-route" onClick={() => showDownloadModal(previewText, "preview-job", { state: "downloading", filename: "Decky-Framegen.zip", received: 57.3 * 1024 * 1024, total: 190.3 * 1024 * 1024 })}>
            Download progress modal
          </button>
          <button className="preview-route" onClick={() => showDownloadModal(previewText, "preview-job", { state: "complete", path: "/home/deck/Downloads/deckyhub/DeckyHub-v1.0.2-rc.4.zip" })}>
            Download complete modal
          </button>
          <button className="preview-route" onClick={() => showDownloadModal(previewText, "preview-job", { state: "error", filename: "Decky-Framegen.zip", error: "HTTP Error 404: Not Found" })}>
            Download failed modal
          </button>
          <button className="preview-route" onClick={() => reportRateLimit(12)}>
            Rate limit banner
          </button>
          {routes.map(([path]) => (
            <button key={path} className={`preview-route ${activePath === path ? "preview-route-active" : ""}`} onClick={() => setActivePath(path)}>
              {path}
            </button>
          ))}
        </nav>
        <main className="steam-screen">
        {ActivePage ? (
          <div className="steam-page">
            <header className="steam-topbar"><span className="steam-brand">STEAM</span><span>⌕ &nbsp; ◉ &nbsp; ◔ &nbsp; ▰ &nbsp; 12:34 PM</span></header>
            <div className="steam-page-content">
              <ActivePage />
            </div>
            <footer className="steam-bottombar"><span className="steam-menu">STEAM &nbsp; MENU</span><span>Ⓐ Select &nbsp;&nbsp; Ⓑ Back</span></footer>
          </div>
        ) : (
          <div className="game-backdrop">
            <aside className="qam-panel">
              <header className="qam-header"><span className="qam-title">⋯ <span>Quick Access</span></span><span>⚙</span></header>
              <p className="qam-app-name">{descriptor.name}</p>
              <div className="qam-content">{descriptor.content}</div>
              <footer className="steam-bottombar"><span className="steam-menu">STEAM &nbsp; MENU</span><span>Ⓐ Select &nbsp;&nbsp; Ⓑ Back</span></footer>
            </aside>
          </div>
        )}
        </main>
      </div>
    </div>
  );
}
