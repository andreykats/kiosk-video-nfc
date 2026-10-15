import type { AppContext } from '../app/context';
import { SETTINGS_SHORTCUT_LABEL } from '../admin/access';
import { addAdminCard, checkPairing, findAdminCard, findCard, pairCard, removeAdminCard, removeCard, scanMatches, setCardVideo } from '../config/ops';
import { matchId, type CardEntry, type CardMatch } from '../config/schema';
import { formatMatch, matchKindLabel } from '../scan/uid';
import { confirmDialog, type DialogAction, type DialogHandle } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { CARD_KEY_LABELS, matchAttrs, pairingError, reassignText } from './pairing';
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

/**
 * Pair-new-card flow: scan → (reassign?) → pick video → save. The card is
 * identified by the kiosk's card key (Settings → Card reader); staff aren't asked.
 */
async function pairNewCard(ctx: AppContext): Promise<void> {
  const dialog = openScanDialog<string>(ctx, {
    title: 'Pair new card',
    testId: 'pair-dialog',
    onScan: (scan, d) => {
      const check = checkPairing(ctx.config.get(), scan, ctx.scanner.cardKey);
      if (check.kind !== 'ok') {
        scanMessage(d, pairingError(check), 'error');
        return false;
      }
      showDetails(check.match, check.existing);
      return true;
    },
  });

  const showDetails = (match: CardMatch, existing: CardEntry | undefined) => {
    const config = ctx.config.get();
    const select = videoSelect(ctx, existing?.fileName ?? null, { 'data-testid': 'pair-video', 'aria-label': 'Video' });
    const error = h('p', { class: 'scan-status error', hidden: true });
    replaceChildren(
      dialog.body,
      h('p', {}, `Card ${matchKindLabel(match)} `, h('strong', { class: 'mono uid', 'data-testid': 'pair-uid' }, formatMatch(match))),
      existing
        ? h(
            'p',
            { class: 'banner banner-warn', 'data-testid': 'pair-existing' },
            match.kind === 'ndef'
              ? `Cards with this card ID already play ${existing.fileName}. Saving will reassign all of them.`
              : `Already paired to ${existing.fileName}. Saving will reassign it.`,
          )
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
 * Pairs scanned cards with one video (Settings → Videos → Pair, and the setup
 * guide). Each card is paired as soon as it's scanned; staff are asked only
 * before moving a card that plays another video. The dialog closes after one
 * card unless "Keep pairing" is ticked.
 */
export async function quickPair(ctx: AppContext, fileName: string): Promise<void> {
  const keep = h('input', { type: 'checkbox', 'data-testid': 'keep-pairing' });
  let paired = false;
  const idle = (): DialogAction<string>[] => [{ label: paired ? 'Done' : 'Cancel', value: null }];
  const save = async (d: DialogHandle<string>, match: CardMatch) => {
    d.setActions(idle());
    if (!(await saveEdit(ctx, (c) => pairCard(c, { match, fileName, label: '' })))) {
      scanMessage(d, 'Could not save. Scan the card again.', 'error');
      return;
    }
    paired = true;
    if (!keep.checked) return d.close(matchId(match));
    d.setActions(idle());
    scanMessage(d, `Paired ${formatMatch(match)} ✓ Scan another card, or press Done.`, 'success');
  };
  const dialog = openScanDialog<string>(ctx, {
    title: `Pair a card with ${fileName}`,
    testId: 'quick-pair-dialog',
    onScan: (scan, d) => {
      d.setActions(idle());
      const check = checkPairing(ctx.config.get(), scan, ctx.scanner.cardKey);
      if (check.kind !== 'ok') {
        scanMessage(d, pairingError(check), 'error');
      } else if (check.existing?.fileName === fileName) {
        scanMessage(d, `${formatMatch(check.match)} already plays this video. Scan another card.`);
      } else if (check.existing) {
        const { match, existing } = check;
        scanMessage(d, `${reassignText(match, existing.fileName)} Reassign it to this video?`);
        d.setActions([
          ...idle(),
          {
            label: 'Reassign',
            value: null,
            kind: 'primary',
            before: async () => {
              await save(d, match);
              return false; // save() closes the dialog unless Keep pairing is ticked
            },
          },
        ]);
      } else {
        void save(d, check.match);
      }
      return false; // closing the dialog stops listening
    },
  });
  dialog.body.append(h('label', { class: 'keep-pairing' }, keep, ' Keep pairing cards to this video'));
  dialog.setActions(idle());
  await dialog.result;
}

/**
 * Admin cards are always added by UID: they're individual staff cards, every
 * reader mode reads UIDs, and a card ID shared by many visitor cards must never
 * open settings.
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
      const match: CardMatch = { kind: 'uid', value: scan.uid };
      if (findAdminCard(config, match)) {
        scanMessage(d, `${formatMatch(match)} is already an admin card. Scan another card.`, 'error');
        return false;
      }
      void saveEdit(ctx, (c) => addAdminCard(c, { match, label: '' })).then((saved) => {
        if (saved) d.close(matchId(match));
        else scanMessage(d, 'Could not save. Scan the card again.', 'error');
      });
      return false; // closing the dialog stops listening
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
      h('p', { class: 'hint', 'data-testid': 'card-key-hint' }, `This kiosk identifies cards by ${CARD_KEY_LABELS[ctx.scanner.cardKey]}. Change it under Card reader.`),
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
                  h(
                    'td',
                    { class: card.match.kind === 'uid' ? 'uid' : 'card-id' },
                    h('span', { class: 'hint' }, `${matchKindLabel(card.match)} `),
                    h('span', { class: 'mono' }, formatMatch(card.match)),
                    card.match.kind === ctx.scanner.cardKey ? null : h('div', { class: 'status warn', 'data-testid': 'card-unused' }, 'Not recognised on this kiosk'),
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
  return reactiveSection(el, render, [(l) => ctx.config.changed.subscribe(l), (l) => ctx.scanner.cardKeyChanged.subscribe(l)]);
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
