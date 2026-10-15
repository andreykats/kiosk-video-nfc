import type { AppContext } from '../app/context';
import { h, replaceChildren } from '../ui/dom';
import { reactiveSection, type Section } from './section';

const MANUAL_INSTALL_STEPS =
  'Click the install icon at the right of the address bar, or Chrome menu ⋮ → Cast, save, and share → Install page as app…';

/** Install button when Chrome has offered install, manual steps otherwise. */
function installCallToAction(ctx: AppContext): HTMLElement {
  if (!ctx.install.canPrompt()) return h('p', { class: 'hint', 'data-testid': 'install-manual' }, MANUAL_INSTALL_STEPS);
  return h('button', { type: 'button', 'data-testid': 'install-button', onclick: () => void ctx.install.prompt() }, 'Install app');
}

/**
 * Optional: the kiosk runs in a Chrome kiosk-mode tab, which shares the
 * installed app's storage. Installing mainly helps Chrome keep that storage
 * (and the videos) when the disk fills up.
 */
export function renderInstallSection(ctx: AppContext): Section {
  const el = h('section', { 'data-testid': 'install-section' });
  return reactiveSection(
    el,
    () => {
      const installed = ctx.install.get() === 'installed';
      replaceChildren(
        el,
        h('h2', {}, 'Install app'),
        h('p', { class: 'hint' }, 'Optional. Installing makes Chrome much less likely to delete the videos when the disk fills up. The kiosk itself opens in Chrome kiosk mode either way.'),
        installed ? h('p', { class: 'success', 'data-testid': 'install-done' }, 'App installed ✓') : installCallToAction(ctx),
        installed ? null : h('p', { class: 'hint' }, 'Chrome may only offer to install after you’ve clicked the page and spent about 30 seconds on it.'),
      );
    },
    [(l) => ctx.install.changed.subscribe(l)],
  );
}
