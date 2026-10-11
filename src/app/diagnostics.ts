import { Emitter } from './emitter';

export type AutoplayStatus = 'unknown' | 'ok' | 'muted' | 'blocked';

/** Live values shown in settings → Diagnostics. */
export class Diagnostics {
  readonly changed = new Emitter<void>();
  lastScan: { uid: string; at: number } | null = null;
  autoplay: AutoplayStatus = 'unknown';

  recordScan(uid: string): void {
    this.lastScan = { uid, at: Date.now() };
    this.changed.emit();
  }

  setAutoplay(status: AutoplayStatus): void {
    if (this.autoplay === status) return;
    this.autoplay = status;
    this.changed.emit();
  }
}
