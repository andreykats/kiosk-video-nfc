# Topps Kiosk — Implementation Plan

## 1. Goal

Build an offline-capable browser kiosk app:

- When idle, a selected **loop video** plays fullscreen on repeat.
- Scanning an NFC card that is **paired** to a video plays that video once, then returns to the loop.
- Scanning an **unpaired** card does nothing.
- A **settings page** adds and deletes videos, pairs cards to videos, pairs admin cards, and exports, imports and updates a shared config.
- **Several kiosks share one config** that is published to GitHub Pages. Video files are copied to each kiosk separately.

## 2. Decisions already made (do not revisit)

| Topic | Decision |
|---|---|
| NFC reader | **ACS ACR1552U or ACR1255U-J1**, read per kiosk either in **USB keyboard-emulation mode** (the reader "types" the UID; no helper app) or through the **NFC Browser Bridge** app (`ws://127.0.0.1:38241/v1`, see §6.3). No WebUSB, Web NFC or Web Serial. |
| Card identity | The card's **UID**, or its **card ID** (first URI or Text NDEF record, bridge only). **The kiosk never writes to cards.** |
| Browser / OS | **Google Chrome** on **Windows and macOS**. |
| Stack | **TypeScript + Vite**, no UI framework. **vite-plugin-pwa** for the service worker and manifest. |
| Hosting | **GitHub Pages** project site (`https://<user>.github.io/<repo>/`), deployed with the official GitHub Actions Pages workflow. The repo is **public**. |
| Video storage | Videos are **imported into the browser** (Origin Private File System, OPFS) on each kiosk. They are never hosted on GitHub. |
| Shared config | `config.json` is committed to the repo under `public/`, so it is served at `<base>/config.json`. |
| Publishing config | **Manual.** Settings → "Export config" downloads `config.json`. The admin uploads it to the repo in GitHub's web UI, and Actions redeploys. |
| Applying config on kiosks | **Manual.** Settings → "Update from published config". Kiosks never auto-apply. |
| Card UIDs in public config | **Plain text is acceptable**, including admin cards. |
| Scan while a paired video plays | **Ignored** until the video finishes and the loop resumes. |
| Settings access | **Keyboard shortcut OR scanning an admin card.** No PIN. Admin cards are paired in settings, and multiple admin cards are allowed. |
| PWA install | The app **actively asks staff to install it** as a PWA, and keeps asking until it's installed (see §9.2). |

## 3. Architecture overview

```
GitHub repo (public)
 ├─ app source (TS/Vite) ──► GitHub Actions ──► GitHub Pages (HTTPS)
 └─ public/config.json  ───────────────────────► <base>/config.json

Kiosk (Chrome, kiosk mode, app installed)
 ├─ Service worker: precached app shell → works offline after first load
 ├─ IndexedDB: active local config (copy of last applied config)
 ├─ OPFS /videos/: imported video files (keyed by file name)
 ├─ <video id=loop> + <video id=feature> (two elements, swapped)
 └─ Keyboard scanner: keydown burst → UID → state machine
```

Single-page app with **hash routing**: `#/` is the kiosk view and `#/settings` is settings. Hash routing avoids GitHub Pages 404s on deep links.

## 4. Config file

### 4.1 Schema (v2)

```jsonc
{
  "schemaVersion": 2,
  "updatedAt": "2026-10-11T15:00:00Z",        // set on export
  "loopVideo": "attract-loop.mp4",            // fileName or null
  "videos": [
    { "fileName": "lion.mp4", "title": "Lion", "sizeBytes": 1048576000 }
  ],
  "cards": [
    { "match": { "kind": "uid", "value": "04A23B1C5D8000" }, "fileName": "lion.mp4", "label": "Lion card" },
    { "match": { "kind": "ndef", "value": "https://topps.drey.dev/c/BRONCOS-12" }, "fileName": "broncos.mp4", "label": "" }
  ],
  "adminCards": [
    { "match": { "kind": "uid", "value": "04FF001122AA80" }, "label": "Front desk admin" }
  ]
}
```

v1 configs (`{ "uid": … }` on each card) are upgraded on load and import.

### 4.2 Rules

