import { IdleTimer, SETTINGS_IDLE_MS } from '../admin/access';
import type { AppContext } from '../app/context';
import { resolveScan } from '../config/ops';
import { startFullscreen } from '../kiosk/fullscreen';
import { closeAllDialogs, isDialogOpen } from '../ui/dialog';
import { h } from '../ui/dom';
import { requestPersistence } from '../videos/opfsStore';
import { renderAdminCards, renderCards } from './cards';
import { renderAutostartSection } from './autostartSection';
import { renderChecklist } from './checklist';
import { renderConfigSection } from './configSection';
import { renderDiagnostics } from './diagnostics';
import { renderInstallSection } from './installSection';
import { renderPlaybackSection } from './playbackSection';
import { renderReaderSection } from './readerSection';
import { renderResetSection } from './resetSection';
import type { Section } from './section';
import { renderVideos } from './videos';

export interface SettingsEnv {
  idle: IdleTimer;
}

/** Leaving settings for the kiosk on purpose: the first time, that's also when it goes fullscreen. */
function openKiosk(ctx: AppContext): void {
  startFullscreen();
  ctx.navigate('kiosk');
}

function renderHeader(ctx: AppContext): Section {
  const swBanner = h('div', { class: 'banner', hidden: true });
  const unsubscribe = ctx.sw.changed.subscribe(() => {
    swBanner.hidden = !ctx.sw.get().needRefresh;
  });
  swBanner.append('A new version of the app is available. ', h('button', { type: 'button', class: 'primary', onclick: () => void ctx.sw.applyUpdate() }, 'Reload'));
  swBanner.hidden = !ctx.sw.get().needRefresh;
  const el = h(
    'header',
    { class: 'settings-header' },
    h('div', { class: 'header-row' }, h('button', { type: 'button', 'data-testid': 'back-to-kiosk', onclick: () => openKiosk(ctx) }, '← Back to kiosk'), h('h1', {}, 'Kiosk settings'), h('button', { type: 'button', 'data-testid': 'open-setup-guide', onclick: () => ctx.navigate('setup') }, 'Setup guide'), h('span', { class: 'version' }, `v${__APP_VERSION__}`)),
    swBanner,
  );
  return { el, destroy: unsubscribe };
}

export function mountSettings(root: HTMLElement, ctx: AppContext): () => void {
  const idle = new IdleTimer(SETTINGS_IDLE_MS, () => ctx.navigate('kiosk'));
  const env: SettingsEnv = { idle };
  // An admin tag closes settings, like it opens them from the kiosk. Not while a
  // dialog is open: Add admin tag and pairing need the scan. This listener is
  // added before any dialog's, so it runs while that dialog is still open.
  const unsubscribeScans = ctx.scanner.scans.subscribe((scan) => {
    if (!isDialogOpen() && resolveScan(ctx.config.get(), scan, ctx.scanner.cardKey)?.kind === 'admin') openKiosk(ctx);
  });
  const sections = [
    renderHeader(ctx),
    renderChecklist(ctx),
    renderVideos(ctx, env),
    renderCards(ctx),
    renderAdminCards(ctx),
    renderPlaybackSection(),
    renderConfigSection(ctx),
    renderReaderSection(ctx),
    renderDiagnostics(ctx),
    renderAutostartSection(),
    renderInstallSection(ctx),
    renderResetSection(ctx),
  ];
  const view = h('div', { class: 'settings', 'data-testid': 'settings' }, ...sections.map((s) => s.el));
  root.replaceChildren(view);

  void requestPersistence().then(() => ctx.readiness.recompute());

  return () => {
    unsubscribeScans();
    idle.destroy();
    sections.forEach((s) => s.destroy());
    closeAllDialogs();
    view.remove();
  };
}
