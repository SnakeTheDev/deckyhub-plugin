# DeckyHub

<div align="center">

[![Release](https://img.shields.io/github/v/release/mazillka/deckyhub-plugin)](https://github.com/mazillka/deckyhub-plugin/releases/latest)
[![Tests](https://img.shields.io/github/actions/workflow/status/mazillka/deckyhub-plugin/ci.yml?branch=main&label=tests)](https://github.com/mazillka/deckyhub-plugin/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)](LICENSE.md)
[![Platform](https://img.shields.io/badge/platform-SteamOS-green)](https://store.steampowered.com/steamos)

### Menu
<img src="screenshots/menu.jpg" width="600" alt="DeckyHub Menu screen">

### Discover
<img src="screenshots/discover.jpg" width="600" alt="DeckyHub Discover screen">

### Updates
<img src="screenshots/updates.jpg" width="600" alt="DeckyHub Updates screen">

### Manage
<img src="screenshots/manage.jpg" width="600" alt="DeckyHub Manage screen">

</div>

**Your Steam Deck's plugin store — right inside Gaming Mode.** · [Website](https://mazillka.github.io/deckyhub-plugin/)

Tired of tabbing out to Desktop Mode, hunting through GitHub releases, and manually downloading ZIPs every time a plugin updates? DeckyHub brings plugin discovery and updates straight to your controller. Browse a curated catalog of the best Steam Deck tools, track any GitHub repo you want, and get notified the moment an update drops — all without leaving your couch.

> **A note on how this is made.** Most of DeckyHub's code was written with the help of AI tools (Claude and Codex). That doesn't mean it ships untested — every release is verified on real hardware before it goes out. I'm telling you this upfront so you know exactly what you're installing and how it got built.

## Why you'll like it

- **Never miss an update** — DeckyHub checks your installed plugins against their latest GitHub releases and pings you with a toast the moment something new is available.
- **No more zip-hunting** — search, download, and see exactly which release asset you need without opening a browser.
- **Built for the couch** — full gamepad navigation, color-coded status at a glance, and one-tap downloads designed for Gaming Mode, not a desktop browser squeezed onto a small screen.
- **You stay in control** — DeckyHub never installs or runs anything on its own. Nothing touches your system until you say so, and installs go through Decky Loader's own installer and confirmation dialog (see [Manage](#manage)).

## What it does

- **Discover** — browse a curated list of Steam Deck plugins/tools, filter by search or installed status, and see release info at a glance, color-coded by status.
- **Updates** — see which of your tracked, installed tools have a newer release available, and download updates in one tap. You'll also get a toast notification when new updates show up.
- **Repositories** — search GitHub, add or remove tracked repositories, and export/import your list. Per-repository release-channel overrides live behind each app's **Manage** button on Discover/Updates instead.
- **Settings** — shows the fixed DeckyHub download folder, toggles overwriting existing files, lets you add an optional GitHub personal access token to raise the API rate limit, checks for DeckyHub's own updates (**Check Update**), and lets you pick how many items show per row (1–3) in the app grid. A separate **Cleanup** section clears the download folder's contents with confirmation.

DeckyHub never installs or runs anything automatically. **Download ZIP** saves a release, which you install yourself via Decky → Developer → Install Plugin from ZIP. For one-tap install, update and uninstall, see [Manage](#manage).

## Bundled repositories

No setup, no configuration — these show up in Discover the moment you install DeckyHub:

| Tool | Category | Repository |
| --- | --- | --- |
| MAKO Decky | Frame Generation | [eugeniosegala/MAKO](https://github.com/eugeniosegala/MAKO) |
| Decky LSFG-VK | Frame Generation | [xXJSONDeruloXx/decky-lsfg-vk](https://github.com/xXJSONDeruloXx/decky-lsfg-vk) |
| Unifideck | Game Libraries | [mubaraknumann/unifideck](https://github.com/mubaraknumann/unifideck) |
| Decky Framegen | Frame Generation | [xXJSONDeruloXx/Decky-Framegen](https://github.com/xXJSONDeruloXx/Decky-Framegen) |
| Nexus Mods | Mod Managers | [RedRanger14/decky-nexus](https://github.com/RedRanger14/decky-nexus) |
| Decky Proton Launch | Launch Options | [moi952/decky-proton-launch](https://github.com/moi952/decky-proton-launch) |
| Launch Options | Launch Options | [Wurielle/decky-launch-options](https://github.com/Wurielle/decky-launch-options) |
| Non-Steam Badges | Game Libraries | [sebet/decky-nonsteam-badges](https://github.com/sebet/decky-nonsteam-badges) |
| Decky-Undervolt | Performance | [totallynotbakadestroyer/Decky-Undervolt](https://github.com/totallynotbakadestroyer/Decky-Undervolt) |
| ProtonDB Badges | Game Libraries | [bschelst/protondb-decky](https://github.com/bschelst/protondb-decky) |
| CSS Loader | Customization | [DeckThemes/SDH-CssLoader](https://github.com/DeckThemes/SDH-CssLoader) |
| Deck as Controller | Controllers | [jmedina21/deck-as-controller](https://github.com/jmedina21/deck-as-controller) |
| BGFX | Frame Generation | [andrewmd5/decky-bgfx](https://github.com/andrewmd5/decky-bgfx) |
| ThemeHub | Customization | [Kaal31/benderthemes](https://github.com/Kaal31/benderthemes) |

Want more? Add any other GitHub repository from **Repositories** in seconds.

## Installing DeckyHub

1. Make sure [Decky Loader](https://decky.xyz/) is installed.
2. Download the latest `DeckyHub-v*.zip` from the [Releases page](https://github.com/mazillka/deckyhub-plugin/releases).
3. In Gaming Mode, open the Quick Access Menu → Decky → Developer → **Install Plugin from ZIP**, and select the downloaded file.
4. Open Quick Access Menu → Decky → **DeckyHub**.

## Using DeckyHub

### Discover

Browse the bundled list or search within it, and filter by **Status** — All, Installed, or Not Installed. Each card is color-coded (green once it's up to date, yellow when an update is available, red on an error) so you can spot what needs attention at a glance, and shows which release **Channel** (stable or pre-release) it's tracking. Tap **Manage** on any card to pick a channel and version, then download the release asset you want.

To track a repository that isn't in the curated list, go to **Repositories**, search for it, and add it — it'll show up in Discover from then on.

### Updates

Shows every tracked tool that's installed and has a newer release available, along with its installed and latest version. Download updates one at a time. The **Updates** button in the Quick Access Menu shows how many updates are waiting.

### Manage

Tap **Manage** on any card in Discover or Updates to:

- pick the release **channel** (stable or pre-release) and a specific **version**;
- **Download ZIP**, open the **Release Page**, or **Check for Updates** for that app;
- for a Decky plugin, **Install** (not installed yet) or **Update** (the selected version is newer than the installed one). This hands the release ZIP to Decky Loader's own installer, the same one the Decky Store uses. Decky asks you to confirm and installs it, verifying the SHA-256 checksum GitHub publishes for the ZIP. Older releases (files uploaded before mid-2025) have no checksum and Decky installs them without that check;
- for an installed Decky plugin, **Uninstall**, which asks you to confirm and then removes the plugin and its settings through Decky Loader.

### Downloads

All downloads are saved to `/home/deck/Downloads/deckyhub`. Settings can clear that folder after confirmation. Starting a download opens a progress dialog with a **Cancel** button; once it finishes, the same dialog shows where the ZIP was saved and how to install it. If a download is interrupted, no partial file is left behind.

When GitHub provides a checksum for a release asset, DeckyHub always verifies it before keeping the download. By default, downloading a file again overwrites the previous copy; turn off **Overwrite Existing Files** in Settings if you'd rather keep both.

### Repositories

Search GitHub for a repository and tap **Add** (repositories you already track show **Already Added** instead, so you can tell at a glance). Results page five at a time. Export your custom repositories to `DeckyHub-repositories.json` in `/home/deck/Downloads` to back them up or share them, or import that file back in. Any repository you've added can be removed again here; the curated repositories that ship with DeckyHub stay available and can't be removed. Prefer a bigger screen? The [Registry Editor](https://mazillka.github.io/deckyhub-plugin/editor.html) is a browser-based tool for building or editing a repository list file before importing it.

To switch a tracked app between stable and pre-release releases, use its [Manage](#manage) window.

### Keeping DeckyHub itself updated

Settings includes a **Check Update** option that looks for new stable releases (or pre-releases, if you opt in) of DeckyHub itself. A newer release triggers a notification; if you're already on the latest, it says no update is available. When an update is available, you get two ways to install it:

- **Update Automatically** — hands the release off to Decky Loader's own installer (the same one the Decky Store uses), which downloads, verifies, and installs it in place. No manual ZIP step needed.
- **Download ZIP** — the classic path: saves the update ZIP to `/home/deck/Downloads/deckyhub`, which you then install yourself via Decky → Developer → Install Plugin from ZIP.

If automatic update isn't available for some reason (e.g. running inside an older Decky Loader build), fall back to Download ZIP.

## Good to know

- DeckyHub talks to GitHub without needing you to log in, so very heavy use in a short time may still hit GitHub's public rate limit (60 requests/hour) — if it does, the error names it as a rate limit and says roughly how long to wait, rather than just a raw status code. Add a personal access token in **Settings → GitHub Access** (no scopes needed — it only reads public repos and releases) to raise that to 5,000/hour; the token stays on your device and is only ever sent to `api.github.com`.
- Release information is cached for 30 minutes, so opening the same app's Manage window or the DeckyHub update modal again shortly after won't always show something new. Every "Check for Updates" and "Refresh" button bypasses this and asks GitHub directly.
- Downloads only ever happen over HTTPS.

## Disclaimer

DeckyHub is only a discovery and download tool. All rights to the plugins and tools listed in its registry belong to their respective authors; DeckyHub does not own, endorse, or take responsibility for any third-party repository or its content.

## License

GPL-3.0-or-later — see [LICENSE.md](LICENSE.md).

## Getting help

Found a bug or have an idea? Open an issue on the [GitHub repository](https://github.com/mazillka/deckyhub-plugin/issues) with a description of what happened — feedback and suggestions are always welcome.

Want to build DeckyHub from source or contribute a change? See [CONTRIBUTING.md](CONTRIBUTING.md).