- **`fileName` is the video's identity across kiosks.** It must be unique, and it is the name of the file in OPFS. Every kiosk imports a file with the same name.
- `sizeBytes` is used only to **warn** when a kiosk's local file size differs. It never blocks.
- `label` on cards and admin cards, and `title` on videos, stay in the schema for compatibility, but the app no longer shows or edits them. New cards are saved with `label: ""`, and new videos get a title derived from the file name.
- A `uid` match value is uppercase hex with no separators (see §6). An `ndef` match value (card ID) is 1–256 characters with no control characters. Each (kind, value) pair may appear at most once across `cards` and `adminCards`.
- Each kiosk has one **card identifier** (UID or NDEF card ID, stored per kiosk; keyboard mode is always UID). Scans resolve as: admin card by card ID or UID, then video card by the kiosk's card identifier only (`resolveScan` in `src/config/ops.ts`). Pairing uses the card identifier without asking; admin cards are always added by UID.
- Every `cards[].fileName` and `loopVideo` must reference an entry in `videos`.
- Write a `validateConfig(json): Result<Config, string[]>` function with clear error messages. Use it for published fetches, file imports and the IndexedDB load.
- Include a `migrate()` hook keyed on `schemaVersion` so future versions can upgrade v1 configs.
- Ship an initial `public/config.json` with empty arrays and `loopVideo: null`.

### 4.3 Config flows (settings page)

| Action | Behaviour |
|---|---|
| **Export config** | Serialize the active config with `updatedAt = now`, pretty-print it, and download it as `config.json`. |
| **Update from published config** | `fetch(\`${import.meta.env.BASE_URL}config.json\`, { cache: 'no-store' })` → validate → show a summary (counts, `updatedAt`, videos missing locally) → confirm → replace the local config entirely. If offline or the fetch fails, show the error and keep the current config. |
| **Import config from file** | Same as above, but the source is a local file picked by the user. Use this for kiosks without internet or for testing. |
| Local edits | Every change in settings saves to IndexedDB immediately. Local edits are overwritten by the next Update or Import, so warn about that in the confirm dialog. |

**Publishing workflow (document in README):** Export config → GitHub repo → `public/config.json` → "Upload files"/replace → commit to `main` → Actions deploys in about 1–2 minutes → on each kiosk, Settings → "Update from published config".

**Service worker:** `config.json` must **not** be precached. Use a NetworkOnly runtime route for it, or exclude it from `globPatterns`, so "Update" always gets the latest published file.

## 5. Video storage (OPFS)

- Store videos in `navigator.storage.getDirectory()` → `videos/` directory → one file per `fileName`.
- **Import (single or multiple files):** `<input type="file" accept="video/*" multiple>`.
- **Import folder:** `<input type="file" webkitdirectory>`.
  - Import files whose names match `config.videos` entries that are missing locally.
  - Offer to also add unlisted files as new videos.
  - This is the main per-kiosk setup flow, run from a USB stick.
- **Copy with streaming and atomic finish:**
  1. Write to `<fileName>.partial` with `createWritable()` and `file.stream().pipeTo(writable)`.
  2. Count bytes through a `TransformStream` to drive a progress bar.
  3. When the copy finishes, `move()` the file to its final name and delete any older version.
  4. On failure, delete the `.partial` file. Delete stale `.partial` files on startup.
- **Before importing:**
  - Check `navigator.storage.estimate()` and refuse with a clear message if the total size exceeds the free quota.
  - Catch `QuotaExceededError`.
- **Overwriting:** importing a file whose name already exists asks for confirmation, then replaces it.
- **Delete video:** confirm first. This removes the OPFS file and the `videos[]` entry, unpairs cards that pointed to it (list them in the confirm dialog). If it was the loop video, the loop moves to another video, preferring one no card plays (the dialog says which).
- **Playback:** `fileHandle.getFile()` → `URL.createObjectURL(file)` → `video.src`. Revoke the URL when it's replaced. Files are disk-backed, so 1 GB files must not be read into memory.
- **Persistent storage:**
  - Call `navigator.storage.persist()` the first time settings opens and again after each import.
  - Show the persisted status and usage/quota in settings.
  - If storage isn't persisted, show a hint to install the app (Chrome grants persistence without a prompt, based on engagement and installation).
