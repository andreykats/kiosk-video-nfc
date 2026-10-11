import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { upsertVideo } from '../../src/config/ops';
import { ConfigStore } from '../../src/config/store';

describe('ConfigStore', () => {
  it('starts empty, persists edits, and reloads them', async () => {
    const factory = new IDBFactory();
    const store = await ConfigStore.open(factory);
    expect(store.status()).toEqual({ error: null, stored: false });
    await store.update((c) => upsertVideo(c, 'lion.mp4', 5));
    const reopened = await ConfigStore.open(factory);
    expect(reopened.get().videos).toEqual([{ fileName: 'lion.mp4', title: 'lion', sizeBytes: 5 }]);
    expect(reopened.status().stored).toBe(true);
  });

  it('rejects invalid edits and keeps the previous config', async () => {
    const store = await ConfigStore.open(new IDBFactory());
    await expect(store.update((c) => ({ ...c, loopVideo: 'nope.mp4' }))).rejects.toThrow(/Invalid config/);
    expect(store.get().loopVideo).toBeNull();
  });

  it('records where a replaced config came from', async () => {
    const factory = new IDBFactory();
    const store = await ConfigStore.open(factory);
    const applied = { source: 'file' as const, updatedAt: '2026-10-11T00:00:00.000Z', appliedAt: '2026-10-11T01:00:00.000Z' };
    await store.replace({ ...store.get(), updatedAt: applied.updatedAt }, applied);
    expect((await ConfigStore.open(factory)).lastApplied()).toEqual(applied);
  });
});
