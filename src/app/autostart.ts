/**
 * Whether this computer opens the kiosk by itself at startup. A page can't see
 * login items, so the startup command (public/mac-kiosk-autostart.sh, or the
 * Windows Startup shortcut) opens the kiosk with `?autostart`, and the app
 * remembers that it saw it. Stored per kiosk, outside the setup-guide progress:
 * a reset doesn't remove the startup command from the computer.
 */

export const AUTOSTART_PARAM = 'autostart';

const KEY = 'kiosk.autostartLaunchedAt';

/** The kiosk's address with the startup marker, for the startup command. */
export function autostartUrl(base: string): string {
  const url = new URL(base);
  url.hash = '';
  url.search = AUTOSTART_PARAM;
  return url.href;
}

/**
 * Records a launch by the startup command and removes the marker from the
 * address bar, so a later reload doesn't count as one. Returns whether this
 * launch was one.
 */
export function recordAutostartLaunch(now = new Date()): boolean {
  const url = new URL(location.href);
  if (!url.searchParams.has(AUTOSTART_PARAM)) return false;
  try {
    localStorage.setItem(KEY, now.toISOString());
  } catch {
    // Storage disabled: the checklist keeps asking for it.
  }
  url.searchParams.delete(AUTOSTART_PARAM);
  history.replaceState(history.state, '', url.href);
  return true;
}

/** When the startup command last opened the kiosk, or null if it never has. */
export function lastAutostartLaunch(): Date | null {
  try {
    const raw = localStorage.getItem(KEY);
    const at = raw === null ? NaN : Date.parse(raw);
    return Number.isNaN(at) ? null : new Date(at);
  } catch {
    return null;
  }
}