- Expected scale is about 20 × 1 GB. Chrome allows up to 60% of the disk per site, so free disk space is the practical limit.

## 6. NFC scan input (keyboard wedge)

### 6.1 Reader configuration (one-time per reader, Windows-only ACS tool)

- Mode: keyboard emulation (UID).
- Output: **hex, uppercase**, any byte separator (the parser strips them), **Enter suffix**, **normal (non-reversed) byte order**.
- **All kiosks' readers must use identical output settings**, or UIDs won't match the shared config.
- Record the chosen settings in the README.

### 6.2 Parser (`src/scan/keyboardScanner.ts`)

- Listen to `keydown` on `window` in the capture phase.
- **Use `event.code`, not `event.key`**, so OS keyboard layout (e.g. AZERTY) doesn't matter:
  - Map `Digit0–9` and `Numpad0–9` → `0–9`.
  - Map `KeyA–KeyF` → `A–F`.
  - Treat `Space`, `Minus` and `Semicolon` as ignored separators.
  - `Enter`/`NumpadEnter` terminates the burst.
- **Burst detection:**
  - Start a buffer on the first hex key.
  - If the gap between keys exceeds `maxInterKeyMs` (default 50, configurable constant), discard the buffer and restart.
  - Any key code outside the accepted set discards the buffer.
  - On Enter, accept if the length is one of 8, 14, 16 or 20 hex chars (4/7/8/10-byte UIDs). Otherwise discard.
  - Also flush on an idle timeout (e.g. 150 ms) with the same validation, in case a reader omits Enter.
- Emit a `scan` event with `{ uid: string, at: number }`.
- Call `preventDefault()` on keys consumed by an active burst, so they don't type into focused inputs or trigger browser shortcuts.
- Debounce identical UIDs within ~1.5 s, because readers can re-emit while a card rests on the reader.
- Unit-test this heavily (§10).

### 6.3 Bridge app and reader modes (`src/scan/cardInput.ts`, `src/scan/bridge/`)

- `CardInput` is the app's single scan source (`ctx.scanner`). Per-kiosk mode, chosen manually by staff, in localStorage `kiosk.readerMode`: `keyboard` (default) or `bridge`. There is no automatic switching between them.
- The keyboard scanner always listens, so reader bursts never type into inputs; its scans only count in `keyboard` mode.
- `keyboard` never opens the WebSocket. `bridge` connects as soon as staff choose it (Settings or the setup guide), so Chrome's `loopback-network` ("Apps on device") prompt appears while they're there. The permission state is only read to explain a denied permission.
- `BridgeScanner` wraps the bridge's TypeScript client, copied into `src/scan/bridge/vendor/` (don't edit there; re-copy from the bridge repo). On each new tap on a non-SAM reader it reads the NDEF message (NFC Forum Type 2 cards only, 1.5 s timeout) and emits `{ uid, ndefKey, records, source: 'bridge' }`. Cards already on the reader when the connection opens are not taps. Same UID within 1.5 s is ignored.
- The focus notice only shows in `keyboard` mode. In `bridge` mode the kiosk shows "Card reader not available" while the bridge app or the reader is missing.

## 7. Kiosk view and playback state machine

```
          ┌──────────────── ended / error ───────────────┐
          ▼                                              │
  [LOOP] ──scan(uid ∈ cards, file present)──► [PLAYING_FEATURE]
    │  ▲                                          │
    │  └─ unknown UID / missing file: no-op       └─ any video-card scan: ignored
    │
    ├─ scan(uid ∈ adminCards) ─► navigate #/settings   (also allowed during PLAYING_FEATURE)
    └─ shortcut Ctrl+Shift+S ─► navigate #/settings (any state)
```

- **Two `<video>` elements**, absolutely positioned, black background, `object-fit: contain`, no controls:
  - `loop` element: `loop` attribute, plays the loop video.
  - `feature` element: plays the card's video.
  - On a feature scan: pause the loop and hide it, set the feature `src`, show it and `play()`.
  - On `ended` or `error`: hide the feature, revoke its URL, show the loop and `play()` it, resuming where it paused.
