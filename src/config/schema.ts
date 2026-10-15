import { err, ok, type Result } from '../result';
import { isCanonicalUid, UID_HEX_LENGTHS } from '../scan/uid';

export const CURRENT_SCHEMA_VERSION = 2;

export interface VideoEntry {
  fileName: string;
  title: string;
  sizeBytes: number;
}

/**
 * What identifies a card: its UID, or the card ID stored in its NDEF data (the
 * first URI or Text record, read through the bridge app). Keyboard-mode readers
 * only ever see the UID.
 */
export interface CardMatch {
  kind: 'uid' | 'ndef';
  value: string;
}

export interface CardEntry {
  match: CardMatch;
  fileName: string;
  label: string;
}

export interface AdminCardEntry {
  match: CardMatch;
  label: string;
}

export const NDEF_KEY_MAX_LENGTH = 256;

/** Returns why `value` can't be an NDEF card ID, or null if it can. */
export function ndefKeyError(value: string): string | null {
  if (value === '') return 'is empty';
  if (value.length > NDEF_KEY_MAX_LENGTH) return `is longer than ${NDEF_KEY_MAX_LENGTH} characters`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return 'contains control characters';
  return null;
}

export interface Config {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  /** Set on export; null for a config that has never been exported. */
  updatedAt: string | null;
  loopVideo: string | null;
  videos: VideoEntry[];
  cards: CardEntry[];
  adminCards: AdminCardEntry[];
}

export function emptyConfig(): Config {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    updatedAt: null,
    loopVideo: null,
    videos: [],
    cards: [],
    adminCards: [],
  };
}

/** One string per match, for maps and equality ("uid:04A2…", "ndef:https://…"). */
export function matchId(match: CardMatch): string {
  return `${match.kind}:${match.value}`;
}

export function sameMatch(a: CardMatch, b: CardMatch): boolean {
  return a.kind === b.kind && a.value === b.value;
}

/** For messages: "UID 04A23B1C" or "card ID "https://…"". */
export function describeMatch(match: CardMatch): string {
  return match.kind === 'uid' ? `UID ${match.value}` : `tag ID ${JSON.stringify(match.value)}`;
}

const PARTIAL_SUFFIX = '.partial';

/**
 * fileName is a video's identity across kiosks and the name of its OPFS file, so it
 * must be a plain file name that OPFS accepts and that can't collide with our
 * in-progress `.partial` files. Returns an error message, or null if valid.
 */
export function fileNameError(name: string): string | null {
  if (name.trim() === '') return 'file name is empty';
  if (name !== name.trim()) return `"${name}" has leading or trailing spaces`;
  if (name.length > 255) return `"${name.slice(0, 40)}…" is longer than 255 characters`;
  if (name === '.' || name === '..') return `"${name}" is not a valid file name`;
  if (/[\\/]/.test(name)) return `"${name}" must not contain "/" or "\\"`;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(name)) return `"${name}" contains control characters`;
  if (name.toLowerCase().endsWith(PARTIAL_SUFFIX)) return `"${name}" must not end in "${PARTIAL_SUFFIX}"`;
  return null;
}

/** v1 identified every card by `uid`; v2 wraps it in `match`. Malformed entries pass through for validation to report. */
function migrateV1Card(card: unknown): unknown {
  if (typeof card !== 'object' || card === null || Array.isArray(card) || !('uid' in card)) return card;
  const { uid, ...rest } = card as Record<string, unknown>;
  return { match: { kind: 'uid', value: uid }, ...rest };
}

/** Upgrades older configs to the current schema. Each entry upgrades version N to N + 1. */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {
  1: (raw) => ({
    ...raw,
    cards: Array.isArray(raw.cards) ? raw.cards.map(migrateV1Card) : raw.cards,
    adminCards: Array.isArray(raw.adminCards) ? raw.adminCards.map(migrateV1Card) : raw.adminCards,
  }),
};

export function migrate(raw: unknown): Result<Record<string, unknown>, string[]> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err(['Config must be a JSON object.']);
  }
  let current = raw as Record<string, unknown>;
  const version = current.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    return err(['"schemaVersion" must be a positive integer.']);
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    return err([
      `Config schemaVersion ${version} is newer than this app supports (${CURRENT_SCHEMA_VERSION}). Reload to update the app.`,
    ]);
  }
  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    const step = MIGRATIONS[v];
    if (!step) return err([`No migration from schemaVersion ${v} to ${v + 1}.`]);
    current = { ...step(current), schemaVersion: v + 1 };
  }
  return ok(current);
}

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates (after migrating) untrusted JSON into a Config. Collects every problem
 * rather than stopping at the first, so admins can fix a config in one pass. The
 * returned config is rebuilt from known fields only.
 */
