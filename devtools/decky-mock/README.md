# decky-mock

Local, browser-based preview of DeckyHub's UI, for iterating on `src/` without a Steam Deck.

**What's real:** `src/` is imported unmodified. All backend calls (`get_apps`, `download_asset`, settings, etc.) go through `dev-server.py` to the actual `main.py` `Plugin` class — same logic, same registry, same GitHub API calls the real plugin makes.

**What's fake:** `@decky/ui` and `@decky/api` are swapped (via a Vite alias) for [ui.tsx](ui.tsx) and [api.ts](api.ts). The shell emulates Steam Deck's 1280×800 Gaming Mode: Quick Access is a right-side panel, routes render behind Steam-style top/bottom chrome, and controls use Steam-like focus styling. The real `@decky/ui` components are scraped at runtime from Steam's own webpack bundle, so this is a behavioral and layout approximation—not pixel-accurate SteamUI. Always do a final controller check on real hardware (or `steam -gamepadui` on Linux) before shipping a UI change.

## Run it

Two processes, both from this folder:

```bash
python dev-server.py   # backend bridge on :8642 — talks to the real main.py
npm install             # first time only
npm run dev              # frontend on :5183
```

Open the printed `http://localhost:5183` URL. The left nav lists the QAM widget, every route `src/index.tsx` registers (Updates, Discover, Repositories, Settings), and standalone buttons that open the real download-progress/download-complete modals without starting an actual download, plus one that raises the GitHub rate-limit banner on the current screen without exhausting the real limit.

## Browser tests

Install Chromium once, then run the Playwright suite. It starts the mock frontend and backend bridge itself, with GitHub release data stubbed for repeatable tests.

```bash
npx playwright install chromium
npm run test:e2e
```

![Discover page in the dev-mock, at Steam Deck density](screenshot.png)

## Known limitations

- `openFilePicker()` is a `window.prompt()` for an absolute path — there's no native file dialog in a browser. Good enough to test the import flow if you paste a real path on your machine.
- `Navigation.NavigateToExternalWeb()` opens a new browser tab instead of Steam's overlay browser.
- Outside the Playwright suite, GitHub isn't stubbed: browsing the mock spends your own IP's 60 requests/hour. Settings shows what's left; add a token there if you iterate a lot.
- Toasts, modals, and tabs are simplified divs/buttons, not Steam's real components.
- The backend bridge only runs calls whose `Origin` is the mock frontend (`http://localhost:5183` or `http://127.0.0.1:5183`), so other sites open in your browser can't drive it.
- The backend bridge stores its settings/registry cache under `.dev-data/` (gitignored) instead of `~/.config/decky-loader/...`, and fakes `decky.DECKY_HOME` for the "installed plugin" scan — so nothing here will ever show as "installed" unless you create fake `plugin.json` files under `.dev-data/plugins/<name>/`. Backend log lines (including errors the frontend forwards) print to the bridge's console and go to `.dev-data/logs/deckyhub.log`, which **Export Logs** zips into `.dev-data/home/Downloads/`.
- This whole `devtools/` folder is standalone tooling with its own `package.json` — it's not part of the plugin build and isn't shipped in releases.
