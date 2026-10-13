import type { ScanEvent } from '../scan/scanEvent';
import { Emitter } from './emitter';

export type AutoplayStatus = 'unknown' | 'ok' | 'muted' | 'blocked';

/** Live values shown in settings → Diagnostics. */
export class Diagnostics {
  readonly changed = new Emitter<void>();
  /** `at` is wall-clock time here, for display. */
  lastScan: ScanEvent | null = null;
  autoplay: AutoplayStatus = 'unknown';

  recordScan(scan: ScanEvent): void {
    this.lastScan = { ...scan, at: Date.now() };
    this.changed.emit();
  }

  setAutoplay(status: AutoplayStatus): void {
    if (this.autoplay === status) return;
    this.autoplay = status;
    this.changed.emit();
  }
}