- **No loop video configured or loop file missing:** black screen with small unobtrusive text: "Setup required — open settings".
- **Autoplay with sound:**
  - Call `play()` and catch `NotAllowedError`.
  - On failure, retry muted, and show a small banner in settings diagnostics saying autoplay is blocked.
  - Kiosk launch flags (§9) prevent this in production.
- Hide the cursor (`cursor: none`) and block the context menu in the kiosk view.
- **Fullscreen:** desktop Chrome ignores `display: fullscreen` and opens the installed app in a window with Chrome's title bar, which a page can't hide. The kiosk view calls `requestFullscreen()` on mount and again on every click or key press (a card scan counts) until it succeeds (`src/kiosk/fullscreen.ts`). Without a gesture this only works if the `AutomaticFullscreenAllowedForUrls` policy lists the site. Production kiosks use the `--kiosk` launch command, which starts fullscreen with no Chrome UI.
- Missing video file for a paired card: no-op plus a `console.warn`. The video is also listed under "Missing videos" in settings.
- Leaving settings (button, or auto-return after **3 minutes idle**) goes back to `#/` and restarts the loop.

## 8. Settings page

Sections, each a plain TS module rendering DOM:

1. **Header:** "Back to kiosk" button, app version (injected from `package.json` via Vite `define`), online/offline indicator.
2. **Videos:**
   - Table showing file name, size, and status (present / missing / size mismatch). There's no title column: the file name is the only name shown for a video, here, in the card dropdowns and in the setup guide.
   - Buttons: Import files, Import folder, Delete.
   - Radio button to select the **loop video**. There is no "no loop" option: whenever there are videos, one is the loop. The first video added becomes the loop, and it can be moved but not cleared.
3. **Cards:**
   - Table showing UID (displayed grouped, e.g. `04 A2 3B…`, on one line), assigned video (dropdown), and Remove. There's no label column: the video file name identifies the card.
   - **"Pair new card"** opens a modal:
     1. "Scan card now…"
     2. Capture UID. If it's already paired, show the current assignment and offer to reassign. If it's an admin card, reject.
     3. Pick a video.
     4. Save.
4. **Admin cards:** list of UIDs with Remove (no label field). **"Add admin card"** opens the same scan modal, saves as soon as a valid card is scanned, and rejects UIDs already used as video cards.
5. **Config:** Export config, Update from published config, Import config from file, last applied `updatedAt`.
6. **Diagnostics:**
   - **Ready to work offline** indicator with a per-condition breakdown (see §9.3).
   - Storage usage/quota and persisted status.
   - Last scanned UID with a live display (handy for testing readers).
   - Autoplay status.
   - Service worker status, with an "App update available → Reload" button. Use vite-plugin-pwa `registerType: 'prompt'` so the app never reloads itself mid-show.

7. **Reset** (last section): **Reset configuration** deletes every video file in OPFS, the stored config and its "last applied" record, and the setup-guide progress, after a confirm dialog listing what will be deleted. Then it opens the setup guide at step 1. The app stays installed and cached, and the install flag is kept, because the app really is still installed.

**Scanner in settings:** scans are only consumed while a scan modal is open. Otherwise settings ignores them, apart from preventing burst keys from typing into inputs.

## 9. PWA, deployment and kiosk setup

### 9.1 PWA and build

- `vite.config.ts`:
  - `base: '/<repo>/'`.
  - vite-plugin-pwa with `registerType: 'prompt'`.
  - Precache the app shell (html/js/css/icons).
  - `navigateFallback: 'index.html'`.
  - Exclude `config.json` from precache, plus a NetworkOnly route for it.
- Manifest:
  - `name`, `short_name`.
  - `start_url: './'`, `scope: './'`.
  - `display: 'fullscreen'`, `background_color: '#000'`.
  - 192/512 icons.
- `.github/workflows/deploy.yml`: use the workflow from the Vite static-deploy guide (checkout → setup-node lts → `npm ci` → `npm run build` → configure-pages → upload-pages-artifact `./dist` → deploy-pages). Set repo Settings → Pages → Source to **GitHub Actions**.

### 9.2 Install prompt (`src/pwa/install.ts`)

**Why install:**

- Strictly speaking, offline already works in a plain tab once the service worker has cached the app.
- Installing makes Chrome more likely to grant persistent storage, so imported videos aren't deleted when the disk fills up.
- Installing also gives the app its own window.
- So the app asks to be installed, and setup isn't complete until it is.

