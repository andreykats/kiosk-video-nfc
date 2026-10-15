import type { CardMatch } from '../config/schema';

/**
 * How this kiosk reads cards, chosen by staff. Stored per kiosk (not in the
 * shared config), since only some kiosks have the bridge app installed.
 * - keyboard: the reader types the UID (HID keyboard mode). Never contacts the bridge.
 * - bridge: cards come from the NFC Browser Bridge app, with their NDEF card ID.
 */
export type ReaderMode = 'keyboard' | 'bridge';

export const READER_MODES: readonly ReaderMode[] = ['keyboard', 'bridge'];

/**
 * What identifies a video card on this kiosk, chosen by staff: its UID or its
 * NDEF payload (card ID). Applies to every card the kiosk pairs and plays. Also
 * stored per kiosk; keyboard mode can only read UIDs, whatever is stored.
 */
export type CardKey = CardMatch['kind'];

export const CARD_KEYS: readonly CardKey[] = ['uid', 'ndef'];

const MODE_KEY = 'kiosk.readerMode';
const DEFAULT_MODE: ReaderMode = 'keyboard';
const CARD_KEY_KEY = 'kiosk.cardKey';
/** Bridge kiosks paired by card ID before this was a setting. */
const DEFAULT_CARD_KEY: CardKey = 'ndef';

export function isReaderMode(value: unknown): value is ReaderMode {
  return typeof value === 'string' && (READER_MODES as readonly string[]).includes(value);
}

export function isCardKey(value: unknown): value is CardKey {
  return typeof value === 'string' && (CARD_KEYS as readonly string[]).includes(value);
}

function read<T>(key: string, valid: (value: unknown) => value is T, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return valid(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage disabled: the choice lasts until the page reloads.
  }
}

export function readReaderMode(): ReaderMode {
  return read(MODE_KEY, isReaderMode, DEFAULT_MODE);
}

export function writeReaderMode(mode: ReaderMode): void {
  write(MODE_KEY, mode);
}

export function readCardKey(): CardKey {
  return read(CARD_KEY_KEY, isCardKey, DEFAULT_CARD_KEY);
}

export function writeCardKey(key: CardKey): void {
  write(CARD_KEY_KEY, key);
}
