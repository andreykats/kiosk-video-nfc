import { Emitter } from '../app/emitter';
import { log } from '../app/log';

export type InstallState = 'installed' | 'not-installed' | 'unknown';

export type InstallEvent =
  | { type: 'init'; stored: InstallState | null; runningAsApp: boolean }
  | { type: 'beforeinstallprompt' }
  | { type: 'appinstalled' }
  | { type: 'displayModeChanged'; runningAsApp: boolean };

/**
 * Pure install-state reducer (PLAN §9.2). `--kiosk` tabs report display-mode
 * "browser" even when the app is installed, so the stored flag and the absence of
 * beforeinstallprompt matter as much as the media query.
 */
export function reduceInstallState(state: InstallState, event: InstallEvent): InstallState {
  switch (event.type) {
    case 'init':
      if (event.runningAsApp) return 'installed';
      return event.stored ?? 'unknown';
    case 'beforeinstallprompt':
      // Chrome only fires this when the app is installable and not installed.
      return 'not-installed';
    case 'appinstalled':
      return 'installed';
    case 'displayModeChanged':
      return event.runningAsApp ? 'installed' : state;
  }
}

const STORAGE_KEY = 'kiosk.installed';

function readStored(): InstallState | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'true') return 'installed';
    if (value === 'false') return 'not-installed';
  } catch {
    // Storage disabled: fall through to unknown.
  }
  return null;
}

function writeStored(state: InstallState): void {
  if (state === 'unknown') return;
  try {
    localStorage.setItem(STORAGE_KEY, state === 'installed' ? 'true' : 'false');
  } catch {
    // Not fatal; we just re-detect next load.
  }
}

/** Tracks install state and holds the deferred beforeinstallprompt event. */
export class InstallManager {
  readonly changed = new Emitter<void>();
  private state: InstallState;
  private deferred: BeforeInstallPromptEvent | null = null;
  private readonly appQueries: MediaQueryList[];

  constructor() {
    this.appQueries = ['(display-mode: standalone)', '(display-mode: fullscreen)'].map((q) => matchMedia(q));
    this.state = reduceInstallState('unknown', {
      type: 'init',
      stored: readStored(),
      runningAsApp: this.runningAsApp(),
    });
    writeStored(this.state);

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.deferred = e;
      this.dispatch({ type: 'beforeinstallprompt' });
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.dispatch({ type: 'appinstalled' });
    });
    for (const q of this.appQueries) {
      q.addEventListener('change', () => this.dispatch({ type: 'displayModeChanged', runningAsApp: this.runningAsApp() }));
    }
  }

  private runningAsApp(): boolean {
    return this.appQueries.some((q) => q.matches);
  }

  private dispatch(event: InstallEvent): void {
    this.state = reduceInstallState(this.state, event);
    writeStored(this.state);
    this.changed.emit();
  }

  get(): InstallState {
    return this.state;
  }

  canPrompt(): boolean {
    return this.deferred !== null && this.state !== 'installed';
  }

  /** Shows Chrome's install dialog. A deferred event can only be used once. */
  async prompt(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const event = this.deferred;
    if (!event) return 'unavailable';
    this.deferred = null;
    this.changed.emit();
    try {
      await event.prompt();
      const { outcome } = await event.userChoice;
      return outcome;
    } catch (e) {
      log.warn('Install prompt failed:', e);
      return 'unavailable';
    }
  }
}
