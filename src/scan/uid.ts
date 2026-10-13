import type { CardMatch } from '../config/schema';

/** Hex lengths of 4-, 7-, 8- and 10-byte card UIDs. */
export const UID_HEX_LENGTHS: readonly number[] = [8, 14, 16, 20];

const UID_RE = /^[0-9A-F]+$/;

/** A canonical UID is uppercase hex with no separators and a known length. */
export function isCanonicalUid(value: string): boolean {
  return UID_RE.test(value) && UID_HEX_LENGTHS.includes(value.length);
}

/** "04A23B1C5D8000" → "04 A2 3B 1C 5D 80 00" for display. */
export function formatUid(uid: string): string {
  return uid.replace(/(..)(?=.)/g, '$1 ');
}

/** "04 A2 3B 1C" for a UID, the card ID itself for an NDEF match. */
export function formatMatch(match: CardMatch): string {
  return match.kind === 'uid' ? formatUid(match.value) : match.value;
}

/** Short label for the match kind, as shown in tables. */
export function matchKindLabel(match: CardMatch): string {
  return match.kind === 'uid' ? 'UID' : 'Card ID';
}
