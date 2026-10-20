import type { PairingCheck } from '../config/ops';
import { matchId, type CardMatch } from '../config/schema';
import type { CardKey } from '../scan/readerMode';
import { formatMatch } from '../scan/uid';
import { h } from '../ui/dom';

/** The kiosk-wide card identifier, as offered in Settings → Card reader. */
export const CARD_KEY_LABELS: Record<CardKey, string> = {
  uid: 'UID',
  ndef: 'NDEF payload (tag ID)',
};

/** Why a scanned card can't be paired as a video card. */
export function pairingError(check: Exclude<PairingCheck, { kind: 'ok' }>): string {
  return check.kind === 'admin'
    ? `${formatMatch(check.entry.match)} is an admin tag. Scan a different tag.`
    : 'This tag has no NDEF payload (no URI or Text record), and this kiosk identifies tags by their NDEF payload. Scan a different tag.';
}

/** Shown before moving a card that already plays another video. */
export function reassignText(match: CardMatch, otherFile: string): string {
  return `${formatMatch(match)} plays “${otherFile}”.${match.kind === 'ndef' ? ' Reassigning moves every tag with this tag ID.' : ''}`;
}

/** How many pairings play a video. In NDEF mode, every tag with the same payload is one. */
export function pairCountText(count: number): string {
  return count === 0 ? 'No tags yet' : `${count} tag${count === 1 ? '' : 's'} paired`;
}

/** DOM attributes identifying a card in tables and chips (data-uid kept for UID cards). */
export function matchAttrs(match: CardMatch): Record<string, string> {
  return match.kind === 'uid' ? { 'data-match': matchId(match), 'data-uid': match.value } : { 'data-match': matchId(match) };
}

/**
 * UID and NDEF table cells for a paired tag: its match plus the otherId recorded
 * at pairing, a dash where it wasn't read. `note` goes under the identifier the
 * tag is paired by. UIDs stay on one line; long NDEF payloads (URLs) may wrap.
 */
export function identifierCells(entry: { match: CardMatch; otherId?: CardMatch }, note: Node | null = null): HTMLElement[] {
  const cell = (kind: CardMatch['kind']) => {
    const id = [entry.match, entry.otherId].find((m) => m?.kind === kind);
    return h(
      'td',
      // col-uid has a fixed width, so NDEF lines up across the Tags and Admin tags tables.
      { class: kind === 'uid' ? 'uid col-uid' : 'card-id', 'data-col': kind },
      id ? h('span', { class: 'mono' }, formatMatch(id)) : h('span', { class: 'hint' }, '—'),
      id === entry.match ? note : null,
    );
  };
  return [cell('uid'), cell('ndef')];
}
