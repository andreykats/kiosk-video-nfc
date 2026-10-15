import type { ScanEvent } from '../scan/scanEvent';
import { Emitter } from './emitter';

export type AutoplayStatus = 'unknown' | 'ok' | 'muted' | 'blocked';

/** Which video the kiosk had to recover: the background loop or a tag's video. */
export type PlaybackFailure = 'loop' | 'feature';

/** Live values shown in settings → Diagnostics. */
export class Diagnostics {
  readonly changed = new Emitter<void>();
  /** `at` is wall-clock time here, for display. */
  lastScan: ScanEvent | null = null;
  autoplay: AutoplayStatus = 'unknown';
  /** Wall-clock time this launch of the app started. */
  readonly startedAt = Date.now();
  /** Playback failures the kiosk recovered from since it started. */
  readonly failures: Record<PlaybackFailure, number> = { loop: 0, feature: 0 };

  recordScan(scan: ScanEvent): void {
    this.lastScan = { ...scan, at: Date.now() };
    this.changed.emit();
  }

  recordPlaybackFailure(kind: PlaybackFailure): void {
    this.failures[kind]++;
    this.changed.emit();
  }

  setAutoplay(status: AutoplayStatus): void {
    if (this.autoplay === status) return;
    this.autoplay = status;
    this.changed.emit();
  }
}
