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
  /** Set once the launch switches version; the page reloads into it. */
  private switching = false;

  start(): void {
    if (this.status.state === 'unsupported') return;
    // A worker may already be waiting when the app starts. It is only switched
    // to once the launch check for a newer version is done: switching while a
    // newer worker installs lets each one's precache cleanup delete the other's
    // new files (index.html, the app bundle), which breaks the offline copy.
    let checking = true;
    let waiting = false;
    const endLaunch = () => {
      clearTimeout(timer);
      if (!this.launching) return;
      this.launching = false;
      // The check outlasted the launch window: offer the waiting version instead.
      if (waiting) this.set({ needRefresh: true });
    };
    const timer = setTimeout(endLaunch, LAUNCH_UPDATE_WINDOW_MS);
    this.updateSW = registerSW({
      onNeedRefresh: () => {
        if (this.switching) return;
        if (!this.launching) return this.set({ needRefresh: true });
        waiting = true;
        if (!checking) this.applyAtLaunch();
      },
      onOfflineReady: () => this.set({ justCachedAt: Date.now() }),
      onRegisteredSW: (_url: string, registration: ServiceWorkerRegistration | undefined) => {
        this.set({ state: 'registered' });
        if (!registration) return endLaunch();
        void checkForUpdate(registration).then(() => {
          checking = false;
          // The newest version, whether it was waiting already or the check found it.
          // workbox-window may also report it through onNeedRefresh after this.
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
    this.switching = true;
    log.info('A new version was found at launch; switching to it.');
    void this.applyUpdate();
  }

  private set(patch: Partial<SwStatus>): void {
    this.status = { ...this.status, ...patch };
    this.changed.emit();
  }
}
