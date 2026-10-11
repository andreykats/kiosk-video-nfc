import type { AppContext } from '../app/context';
import { addAdminCard, findAdminCard, findCard, findVideo, pairCard, removeAdminCard, removeCard, setAdminCardLabel, setCardLabel, setCardVideo } from '../config/ops';
import { formatUid } from '../scan/uid';
import { confirmDialog } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { openScanDialog, scanMessage } from './scanModal';
import { reactiveSection, type Section } from './section';
import { saveEdit } from '../app/edits';

function videoSelect(ctx: AppContext, selected: string | null, attrs: Record<string, string> = {}): HTMLSelectElement {
  const config = ctx.config.get();
  const select = h('select', attrs);
  if (selected === null) select.append(h('option', { value: '', disabled: true, selected: true }, 'Choose a video…'));
  for (const v of config.videos) {
    select.append(h('option', { value: v.fileName, selected: v.fileName === selected }, v.title ? `${v.title} (${v.fileName})` : v.fileName));
  }
  return select;
}

/** Pair-new-card flow: scan → (reassign?) → pick video + label → save. */
async function pairNewCard(ctx: AppContext): Promise<void> {
  const dialog = openScanDialog<string>(ctx, {
    title: 'Pair new card',
    testId: 'pair-dialog',
    onScan: (uid, d) => {
      const config = ctx.config.get();
      const admin = findAdminCard(config, uid);
      if (admin) {
        scanMessage(d, `${formatUid(uid)} is an admin card${admin.label ? ` (${admin.label})` : ''}. Remove it from admin cards first, or scan another card.`, 'error');
        return false;
      }
      showDetails(uid);
      return true;
    },
  });

  const showDetails = (uid: string) => {
    const config = ctx.config.get();
    const existing = findCard(config, uid);
    const select = videoSelect(ctx, existing?.fileName ?? null, { 'data-testid': 'pair-video', 'aria-label': 'Video' });
    const label = h('input', { type: 'text', value: existing?.label ?? '', placeholder: 'e.g. Lion card', 'data-testid': 'pair-label', 'aria-label': 'Label' });
    const error = h('p', { class: 'scan-status error', hidden: true });
    replaceChildren(
      dialog.body,
      h('p', {}, 'Card ', h('strong', { class: 'mono', 'data-testid': 'pair-uid' }, formatUid(uid))),
      existing
        ? h(
            'p',
            { class: 'banner banner-warn' },
            `Already paired to "${findVideo(config, existing.fileName)?.title || existing.fileName}"${existing.label ? ` as “${existing.label}”` : ''}. Saving will reassign it.`,
          )
        : null,
      config.videos.length === 0
        ? h('p', { class: 'scan-status error' }, 'There are no videos yet. Import a video first.')
        : h('label', {}, 'Video ', select),
      h('label', {}, 'Label ', label),
      error,
    );
    dialog.setActions([
      { label: 'Cancel', value: null },
      {
        label: existing ? 'Reassign' : 'Save',
        value: uid,
        kind: 'primary',
        before: async () => {
          if (!select.value) {
            error.textContent = 'Choose a video.';
            error.hidden = false;
            return false;
          }
          return saveEdit(ctx, (c) => pairCard(c, { uid, fileName: select.value, label: label.value.trim() }));
        },
      },
    ]);
    label.focus();
  };

  await dialog.result;
}

async function addNewAdminCard(ctx: AppContext): Promise<void> {
  const dialog = openScanDialog<string>(ctx, {
    title: 'Add admin card',
    testId: 'admin-dialog',
    onScan: (uid, d) => {
      const config = ctx.config.get();
      const card = findCard(config, uid);
      if (card) {
        scanMessage(d, `${formatUid(uid)} is paired to video "${card.fileName}". Remove it from cards first, or scan another card.`, 'error');
        return false;
      }
      if (findAdminCard(config, uid)) {
        scanMessage(d, `${formatUid(uid)} is already an admin card. Scan another card.`, 'error');
        return false;
      }
      const label = h('input', { type: 'text', placeholder: 'e.g. Front desk admin', 'data-testid': 'admin-label', 'aria-label': 'Label' });
      replaceChildren(d.body, h('p', {}, 'Card ', h('strong', { class: 'mono', 'data-testid': 'admin-uid' }, formatUid(uid))), h('label', {}, 'Label ', label));
      d.setActions([
        { label: 'Cancel', value: null },
        { label: 'Save', value: uid, kind: 'primary', before: () => saveEdit(ctx, (c) => addAdminCard(c, { uid, label: label.value.trim() })) },
      ]);
      label.focus();
      return true;
    },
  });
  await dialog.result;
}

