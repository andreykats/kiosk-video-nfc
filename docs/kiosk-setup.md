# Kiosk machine setup

Follow these steps once on each kiosk computer. Replace `<url>` with the published site, e.g. `https://topps.drey.dev/`.

## Both Windows and macOS

1. Plug in the ACR1552U reader. Its output settings must match the other kiosks (see the README).
2. In Google Chrome, **while online**, open `<url>`. The **setup guide** opens and shows one step at a time:
   1. **Install the Topps Kiosk.** Use the **Install app** button. If there's no button, click the install icon at the right of the address bar, or open Chrome menu ⋮ → Cast, save, and share → Install page as app…. Chrome may only offer to install after you've clicked the page and spent about 30 seconds on it. Chrome then opens the app in its own window, and the guide carries on there.
   2. **Connect the NFC reader.** Hold any card on the reader and check that the guide shows "Reader is working".
   3. **Import configuration.**
      - On the first kiosk, choose **Start a new config**.
      - On every other kiosk, choose **Import a config file** and pick the `config.json` exported from the first kiosk.
   4. **Add or copy the videos.** Insert the USB stick.
      - With a new config, choose the video files (or a folder).
      - With an existing config, choose the folder. The guide copies the videos the config lists.
   5. **Pair videos with cards.** For each video, press **Pair card** and hold its card on the reader. Tick **Loop** on the one video that plays on repeat.
   6. **Pair an admin card.** Hold the card staff will use to open settings. You can add more than one, or press Skip and use the keyboard shortcut instead.
   7. **You're all set.** Check that it shows **Ready to work offline ✓**. On the first kiosk, press **Export config** to save `config.json` for the other kiosks. Then press **Start kiosk**.
3. Open settings (**Ctrl+Shift+S**; Control, not Cmd, on a Mac) and check that Diagnostics shows **Persisted: yes**. If it doesn't, make sure the app is installed, then reopen settings.
4. On the first kiosk, copy the exported `config.json` to the USB stick, so the other kiosks can use **Import a config file**. If you skipped the export, it's also in Settings → Config → **Export config**.
5. Set the launch command to run at login (see the sections below):
   ```
   chrome --kiosk --autoplay-policy=no-user-gesture-required <url>
   ```
   A kiosk-mode tab shares storage with the installed app, so it sees the same videos and config. To exit kiosk mode, press Alt+F4 (Windows) or Cmd+Q (Mac).

   **Use this command for the live kiosk, not the installed app's icon.** Chrome opens the installed app in a window with its own title bar (app name, Uninstall, extensions, ⋮ menu), which the page can't hide. The app does go fullscreen on the first click or card scan, which hides the bar, but it can't do so by itself at launch. Kiosk mode starts fullscreen with no Chrome bars at all.

   If you do run the installed app directly and want it fullscreen at launch without a click, set the Chrome policy `AutomaticFullscreenAllowedForUrls` to `https://topps.drey.dev` on that machine, for example through your device management.
6. Turn off sleep, the screen saver and notifications.
7. **Offline test:** disconnect the network and restart the computer. Check that the loop plays and that a test card works. Then reconnect.

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
| "Setup required" on the screen | No loop video is selected, or the loop file is missing. Press **Open setup guide**, or open settings and follow the checklist. |
| Settings says "App update available" | Press **Reload** when no one is watching. The app never reloads itself. |
| Videos disappeared | Storage wasn't persisted and Chrome cleared it. Install the app, re-import the videos, and check **Persisted: yes**. |
