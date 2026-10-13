/**
 * How this kiosk reads cards. Stored per kiosk (not in the shared config),
 * since only some kiosks have the bridge app installed.
 * - keyboard: the reader types the UID (HID keyboard mode). Never contacts the bridge.
 * - bridge: cards come from the NFC Browser Bridge app, with their NDEF card ID.
 * - auto: the bridge while it's running with a reader attached, otherwise the keyboard.
 */
export type ReaderMode = 'keyboard' | 'bridge' | 'auto';

export const READER_MODES: readonly ReaderMode[] = ['keyboard', 'bridge', 'auto'];

const KEY = 'kiosk.readerMode';
const DEFAULT: ReaderMode = 'keyboard';

export function isReaderMode(value: unknown): value is ReaderMode {
  return typeof value === 'string' && (READER_MODES as readonly string[]).includes(value);
}

export function readReaderMode(): ReaderMode {
  try {
    const value = localStorage.getItem(KEY);
    return isReaderMode(value) ? value : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

export function writeReaderMode(mode: ReaderMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // Storage disabled: the mode lasts until the page reloads.
  }
}