export function renderCards(ctx: AppContext): Section {
  const body = h('div');
  const render = () => {
    const config = ctx.config.get();
    replaceChildren(
      body,
      h('div', { class: 'toolbar' }, h('button', { type: 'button', class: 'primary', onclick: () => void pairNewCard(ctx) }, 'Pair new card')),
      config.cards.length === 0
        ? h('p', { class: 'hint' }, 'No cards paired yet.')
        : h(
            'table',
            { 'data-testid': 'cards-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'UID'), h('th', {}, 'Label'), h('th', {}, 'Video'), h('th'))),
            h(
              'tbody',
              {},
              ...config.cards.map((card) => {
                const select = videoSelect(ctx, card.fileName, { 'aria-label': `Video for ${card.uid}` });
                select.addEventListener('change', () => void saveEdit(ctx, (c) => setCardVideo(c, card.uid, select.value)));
                return h(
                  'tr',
                  { 'data-uid': card.uid },
                  h('td', { class: 'mono' }, formatUid(card.uid)),
                  h(
                    'td',
                    {},
                    h('input', {
                      type: 'text',
                      value: card.label,
                      'aria-label': `Label for ${card.uid}`,
                      onchange: (e: Event) => void saveEdit(ctx, (c) => setCardLabel(c, card.uid, (e.target as HTMLInputElement).value.trim())),
                    }),
                  ),
                  h('td', {}, select),
                  h(
                    'td',
                    {},
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'danger',
                        onclick: async () => {
                          const ok = await confirmDialog({ title: 'Remove card?', content: [`${formatUid(card.uid)} ${card.label}`], confirmLabel: 'Remove', danger: true });
                          if (ok) await saveEdit(ctx, (c) => removeCard(c, card.uid));
                        },
                      },
                      'Remove',
                    ),
                  ),
                );
              }),
            ),
          ),
    );
  };
  const el = h('section', { 'data-testid': 'cards-section' }, h('h2', {}, 'Cards'), body);
  return reactiveSection(el, render, [(l) => ctx.config.changed.subscribe(l)]);
}

export function renderAdminCards(ctx: AppContext): Section {
  const body = h('div');
  const render = () => {
    const config = ctx.config.get();
    replaceChildren(
      body,
      h('div', { class: 'toolbar' }, h('button', { type: 'button', onclick: () => void addNewAdminCard(ctx) }, 'Add admin card')),
      config.adminCards.length === 0
        ? h('p', { class: 'hint' }, 'No admin cards. Settings can still be opened with Ctrl+Alt+Shift+S.')
        : h(
            'ul',
            { 'data-testid': 'admin-list', class: 'admin-list' },
            ...config.adminCards.map((card) =>
              h(
                'li',
                { 'data-uid': card.uid },
                h('span', { class: 'mono' }, formatUid(card.uid)),
                ' ',
                h('input', {
                  type: 'text',
                  value: card.label,
                  'aria-label': `Label for ${card.uid}`,
                  onchange: (e: Event) => void saveEdit(ctx, (c) => setAdminCardLabel(c, card.uid, (e.target as HTMLInputElement).value.trim())),
                }),
                ' ',
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'danger',
                    onclick: async () => {
                      const ok = await confirmDialog({ title: 'Remove admin card?', content: [`${formatUid(card.uid)} ${card.label}`], confirmLabel: 'Remove', danger: true });
                      if (ok) await saveEdit(ctx, (c) => removeAdminCard(c, card.uid));
                    },
                  },
                  'Remove',
                ),
              ),
            ),
          ),
    );
  };
  const el = h('section', { 'data-testid': 'admin-section' }, h('h2', {}, 'Admin cards'), body);
  return reactiveSection(el, render, [(l) => ctx.config.changed.subscribe(l)]);
}
