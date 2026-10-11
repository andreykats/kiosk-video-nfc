import { Emitter } from '../app/emitter';
import { UID_HEX_LENGTHS } from './uid';

/**
 * The ACR1552U in keyboard-emulation mode "types" a card UID as hex followed by
 * Enter, much faster than a person can. We tell the two apart by timing.
 *
 * Keys are read from `event.code` (physical key), not `event.key`, so the OS
 * keyboard layout (AZERTY etc.) doesn't change what we decode.
 */

export interface ScanEvent {
  uid: string;
  at: number;
}

export interface ScannerOptions {
  /** A gap longer than this between keys ends the burst. */
  maxInterKeyMs: number;
  /** With no Enter, a burst idle for this long is flushed and validated. */
  idleFlushMs: number;
  /** The same UID scanned again within this window is ignored. */
  debounceMs: number;
}

export const DEFAULT_SCANNER_OPTIONS: ScannerOptions = {
  maxInterKeyMs: 50,
  idleFlushMs: 150,
  debounceMs: 1500,
};

export interface KeyInput {
  code: string;
  /** Time in ms (performance.now() or event.timeStamp). */
  at: number;
  repeat?: boolean;
  ctrlKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
}

export interface FeedResult {
  /** The key belonged to a burst and should not reach the page. */
  consumed: boolean;
  scan?: ScanEvent;
}

const SEPARATOR_CODES = new Set(['Space', 'Minus', 'Semicolon']);
const ENTER_CODES = new Set(['Enter', 'NumpadEnter']);
/** Readers press Shift to type uppercase A–F; it's neither data nor an abort. */
const NEUTRAL_CODES = new Set(['ShiftLeft', 'ShiftRight']);

export function hexForCode(code: string): string | null {
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(code);
  if (digit) return digit[1]!;
  const letter = /^Key([A-F])$/.exec(code);
  if (letter) return letter[1]!;
  return null;
}

/** Pure, clock-injected burst parser. */
export class ScanParser {
  private buffer = '';
  private lastKeyAt = 0;
  private lastUid: string | null = null;
  private lastUidAt = -Infinity;

  constructor(private readonly options: ScannerOptions = DEFAULT_SCANNER_OPTIONS) {}

  get active(): boolean {
    return this.buffer.length > 0;
  }

  feed(key: KeyInput): FeedResult {
    if (this.active && key.at - this.lastKeyAt > this.options.maxInterKeyMs) this.reset();

    if (key.repeat || key.ctrlKey || key.altKey || key.metaKey) {
      // Held keys and shortcuts are never reader output.
      this.reset();
      return { consumed: false };
    }

    if (NEUTRAL_CODES.has(key.code)) {
      if (this.active) this.lastKeyAt = key.at;
      return { consumed: this.active };
    }

    const hex = hexForCode(key.code);
    if (hex !== null) {
      const continuing = this.active;
      this.buffer += hex;
      this.lastKeyAt = key.at;
      // The first key can't be told apart from typing yet, so it passes through.
      return { consumed: continuing };
    }

    if (SEPARATOR_CODES.has(key.code) && this.active) {
      this.lastKeyAt = key.at;
      return { consumed: true };
    }

    if (ENTER_CODES.has(key.code) && this.active) {
      const scan = this.complete(key.at);
      return scan ? { consumed: true, scan } : { consumed: true };
    }

    this.reset();
    return { consumed: false };
  }

  /** Called when no key has arrived for idleFlushMs (reader without Enter suffix). */
  flush(now: number): ScanEvent | undefined {
    if (!this.active) return undefined;
    if (now - this.lastKeyAt > this.options.idleFlushMs + this.options.maxInterKeyMs * 4) {
      // Timer fired far too late (e.g. tab was throttled); don't trust the burst.
      this.reset();
      return undefined;
    }
    return this.complete(now);
  }

  private complete(at: number): ScanEvent | undefined {
    const uid = this.buffer;
    this.reset();
    if (!UID_HEX_LENGTHS.includes(uid.length)) return undefined;
    const duplicate = uid === this.lastUid && at - this.lastUidAt < this.options.debounceMs;
    // A card resting on the reader may re-emit; keep extending the window.
    this.lastUid = uid;
    this.lastUidAt = at;
    return duplicate ? undefined : { uid, at };
  }

  private reset(): void {
    this.buffer = '';
  }
}

/**
 * Listens on `window` in the capture phase so bursts are seen before any handler
 * and consumed keys can't type into inputs or trigger browser shortcuts.
 */
export class KeyboardScanner {
  readonly scans = new Emitter<ScanEvent>();
  private readonly parser: ScanParser;
  private idleTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly target: Window = window,
    private readonly options: ScannerOptions = DEFAULT_SCANNER_OPTIONS,
  ) {
    this.parser = new ScanParser(options);
    this.target.addEventListener('keydown', this.onKeyDown, { capture: true });
  }

  destroy(): void {
    this.target.removeEventListener('keydown', this.onKeyDown, { capture: true });
    clearTimeout(this.idleTimer);
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    clearTimeout(this.idleTimer);
    const result = this.parser.feed({
      code: event.code,
      at: performance.now(),
      repeat: event.repeat,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
    });
    if (result.consumed) {
      event.preventDefault();
      event.stopPropagation();
    }
    if (result.scan) this.scans.emit(result.scan);
    if (this.parser.active) {
      this.idleTimer = setTimeout(() => {
        const scan = this.parser.flush(performance.now());
        if (scan) this.scans.emit(scan);
      }, this.options.idleFlushMs);
    }
  };
}
