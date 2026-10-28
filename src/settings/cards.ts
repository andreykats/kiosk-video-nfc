import type { AppContext } from '../app/context';
import { SETTINGS_SHORTCUT_LABEL } from '../admin/access';
import { addAdminCard, cardsForVideo, checkPairing, findAdminCard, findCard, otherIdOf, pairCard, removeAdminCard, removeCard, scanMatches, setCardVideo } from '../config/ops';
import { matchId, type CardEntry, type CardMatch, type UidMatch } from '../config/schema';
import { formatMatch, matchKindLabel } from '../scan/uid';
import { confirmDialog, type DialogAction, type DialogHandle } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { identifierCells, matchAttrs, pairCountText, pairingError, reassignText } from './pairing';
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
    title: 'Pair new tag',
    testId: 'pair-dialog',
    onScan: (scan, d) => {
      const check = checkPairing(ctx.config.get(), scan, ctx.scanner.cardKey);
      if (check.kind !== 'ok') {
        scanMessage(d, pairingError(check), 'error');
        return false;
      }
      showDetails(check.match, check.existing, otherIdOf(scan, check.match));
      return true;
    },
  });

  const showDetails = (match: CardMatch, existing: CardEntry | undefined, otherId: CardMatch | undefined) => {
    const config = ctx.config.get();
    const select = videoSelect(ctx, existing?.fileName ?? null, { 'data-testid': 'pair-video', 'aria-label': 'Video' });
    const error = h('p', { class: 'scan-status error', hidden: true });
    replaceChildren(
      dialog.body,
      h('p', {}, `Tag ${matchKindLabel(match)} `, h('strong', { class: 'mono uid', 'data-testid': 'pair-uid' }, formatMatch(match))),
      existing
        ? h(
            'p',
            { class: 'banner banner-warn', 'data-testid': 'pair-existing' },
            match.kind === 'ndef'
              ? `Tags with this tag ID already play ${existing.fileName}. Saving will reassign all of them.`
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
          return saveEdit(ctx, (c) => pairCard(c, { match, fileName: select.value, label: '', ...(otherId && { otherId }) }));
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
 * card unless "Keep pairing" is ticked, and shows how many tags play the video.
 */
export async function quickPair(ctx: AppContext, fileName: string): Promise<void> {
  const keep = h('input', { type: 'checkbox', 'data-testid': 'keep-pairing' });
  const count = h('p', { class: 'hint', 'data-testid': 'quick-pair-count' });
  const showCount = () => {
    count.textContent = pairCountText(cardsForVideo(ctx.config.get(), fileName).length);
  };
  let paired = false;
  const idle = (): DialogAction<string>[] => [{ label: paired ? 'Done' : 'Cancel', value: null }];
  const save = async (d: DialogHandle<string>, match: CardMatch, otherId: CardMatch | undefined) => {
    d.setActions(idle());
    if (!(await saveEdit(ctx, (c) => pairCard(c, { match, fileName, label: '', ...(otherId && { otherId }) })))) {
      scanMessage(d, 'Could not save. Scan the tag again.', 'error');
      return;
    }
    paired = true;
    showCount();
    if (!keep.checked) return d.close(matchId(match));
    d.setActions(idle());
    scanMessage(d, `Paired ${formatMatch(match)} ✓ Scan another tag, or press Done.`, 'success');
  };
  const dialog = openScanDialog<string>(ctx, {
    title: `Pair a tag with ${fileName}`,
    testId: 'quick-pair-dialog',
    onScan: (scan, d) => {
      d.setActions(idle());
      const check = checkPairing(ctx.config.get(), scan, ctx.scanner.cardKey);
      if (check.kind !== 'ok') {
        scanMessage(d, pairingError(check), 'error');
      } else if (check.existing?.fileName === fileName) {
        scanMessage(d, `${formatMatch(check.match)} already plays this video. Scan another tag.`);
      } else if (check.existing) {
        const { match, existing } = check;
        const otherId = otherIdOf(scan, match);
        scanMessage(d, `${reassignText(match, existing.fileName)} Reassign it to this video?`);
        d.setActions([
          ...idle(),
          {
            label: 'Reassign',
            value: null,
            kind: 'primary',
            before: async () => {
              await save(d, match, otherId);
              return false; // save() closes the dialog unless Keep pairing is ticked
            },
          },
        ]);
      } else {
        void save(d, check.match, otherIdOf(scan, check.match));
      }
      return false; // closing the dialog stops listening
    },
  });
  showCount();
  dialog.body.append(count, h('label', { class: 'keep-pairing' }, keep, ' Keep pairing tags to this video'));
  dialog.setActions(idle());
  await dialog.result;
}

/**
 * Remove-tag flow: scan → confirm → unpair. Looks the tag up by every identifier
 * the scan carries, so a tag paired by the other kind (not recognised on this
 * kiosk) can be removed too. Admin tags are removed under Admin tags instead.
 */
async function removeTagByScan(ctx: AppContext): Promise<void> {
  const dialog = openScanDialog<string>(ctx, {
    title: 'Remove tag',
    testId: 'remove-tag-dialog',
    onScan: (scan, d) => {
      const config = ctx.config.get();
      d.setActions([{ label: 'Cancel', value: null }]);
      const admin = findAdminCard(config, scan.uid);
      if (admin) {
        scanMessage(d, `${formatMatch(admin.match)} is an admin tag. Remove it under Admin tags, or scan another tag.`, 'error');
        return false;
      }
      const card = scanMatches(scan)
        .map((m) => findCard(config, m))
        .find((c) => c !== undefined);
      if (!card) {
        scanMessage(d, 'This tag isn’t paired. Scan another tag.', 'error');
        return false;
      }
      const { match, fileName } = card;
      scanMessage(
        d,
        match.kind === 'ndef'
          ? `Tags with tag ID ${formatMatch(match)} play “${fileName}”. Removing it unpairs all of them.`
          : `${formatMatch(match)} plays “${fileName}”. Remove it?`,
      );
      d.setActions([
        { label: 'Cancel', value: null },
        { label: 'Remove', value: matchId(match), kind: 'danger', before: () => saveEdit(ctx, (c) => removeCard(c, match)) },
      ]);
      return false; // a different tag scanned before confirming replaces this one
    },
  });
  await dialog.result;
}

/**
 * Admin cards are always added by UID: they're individual staff cards, every
 * reader mode reads UIDs, and a card ID shared by many visitor cards must never
 * open settings.
 */
async function addNewAdminCard(ctx: AppContext): Promise<void> {
  const dialog = openScanDialog<string>(ctx, {
    title: 'Add admin tag',
    testId: 'admin-dialog',
    onScan: (scan, d) => {
      const config = ctx.config.get();
      const card = scanMatches(scan)
        .map((m) => findCard(config, m))
        .find((c) => c !== undefined);
      if (card) {
        scanMessage(d, `${formatMatch(card.match)} is paired to video "${card.fileName}". Remove it from tags first, or scan another tag.`, 'error');
        return false;
      }
      const match: UidMatch = { kind: 'uid', value: scan.uid };
      if (findAdminCard(config, scan.uid)) {
        scanMessage(d, `${formatMatch(match)} is already an admin tag. Scan another tag.`, 'error');
        return false;
      }
      const otherId = otherIdOf(scan, match);
      void saveEdit(ctx, (c) => addAdminCard(c, { match, label: '', ...(otherId && { otherId }) })).then((saved) => {
        if (saved) d.close(matchId(match));
        else scanMessage(d, 'Could not save. Scan the tag again.', 'error');
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
      h(
        'div',
        { class: 'toolbar' },
        h('button', { type: 'button', onclick: () => void pairNewCard(ctx) }, 'Pair new tag'),
        h('button', { type: 'button', 'data-testid': 'remove-tag', disabled: config.cards.length === 0, onclick: () => void removeTagByScan(ctx) }, 'Remove tag'),
      ),
      config.cards.length === 0
        ? h('p', { class: 'hint' }, 'No tags paired yet.')
        : h(
            'table',
            { 'data-testid': 'cards-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'UID'), h('th', {}, 'NDEF'), h('th', {}, 'Video file'), h('th'))),
            h(
              'tbody',
              {},
              ...config.cards.map((card) => {
                const select = videoSelect(ctx, card.fileName, { 'aria-label': `Video for ${card.match.value}` });
                select.addEventListener('change', () => void saveEdit(ctx, (c) => setCardVideo(c, card.match, select.value)));
                return h(
                  'tr',
                  matchAttrs(card.match),
                  ...identifierCells(
                    card,
                    card.match.kind === ctx.scanner.cardKey ? null : h('div', { class: 'status warn', 'data-testid': 'card-unused' }, 'Not recognised on this kiosk'),
                  ),
                  h('td', {}, select),
                  h(
                    'td',
                    { class: 'actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'danger',
                        onclick: async () => {
                          const ok = await confirmDialog({ title: 'Remove tag?', content: [`${formatMatch(card.match)} → ${card.fileName}`], confirmLabel: 'Remove', danger: true });
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
  const el = h('section', { 'data-testid': 'cards-section' }, h('h2', {}, 'Tags'), body);
  return reactiveSection(el, render, [(l) => ctx.config.changed.subscribe(l), (l) => ctx.scanner.cardKeyChanged.subscribe(l)]);
}

export function renderAdminCards(ctx: AppContext): Section {
  const body = h('div');
  const render = () => {
    const config = ctx.config.get();
    replaceChildren(
      body,
      h('div', { class: 'toolbar' }, h('button', { type: 'button', onclick: () => void addNewAdminCard(ctx) }, 'Add admin tag')),
      config.adminCards.length === 0
        ? h('p', { class: 'hint' }, `No admin tags. Settings can still be opened with ${SETTINGS_SHORTCUT_LABEL}.`)
        : h(
            'table',
            { 'data-testid': 'admin-list' },
            h('thead', {}, h('tr', {}, h('th', {}, 'UID'), h('th', {}, 'NDEF'), h('th'))),
            h(
              'tbody',
              {},
              ...config.adminCards.map((card) =>
                h(
                  'tr',
                  matchAttrs(card.match),
                  ...identifierCells(card),
                  h(
                    'td',
                    { class: 'actions' },
                    h(
                      'button',
                      {
                        type: 'button',
                        class: 'danger',
                        onclick: async () => {
                          const ok = await confirmDialog({ title: 'Remove admin tag?', content: [formatMatch(card.match)], confirmLabel: 'Remove', danger: true });
                          if (ok) await saveEdit(ctx, (c) => removeAdminCard(c, card.match.value));
                        },
                      },
                      'Remove',
                    ),
                  ),
                ),
              ),
            ),
          ),
    );
  };
  const el = h('section', { 'data-testid': 'admin-section' }, h('h2', {}, 'Admin tags'), body);
  return reactiveSection(el, render, [(l) => ctx.config.changed.subscribe(l)]);
}