**Detecting install state** (store the result in `localStorage` key `kiosk.installed`):

- `beforeinstallprompt` fired → **not installed**.
  - Chrome only fires it when the app isn't already installed and meets the install criteria.
  - Call `preventDefault()` and keep the event for the Install button.
  - Set `installed = false`.
- `appinstalled` fired → **installed**.
  - This covers installs from our button and from Chrome's own address-bar or menu install.
  - Set `installed = true`, drop the saved event, and hide all install prompts.
- `matchMedia('(display-mode: standalone)')` or `(display-mode: fullscreen)` matches → running as the installed app → `installed = true`.
- Otherwise → `unknown`.
  - The kiosk launch command opens a Chrome tab in `--kiosk` mode, which reports `display-mode: browser` even when the app is installed. The stored flag and the absence of `beforeinstallprompt` are what tell us it's installed.

**Where the prompt appears:**

- **Settings: a top banner** whenever the state is not `installed`. It reads "Install this app so it keeps working offline and your videos aren't cleared."
  - If a `beforeinstallprompt` event is saved, show an **Install app** button that calls `prompt()` and awaits `userChoice`. A saved event can only be used once; if the user dismisses it, keep the banner and wait for Chrome to fire the event again.
  - If no event is available yet, show manual steps: "Click the install icon at the right of the address bar, or Chrome menu ⋮ → Cast, save, and share → Install page as app…"
  - Chrome only offers install after the user has clicked the page once and spent about 30 seconds on it, so the button may appear late. The banner must still work without it.
- **First-launch setup guide (`#/setup`, `src/onboarding/`):** one centred card per step, with Back/Next. It opens instead of the kiosk until it's finished, unless the kiosk can already play its loop video. It resumes at the first unfinished step after a reload, including when Chrome opens the newly installed app in its own window. Steps:
  1. **Install the Topps Kiosk**: the install call-to-action above, or "Skip for now".
  2. **Connect the NFC reader**: "hold any card on it". Next is enabled once a scan arrives, and the step can be skipped.
  3. **Import configuration**: **Import a config file** or **Start a new config**. The guide doesn't offer the published `config.json`; configs are copied between kiosks as files.
  4. New config → **Add videos** (files or a whole folder); the import moves straight on to step 5. Imported config → **Copy the videos** (folder import of the listed videos that are missing). This step can't be skipped: its only button is **Choose folder** until every listed video is on the kiosk. If a folder has only some of them, the step lists what's still needed. Then **Next** appears (the guide moves on by itself after a complete import).
  5. **Pair videos with cards**: lists the videos. Each row has **Pair card** (scan inline; admin cards are rejected, and a card that already plays another video can be moved) or a **Loop** checkbox. Only one video can be the loop, and making a video the loop unpairs its cards. Next is enabled once a loop video is chosen.
  6. **Pair an admin card**: hold a card on the reader and it's added as an admin card. Cards that already play a video are refused, more than one card can be added, and the step can be skipped (the keyboard shortcut still works).
  7. **You're all set**: a summary plus the "Ready to work offline" indicator (§9.3), with **Export config** (downloads `config.json`, same as in settings) next to **Start kiosk**.

  Settings has a **Setup guide** button that reopens it. If the loop goes missing after setup, the kiosk shows "Setup required" with buttons for the guide and for settings.
- **Settings checklist:** Install app, Update config, Import videos, Storage persisted, **Ready to work offline ✓** (§9.3). It shows at the top of settings until every item is green.
- **Kiosk view with a configured loop:** **no install prompt.** Visitors can't install it, and it would cover the content.
- **Diagnostics:** "Installed: yes / no / unknown".

**Manifest requirements** (needed for Chrome to offer install at all):

- `name`/`short_name`.
- 192 px and 512 px icons.
- `start_url`.
- `display: 'fullscreen'` or `'standalone'`.
- Served over HTTPS (GitHub Pages already is).
- Do not set `prefer_related_applications`.

**Tests:**

