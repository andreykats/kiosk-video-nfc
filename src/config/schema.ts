import { err, ok, type Result } from '../result';
import { isCanonicalUid, UID_HEX_LENGTHS } from '../scan/uid';

export const CURRENT_SCHEMA_VERSION = 1;

export interface VideoEntry {
  fileName: string;
  title: string;
  sizeBytes: number;
}

export interface CardEntry {
  uid: string;
  fileName: string;
  label: string;
}

export interface AdminCardEntry {
  uid: string;
  label: string;
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

/**
 * Upgrades older configs to the current schema. Each entry upgrades version N to
 * N + 1. There is only v1 today, so the table is empty.
 */
const MIGRATIONS: Record<number, (raw: Record<string, unknown>) => Record<string, unknown>> = {};

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

  const uids = new Map<string, string>(); // uid → where it was first seen
  const checkUid = (uid: unknown, at: string): uid is string => {
    if (typeof uid !== 'string' || !isCanonicalUid(uid)) {
      errors.push(
        `${at}.uid must be uppercase hex with no separators, ${UID_HEX_LENGTHS.join('/')} characters long (got ${JSON.stringify(uid)}).`,
      );
      return false;
    }
    const seen = uids.get(uid);
    if (seen) {
      errors.push(`${at}.uid ${uid} is already used by ${seen}.`);
      return false;
    }
    uids.set(uid, at);
    return true;
  };

  const cards: CardEntry[] = [];
  arrayField('cards').forEach((c, i) => {
    const at = `cards[${i}]`;
    if (!isObj(c)) return void errors.push(`${at} must be an object.`);
    const { uid, fileName, label } = c;
    if (!checkUid(uid, at)) return;
    if (typeof fileName !== 'string' || !fileNames.has(fileName)) {
      return void errors.push(`${at}.fileName ${JSON.stringify(fileName)} does not match any entry in "videos".`);
    }
    if (typeof label !== 'string') return void errors.push(`${at}.label must be a string.`);
    cards.push({ uid, fileName, label });
  });

  const adminCards: AdminCardEntry[] = [];
  arrayField('adminCards').forEach((c, i) => {
    const at = `adminCards[${i}]`;
    if (!isObj(c)) return void errors.push(`${at} must be an object.`);
    const { uid, label } = c;
    if (!checkUid(uid, at)) return;
    if (typeof label !== 'string') return void errors.push(`${at}.label must be a string.`);
    adminCards.push({ uid, label });
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
