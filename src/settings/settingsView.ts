import { IdleTimer, SETTINGS_IDLE_MS } from '../admin/access';
import type { AppContext } from '../app/context';
import { closeAllDialogs } from '../ui/dialog';
import { h } from '../ui/dom';
import { requestPersistence } from '../videos/opfsStore';
import { renderAdminCards, renderCards } from './cards';
import { renderChecklist } from './checklist';
import { renderConfigSection } from './configSection';
import { renderDiagnostics } from './diagnostics';
import { renderInstallSection } from './installSection';
import { renderReaderSection } from './readerSection';
import { renderResetSection } from './resetSection';
import type { Section } from './section';
import { renderVideos } from './videos';

export interface SettingsEnv {
  idle: IdleTimer;
}

function renderHeader(ctx: AppContext): Section {
  const online = h('span', { class: 'online', 'data-testid': 'online-status' });
  const update = () => {
    online.textContent = navigator.onLine ? '● Online' : '○ Offline';
    online.className = `online ${navigator.onLine ? 'good' : 'warn'}`;
  };
  update();
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  const swBanner = h('div', { class: 'banner', hidden: true });
  const unsubscribe = ctx.sw.changed.subscribe(() => {
    swBanner.hidden = !ctx.sw.get().needRefresh;
  });
  swBanner.append('A new version of the app is available. ', h('button', { type: 'button', class: 'primary', onclick: () => void ctx.sw.applyUpdate() }, 'Reload'));
  swBanner.hidden = !ctx.sw.get().needRefresh;
  const el = h(
    'header',
    { class: 'settings-header' },
    h('div', { class: 'header-row' }, h('button', { type: 'button', 'data-testid': 'back-to-kiosk', onclick: () => ctx.navigate('kiosk') }, '← Back to kiosk'), h('h1', {}, 'Kiosk settings'), h('button', { type: 'button', 'data-testid': 'open-setup-guide', onclick: () => ctx.navigate('setup') }, 'Setup guide'), h('span', { class: 'version' }, `v${__APP_VERSION__}`), online),
    swBanner,
  );
  return {
    el,
    destroy: () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
      unsubscribe();
    },
  };
}

export function mountSettings(root: HTMLElement, ctx: AppContext): () => void {
  const idle = new IdleTimer(SETTINGS_IDLE_MS, () => ctx.navigate('kiosk'));
  const env: SettingsEnv = { idle };
  const sections = [
    renderHeader(ctx),
    renderChecklist(ctx),
    renderVideos(ctx, env),
    renderCards(ctx),
    renderAdminCards(ctx),
    renderConfigSection(ctx),
    renderReaderSection(ctx),
    renderDiagnostics(ctx),
    renderInstallSection(ctx),
    renderResetSection(ctx),
  ];
  const view = h('div', { class: 'settings', 'data-testid': 'settings' }, ...sections.map((s) => s.el));
  root.replaceChildren(view);

  void requestPersistence().then(() => ctx.readiness.recompute());

  return () => {
    idle.destroy();
    sections.forEach((s) => s.destroy());
    closeAllDialogs();
    view.remove();
  };
}
