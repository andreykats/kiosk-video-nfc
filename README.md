# Kiosk

A browser kiosk for Google Chrome on Windows and macOS. While idle it plays a loop video fullscreen. When someone scans a paired NFC card, it plays that card's video once and then goes back to the loop. Cards that aren't paired do nothing.

- **Reader:** an ACS NFC reader (ACR1552U or ACR1255U-J1), read one of two ways, chosen per kiosk in Settings → **Card reader**:
  - **HID Keyboard:** the reader types the card UID and then Enter. Nothing to install.
  - **NFC Browser Bridge:** the [NFC Browser Bridge](https://github.com/andreykats/nfc-browser-bridge) app, running in the tray or menu bar, passes cards to the page. It also reads the card's **card ID** (NDEF), and taps work even when the kiosk window isn't focused.
- **Hosting:** GitHub Pages (see [Deployment](#deployment)). After the first load, the app works offline (it's an installable PWA). Below, `<url>` stands for the site's address, ending in `/`.
- **Videos:** each kiosk imports its own copies into browser storage (the origin private file system). Videos are never uploaded to GitHub.
- **Config:** a `config.json` file lists the videos, card pairings and admin cards. You set it up on one kiosk, export it, and import it on the others (see [Sharing config changes](#sharing-config-changes)).

Full design: [PLAN.md](PLAN.md). Kiosk machine setup: [docs/kiosk-setup.md](docs/kiosk-setup.md).

## Using it

On first launch, a **setup guide** starts with a welcome card, then walks through each step: connect the reader, load or start a config, add videos, pair cards / pick the background loop, pair an admin card, and set the kiosk to open at startup. Installing the app is optional and lives at the bottom of settings (**Install as Chrome App**). You can reopen it from Settings → **Setup guide**.

| | |
|---|---|
| Open settings | **Ctrl+Shift+S**, or scan an admin card |
| Leave settings | **Back to kiosk**, scan an admin card (unless a dialog is waiting for a card), or wait 3 minutes without touching anything (this timer pauses while videos import) |
| Pair a card | Settings → Videos → **Pair** next to the video, then scan one or more cards. Or Settings → Cards → **Pair new card**, scan the card, pick a video |
| Remove a tag | Settings → Tags → **Remove tag**, scan the tag, press **Remove**. Or **Remove** on its row. Admin tags are refused here: remove them under Admin tags |
| Add an admin card | Settings → Admin cards → **Add admin card**, scan the card |
| Pick the loop video | Settings → Videos → the **Loop** radio button |
| See how often videos play | Settings → Videos → **Plays**: how many times a card played each video on this kiosk (the loop's repeats don't count). **Reset counter** sets them all back to 0 |
| Start over | Settings → Reset → **Reset configuration** deletes this kiosk's videos and config, then restarts the setup guide (export the config first to keep it) |

By default, scanning a card while a card video is playing does nothing: the video plays to the end first. To let a scan interrupt it instead, tick Settings → **Playback** → **Tag scans interrupt the playing video** (stored per kiosk). The scanned card's video then starts at once, and the same card again starts its video over. An admin card opens settings either way.

**Keyboard shortcut:** press **Ctrl+Shift+S** to open settings from the kiosk screen or the setup guide. It's the same three keys on Windows and on a Mac, where you press **Control**, not Cmd. Chrome doesn't use this combination for anything else. (Earlier versions used Ctrl+Alt+Shift+S, which no longer works.)

## Running a kiosk (launch command)

For a live kiosk, start Chrome with this command instead of opening the installed app's icon:

```
chrome --kiosk --autoplay-policy=no-user-gesture-required <url>
```

| Flag | What it does |
|---|---|
| `--kiosk` | Opens the site fullscreen with no Chrome toolbars, tabs or title bar. |
| `--autoplay-policy=no-user-gesture-required` | Lets videos play with sound without anyone clicking first. Without it, Chrome plays them muted. |

Step 7 of the setup guide (**Open the kiosk at startup**) shows the command for this computer with a **Copy command** button. The startup command opens `<url>?autostart`: the app records that launch, which turns **Opens at startup** green in the settings checklist, and removes `?autostart` from the address.

**Windows:** press Win+R, run `shell:startup`, and in that folder create a shortcut with this target, so it starts at login:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required <url>?autostart
```

**macOS:** run this in Terminal as the kiosk's user. It adds a LaunchAgent that runs `open -na "Google Chrome" --args --kiosk --autoplay-policy=no-user-gesture-required <url>?autostart` at login, stops Chrome from opening by itself, and turns on automatic login ([public/mac-kiosk-autostart.sh](public/mac-kiosk-autostart.sh); `--dry-run` and `--url` are explained in `--help`):

```
curl -fsSL <url>mac-kiosk-autostart.sh | bash -s -- --url <url>
```

It saves what it changed, so running it with `--uninstall` puts it back. Once the kiosk has opened at startup, Settings → **Open at startup** shows that command. It opens the kiosk with `?autostart=removed` when it's done, so the app forgets the launch and shows the setup steps again.

Chrome only applies the flags when it isn't already running, so the script makes sure Chrome doesn't open by itself at login.

- **Exiting kiosk mode:** Alt+F4 on Windows, Cmd+Q on a Mac.
- **Same data as the installed app:** the kiosk-mode window uses the same storage as the installed app, so it has the same videos and config. Do the setup guide first (in the installed app or a normal Chrome window), then switch to the launch command.
- **Why not the app icon:** Chrome opens the installed app in a window with its own title bar (app name, Uninstall, extensions and the ⋮ menu), and a web page can't hide that bar. The app goes fullscreen, which hides it, once someone opens the kiosk from settings or the setup guide (← Back to kiosk, Start kiosk, or an admin card in settings), and on any click or card scan after that, but it can't do that by itself at launch. Kiosk mode is fullscreen from the start. The only way to make the installed app fullscreen at launch without a click is the Chrome admin policy `AutomaticFullscreenAllowedForUrls` set to the site's origin, which Chrome only honours on managed machines.
- **Keep the window focused:** the reader types into whichever window has focus, so nothing else should be open on top of the kiosk.

Full machine setup, including sleep settings and an offline test: [docs/kiosk-setup.md](docs/kiosk-setup.md).

## Sharing config changes

Kiosks never apply config changes on their own. Configs are copied between kiosks as files. To roll out a change:

1. On the kiosk where you made the changes, open Settings → Config → **Export config**. This downloads `config.json`.
2. Copy `config.json` to each of the other kiosks, for example on the USB stick with the videos.
3. On each kiosk, open Settings → Config → **Import config from file**, pick the file, check the summary, and confirm.
4. If the summary lists videos that are missing on that kiosk, use Videos → **Import folder** to copy them.

**Update from published config** is shown in settings but switched off. When it's on, it applies `public/config.json` from this repo instead of a file. To turn it back on, set `PUBLISHED_CONFIG_ENABLED` to `true` in `src/config/sync.ts`.

Importing a config replaces the kiosk's config completely. Any changes made locally on that kiosk are lost, and the confirm dialog warns about this.

A video's `fileName` is its identity on every kiosk. Each kiosk must import a file with exactly that name.

## Reader configuration

Staff choose the **Card reader input method** and the **Card identifier** in Settings → **Card reader** (the setup guide asks on its reader step). The kiosk never switches by itself. Both choices are stored on each kiosk, not in the shared config.

| Mode | When to use it |
|---|---|
| **HID Keyboard** (default) | No software can be installed on the kiosk. Cards are matched by UID only. |
| **NFC Browser Bridge** | The bridge app is installed. Cards are matched by the kiosk's card identifier: UID (the default) or NDEF payload. If the bridge app or the reader is missing, the kiosk screen says so. |

### NFC Browser Bridge

1. Install the bridge app from its [Releases page](https://github.com/andreykats/nfc-browser-bridge/releases) and let it start at login (see its README).
2. Keep the reader in its factory **CCID** mode. No ACS tool needed.
3. In Settings → **Card reader**, choose **NFC Browser Bridge**. The kiosk connects straight away, and Chrome asks to allow **Apps on device** for this site: choose **Allow**. Chrome remembers this for the Chrome profile. Managed machines can skip the prompt with the Chrome policy `LoopbackNetworkAllowedForUrls` set to the site's origin.
4. Hold a card on the reader. Settings → Diagnostics shows its UID, card ID and NDEF records.

On a Mac the bridge also watches for a reader that is plugged in but stopped working, and restarts it over USB as if it had been replugged. The kiosk screen says "The NFC reader isn’t responding. Restarting it…" meanwhile, and "Unplug it and plug it back in" if that didn't help. Staff can restart it by hand with **Reset reader** in Settings → **Tag reader**. Reader changes, restarts and the screen notices are written to Settings → Diagnostics → log.

### Card identifier

Each kiosk identifies video cards one way, chosen under **Card identifier** in Settings → **Card reader**. Pairing never asks; it uses this setting.

- **NDEF payload (card ID):** the value of the card's first **URI** record (the full URL), or, if it has none, its first **Text** record (without the language code), compared exactly. Every card written with the same ID plays the same video. Use it for batches of identical cards. Needs the NFC Browser Bridge; cards without a URI or Text record can't be paired.
- **UID:** only that physical card. HID Keyboard mode always uses the UID.

The Tags and Admin tags tables in settings have a **UID** and an **NDEF** column. When a tag is paired through the NFC Browser Bridge, the kiosk also records the identifier it doesn't pair by, just for display. Tags paired with an HID keyboard reader show a dash under NDEF.

A kiosk ignores pairings of the other kind, so a shared config can hold both. Settings → Card reader warns when the config has cards this kiosk won't recognise, and the Cards list marks them. Admin cards are always added by UID, so a card ID shared by visitor cards can never open settings; they win over video cards.

### HID Keyboard mode on the ACR1552U

The reader ships in CCID (smart card) mode. On a Mac, switch it by pasting this into Terminal: `curl -fsSL <url>acr1552-mode.sh -o /tmp/acr1552-mode.sh && bash /tmp/acr1552-mode.sh hid`. It asks for an admin password. A web page can't open Terminal itself, and a script downloaded by the browser is blocked by Gatekeeper, but one fetched with curl isn't. [`public/acr1552-mode.sh`](public/acr1552-mode.sh) also takes `get`, `ccid` and `both`. In HID-only mode the script can't switch the reader back, so it asks first; `both` keeps HID and CCID. It only changes the mode, so check the output settings below.

Otherwise, use ACS's configuration tool (Windows only) **once per reader**:

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
npm run dev          # http://localhost:5173/kiosk-video-nfc-website/ (no service worker in dev)
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

`.github/workflows/deploy.yml` runs the unit tests, builds, and deploys to GitHub Pages on every push to `main`. In the repo, **Settings → Pages → Source** is set to **GitHub Actions**, with the custom domain `topps.drey.dev` and HTTPS enforced.

The published app's name (window title, installed app name, setup guide) comes from the `APP_NAME` variable under **Settings → Secrets and variables → Actions → Variables**, set to `Topps Kiosk`. Without it, and in local builds, the app is called `Kiosk`. Keep the source generic: what's specific to the published app goes in these repo settings, not in the code.

Every deploy gets the next version number: v1.0.1, v1.0.2, and so on. The workflow finds the highest `v1.0.N` tag, builds with `1.0.(N+1)`, and pushes that tag once the deploy succeeds. The version shows in the settings header and on step 1 of the setup guide. To start a new series (e.g. v1.1.1), change `version` in `package.json` to `1.1.0`. Local builds show `<package version>-dev`.

The workflow sets Vite's `base` from the Pages path, which is `/` on the custom domain. Local builds default to `/kiosk-video-nfc-website/`, which you can override with `BASE_PATH=/other-name npm run build`.

`config.json` is never precached by the service worker, so **Update from published config** would always fetch the latest file if it's switched back on.

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