- Unit-test the install-state reducer (events and media query → state).
- In Playwright, dispatch a synthetic `beforeinstallprompt` (a stub with `prompt()` and `userChoice`) and `appinstalled`, then assert the banner and button show and hide correctly.
- Real installation is checked manually on both OSes.

### 9.3 "Ready to work offline" indicator (`src/pwa/offlineReady.ts`)

Purpose: staff can confirm a kiosk will start and run with no internet before it goes live.

**Recompute on every load.** Do not store this state as a flag. Cache eviction or a site-data wipe must turn the indicator off.

| # | Condition | How to check | Blocking? |
|---|---|---|---|
| 1 | **App cached** | `navigator.serviceWorker.getRegistration()` has `active?.state === 'activated'` **and** `caches.match(import.meta.env.BASE_URL + 'index.html')` resolves. Workbox only activates a service worker after every precache entry is downloaded, so an activated worker means the app shell is complete. | Yes |
| 2 | **Config present** | A valid config is loaded from IndexedDB. | Yes |
| 3 | **Loop video present** | `loopVideo` is set and the file exists in OPFS. | Yes |
| 4 | **All paired videos present** | Every `videos[].fileName` referenced by `cards` exists in OPFS. List any that are missing. | Yes |
| 5 | **Storage persisted** | `navigator.storage.persisted()` is true. | No: warning only, with an "Install the app" hint |

**Display:**

- Overall status is **"Ready to work offline ✓"** (green) when conditions 1–4 pass.
- Otherwise it's **"Not ready to work offline"** (red), with each failing condition and how to fix it, e.g. "Missing videos: lion.mp4 → Import folder".
- Condition 5 shows as an amber warning, but doesn't block the green state.

**Update triggers:**

- On load.
- On vite-plugin-pwa `registerSW({ onOfflineReady, onRegisteredSW })`. `onOfflineReady` fires when the first service-worker install finishes, so recompute then and briefly show "App cached for offline use".
- On `navigator.serviceWorker` `controllerchange`.
- After any video import or delete, and after any config apply.

**If the service worker isn't supported or registration fails** (`onRegisterError`), show condition 1 as failed with the error message.

**Tests:**

- Unit-test the pure `computeOfflineReadiness(inputs) → { ready, conditions[] }` function.
- In Playwright:
  1. First visit: wait for readiness to turn green.
  2. Go offline and reload: the app and indicator still show green.
  3. Delete a video from OPFS: the indicator turns red and lists that video.
  4. Clear caches and unregister the service worker: condition 1 fails.

### 9.4 Kiosk machine setup (write as `docs/kiosk-setup.md`)

**Both OSes:**

1. Open the site in Chrome while online. The setup guide opens.
2. Follow it: install the app, test the reader, load the config (published or from a file), copy the videos from the USB stick, and check the pairings.
3. On the last step, check that it shows **Ready to work offline ✓**.
4. Check in settings that storage is persisted.
5. Set the launch command to run at login:
   ```
   chrome --kiosk --autoplay-policy=no-user-gesture-required https://<user>.github.io/<repo>/
   ```
   Kiosk mode in a tab shares the same origin storage as the installed app, so the imported videos and config are available. Exit with Alt+F4 (Windows) or Cmd+Q (Mac).
6. Turn off sleep, screen saver and notifications.
7. **Offline test:** disconnect the network, restart the machine (or Chrome with the launch command), and check that the loop plays and a test card works. Then reconnect.

**Windows:**

- Put a shortcut with the command above, using the full `chrome.exe` path, in the Startup folder (`shell:startup`).
- Set Windows Update active hours or restart scheduling outside opening hours.

**macOS:**

- Use a Login Item or LaunchAgent running `open -na "Google Chrome" --args --kiosk --autoplay-policy=no-user-gesture-required <url>`. Flags only apply if Chrome isn't already running.
- The first time the reader is plugged in, macOS may show **Keyboard Setup Assistant**. Dismiss it, because it steals focus and scans would be lost.

**Focus:** the kiosk window must stay focused, since keystrokes go to the focused window. Note this in troubleshooting.

## 10. Testing

**Unit (Vitest):**

