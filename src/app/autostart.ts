/**
 * Whether this computer opens the kiosk by itself at startup. A page can't see
 * login items, so the startup command (public/mac-kiosk-autostart.sh, or the
 * Windows Startup shortcut) opens the kiosk with `?autostart`, and the app
 * remembers that it saw it. Stored per kiosk, outside the setup-guide progress:
 * a reset doesn't remove the startup command from the computer. The uninstall
 * script (public/mac-kiosk-autostart-uninstall.sh) opens `?autostart=removed`,
 * which forgets it.
 */

export const AUTOSTART_PARAM = 'autostart';
const REMOVED = 'removed';

const KEY = 'kiosk.autostartLaunchedAt';

/** The kiosk's address with the startup marker, for the startup command. */
export function autostartUrl(base: string): string {
  const url = new URL(base);
  url.hash = '';
  url.search = AUTOSTART_PARAM;
  return url.href;
}

/**
 * Acts on the startup marker in the address: records a launch by the startup
 * command, or forgets it when the uninstall script opened the kiosk. Removes the
 * marker from the address bar, so a later reload doesn't count again.
 */
export function readAutostartMarker(now = new Date()): 'launch' | 'removed' | null {
  const url = new URL(location.href);
  const marker = url.searchParams.get(AUTOSTART_PARAM);
  if (marker === null) return null;
  const removed = marker === REMOVED;
  try {
    if (removed) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, now.toISOString());
  } catch {
    // Storage disabled: the checklist keeps asking for it.
  }
  url.searchParams.delete(AUTOSTART_PARAM);
  history.replaceState(history.state, '', url.href);
  return removed ? 'removed' : 'launch';
}

/**
 * Calls `listener` when another tab records or forgets a launch, e.g. the tab
 * the uninstall script opens. Returns the unsubscribe function.
 */
export function onAutostartChange(listener: () => void): () => void {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY || e.key === null) listener();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
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
