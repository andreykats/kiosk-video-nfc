import type { AppliedInfo, ConfigStore } from '../config/store';
import { checkAppCached, computeOfflineReadiness, type Readiness } from '../pwa/offlineReady';
import type { InstallManager } from '../pwa/install';
import type { ServiceWorkerManager } from '../pwa/sw';
import { storageInfo, type StorageInfo, type VideoStore } from '../videos/opfsStore';
import { lastAutostartLaunch } from './autostart';
import { Emitter } from './emitter';
import { log } from './log';

export interface ChecklistItem {
  id: 'config' | 'videos' | 'persisted' | 'offline' | 'autostart';
  label: string;
  done: boolean;
  hint?: string;
}

export interface ChecklistInputs {
  applied: AppliedInfo | null;
  videoCount: number;
  missingVideos: number;
  persisted: boolean | null;
  readiness: Readiness;
  /** The startup command has opened the kiosk at least once. */
  autostartLaunched: boolean;
}

/** Pure first-run setup checklist (PLAN §9.2). */
export function computeChecklist(i: ChecklistInputs): ChecklistItem[] {
  return [
    { id: 'config', label: 'Update config', done: i.applied !== null, hint: 'Settings → Config → Update from published config.' },
    {
      id: 'videos',
      label: 'Import videos',
      done: i.videoCount > 0 && i.missingVideos === 0,
      hint: i.videoCount === 0 ? 'No videos in the config yet.' : `${i.missingVideos} video(s) missing → Import folder.`,
    },
    { id: 'persisted', label: 'Storage persisted', done: i.persisted === true, hint: 'Install the app (Settings → Install as Chrome App), then reopen settings.' },
    { id: 'offline', label: 'Ready to work offline', done: i.readiness.ready, hint: 'See Diagnostics for details.' },
    {
      id: 'autostart',
      label: 'Opens at startup',
      done: i.autostartLaunched,
      hint: 'Set the kiosk to open at startup (setup guide → Open at startup), then restart this computer.',
    },
  ];
}

export interface ReadinessSnapshot {
  readiness: Readiness;
  checklist: ChecklistItem[];
  storage: StorageInfo;
}

/**
 * Recomputes offline readiness and the checklist whenever an input may have
 * changed. Nothing is persisted: a wiped cache must turn the indicator red.
 */
export class ReadinessMonitor {
  readonly changed = new Emitter<ReadinessSnapshot>();
  private snapshot: ReadinessSnapshot | null = null;
  private pending: Promise<void> | null = null;
  private dirty = false;

  constructor(
    private readonly config: ConfigStore,
    private readonly videos: VideoStore,
    private readonly sw: ServiceWorkerManager,
    // Installing can make storage persistent.
    install: InstallManager,
  ) {
    const trigger = () => this.recompute();
    config.changed.subscribe(trigger);
    videos.changed.subscribe(trigger);
    sw.changed.subscribe(trigger);
    install.changed.subscribe(trigger);
    navigator.serviceWorker?.ready.then(trigger).catch(() => undefined);
  }

  get(): ReadinessSnapshot | null {
    return this.snapshot;
  }

  /** Coalesces overlapping requests; always finishes with fresh inputs. */
  recompute(): Promise<void> {
    if (this.pending) {
      this.dirty = true;
      return this.pending;
    }
    this.pending = (async () => {
      do {
        this.dirty = false;
        try {
          this.snapshot = await this.compute();
          this.changed.emit(this.snapshot);
        } catch (e) {
          log.error('Readiness check failed:', e);
        }
      } while (this.dirty);
      this.pending = null;
    })();
    return this.pending;
  }

  private async compute(): Promise<ReadinessSnapshot> {
    const [appCached, storage] = await Promise.all([checkAppCached(this.sw.get().error), storageInfo()]);
    const status = this.config.status();
    const config = status.stored ? this.config.get() : null;
    const presentFiles = this.videos.names();
    const readiness = computeOfflineReadiness({
      appCached,
      config,
      configError: status.error ? `Stored config is invalid: ${status.error.join(' ')}` : undefined,
      presentFiles,
      persisted: storage.persisted,
    });
    const listed = this.config.get().videos;
    const checklist = computeChecklist({
      applied: this.config.lastApplied(),
      videoCount: listed.length,
      missingVideos: listed.filter((v) => !presentFiles.has(v.fileName)).length,
      persisted: storage.persisted,
      readiness,
      autostartLaunched: lastAutostartLaunch() !== null,
    });
    return { readiness, checklist, storage };
  }
}
