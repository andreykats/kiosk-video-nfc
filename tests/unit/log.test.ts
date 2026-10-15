import { describe, expect, it } from 'vitest';
import { formatLog, LogBook, parseLog } from '../../src/app/log';

/** In-memory stand-in for localStorage. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

describe('LogBook', () => {
  it('keeps entries across instances (restarts) and clears them', () => {
    const storage = memoryStorage();
    let t = 1000;
    const book = new LogBook(storage, () => t++);
    let changes = 0;
    book.changed.subscribe(() => changes++);
    book.add('start', ['Kiosk started.']);
    book.add('error', ['Loop failed:', new Error('decode')]);
    expect(changes).toBe(2);

    const reloaded = new LogBook(storage);
    expect(reloaded.recent()).toEqual([
      { at: 1000, level: 'start', message: 'Kiosk started.' },
      { at: 1001, level: 'error', message: 'Loop failed: Error: decode' },
    ]);

    reloaded.clear();
    expect(reloaded.recent()).toEqual([]);
    expect(storage.length).toBe(0);
    expect(new LogBook(storage).recent()).toEqual([]);
  });

  it('keeps only the last 200 entries and shortens long messages', () => {
    const storage = memoryStorage();
    const book = new LogBook(storage);
    for (let i = 0; i < 205; i++) book.add('warn', [`entry ${i}`]);
    book.add('warn', ['x'.repeat(2000)]);
    const kept = new LogBook(storage).recent();
    expect(kept).toHaveLength(200);
    expect(kept[0]!.message).toBe('entry 6');
    expect(kept.at(-1)!.message).toHaveLength(500);
    expect(kept.at(-1)!.message.endsWith('…')).toBe(true);
  });

  it('works without storage, or when storage refuses to write', () => {
    const none = new LogBook(null);
    none.add('info', ['hello']);
    expect(none.recent()).toHaveLength(1);

    const full = { ...memoryStorage(), setItem: () => { throw new DOMException('full', 'QuotaExceededError'); } };
    const book = new LogBook(full);
    book.add('error', ['still logged']);
    expect(book.recent().map((e) => e.message)).toEqual(['still logged']);
  });
});

describe('parseLog', () => {
  it('keeps only well-formed entries', () => {
    const raw = JSON.stringify([
      { at: 1, level: 'warn', message: 'ok' },
      { at: 'soon', level: 'warn', message: 'bad time' },
      { at: 2, level: 'debug', message: 'bad level' },
      { at: 3, level: 'error', message: 7 },
      null,
      { at: 4, level: 'start', message: 'also ok', extra: true },
    ]);
    expect(parseLog(raw)).toEqual([
      { at: 1, level: 'warn', message: 'ok' },
      { at: 4, level: 'start', message: 'also ok' },
    ]);
  });

  it('ignores anything that is not a JSON array', () => {
    for (const raw of [null, 'not json', '{"a":1}', '5', 'null']) expect(parseLog(raw)).toEqual([]);
  });
});

describe('formatLog', () => {
  it('writes one line per entry with an ISO time and the level', () => {
    expect(
      formatLog([
        { at: Date.UTC(2026, 9, 15, 4, 5), level: 'start', message: 'Kiosk started.' },
        { at: Date.UTC(2026, 9, 15, 9, 0), level: 'error', message: 'Loop failed.' },
      ]),
    ).toBe('2026-10-15T04:05:00.000Z START Kiosk started.\n2026-10-15T09:00:00.000Z ERROR Loop failed.');
  });
});
