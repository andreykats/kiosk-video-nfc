export type ProgressStatus = 'progress' | 'waiting' | 'stalled';

/**
 * Pure, clock-injected stall detector for a media element. A video that should
 * be playing but whose currentTime hasn't moved for `stallMs` is stalled: frozen
 * decoder, a play() that never started, a file read that never returned. None
 * of those fire `ended` or `error`, so without this the kiosk would wait forever.
 */
export class ProgressWatch {
  private lastTime: number | null = null;
  private lastProgressAt: number;

  constructor(
    private readonly stallMs: number,
    now: number,
  ) {
    this.lastProgressAt = now;
  }

  /** Starts a fresh grace period, e.g. after a new source or a state change. */
  reset(now: number): void {
    this.lastTime = null;
    this.lastProgressAt = now;
  }

  sample(currentTime: number, now: number): ProgressStatus {
    const moved = this.lastTime !== null && currentTime !== this.lastTime;
    this.lastTime = currentTime;
    if (moved) {
      this.lastProgressAt = now;
      return 'progress';
    }
    return now - this.lastProgressAt >= this.stallMs ? 'stalled' : 'waiting';
  }
}

/** Exponential backoff for the nth consecutive failure (n ≥ 1). */
export function retryDelay(failures: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** Math.max(0, failures - 1), maxMs);
}
