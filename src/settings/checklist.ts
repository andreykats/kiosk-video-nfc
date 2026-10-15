import type { AppContext } from '../app/context';
import { h, replaceChildren } from '../ui/dom';
import { reactiveSection, type Section } from './section';

/** Setup checklist at the top of settings; hides once every item is green. */
export function renderChecklist(ctx: AppContext): Section {
  const el = h('section', { class: 'checklist', 'data-testid': 'setup-checklist' });
  const section = reactiveSection(
    el,
    () => {
      const snapshot = ctx.readiness.get();
      if (!snapshot) {
        replaceChildren(el, h('p', { class: 'hint' }, 'Checking setup…'));
        return;
      }
      const allDone = snapshot.checklist.every((i) => i.done);
      el.hidden = allDone;
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
            ),
          ),
        ),
      );
    },
    [(l) => ctx.readiness.changed.subscribe(l)],
  );
  void ctx.readiness.recompute();
  return section;
}
