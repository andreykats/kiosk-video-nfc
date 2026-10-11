import './style.css';
import { isSettingsShortcut } from './admin/access';
import type { AppContext, Route } from './app/context';
import { Diagnostics } from './app/diagnostics';
import { captureGlobalErrors, errorMessage, log } from './app/log';
import { ReadinessMonitor } from './app/readiness';
import { ConfigStore } from './config/store';
import { mountKiosk } from './kiosk/kioskView';
import { mountOnboarding } from './onboarding/onboardingView';
import { readFlags, writeFlags } from './onboarding/progress';
import { InstallManager } from './pwa/install';
import { ServiceWorkerManager } from './pwa/sw';
import { KeyboardScanner } from './scan/keyboardScanner';
import { mountSettings } from './settings/settingsView';
import { h } from './ui/dom';
import { VideoStore } from './videos/opfsStore';

const ROUTE_HASH: Record<Route, string> = { kiosk: '#/', settings: '#/settings', setup: '#/setup' };

function currentRoute(): Route {
  if (location.hash.startsWith('#/settings')) return 'settings';
  if (location.hash.startsWith('#/setup')) return 'setup';
  return 'kiosk';
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

  /** A kiosk that can already play its loop doesn't need the first-launch guide. */
  const isPlayable = () => {
    const loop = config.get().loopVideo;
    return loop !== null && videos.has(loop);
  };

  const render = () => {
    unmount?.();
    let route = currentRoute();
    if (route === 'kiosk' && !readFlags().completed) {
      if (isPlayable()) {
        writeFlags({ completed: true });
      } else {
        history.replaceState(null, '', ROUTE_HASH.setup);
        route = 'setup';
      }
    }
    document.documentElement.dataset.route = route;
    const mount = { kiosk: mountKiosk, settings: mountSettings, setup: mountOnboarding }[route];
    unmount = mount(root, ctx);
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
