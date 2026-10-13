import { scanMatches } from '../config/ops';
import { matchId, type CardMatch } from '../config/schema';
import type { ScanEvent } from '../scan/scanEvent';
import { formatMatch } from '../scan/uid';
import { h } from '../ui/dom';

/**
 * Lets staff choose how a scanned card is recognised when it carries a card ID
 * as well as a UID. Returns null when the scan only has a UID (keyboard mode, or
 * a card with no URI/Text record): there's nothing to choose.
 */
export function matchChooser(
  scan: ScanEvent,
  selected: CardMatch['kind'],
  onChange: (kind: CardMatch['kind']) => void,
): HTMLElement | null {
  if (scan.ndefKey === null) return null;
  const option = (match: CardMatch, label: string, hint: string) =>
    h(
      'label',
      { class: 'match-option' },
      h('input', {
        type: 'radio',
        name: 'match-kind',
        value: match.kind,
        checked: match.kind === selected,
        'data-testid': `match-${match.kind}`,
        onchange: () => onChange(match.kind),
      }),
      ' ',
      label,
      ' ',
      h('strong', { class: 'mono' }, formatMatch(match)),
      h('span', { class: 'hint' }, ` — ${hint}`),
    );
  const [ndef, uid] = scanMatches(scan) as [CardMatch, CardMatch];
  return h(
    'fieldset',
    { class: 'match-chooser', 'data-testid': 'match-chooser' },
    h('legend', {}, 'Recognise this card by'),
    option(ndef, 'Card ID', 'every card written with this ID does the same; needs the bridge app'),
    option(uid, 'UID', 'only this physical card; works with the bridge and in keyboard mode'),
  );
}

/** DOM attributes identifying a card in tables and chips (data-uid kept for UID cards). */
export function matchAttrs(match: CardMatch): Record<string, string> {
  return match.kind === 'uid' ? { 'data-match': matchId(match), 'data-uid': match.value } : { 'data-match': matchId(match) };
}

/** The match for the chosen kind. */
export function chosenMatch(scan: ScanEvent, kind: CardMatch['kind']): CardMatch {
  return kind === 'ndef' && scan.ndefKey !== null ? { kind: 'ndef', value: scan.ndefKey } : { kind: 'uid', value: scan.uid };
}