- Scanner: valid bursts of each UID length, separators, Enter vs idle flush, slow human typing rejected, non-hex key aborts, `event.code` mapping under a simulated AZERTY layout (`key` differs, `code` same), debounce.
- Config: validation (each rule in §4.2), migration hook, export round-trip.
- State machine: transitions, ignore-while-playing, admin scan from both states, unknown UID no-op, missing file no-op.

**E2E (Playwright, Chromium):**

- Use small fixture MP4s, a few seconds of H.264. Generate them with ffmpeg in a setup script or commit them under `tests/fixtures`.
- Simulate scans with `page.keyboard` bursts at about 5 ms per key.
- Cover: loop plays → scan paired card → feature plays → `ended` → loop resumes; scan during feature is ignored; unknown card does nothing; admin card and shortcut open settings; pairing flow; export → import round-trip; import video into OPFS and play it back.
- **Offline:** load once, `context.setOffline(true)`, reload, and assert that the app and videos still work.

**Hardware acceptance (must be done by the user; not automatable):**

- A real ACR1552U in keyboard mode on **both** a Mac and a Windows PC: pairing, playback, and the same card producing the same UID on both machines.
- 20 × ~1 GB import.
- Overnight loop stability.
- Reboot → auto-launch → offline start.

## 11. Suggested file layout

```
index.html
src/main.ts                    # router (#/ vs #/settings), SW registration
src/kiosk/kioskView.ts         # video elements, state machine wiring
src/kiosk/stateMachine.ts      # pure, unit-tested
src/scan/keyboardScanner.ts    # pure parser + DOM adapter
src/config/schema.ts           # types, validateConfig, migrate
src/config/store.ts            # IndexedDB load/save of active config
src/config/sync.ts             # export, import-from-file, update-from-published
src/videos/opfsStore.ts        # import (streaming, .partial, progress), delete, getFile, estimate
src/admin/access.ts            # shortcut + admin-card detection, idle auto-return
src/pwa/install.ts             # install-state detection + install prompt (§9.2)
src/pwa/offlineReady.ts        # offline-readiness checks + indicator (§9.3)
src/settings/*.ts              # section renderers + scan modal
public/config.json             # published shared config (initially empty)
public/icons/*
docs/kiosk-setup.md
.github/workflows/deploy.yml
tests/unit/*, tests/e2e/*, tests/fixtures/*
```

## 12. Error handling requirements

- Every external input must be validated with user-visible errors and no partial state:
  - Fetched config.
  - Imported config file.
  - Picked video files.
  - OPFS operations.
  - Scanner input.
- The kiosk view must **never** get stuck. Any playback or config error falls back to the loop, or to the "Setup required" screen.
- Log errors to the console with a consistent prefix, and keep the last ~50 in memory for the diagnostics panel.

## 13. Out of scope

Writing to NFC cards, Web NFC/WebUSB/Bluetooth, automatic config sync, hosting or syncing video files, authentication beyond the shortcut and admin cards, and browsers other than Chrome.

## 14. Open items for the user to confirm during implementation

1. **Repo name / GitHub account**, which determines `base`.
2. **ACR1552U config tool options:** check that hex, uppercase, Enter suffix and normal byte order are all available. Adjust §6 if the tool's terms differ.
3. **Admin card during playback:** assumed to open settings even while a feature video plays. Change it if not wanted.
4. **Shortcut** `Ctrl+Shift+S` and **settings idle timeout** of 3 min are defaults.

## 15. Reference docs (fetched 2026-10-11)

- ACR1552U: https://www.acs.com.hk/en/products/575/acr1552u-usb-nfc-reader-iv/ (spec: https://www.acs.com.hk/download-manual/13248/TSP-ACR1552U-1.07.pdf)
- OPFS (MDN): https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system
- Storage quotas & persistence (MDN): https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria
- Vite static deploy (GitHub Pages): https://vite.dev/guide/static-deploy
- vite-plugin-pwa: https://vite-pwa-org.netlify.app/guide/
- GitHub Pages limits: https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
- Chrome autoplay policy: https://developer.chrome.com/blog/autoplay
- Custom install prompt (beforeinstallprompt / appinstalled): https://web.dev/articles/customize-install
- Chrome installability criteria: https://web.dev/articles/install-criteria
- vite-plugin-pwa registerSW options (onOfflineReady etc.): https://vite-pwa-org.netlify.app/frameworks/
