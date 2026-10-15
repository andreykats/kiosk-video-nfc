import { Emitter } from './emitter';

export interface LogEntry {
  at: number;
  /** 'start' marks each launch of the app, so one run can be told from the next. */
  level: 'start' | 'info' | 'warn' | 'error';
  message: string;
}

const PREFIX = '[kiosk]';
const KEY = 'kiosk.log';
const MAX_ENTRIES = 200;
const MAX_MESSAGE_LENGTH = 500;
const LEVELS: ReadonlySet<string> = new Set<LogEntry['level']>(['start', 'info', 'warn', 'error']);

function describe(part: unknown): string {
  if (part instanceof Error) return `${part.name}: ${part.message}`;
  if (typeof part === 'string') return part;
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/**
 * The last MAX_ENTRIES log entries, kept in localStorage so that what happened
 * before a restart or crash can still be read in settings → Diagnostics.
 */
export class LogBook {
  readonly changed = new Emitter<void>();
  private entries: LogEntry[];

  constructor(
    private readonly storage: Storage | null = safeLocalStorage(),
    private readonly now: () => number = Date.now,
  ) {
    this.entries = parseLog(read(storage));
  }

  recent(): readonly LogEntry[] {
    return this.entries;
  }

  add(level: LogEntry['level'], parts: unknown[]): void {
    let message = parts.map(describe).join(' ');
    if (message.length > MAX_MESSAGE_LENGTH) message = `${message.slice(0, MAX_MESSAGE_LENGTH - 1)}…`;
    this.entries.push({ at: this.now(), level, message });
    if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    this.save();
  }

  clear(): void {
    this.entries = [];
    this.save();
  }

  private save(): void {
    try {
      if (this.entries.length === 0) this.storage?.removeItem(KEY);
      else this.storage?.setItem(KEY, JSON.stringify(this.entries));
    } catch {
      // Storage disabled or full: the log lasts until the page reloads.
    }
    this.changed.emit();
  }
}

function read(storage: Storage | null): string | null {
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

/** Keeps only well-formed entries; anything else stored is dropped. */
export function parseLog(raw: string | null): LogEntry[] {
  if (raw === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const entries = value.filter(
    (e): e is LogEntry =>
      typeof e === 'object' &&
      e !== null &&
      Number.isFinite(e.at) &&
      LEVELS.has(e.level) &&
      typeof e.message === 'string' &&
      e.message.length <= MAX_MESSAGE_LENGTH,
  );
  return entries.slice(-MAX_ENTRIES).map(({ at, level, message }) => ({ at, level, message }));
}

/** Plain text for pasting into a message: one line per entry, oldest first. */
export function formatLog(entries: readonly LogEntry[]): string {
  return entries.map((e) => `${new Date(e.at).toISOString()} ${e.level.toUpperCase()} ${e.message}`).join('\n');
}

const book = new LogBook();
export const logChanged = book.changed;

/** Console logging with a consistent prefix; also kept in the stored log for Diagnostics. */
export const log = {
  /** Marks a launch of the app. */
  start: (...parts: unknown[]) => {
    console.info(PREFIX, ...parts);
    book.add('start', parts);
  },
  info: (...parts: unknown[]) => {
    console.info(PREFIX, ...parts);
    book.add('info', parts);
  },
  warn: (...parts: unknown[]) => {
    console.warn(PREFIX, ...parts);
    book.add('warn', parts);
  },
  error: (...parts: unknown[]) => {
    console.error(PREFIX, ...parts);
    book.add('error', parts);
  },
  recent: (): readonly LogEntry[] => book.recent(),
  clear: () => book.clear(),
};

export function captureGlobalErrors(): void {
  window.addEventListener('error', (e) => log.error('Uncaught:', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => log.error('Unhandled rejection:', e.reason));
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
