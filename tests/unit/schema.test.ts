import { describe, expect, it } from 'vitest';
import { emptyConfig, fileNameError, migrate, validateConfig, type Config } from '../../src/config/schema';
import { parseConfigText, serializeForExport, summarizeConfig, fetchPublishedConfig } from '../../src/config/sync';

const valid = (): Config => ({
  schemaVersion: 1,
  updatedAt: '2026-10-11T15:00:00.000Z',
  loopVideo: 'attract-loop.mp4',
  videos: [
    { fileName: 'attract-loop.mp4', title: 'Loop', sizeBytes: 100 },
    { fileName: 'lion.mp4', title: 'Lion', sizeBytes: 1048576000 },
  ],
  cards: [{ uid: '04A23B1C5D8000', fileName: 'lion.mp4', label: 'Lion card' }],
  adminCards: [{ uid: '04FF001122AA80', label: 'Front desk admin' }],
});

const errorsOf = (json: unknown): string[] => {
  const r = validateConfig(json);
  return r.ok ? [] : r.error;
};

describe('validateConfig', () => {
  it('accepts a valid config and the shipped empty config', () => {
    expect(validateConfig(valid())).toEqual({ ok: true, value: valid() });
    expect(validateConfig(emptyConfig()).ok).toBe(true);
  });

  it('drops unknown fields', () => {
    const r = validateConfig({ ...valid(), extra: true, videos: [{ ...valid().videos[0], junk: 1 }, valid().videos[1]] });
    expect(r.ok && Object.keys(r.value)).not.toContain('extra');
    expect(r.ok && Object.keys(r.value.videos[0]!)).toEqual(['fileName', 'title', 'sizeBytes']);
  });

  it('rejects non-objects', () => {
    expect(errorsOf(null)).toEqual(['Config must be a JSON object.']);
    expect(errorsOf([])).toEqual(['Config must be a JSON object.']);
  });

  it('requires unique file names', () => {
    const c = valid();
    c.videos.push({ ...c.videos[1]! });
    expect(errorsOf(c).join()).toMatch(/lion\.mp4" is listed more than once/);
  });

  it('rejects unsafe file names', () => {
    for (const name of ['a/b.mp4', '..', '', 'x.mp4.partial', ' lead.mp4']) {
      const c = valid();
      c.videos[1]!.fileName = name;
      c.cards = [];
      expect(errorsOf(c).length, name).toBeGreaterThan(0);
    }
  });

  it('rejects bad sizes', () => {
    const c = valid();
    c.videos[0]!.sizeBytes = -1;
    expect(errorsOf(c).join()).toMatch(/sizeBytes must be a non-negative integer/);
  });

  it('requires canonical UIDs', () => {
    for (const uid of ['04a23b1c', '04 A2 3B 1C', '04A23B', 'ZZZZZZZZ']) {
      const c = valid();
      c.cards[0]!.uid = uid;
      expect(errorsOf(c).join(), uid).toMatch(/uppercase hex/);
    }
  });

  it('allows a UID in only one of cards or adminCards', () => {
    const c = valid();
    c.adminCards[0]!.uid = c.cards[0]!.uid;
    expect(errorsOf(c).join()).toMatch(/already used by cards\[0\]/);
    const d = valid();
    d.cards.push({ ...d.cards[0]! });
    expect(errorsOf(d).join()).toMatch(/already used/);
  });

  it('requires card and loop references to exist in videos', () => {
    const c = valid();
    c.cards[0]!.fileName = 'missing.mp4';
    c.loopVideo = 'gone.mp4';
    const errors = errorsOf(c);
    expect(errors.some((e) => e.includes('cards[0].fileName "missing.mp4"'))).toBe(true);
    expect(errors.some((e) => e.includes('"loopVideo" "gone.mp4"'))).toBe(true);
  });

  it('rejects an invalid updatedAt', () => {
    expect(errorsOf({ ...valid(), updatedAt: 'yesterday' }).join()).toMatch(/updatedAt/);
  });

  it('reports every problem at once', () => {
    expect(errorsOf({ schemaVersion: 1, videos: 'x', cards: {}, adminCards: null }).length).toBe(3);
  });
});

describe('migrate', () => {
  it('passes the current version through', () => {
    expect(migrate(valid())).toEqual({ ok: true, value: valid() });
  });

  it('refuses newer and missing versions', () => {
    expect(errorsOf({ ...valid(), schemaVersion: 2 }).join()).toMatch(/newer than this app supports/);
    expect(errorsOf({ ...valid(), schemaVersion: undefined }).join()).toMatch(/schemaVersion/);
  });
});

describe('fileNameError', () => {
  it('accepts ordinary names', () => {
    expect(fileNameError('Lion Roar (final).mp4')).toBeNull();
  });
});

describe('export round-trip', () => {
  it('serializes with a fresh updatedAt and parses back identically', () => {
    const now = new Date('2026-12-01T10:00:00.000Z');
    const text = serializeForExport(valid(), now);
    expect(text).toContain('\n  "schemaVersion": 1');
    const parsed = parseConfigText(text);
    expect(parsed).toEqual({ ok: true, value: { ...valid(), updatedAt: now.toISOString() } });
  });

  it('reports invalid JSON', () => {
    const r = parseConfigText('{ nope');
    expect(!r.ok && r.error[0]).toMatch(/Not valid JSON/);
  });
});

describe('fetchPublishedConfig', () => {
  it('fetches with no-store and validates', async () => {
    let init: RequestInit | undefined;
    const fake = (async (_url: string, i?: RequestInit) => {
      init = i;
      return new Response(JSON.stringify(valid()));
    }) as typeof fetch;
    const r = await fetchPublishedConfig(fake, '/x/config.json');
    expect(init?.cache).toBe('no-store');
    expect(r.ok).toBe(true);
  });

  it('reports HTTP errors and network failures without throwing', async () => {
    const notFound = (async () => new Response('', { status: 404, statusText: 'Not Found' })) as typeof fetch;
    expect(await fetchPublishedConfig(notFound, '/c.json')).toEqual({ ok: false, error: ['Could not download the published config: HTTP 404 Not Found'] });
    const broken = (async () => {
      throw new TypeError('Failed to fetch');
    }) as typeof fetch;
    const r = await fetchPublishedConfig(broken, '/c.json');
    expect(!r.ok && r.error[0]).toMatch(/Failed to fetch|offline/);
  });
});

describe('summarizeConfig', () => {
  it('lists videos missing locally', () => {
    expect(summarizeConfig(valid(), new Set(['lion.mp4']))).toMatchObject({ videos: 2, cards: 1, adminCards: 1, missingLocally: ['attract-loop.mp4'] });
  });
});
