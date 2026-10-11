import type { AppContext } from '../app/context';
import { h, replaceChildren } from '../ui/dom';
import { reactiveSection, type Section } from './section';

const MANUAL_INSTALL_STEPS =
  'Click the install icon at the right of the address bar, or Chrome menu ⋮ → Cast, save, and share → Install page as app…';

/** Install button when Chrome has offered install, manual steps otherwise. */
export function installCallToAction(ctx: AppContext): HTMLElement {
  if (!ctx.install.canPrompt()) return h('p', { class: 'hint', 'data-testid': 'install-manual' }, MANUAL_INSTALL_STEPS);
  return h(
    'button',
    {
      type: 'button',
      class: 'primary',
      'data-testid': 'install-button',
      onclick: () => void ctx.install.prompt(),
    },
    'Install app',
  );
}

export function renderInstallBanner(ctx: AppContext): Section {
  const el = h('div', { class: 'banner banner-warn', 'data-testid': 'install-banner' });
  return reactiveSection(
    el,
    () => {
      el.hidden = ctx.install.get() === 'installed';
      replaceChildren(
        el,
        h('p', {}, 'Install this app so it keeps working offline and your videos aren’t cleared.'),
        installCallToAction(ctx),
      );
    },
    [(l) => ctx.install.changed.subscribe(l)],
  );
}

/**
 * First-run checklist. In settings it hides once every item is green; on the
 * kiosk "Setup required" screen (compact) it always shows.
 */
export function renderChecklist(ctx: AppContext, options: { compact?: boolean } = {}): Section {
  const el = h('section', { class: `checklist${options.compact ? ' compact' : ''}`, 'data-testid': 'setup-checklist' });
  const section = reactiveSection(
    el,
    () => {
      const snapshot = ctx.readiness.get();
      if (!snapshot) {
        replaceChildren(el, h('p', { class: 'hint' }, 'Checking setup…'));
        return;
      }
      const allDone = snapshot.checklist.every((i) => i.done);
      el.hidden = allDone && !options.compact;
      replaceChildren(
        el,
        h('h2', {}, 'Setup checklist'),
        h(
          'ol',
          {},
          ...snapshot.checklist.map((item) =>
            h(
              'li',
              { class: item.done ? 'done' : 'todo', 'data-item': item.id },
              h('span', { class: 'mark' }, item.done ? '✓' : '✗'),
              ' ',
              item.label,
              !item.done && item.hint ? h('span', { class: 'hint' }, ` — ${item.hint}`) : null,
              item.id === 'install' && !item.done ? installCallToAction(ctx) : null,
            ),
          ),
        ),
      );
    },
    [(l) => ctx.readiness.changed.subscribe(l), (l) => ctx.install.changed.subscribe(l)],
  );
  void ctx.readiness.recompute();
  return section;
}
