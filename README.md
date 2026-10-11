# Topps Kiosk

A browser kiosk for Google Chrome on Windows and macOS. While idle it plays a loop video fullscreen. When someone scans a paired NFC card, it plays that card's video once and then goes back to the loop. Cards that aren't paired do nothing.

- **Reader:** ACS ACR1552U in USB keyboard-emulation mode. The reader types the card UID and then Enter. No drivers or helper apps are needed.
- **Hosting:** GitHub Pages. After the first load, the app works offline (it's an installable PWA).
- **Videos:** each kiosk imports its own copies into browser storage (the origin private file system). Videos are never uploaded to GitHub.
- **Shared config:** `public/config.json` in this repo lists the videos, card pairings and admin cards. All kiosks use it.

Full design: [PLAN.md](PLAN.md). Kiosk machine setup: [docs/kiosk-setup.md](docs/kiosk-setup.md).

## Using it

On first launch, a **setup guide** walks through each step: install the app, connect the reader, load or start a config, add videos, pair cards / pick the background loop, and pair an admin card. You can reopen it from Settings → **Setup guide**.

| | |
|---|---|
| Open settings | **Ctrl+Alt+Shift+S** (Ctrl+Option+Shift+S on a Mac), or scan an admin card |
| Leave settings | **Back to kiosk**, or wait 3 minutes without touching anything (this timer pauses while videos import) |
| Pair a card | Settings → Cards → **Pair new card**, scan the card, pick a video |
| Add an admin card | Settings → Admin cards → **Add admin card**, scan the card |
| Pick the loop video | Settings → Videos → the **Loop** radio button |
| Start over | Settings → Reset → **Reset configuration** deletes this kiosk's videos and config, then restarts the setup guide (export the config first to keep it) |

Scanning a card while a card video is playing does nothing. An admin card still opens settings.

## Sharing config changes

Kiosks never apply config changes on their own. Configs are copied between kiosks as files. To roll out a change:

1. On the kiosk where you made the changes, open Settings → Config → **Export config**. This downloads `config.json`.
2. Copy `config.json` to each of the other kiosks, for example on the USB stick with the videos.
3. On each kiosk, open Settings → Config → **Import config from file**, pick the file, check the summary, and confirm.
4. If the summary lists videos that are missing on that kiosk, use Videos → **Import folder** to copy them.

**Update from published config** is shown in settings but switched off. When it's on, it applies `public/config.json` from this repo instead of a file. To turn it back on, set `PUBLISHED_CONFIG_ENABLED` to `true` in `src/config/sync.ts`.

Importing a config replaces the kiosk's config completely. Any changes made locally on that kiosk are lost, and the confirm dialog warns about this.

A video's `fileName` is its identity on every kiosk. Each kiosk must import a file with exactly that name.

## Reader configuration (ACR1552U)

Use ACS's configuration tool (Windows only) **once per reader**:

| Setting | Value |
|---|---|
| Mode | Keyboard emulation, card UID |
| Output format | Hex, **uppercase** |
| Byte separator | Any (the app removes spaces, `-` and `:`) |
| Suffix | **Enter** |
| Byte order | **Normal** (not reversed) |

**Every kiosk's reader must use the same settings.** Otherwise the same card produces a different UID on each kiosk and won't match the shared config. To check a reader, scan a card and look at Settings → Diagnostics → **Last scanned UID**.

> To confirm on the hardware: check that the ACS tool offers all of these options under these names. If it doesn't, update this table.

## Development

```sh
npm install
npm run dev          # http://localhost:5173/topps-nfc-kiosk/ (no service worker in dev)
npm test             # unit tests (Vitest)
npm run test:e2e     # end-to-end tests (Playwright, uses your installed Google Chrome)
npm run build        # type-check + production build into dist/
npm run fixtures     # regenerate the test videos in tests/fixtures (needs ffmpeg)
node scripts/make-icons.mjs   # regenerate public/icons
```

The e2e tests build the app and serve it with `vite preview`. They use `channel: 'chrome'` because the test videos are H.264, which the bundled Chromium can't play.

To simulate a reader by hand, focus the page and run this in DevTools. It types a UID quickly and then presses Enter:

```js
for (const c of '04A23B1C5D8000') window.dispatchEvent(new KeyboardEvent('keydown', { code: /\d/.test(c) ? `Digit${c}` : `Key${c}` }));
window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter' }));
```

### Deployment

`.github/workflows/deploy.yml` runs the unit tests, builds, and deploys to GitHub Pages on every push to `main`. In the repo, set **Settings → Pages → Source** to **GitHub Actions**. The workflow sets Vite's `base` from the Pages path, so the repo name doesn't need to be hard-coded. Local builds default to `/topps-nfc-kiosk/`, which you can override with `BASE_PATH=/other-name npm run build`.

`config.json` is never precached by the service worker, so **Update** always fetches the latest published file.

### Layout

```
src/main.ts                 router (#/ kiosk, #/settings), startup
src/kiosk/                  playback state machine (pure) + video view
src/scan/                   keyboard-wedge burst parser (pure) + DOM adapter
src/config/                 schema/validation/migration, IndexedDB store, export/import/update
src/videos/                 OPFS storage (streamed import, .partial + rename), import planning
src/pwa/                    install-state detection, offline-readiness checks, SW registration
src/onboarding/             first-launch setup guide (step logic is pure)
src/settings/               settings sections and scan dialogs
tests/unit, tests/e2e       Vitest and Playwright suites; tests/fixtures holds small H.264 videos
```
