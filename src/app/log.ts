import { Emitter } from './emitter';

export interface LogEntry {
  at: number;
  level: 'warn' | 'error';
  message: string;
}

const PREFIX = '[kiosk]';
const MAX_ENTRIES = 50;

const entries: LogEntry[] = [];
export const logChanged = new Emitter<void>();

function describe(part: unknown): string {
  if (part instanceof Error) return `${part.name}: ${part.message}`;
  if (typeof part === 'string') return part;
  try {
    return JSON.stringify(part);
  } catch {
    return String(part);
  }
}

function record(level: LogEntry['level'], parts: unknown[]): void {
  entries.push({ at: Date.now(), level, message: parts.map(describe).join(' ') });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  logChanged.emit();
}

/** Console logging with a consistent prefix; keeps the last 50 for diagnostics. */
export const log = {
  info: (...parts: unknown[]) => console.info(PREFIX, ...parts),
  warn: (...parts: unknown[]) => {
    console.warn(PREFIX, ...parts);
    record('warn', parts);
  },
  error: (...parts: unknown[]) => {
    console.error(PREFIX, ...parts);
    record('error', parts);
  },
  recent: (): readonly LogEntry[] => entries,
};

export function captureGlobalErrors(): void {
  window.addEventListener('error', (e) => log.error('Uncaught:', e.error ?? e.message));
  window.addEventListener('unhandledrejection', (e) => log.error('Unhandled rejection:', e.reason));
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