export function validateConfig(json: unknown): Result<Config, string[]> {
  const migrated = migrate(json);
  if (!migrated.ok) return migrated;
  const raw = migrated.value;
  const errors: string[] = [];

  let updatedAt: string | null = null;
  if (raw.updatedAt !== null && raw.updatedAt !== undefined) {
    if (typeof raw.updatedAt !== 'string' || Number.isNaN(Date.parse(raw.updatedAt))) {
      errors.push('"updatedAt" must be an ISO date string or null.');
    } else {
      updatedAt = raw.updatedAt;
    }
  }

  const arrayField = (key: string): unknown[] => {
    const value = raw[key];
    if (!Array.isArray(value)) {
      errors.push(`"${key}" must be an array.`);
      return [];
    }
    return value;
  };

  const videos: VideoEntry[] = [];
  const fileNames = new Set<string>();
  arrayField('videos').forEach((v, i) => {
    const at = `videos[${i}]`;
    if (!isObj(v)) return void errors.push(`${at} must be an object.`);
    const { fileName, title, sizeBytes } = v;
    if (typeof fileName !== 'string') return void errors.push(`${at}.fileName must be a string.`);
    const nameErr = fileNameError(fileName);
    if (nameErr) return void errors.push(`${at}.fileName: ${nameErr}.`);
    if (fileNames.has(fileName)) return void errors.push(`${at}.fileName "${fileName}" is listed more than once.`);
    if (typeof title !== 'string') return void errors.push(`${at}.title must be a string.`);
    if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
      return void errors.push(`${at}.sizeBytes must be a non-negative integer.`);
    }
    fileNames.add(fileName);
    videos.push({ fileName, title, sizeBytes });
  });

  const matches = new Map<string, string>(); // matchId → where it was first seen
  const checkMatch = (match: unknown, at: string): match is CardMatch => {
    if (!isObj(match)) {
      errors.push(`${at}.match must be an object with "kind" and "value".`);
      return false;
    }
    const { kind, value } = match;
    if (kind === 'uid') {
      if (typeof value !== 'string' || !isCanonicalUid(value)) {
        errors.push(
          `${at}.match.value must be a UID: uppercase hex with no separators, ${UID_HEX_LENGTHS.join('/')} characters long (got ${JSON.stringify(value)}).`,
        );
        return false;
      }
    } else if (kind === 'ndef') {
      const problem = typeof value === 'string' ? ndefKeyError(value) : 'must be a string';
      if (problem) {
        errors.push(`${at}.match.value (tag ID) ${problem}.`);
        return false;
      }
    } else {
      errors.push(`${at}.match.kind must be "uid" or "ndef" (got ${JSON.stringify(kind)}).`);
      return false;
    }
    const id = matchId({ kind, value: value as string });
    const seen = matches.get(id);
    if (seen) {
      errors.push(`${at}: ${describeMatch({ kind, value: value as string })} is already used by ${seen}.`);
      return false;
    }
    matches.set(id, at);
    return true;
  };

  const cards: CardEntry[] = [];
  arrayField('cards').forEach((c, i) => {
    const at = `cards[${i}]`;
    if (!isObj(c)) return void errors.push(`${at} must be an object.`);
    const { match, fileName, label } = c;
    if (!checkMatch(match, at)) return;
    if (typeof fileName !== 'string' || !fileNames.has(fileName)) {
      return void errors.push(`${at}.fileName ${JSON.stringify(fileName)} does not match any entry in "videos".`);
    }
    if (typeof label !== 'string') return void errors.push(`${at}.label must be a string.`);
    cards.push({ match: { kind: match.kind, value: match.value }, fileName, label });
  });

  const adminCards: AdminCardEntry[] = [];
  arrayField('adminCards').forEach((c, i) => {
    const at = `adminCards[${i}]`;
    if (!isObj(c)) return void errors.push(`${at} must be an object.`);
    const { match, label } = c;
    if (!checkMatch(match, at)) return;
    if (typeof label !== 'string') return void errors.push(`${at}.label must be a string.`);
    adminCards.push({ match: { kind: match.kind, value: match.value }, label });
  });

  let loopVideo: string | null = null;
  if (raw.loopVideo !== null && raw.loopVideo !== undefined) {
    if (typeof raw.loopVideo !== 'string' || !fileNames.has(raw.loopVideo)) {
      errors.push(`"loopVideo" ${JSON.stringify(raw.loopVideo)} does not match any entry in "videos".`);
    } else {
      loopVideo = raw.loopVideo;
    }
  }

  if (errors.length > 0) return err(errors);
  return ok({ schemaVersion: CURRENT_SCHEMA_VERSION, updatedAt, loopVideo, videos, cards, adminCards });
}
