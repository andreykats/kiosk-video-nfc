import type { ConfigStore } from '../config/store';
import type { CardInput } from '../scan/cardInput';
import type { InstallManager } from '../pwa/install';
import type { ServiceWorkerManager } from '../pwa/sw';
import type { VideoStore } from '../videos/opfsStore';
import type { PlayCounts } from '../videos/playCounts';
import type { Diagnostics } from './diagnostics';
import type { ReadinessMonitor } from './readiness';

export type Route = 'kiosk' | 'settings' | 'setup';

/** Long-lived services shared by the kiosk and settings views. */
export interface AppContext {
  config: ConfigStore;
  videos: VideoStore;
  playCounts: PlayCounts;
  scanner: CardInput;
  install: InstallManager;
  sw: ServiceWorkerManager;
  diagnostics: Diagnostics;
  readiness: ReadinessMonitor;
  navigate(route: Route): void;
}
