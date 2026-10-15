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

/** How long after launch a new version is still applied (with a reload) rather than only offered. */
export const LAUNCH_UPDATE_WINDOW_MS = 30_000;

/**
 * Asks the server for a newer service worker and waits until it has finished
 * installing. Resolves quietly when offline: the cached version keeps running.
 */
export async function checkForUpdate(registration: ServiceWorkerRegistration): Promise<void> {
  try {
    await registration.update();
  } catch {
    return;
  }
  const installing = registration.installing;
  if (!installing) return;
  await new Promise<void>((resolve) => {
    const done = () => installing.state !== 'installing' && resolve();
    installing.addEventListener('statechange', done);
    done();
  });
}

/**
 * Wraps vite-plugin-pwa's registerSW (`registerType: 'prompt'`). The app only
 * updates itself while launching: it checks for a new version once, and if one
 * is found within LAUNCH_UPDATE_WINDOW_MS it activates it and reloads before the
 * show gets going. It never checks again, and a version Chrome finds later (on
 * its own) is only offered through the Reload banner in settings.
 */
export class ServiceWorkerManager {
  readonly changed = new Emitter<void>();
  private status: SwStatus = {
    state: 'serviceWorker' in navigator ? 'registering' : 'unsupported',
    error: null,
    needRefresh: false,
    justCachedAt: null,
  };
  private updateSW: ((reload?: boolean) => Promise<void>) | null = null;
  private launching = true;

  start(): void {
    if (this.status.state === 'unsupported') return;
    const timer = setTimeout(() => (this.launching = false), LAUNCH_UPDATE_WINDOW_MS);
    const endLaunch = () => {
      clearTimeout(timer);
      this.launching = false;
    };
    this.updateSW = registerSW({
      onNeedRefresh: () => {
        if (this.launching) return this.applyAtLaunch();
        this.set({ needRefresh: true });
      },
      onOfflineReady: () => this.set({ justCachedAt: Date.now() }),
      onRegisteredSW: (_url: string, registration: ServiceWorkerRegistration | undefined) => {
        this.set({ state: 'registered' });
        if (!registration) return endLaunch();
        void checkForUpdate(registration).then(() => {
          // workbox-window may report the waiting worker after this resolves.
          if (this.launching && registration.waiting) this.applyAtLaunch();
          endLaunch();
        });
      },
      onRegisterError: (e: unknown) => {
        endLaunch();
        log.error('Service worker registration failed:', e);
        this.set({ state: 'error', error: errorMessage(e) });
      },
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => this.changed.emit());
  }

  get(): SwStatus {
    return this.status;
  }

  /**
   * Activates the waiting worker and reloads. After launch, only ever
   * user-initiated. registerSW only reloads when the update came through
   * onNeedRefresh, so reload here once the new worker takes control.
   */
  async applyUpdate(): Promise<void> {
    navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), { once: true });
    await this.updateSW?.(true);
  }

  /** Once per launch: the reload starts a fresh launch, which finds nothing new. */
  private applyAtLaunch(): void {
    if (!this.launching) return;
    this.launching = false;
    log.info('A new version was found at launch; switching to it.');
    void this.applyUpdate();
  }

  private set(patch: Partial<SwStatus>): void {
    this.status = { ...this.status, ...patch };
    this.changed.emit();
  }
}
