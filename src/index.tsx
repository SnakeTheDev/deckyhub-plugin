import { addEventListener, definePlugin, removeEventListener, routerHook } from "@decky/api";
import { staticClasses } from "@decky/ui";
import type { ReactNode } from "react";
import { FaGithub } from "react-icons/fa";
import { REGISTRY_UPDATED } from "./api";
import { I18nProvider } from "./i18n";
import { Content } from "./pages/Content";
import { ManageRepositoriesPage } from "./pages/ManageRepositoriesPage";
import { SettingsPage } from "./pages/SettingsPage";
import { pageStyle } from "./utils";

const MOTION_CSS = `
  @media (prefers-reduced-motion: no-preference) {
    @keyframes deckyhub-enter { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
    .deckyhub-motion { animation: deckyhub-enter 220ms cubic-bezier(.2, .8, .2, 1) both; }
    .deckyhub-motion button { transition: transform 140ms ease, filter 140ms ease; }
    .deckyhub-motion button:hover, .deckyhub-motion button:focus-visible { transform: translateY(-1px); filter: brightness(1.08); }
  }
`;

function Motion({ children }: { children: ReactNode }) {
  return <div className="deckyhub-motion" style={{ height: "100%" }}><style>{MOTION_CSS}</style>{children}</div>;
}

const ROUTES: Record<string, () => ReactNode> = {
  "/deckyhub/updates": () => <Content fullPage="updates" />,
  "/deckyhub/discover": () => <Content fullPage="discover" />,
  "/deckyhub/settings": () => <SettingsPage />,
  "/deckyhub/repositories": () => <ManageRepositoriesPage />,
};

// The backend refreshes the registry in the background after startup; forward its
// event to the window one the pages already reload on.
const onRegistryUpdated = () => window.dispatchEvent(new Event(REGISTRY_UPDATED));

export default definePlugin(() => {
  addEventListener("registry_updated", onRegistryUpdated);
  for (const [path, page] of Object.entries(ROUTES)) {
    routerHook.addRoute(path, () => (
      <Motion>
        <div style={pageStyle}>
          <I18nProvider>{page()}</I18nProvider>
        </div>
      </Motion>
    ));
  }
  return {
    name: "DeckyHub",
    titleView: <div className={staticClasses.Title}>DeckyHub</div>,
    content: (
      <Motion>
        <I18nProvider>
          <Content />
        </I18nProvider>
      </Motion>
    ),
    icon: <FaGithub />,
    onDismount() {
      Object.keys(ROUTES).forEach((path) => routerHook.removeRoute(path));
      removeEventListener("registry_updated", onRegistryUpdated);
    },
  };
});
