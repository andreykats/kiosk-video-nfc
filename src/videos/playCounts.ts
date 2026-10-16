import { Emitter } from '../app/emitter';

const KEY = 'kiosk.playCounts';

/**
 * How many times each video was played by a tag on this kiosk, by file name.
 * Stored per kiosk, not in the shared config. The loop's repeats don't count.
 */
export class PlayCounts {
  readonly changed = new Emitter<void>();
  private counts: Map<string, number>;

  constructor(private readonly storage: Storage | null = safeLocalStorage()) {
    this.counts = parse(read(storage));
  }

  get(fileName: string): number {
    return this.counts.get(fileName) ?? 0;
  }

  increment(fileName: string): void {
    this.counts.set(fileName, this.get(fileName) + 1);
    this.save();
  }

  reset(fileName: string): void {
    if (this.counts.delete(fileName)) this.save();
  }

  clear(): void {
    this.counts.clear();
    this.save();
  }

  private save(): void {
    try {
      if (this.counts.size === 0) this.storage?.removeItem(KEY);
      else this.storage?.setItem(KEY, JSON.stringify(Object.fromEntries(this.counts)));
    } catch {
      // Storage disabled or full: counts last until the page reloads.
    }
    this.changed.emit();
  }
}

function safeLocalStorage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage | null): string | null {
  try {
    return storage?.getItem(KEY) ?? null;
  } catch {
    return null;
  }
}

/** Keeps only non-negative whole counts; anything else stored is dropped. */
export function parse(raw: string | null): Map<string, number> {
  const counts = new Map<string, number>();
  if (raw === null) return counts;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return counts;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return counts;
  for (const [fileName, count] of Object.entries(value)) {
    if (Number.isSafeInteger(count) && (count as number) >= 0) counts.set(fileName, count as number);
  }
  return counts;
}
