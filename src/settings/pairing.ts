import type { PairingCheck } from '../config/ops';
import { matchId, type CardMatch } from '../config/schema';
import type { CardKey } from '../scan/readerMode';
import { formatMatch } from '../scan/uid';

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

/** DOM attributes identifying a card in tables and chips (data-uid kept for UID cards). */
export function matchAttrs(match: CardMatch): Record<string, string> {
  return match.kind === 'uid' ? { 'data-match': matchId(match), 'data-uid': match.value } : { 'data-match': matchId(match) };
}
