/**
 * Whether a tag scan may interrupt the video that's playing, chosen by staff in
 * Settings → Playback. Stored per kiosk, like the reader settings. Off by
 * default: a video plays to the end before another tag can start one.
 */
const INTERRUPT_KEY = 'kiosk.interruptPlayback';

export function readInterruptPlayback(): boolean {
  try {
    return localStorage.getItem(INTERRUPT_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writeInterruptPlayback(on: boolean): void {
  try {
    if (on) localStorage.setItem(INTERRUPT_KEY, 'true');
    else localStorage.removeItem(INTERRUPT_KEY);
  } catch {
    // Storage disabled: the choice lasts until the page reloads.
  }
}
