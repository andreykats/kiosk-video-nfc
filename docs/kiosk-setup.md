# Kiosk machine setup

Follow these steps once on each kiosk computer. Replace `<url>` with the published site, e.g. `https://andreykats.github.io/topps-nfc-kiosk/`.

## Both Windows and macOS

1. Plug in the ACR1552U reader. Its output settings must match the other kiosks (see the README).
2. In Google Chrome, **while online**, open `<url>`. Then open settings with **Ctrl+Alt+Shift+S** (Ctrl+Option+Shift+S on a Mac).
3. **Install the app.** Use the **Install app** button in the yellow banner. If there's no button, click the install icon at the right of the address bar, or open Chrome menu ⋮ → Cast, save, and share → Install page as app…. Chrome may only offer installing after you've clicked the page and spent about 30 seconds on it.
4. Go to Config → **Update from published config** and confirm.
5. Insert the USB stick with the videos. Go to Videos → **Import folder** and pick the folder. Videos that are listed in the config but missing on this kiosk are copied. If the folder has videos that aren't in the config, the app asks whether to add them too.
6. Check that the **Setup checklist** at the top of settings is all green, and that Diagnostics shows **Ready to work offline ✓** and **Persisted: yes**. If storage isn't persisted, make sure the app is installed, then reopen settings.
7. Scan each card once to check it, then press **Back to kiosk**.
8. Set the launch command to run at login (see the sections below):
   ```
   chrome --kiosk --autoplay-policy=no-user-gesture-required <url>
   ```
   A kiosk-mode tab shares storage with the installed app, so it sees the same videos and config. To exit kiosk mode, press Alt+F4 (Windows) or Cmd+Q (Mac).
9. Turn off sleep, the screen saver and notifications.
10. **Offline test:** disconnect the network and restart the computer. Check that the loop plays and that a test card works. Then reconnect.

## Windows

- Press Win+R and run `shell:startup`. In that folder, create a shortcut with this target:
  ```
  "C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required <url>
  ```
- Set Windows Update active hours, or schedule restarts, outside opening hours.

## macOS

- Add a Login Item, or a LaunchAgent, that runs:
  ```
  open -na "Google Chrome" --args --kiosk --autoplay-policy=no-user-gesture-required <url>
  ```
  The flags only take effect if Chrome isn't already running. Make sure Chrome doesn't open by itself at login first.
- The first time the reader is plugged in, macOS may show **Keyboard Setup Assistant**. Close it, because while it's open it takes focus and scans are lost.

## Troubleshooting

| Symptom | Check |
|---|---|
| Scans do nothing | The kiosk window must have keyboard focus, because the reader types into whichever window is focused. Click the kiosk once. In settings, Diagnostics → **Last scanned UID** shows whether scans are arriving. |
| A card plays nothing | The UID isn't paired, or the video isn't imported on this kiosk (Videos shows it as **missing**). |
| Same card, different UID on two kiosks | The readers have different output settings. Reconfigure them to match. |
| Video plays muted / Diagnostics says autoplay is blocked | Chrome was started without `--autoplay-policy=no-user-gesture-required`. Quit Chrome completely and start it with the launch command. |
| "Setup required" on the screen | No loop video is selected, or the loop file is missing. Open settings and follow the checklist. |
| Settings says "App update available" | Press **Reload** when no one is watching. The app never reloads itself. |
| Videos disappeared | Storage wasn't persisted and Chrome cleared it. Install the app, re-import the videos, and check **Persisted: yes**. |
