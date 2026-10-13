import type { AppContext } from '../app/context';
import { SETTINGS_SHORTCUT_LABEL } from '../admin/access';
import { addAdminCard, findAdminCard, findCard, pairCard, removeAdminCard, removeCard, scanMatches, setCardVideo } from '../config/ops';
import { matchId, type CardMatch } from '../config/schema';
import type { ScanEvent } from '../scan/scanEvent';
import { formatMatch, matchKindLabel } from '../scan/uid';
import { confirmDialog } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { chosenMatch, matchAttrs, matchChooser } from './matchChooser';
import { openScanDialog, scanMessage } from './scanModal';
import { reactiveSection, type Section } from './section';
import { saveEdit } from '../app/edits';

function videoSelect(ctx: AppContext, selected: string | null, attrs: Record<string, string> = {}): HTMLSelectElement {
  const config = ctx.config.get();
  const select = h('select', attrs);
  if (selected === null) select.append(h('option', { value: '', disabled: true, selected: true }, 'Choose a video…'));
  for (const v of config.videos) {
    select.append(h('option', { value: v.fileName, selected: v.fileName === selected }, v.fileName));
  }
  return select;
}

/** The admin card a scan would open settings with, if any. */
function adminFor(ctx: AppContext, scan: ScanEvent) {
  const config = ctx.config.get();
  return scanMatches(scan)
    .map((m) => findAdminCard(config, m))
    .find((a) => a !== undefined);
}

/** Pair-new-card flow: scan → choose card ID or UID → (reassign?) → pick video → save. */
async function pairNewCard(ctx: AppContext): Promise<void> {
  const dialog = openScanDialog<string>(ctx, {
    title: 'Pair new card',
    testId: 'pair-dialog',
    onScan: (scan, d) => {
      const admin = adminFor(ctx, scan);
      if (admin) {
        scanMessage(d, `${formatMatch(admin.match)} is an admin card. Remove it from admin cards first, or scan another card.`, 'error');
        return false;
      }
      // A card ID makes cards interchangeable, which is the point of writing one.
      kind = scan.ndefKey === null ? 'uid' : 'ndef';
      showDetails(scan);
      return true;
    },
  });
  let kind: CardMatch['kind'] = 'uid';
  let chosenFile: string | null = null;

  const showDetails = (scan: ScanEvent) => {
    const config = ctx.config.get();
    const match = chosenMatch(scan, kind);
    const existing = findCard(config, match);
    const other = scanMatches(scan)
      .filter((m) => m.kind !== match.kind)
      .map((m) => findCard(config, m))
      .find((c) => c !== undefined);
    const select = videoSelect(ctx, chosenFile ?? existing?.fileName ?? null, { 'data-testid': 'pair-video', 'aria-label': 'Video' });
    select.addEventListener('change', () => (chosenFile = select.value));
    const error = h('p', { class: 'scan-status error', hidden: true });
    replaceChildren(
      dialog.body,
      h('p', {}, `Card ${matchKindLabel(match)} `, h('strong', { class: 'mono uid', 'data-testid': 'pair-uid' }, formatMatch(match))),
      matchChooser(scan, kind, (k) => {
        kind = k;
        showDetails(scan);
      }),
      existing
        ? h(
            'p',
            { class: 'banner banner-warn', 'data-testid': 'pair-existing' },
            match.kind === 'ndef'
              ? `Cards with this card ID already play ${existing.fileName}. Saving will reassign all of them.`
              : `Already paired to ${existing.fileName}. Saving will reassign it.`,
          )
        : null,
      other
        ? h('p', { class: 'hint' }, `This card is also paired by ${matchKindLabel(other.match)} to ${other.fileName}.${match.kind === 'ndef' ? ' The card ID takes priority.' : ' Its card ID takes priority, so remove that pairing if this card should play the video chosen here.'}`)
        : null,
      config.videos.length === 0
        ? h('p', { class: 'scan-status error' }, 'There are no videos yet. Import a video first.')
        : h('label', {}, 'Video ', select),
      error,
    );
    dialog.setActions([
      { label: 'Cancel', value: null },
      {
        label: existing ? 'Reassign' : 'Save',
        value: matchId(match),
        kind: 'primary',
        before: async () => {
          if (!select.value) {
            error.textContent = 'Choose a video.';
            error.hidden = false;
            return false;
          }
          return saveEdit(ctx, (c) => pairCard(c, { match, fileName: select.value, label: '' }));
        },
      },
    ]);
    select.focus();
  };

  await dialog.result;
}

