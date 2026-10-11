import './style.css';
import { isSettingsShortcut } from './admin/access';
import type { AppContext, Route } from './app/context';
import { Diagnostics } from './app/diagnostics';
import { captureGlobalErrors, errorMessage, log } from './app/log';
import { ReadinessMonitor } from './app/readiness';
import { ConfigStore } from './config/store';
import { mountKiosk } from './kiosk/kioskView';
import { InstallManager } from './pwa/install';
import { ServiceWorkerManager } from './pwa/sw';
import { KeyboardScanner } from './scan/keyboardScanner';
import { mountSettings } from './settings/settingsView';
import { h } from './ui/dom';
import { VideoStore } from './videos/opfsStore';

const ROUTE_HASH: Record<Route, string> = { kiosk: '#/', settings: '#/settings' };

function currentRoute(): Route {
  return location.hash.startsWith('#/settings') ? 'settings' : 'kiosk';
}

function showFatal(root: HTMLElement, message: string): void {
  root.replaceChildren(h('div', { class: 'fatal', 'data-testid': 'fatal' }, h('h1', {}, 'The kiosk cannot start'), h('p', {}, message)));
}

async function boot(): Promise<void> {
  captureGlobalErrors();
  const root = document.getElementById('app')!;

  // Created before any await so an early beforeinstallprompt isn't missed.
  const install = new InstallManager();
  const sw = new ServiceWorkerManager();
  sw.start();
  const scanner = new KeyboardScanner();
  const diagnostics = new Diagnostics();
  scanner.scans.subscribe((scan) => diagnostics.recordScan(scan.uid));

  let config: ConfigStore;
  let videos: VideoStore;
  try {
    [config, videos] = await Promise.all([ConfigStore.open(), VideoStore.open()]);
  } catch (e) {
    log.error('Startup failed:', e);
    showFatal(root, errorMessage(e));
    return;
  }
  const loadError = config.status().error;
  if (loadError) log.error('Stored config is invalid and was ignored:', loadError.join(' '));

  const readiness = new ReadinessMonitor(config, videos, sw, install);
  let unmount: (() => void) | null = null;

  const ctx: AppContext = {
    config,
    videos,
    scanner,
    install,
    sw,
    diagnostics,
    readiness,
    navigate(route) {
      if (currentRoute() === route) return;
      location.hash = ROUTE_HASH[route];
    },
  };

  const render = () => {
    unmount?.();
    const route = currentRoute();
    document.documentElement.dataset.route = route;
    unmount = route === 'settings' ? mountSettings(root, ctx) : mountKiosk(root, ctx);
  };

  window.addEventListener('hashchange', render);
  window.addEventListener('keydown', (e) => {
    if (isSettingsShortcut(e)) {
      e.preventDefault();
      ctx.navigate('settings');
    }
  });
  render();
  void readiness.recompute();
}

void boot();
