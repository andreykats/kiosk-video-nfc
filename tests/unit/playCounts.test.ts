import { describe, expect, it } from 'vitest';
import { parse, PlayCounts } from '../../src/videos/playCounts';

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

describe('PlayCounts', () => {
  it('counts plays per video, keeps them across instances, and clears them', () => {
    const storage = memoryStorage();
    const counts = new PlayCounts(storage);
    let changes = 0;
    counts.changed.subscribe(() => changes++);
    expect(counts.get('lion.mp4')).toBe(0);
    counts.increment('lion.mp4');
    counts.increment('lion.mp4');
    counts.increment('tiger.mp4');
    expect(changes).toBe(3);

    const reloaded = new PlayCounts(storage);
    expect(reloaded.get('lion.mp4')).toBe(2);
    expect(reloaded.get('tiger.mp4')).toBe(1);

    reloaded.clear();
    expect(reloaded.get('lion.mp4')).toBe(0);
    expect(new PlayCounts(storage).get('lion.mp4')).toBe(0);
  });

  it('works without storage', () => {
    const counts = new PlayCounts(null);
    counts.increment('lion.mp4');
    expect(counts.get('lion.mp4')).toBe(1);
  });
});

describe('parse', () => {
  it('keeps only whole, non-negative counts', () => {
    expect(parse('{"a.mp4":3,"b.mp4":-1,"c.mp4":1.5,"d.mp4":"4","e.mp4":0}')).toEqual(new Map([['a.mp4', 3], ['e.mp4', 0]]));
  });

  it('ignores anything that is not a JSON object', () => {
    for (const raw of [null, 'not json', '[1,2]', '5', 'null']) expect(parse(raw).size).toBe(0);
  });
});