/**
 * Admin cards default to the UID: they're individual staff cards, and a card ID
 * shared by many visitor cards must never open settings.
 */
async function addNewAdminCard(ctx: AppContext): Promise<void> {
  const dialog = openScanDialog<string>(ctx, {
    title: 'Add admin card',
    testId: 'admin-dialog',
    onScan: (scan, d) => {
      const config = ctx.config.get();
      const card = scanMatches(scan)
        .map((m) => findCard(config, m))
        .find((c) => c !== undefined);
      if (card) {
        scanMessage(d, `${formatMatch(card.match)} is paired to video "${card.fileName}". Remove it from cards first, or scan another card.`, 'error');
        return false;
      }
      if (scan.ndefKey === null) {
        save(d, { kind: 'uid', value: scan.uid });
        return true;
      }
      showChoice(scan);
      return true;
    },
  });
  let kind: CardMatch['kind'] = 'uid';

  const save = (d: typeof dialog, match: CardMatch) => {
    if (findAdminCard(ctx.config.get(), match)) {
      scanMessage(d, `${formatMatch(match)} is already an admin card. Scan another card.`, 'error');
      return;
    }
    void saveEdit(ctx, (c) => addAdminCard(c, { match, label: '' })).then((saved) => {
      if (saved) d.close(matchId(match));
      else scanMessage(d, 'Could not save. Scan the card again.', 'error');
    });
  };

  const showChoice = (scan: ScanEvent) => {
    const status = h('p', { class: 'scan-status', 'data-testid': 'scan-status' });
    replaceChildren(
      dialog.body,
      matchChooser(scan, kind, (k) => (kind = k)),
      status,
    );
    dialog.setActions([
      { label: 'Cancel', value: null },
      {
        label: 'Add',
        value: null,
        kind: 'primary',
        before: async () => {
          save(dialog, chosenMatch(scan, kind));
          return false; // save() closes the dialog once stored
        },
      },
    ]);
  };

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
            h('thead', {}, h('tr', {}, h('th', {}, 'Card'), h('th', {}, 'Video'), h('th'))),
            h(
              'tbody',
              {},
              ...config.cards.map((card) => {
                const select = videoSelect(ctx, card.fileName, { 'aria-label': `Video for ${card.match.value}` });
                select.addEventListener('change', () => void saveEdit(ctx, (c) => setCardVideo(c, card.match, select.value)));
                return h(
                  'tr',
                  matchAttrs(card.match),
                  // UIDs stay on one line; long card IDs (URLs) may wrap.
                  h('td', { class: card.match.kind === 'uid' ? 'uid' : 'card-id' }, h('span', { class: 'hint' }, `${matchKindLabel(card.match)} `), h('span', { class: 'mono' }, formatMatch(card.match))),
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
                          const ok = await confirmDialog({ title: 'Remove card?', content: [`${formatMatch(card.match)} → ${card.fileName}`], confirmLabel: 'Remove', danger: true });
                          if (ok) await saveEdit(ctx, (c) => removeCard(c, card.match));
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
        ? h('p', { class: 'hint' }, `No admin cards. Settings can still be opened with ${SETTINGS_SHORTCUT_LABEL}.`)
        : h(
            'ul',
            { 'data-testid': 'admin-list', class: 'admin-list' },
            ...config.adminCards.map((card) =>
              h(
                'li',
                matchAttrs(card.match),
                card.match.kind === 'ndef' ? h('span', { class: 'hint' }, 'Card ID ') : null,
                h('span', { class: 'mono uid' }, formatMatch(card.match)),
                ' ',
                h(
                  'button',
                  {
                    type: 'button',
                    class: 'danger',
                    onclick: async () => {
                      const ok = await confirmDialog({ title: 'Remove admin card?', content: [formatMatch(card.match)], confirmLabel: 'Remove', danger: true });
                      if (ok) await saveEdit(ctx, (c) => removeAdminCard(c, card.match));
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
