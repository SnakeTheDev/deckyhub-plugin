# DeckyHub skills

Use these project skills when working in this repository.

## Steam Deck UI

- Verify UI behavior in the mock and on real Steam Deck hardware before release. Controller-focus and modal rules are in [AGENTS.md](AGENTS.md#development-rules).
- Steam only scrolls to follow focus: text above a page's first focusable control is unreachable by controller. Wrap it in `<Focusable onActivate={() => {}}>` so D-pad up can land on it.
- Clickable non-button elements need both `onActivate` (A button) and `onClick` (touchscreen).
- Every new user-facing string needs its key in all 7 `src/i18n/*.ts` files (`en.ts` is the type source `tsc` enforces). Reuse an existing translation when the text already exists.

## Decky Loader

- `utilities/install_plugin` shows Decky's own confirm dialog; `utilities/uninstall_plugin` deletes the plugin and its settings immediately — always confirm first.
- Check route names and behavior in decky-loader's `backend/decky_loader/utilities.py` and `browser.py` before relying on them.

## GitHub API

- Every release lookup goes through `fetchReleases(repo)` in `src/utils.ts` (one shared per-repo cache); don't add separate GitHub fetches.
- Unauthenticated use gets 60 requests/hour per IP: count the requests a change adds. `GET /rate_limit` is free.

## Verification

Commands are in [AGENTS.md](AGENTS.md#commands).

## Test hygiene

Every test must be able to fail when the behavior it names breaks. Delete fake and redundant tests rather than keeping them for the count; when you touch a test file, clean up what you find there.

- Fake: asserts only what a mock, fixture or `route.fulfill` stub was set up to return; checks a constant against itself; passes with the code under test removed or stubbed out; or catches every error so nothing can fail.
- Mislabeled: the name says something different from what the test asserts (e.g. `..._defaults_to_false` asserting `True`). Rename it to match the code if the behavior is intended; otherwise fix the code.
- Redundant: covers the same behavior and branch as another test with no new input or edge case, including a backend unit test duplicated by an E2E test (or the reverse) at no extra depth. Keep the cheaper or more specific one.
- Before deleting, name the test that still covers the behavior, or confirm the behavior is gone. If nothing else covers it, rewrite the test so it can fail; don't delete it.
- To check that a test is real, break the code it covers and confirm it fails, then revert.

## Browser tests and the mock

- Mocked GitHub list endpoints (`/releases?per_page=20`, …) must return arrays, like the real API.
- `devtools/decky-mock/.dev-data/settings.json` is shared by the interactive mock and the E2E bridge: tests that depend on settings reset them first and restore them in `finally`. Don't use `--repeat-each` on them (it runs copies in parallel on that file).
- Fake Decky Loader with `page.addInitScript` setting `window.DeckyBackend` to record calls; seed installed plugins as `.dev-data/plugins/<name>/plugin.json` and remove them in `finally`.
- Send keys from a locator inside the mock's iframe (`locator.press`); `page.keyboard` goes to the outer page.
- Wait for async-loaded state (e.g. the saved token appearing) before typing into a field.
- Restart `dev-server.py` after backend changes — it doesn't reload `main.py`, and a stale bridge shows blank pages.
- When timing in the in-app browser pane, use a `MutationObserver`, not `setTimeout` polling: background timers are throttled to ~1 s.

## Docs and website

Every change that alters what a user sees or does updates the docs in the same PR. `tests/test_docs.py` (run by `pnpm run test:backend`) enforces the mechanical parts.

- User-visible behavior (screens, buttons, settings, install/download flow): update README's matching section, and the promo page's features/FAQ in `docs/index.html` if it describes it.
- Registry apps added, removed or renamed in `registry/apps.json`: regenerate README's **Bundled repositories** table in the same order. The promo page's catalog is built from the file at deploy time.
- Screenshots: replace the JPEG in `screenshots/`; the site build makes its WebP copies. A new screenshot also needs an `<img>` in `docs/index.html`.
- New page in `docs/`: add it to `docs/sitemap.xml` and give it a `<title>`, meta description and canonical URL.
- Architecture, commands or dev rules change: update `AGENTS.md`; release or contribution steps: `CONTRIBUTING.md`.
- Before finishing, grep the docs for names you renamed or removed.

## Security

- Download only GitHub release assets that belong to the selected repository.
- Treat repository names and imported files as untrusted input; validate them at the backend boundary.
- Preserve SHA-256 verification for DeckyHub self-updates. Other plugins may install without a checksum (Decky receives an empty hash).

## Release

- One topic per PR (PRs are squash-merged, see CONTRIBUTING.md); the PR must typecheck.
- Push a `v*` tag only after all checks pass.
- Cut a release only when the plugin ZIP changes (`plugin.json`, `main.py`, `backend/`, `src/`, `registry/`, `package.json`). Docs- or website-only changes ship by merging to `main`; a release with no plugin change still pings every user with an update toast.
- If the release workflow fails after the tag is pushed, fix it and bump to the next rc; never move a published tag.
- Changes to install/download/uninstall behavior also update README, `CONTRIBUTING.md` and `AGENTS.md`, which describe that policy.
- Release steps: [CONTRIBUTING.md](CONTRIBUTING.md#releases). Release notes (every release, pre-releases too): the Release section of [AGENTS.md](AGENTS.md#release).
