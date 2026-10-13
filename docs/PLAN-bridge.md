# Plan: Kiosk app uses the NFC bridge, reads NDEF, and matches cards by NDEF ID

> **Changed after implementation (2026-10-13):** Automatic mode was removed. Reader setup is manual: Keyboard (HID) or Bridge app, chosen by staff. See PLAN.md §6.3.

## Context

**Today.** The kiosk (`andreykats/topps-nfc-kiosk`, this repo; live at https://topps.drey.dev; TypeScript + Vite PWA; Chrome on Windows and macOS) reads cards through an ACS reader in USB HID keyboard mode. `src/scan/keyboardScanner.ts` parses the typed UID. That mode only gives the UID and loses scans whenever the window isn't focused (the full-screen "Paused" notice).

**What's new.** A separate project, `andreykats/nfc-browser-bridge` (Plan 1), adds a native tray / menu-bar **bridge app**. It exposes the OS smart-card service to web pages over `ws://127.0.0.1:38241/v1`. It also ships a dependency-free TypeScript client in its `client/` folder (`protocol`, `client`, `tlv`, `ndef`, `ntag`, `fakeBridge`). Its protocol is frozen in its `docs/PROTOCOL.md`.

**This plan** makes the kiosk use the bridge. User decisions:
- **Reader mode is a per-kiosk setting:** Keyboard (HID, the default), Bridge app, or Automatic. HID keyboard mode stays for kiosks that can't install the bridge.
- **Read full NDEF; never write it.**
- **Pick videos by NDEF content.** The card carries an ID in its **first URI or Text record**, compared exactly. The config maps that ID to a video. Cards without NDEF, and any card scanned in keyboard mode, still match by UID.

**Dependency.**
- Steps 2–7 can be built against the bridge's frozen `PROTOCOL.md` and `fakeBridge.ts` as soon as they exist.
- **Ship only after** the bridge's hardware checklist has passed and `v0.1.0` is tagged.
- Copy the client files from that tag (step 1).

**Protocol summary** (the bridge's `docs/PROTOCOL.md` is the source of truth):
- **Events:**
  - `hello {protocol:1, version, readers:[{name, kind, card:{uid, atr}|null}]}` is sent on connect. Cards it lists are *not* new taps.
  - `readers` sends the full list on any change.
  - `card_present {reader, uid, atr}` and `card_removed {reader}` follow taps.
- **Requests:** `transmit {reader, apdus:[hex]}` returns `{responses:[{data, sw}]}`; `reset {reader}`.
- **Errors:** `{id, ok:false, error:{code, message}}`.
- **UIDs** are uppercase hex, the same format the kiosk already stores. The bridge's hardware spike (`docs/HARDWARE.md` there) confirms the UID matches keyboard mode's output.

**Chrome permission.** An https page connecting to `ws://127.0.0.1` needs the **`loopback-network`** permission ("Apps on device"). Chrome prompts once per site and remembers the answer in the Chrome profile. `http://localhost` (dev/e2e) never prompts. Policy `LoopbackNetworkAllowedForUrls` pre-grants it on managed machines.

Follow `AGENTS.md`:
- Stage only your own files. Other agents edit this repo too.
- Run `npm test` and `npm run test:e2e` before pushing.
- Pushing to `main` deploys; report the version that went live.
- If port 4173 is busy, test from a temporary build directory.

## 1. Vendored bridge client
- Copy `client/src/{protocol,client,tlv,ndef,ntag,fakeBridge}.ts` from bridge tag `v0.1.0` into `src/scan/bridge/vendor/`.
- Give each file a header: `// Copied from andreykats/nfc-browser-bridge v0.1.0 client/src/<file>. Don't edit here; re-copy to update.`
- The kiosk uses only the read functions (`isType2`, `readCC`, `readNdef`, `matchKey`). `fakeBridge.ts` is for tests only.

## 2. Scan input (`src/scan/`)
**`ScanEvent`** (`keyboardScanner.ts`) becomes:
`{ uid, at, source: 'keyboard' | 'bridge', ndefKey: string | null, records?: NdefRecord[] }`.
The keyboard path sets `ndefKey: null`.

**New `bridgeScanner.ts` (`BridgeScanner`).** Wraps `BridgeClient` (`127.0.0.1` only).
- On `card_present` from a reader with kind `picc`:
  - If `isType2(atr)`: run `readNdef` with a **1.5 s** timeout, then emit `{uid, ndefKey: matchKey(records), records}`.
  - Otherwise, on read failure, or on timeout: emit with the UID only, and log a warning on failure.
- Ignores cards listed in `hello`, so a bridge restart doesn't replay a video.
- Debounces the same card and UID for 1.5 s, like `ScanParser`.
- **Status emitter:** `off | connecting | connected {version, readers} | unreachable | permission-denied | protocol-mismatch`.

**New `cardInput.ts` (`CardInput`).** Exposes the same `scans: Emitter<ScanEvent>` the app uses today, plus `status`.
- Mode is saved per kiosk in localStorage under `kiosk.readerMode` (`keyboard` | `bridge` | `auto`, default `keyboard`), with a small read/write helper like `src/onboarding/progress.ts`.
- **`KeyboardScanner` stays attached in every mode**, so reader bursts never type into inputs. `CardInput` just drops its events when they aren't wanted.
- **keyboard:** never opens the WebSocket, so the Chrome prompt can't appear on the visitor screen.
- **bridge:** passes through bridge scans only.
- **auto:** passes bridge scans while the bridge is connected *and* reports at least one `picc` reader, and keyboard scans otherwise.
  - Auto only opens the socket when `navigator.permissions.query({name: 'loopback-network'})` returns `granted`.
  - Wrap the query in try/catch; an unknown name or state counts as not granted.
  - Re-check on `PermissionStatus.onchange`.
- **Mode changes apply live,** with no reload.

**Wiring**
- `AppContext.scanner` (`src/app/context.ts`) becomes `CardInput`. `src/main.ts` constructs it.
- The UID-only consumers take the full `ScanEvent`:
  - `diagnostics.recordScan` (`src/app/diagnostics.ts`)
  - `src/kiosk/kioskView.ts` (~line 300)
  - `src/settings/scanModal.ts`
  - `src/onboarding/onboardingView.ts` (~148, ~394, ~544)

## 3. Config schema v2 (`src/config/schema.ts`, `src/config/ops.ts`)
- **Types:**
  - `CardMatch = { kind: 'uid' | 'ndef'; value: string }`
  - `CardEntry = { match: CardMatch; fileName; label }`
  - `AdminCardEntry = { match: CardMatch; label }`
- **Version:** `CURRENT_SCHEMA_VERSION = 2`.
- **Migration:** `MIGRATIONS[1]` converts `{uid, …}` to `{match: {kind: 'uid', value: uid}, …}` for `cards` and `adminCards`.
- **Validation** (keep the collect-all-errors style):
  - `uid` values keep the `isCanonicalUid` rules.
  - `ndef` values must be non-empty, at most 256 characters, with no control characters.
  - Each (kind, value) pair must be unique across cards and admin cards together. This replaces the shared `uids` map.
- **Ops rekeyed by `CardMatch`:** `findCard`, `findAdminCard`, `pairCard`, `setCardVideo`, `removeCard`, `addAdminCard`, `removeAdminCard`.
- **New `resolveScan(config, scan)`.** Returns `{kind: 'admin' | 'video', entry} | null` with explicit precedence:
  1. Admin card by NDEF key
  2. Admin card by UID
  3. Video card by NDEF key
  4. Video card by UID
- **`src/kiosk/stateMachine.ts`:** the event becomes `{type: 'scan', scan: ScanEvent}` and uses `resolveScan`. Keep the warning about a missing video file, using the matched value in the text.
- **Older builds:**
  - A v1 build importing a v2 file gets "newer than this app supports. Reload to update" (existing behaviour; fine).
  - An older cached service-worker build that finds a v2 config in IndexedDB fails in `ConfigStore.load` (`src/config/store.ts:66`). Verify that the service-worker update path delivers the new build and that the config then loads.
  - Publishing is currently disabled (`PUBLISHED_CONFIG_ENABLED = false` in `src/config/sync.ts`).

## 4. UI
**Pairing**
- Applies to video cards and admin cards (`src/settings/cards.ts`, `scanModal.ts`) and to the onboarding pair/admin steps.
- If the scan has an `ndefKey`, the dialog shows both identifiers and lets staff choose:
  - **Match by card ID (NDEF):** `<key>`. The default.
  - **Match by UID:** `<formatted uid>`.
- **Warning:** if another paired card already uses the same NDEF key, warn that every card with that ID will play the same video. The common case is many cards written with the same maker URL.
- **Conflict checks** use `CardMatch`: a value already used as an admin card, or as a video card.
- **The cards table** shows the match kind ("UID" / "Card ID") and value.

**Kiosk view** (`src/kiosk/kioskView.ts`)
- The focus "Paused" notice (~278–314) shows only while the active source is the keyboard.
- **New full-screen notice** in the same style, shown in `bridge` mode, and in `auto` mode once the socket was opened, when the bridge is unreachable: **"Card reader bridge not running"**, with a one-line hint.

**Settings: new "Card reader" section** (`src/settings/`, added to `settingsView.ts`)
- **Mode select:** Keyboard (HID) / Bridge app / Automatic, with one-line explanations.
- **Bridge status:** state, version, reader names, and permission state. When the permission is denied, give the steps to fix it: the site settings icon → "Apps on device" → Allow.
- A **Connect** button that opens the socket while staff are present, which triggers the Chrome prompt.
- A link to the bridge download: https://github.com/andreykats/nfc-browser-bridge/releases.
- **Warning** when the mode is `keyboard`: "N cards are matched by card ID (NDEF) and can't play in keyboard mode."

**Onboarding reader step** (`onboardingView.ts` ~140)
- Ask which mode to use first.
- **Bridge path:** a Connect button (prompt), then status, then "hold a card". Show the card's UID and NDEF card ID.
- **Keyboard path:** keep today's flow and text.
- The rest of `steps.ts` / `progress.ts` is unchanged.

**Diagnostics** (`src/settings/diagnostics.ts`, `src/app/diagnostics.ts`)
- New rows: **Reader mode**, **Active source**, and **Bridge** (status and version).
- **Last scan** shows UID, NDEF card ID, and a compact list of records (type and decoded value).

## 5. Tests
**Unit (Vitest, `tests/unit/`)**
- **Schema:** v1→v2 migration, v2 validation (bad uid, empty or long ndef value, duplicate (kind, value) across lists).
- **`resolveScan`:** precedence.
- **Updated tests:** the ops tests and `stateMachine.test.ts` for the new event.
- **`CardInput` modes:**
  - Keyboard never connects.
  - Bridge drops keyboard scans but still swallows bursts.
  - Auto switches on connect and disconnect and on the reader list.
  - Auto doesn't connect without the permission granted (mock `navigator.permissions`).
- **`BridgeScanner`,** using the vendored `fakeBridge`:
  - NDEF key extraction for URI and Text records.
  - `hello` cards are ignored.
  - A non-Type-2 ATR gives a UID-only scan.
  - A read timeout gives a UID-only scan.
  - Debounce.
- Update `scanner.test.ts` for the new `ScanEvent`.

**E2E (Playwright, `tests/e2e/`)**
- Fake the bridge with `page.routeWebSocket('ws://127.0.0.1:38241/v1', …)`. Add a helper in `tests/e2e/helpers.ts` that sends `hello`, `card_present` and transmit responses from an NTAG memory image.
- **Scenarios:**
  - **Bridge mode:** pair a card by NDEF card ID, then tap it and the video plays.
  - **UID card:** a UID-only card still plays.
  - **Admin card:** an admin card matched by NDEF opens settings.
  - **Bridge down:** stop the fake bridge and the "bridge not running" notice appears.
  - **Keyboard mode:** no WebSocket is opened, and the existing keyboard scan tests still pass.
  - **Mode setting:** the setting persists across a reload.
- Check whether Playwright 1.64 needs `context.grantPermissions` for `loopback-network`. Tests run on `http://localhost`, so the real prompt isn't exercised; that's covered by the hardware check.

## 6. Docs
- **`README.md`, "Reader configuration":** describe the two ways to connect:
  - **Bridge app:** install it, keep the factory "CCID only" reader mode (or "HID + CCID" if the bridge's spike confirmed it), allow "Apps on device" once, and optionally pre-grant with the `LoopbackNetworkAllowedForUrls` policy.
  - **Keyboard (HID):** the existing table.
- **Card IDs:** how they work, with the first-URI-or-Text-record rule.
- **`PLAN.md`:** update §6 (scan input) and the config schema section.

## 7. Verification and deploy
1. Run `npm run typecheck`, `npm test` and `npm run test:e2e`.
2. **Hardware run on the Mac** with the released bridge `v0.1.0`, an ACR1552U, and NTAG cards with and without NDEF:
   1. **Bridge mode:** a card paired by NDEF ID plays, and so does a UID-paired card. Two cards written with the same ID play the same video.
   2. **Admin card** via NDEF opens settings.
   3. **Keyboard mode** still works with the reader in HID mode.
   4. **Auto mode** falls back to keyboard when the bridge quits, and returns to the bridge when it restarts, with no replayed video.
   5. **The Chrome prompt** appears only on the setup or settings Connect action, never on the visitor screen.
   6. **Unfocused window:** in bridge mode, scans still work when the kiosk window isn't focused.
3. Commit only after the tests pass and the hardware run has been seen working.
4. Deploy per `AGENTS.md` and report the live version.
