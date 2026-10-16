/**
 * Playback choices made by staff in Settings → Playback. Stored per kiosk, like
 * the reader settings; only a choice that differs from the default is stored.
 */
function readFlag(key: string, fallback: boolean): boolean {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

function writeFlag(key: string, fallback: boolean, on: boolean): void {
  try {
    if (on === fallback) localStorage.removeItem(key);
    else localStorage.setItem(key, String(on));
  } catch {
    // Storage disabled: the choice lasts until the page reloads.
  }
}

/** Whether a tag scan may interrupt the playing video. Off: a video plays to the end first. */
const INTERRUPT_KEY = 'kiosk.interruptPlayback';

export function readInterruptPlayback(): boolean {
  return readFlag(INTERRUPT_KEY, false);
}

export function writeInterruptPlayback(on: boolean): void {
  writeFlag(INTERRUPT_KEY, false, on);
}

/**
 * Whether videos are zoomed to fill the screen, cropping what doesn't fit (a
 * landscape video on a portrait screen fills the height and shows the middle).
 * On by default; off shows the whole video with black bars.
 */
const FILL_SCREEN_KEY = 'kiosk.fillScreen';

export function readFillScreen(): boolean {
  return readFlag(FILL_SCREEN_KEY, true);
}

export function writeFillScreen(on: boolean): void {
  writeFlag(FILL_SCREEN_KEY, true, on);
}
