import type { ConfigStore } from '../config/store';
import type { KeyboardScanner } from '../scan/keyboardScanner';
import type { InstallManager } from '../pwa/install';
import type { ServiceWorkerManager } from '../pwa/sw';
import type { VideoStore } from '../videos/opfsStore';
import type { Diagnostics } from './diagnostics';
import type { ReadinessMonitor } from './readiness';

export type Route = 'kiosk' | 'settings';

/** Long-lived services shared by the kiosk and settings views. */
export interface AppContext {
  config: ConfigStore;
  videos: VideoStore;
  scanner: KeyboardScanner;
  install: InstallManager;
  sw: ServiceWorkerManager;
  diagnostics: Diagnostics;
  readiness: ReadinessMonitor;
  navigate(route: Route): void;
}
