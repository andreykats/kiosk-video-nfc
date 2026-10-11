import { registerSW } from 'virtual:pwa-register';
import { Emitter } from '../app/emitter';
import { errorMessage, log } from '../app/log';

export interface SwStatus {
  state: 'unsupported' | 'registering' | 'registered' | 'error';
  error: string | null;
  needRefresh: boolean;
  /** Set briefly after the first install finishes caching the app. */
  justCachedAt: number | null;
}

/** Wraps vite-plugin-pwa's registerSW with `registerType: 'prompt'` semantics. */
export class ServiceWorkerManager {
  readonly changed = new Emitter<void>();
  private status: SwStatus = {
    state: 'serviceWorker' in navigator ? 'registering' : 'unsupported',
    error: null,
    needRefresh: false,
    justCachedAt: null,
  };
  private updateSW: ((reload?: boolean) => Promise<void>) | null = null;

  start(): void {
    if (this.status.state === 'unsupported') return;
    this.updateSW = registerSW({
      onNeedRefresh: () => this.set({ needRefresh: true }),
      onOfflineReady: () => this.set({ justCachedAt: Date.now() }),
      onRegisteredSW: () => this.set({ state: 'registered' }),
      onRegisterError: (e: unknown) => {
        log.error('Service worker registration failed:', e);
        this.set({ state: 'error', error: errorMessage(e) });
      },
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => this.changed.emit());
  }

  get(): SwStatus {
    return this.status;
  }

  /** Activates the waiting worker and reloads. Only ever user-initiated. */
  async applyUpdate(): Promise<void> {
    await this.updateSW?.(true);
  }

  private set(patch: Partial<SwStatus>): void {
    this.status = { ...this.status, ...patch };
    this.changed.emit();
  }
}
