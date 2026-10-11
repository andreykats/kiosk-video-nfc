import { describe, expect, it } from 'vitest';
import { computeChecklist } from '../../src/app/readiness';
import { emptyConfig, type Config } from '../../src/config/schema';
import { computeOfflineReadiness, type ReadinessInputs } from '../../src/pwa/offlineReady';

const config: Config = {
  ...emptyConfig(),
  loopVideo: 'loop.mp4',
  videos: [
    { fileName: 'loop.mp4', title: '', sizeBytes: 1 },
    { fileName: 'lion.mp4', title: '', sizeBytes: 1 },
    { fileName: 'tiger.mp4', title: '', sizeBytes: 1 },
  ],
  cards: [
    { uid: '04A23B1C', fileName: 'lion.mp4', label: '' },
    { uid: '04A23B1D', fileName: 'tiger.mp4', label: '' },
  ],
};

const inputs = (patch: Partial<ReadinessInputs> = {}): ReadinessInputs => ({
  appCached: { ok: true },
  config,
  presentFiles: new Set(['loop.mp4', 'lion.mp4', 'tiger.mp4']),
  persisted: true,
  ...patch,
});

const status = (r: ReturnType<typeof computeOfflineReadiness>, id: string) => r.conditions.find((c) => c.id === id);

describe('computeOfflineReadiness', () => {
  it('is ready when conditions 1–4 pass', () => {
    const r = computeOfflineReadiness(inputs());
    expect(r.ready).toBe(true);
    expect(r.conditions.map((c) => c.status)).toEqual(['pass', 'pass', 'pass', 'pass', 'pass']);
  });

  it('persisted storage is only a warning', () => {
    const r = computeOfflineReadiness(inputs({ persisted: false }));
    expect(r.ready).toBe(true);
    expect(status(r, 'persisted')?.status).toBe('warn');
  });

  it('fails when the app is not cached, with the reason', () => {
    const r = computeOfflineReadiness(inputs({ appCached: { ok: false, error: 'SW registration failed: boom' } }));
    expect(r.ready).toBe(false);
    expect(status(r, 'appCached')?.detail).toBe('SW registration failed: boom');
  });

  it('fails without a config', () => {
    const r = computeOfflineReadiness(inputs({ config: null }));
    expect(r.ready).toBe(false);
    expect(status(r, 'config')?.status).toBe('fail');
    expect(status(r, 'loopVideo')?.status).toBe('fail');
  });

  it('fails when the loop video is unset or missing', () => {
    expect(status(computeOfflineReadiness(inputs({ config: { ...config, loopVideo: null } })), 'loopVideo')?.status).toBe('fail');
    const r = computeOfflineReadiness(inputs({ presentFiles: new Set(['lion.mp4', 'tiger.mp4']) }));
    expect(status(r, 'loopVideo')?.detail).toMatch(/loop\.mp4 → Import folder/);
  });

  it('lists missing paired videos', () => {
    const r = computeOfflineReadiness(inputs({ presentFiles: new Set(['loop.mp4']) }));
    expect(r.ready).toBe(false);
    expect(status(r, 'pairedVideos')?.detail).toBe('Missing videos: lion.mp4, tiger.mp4 → Import folder');
  });
});

describe('computeChecklist', () => {
  it('marks each step from its inputs', () => {
    const readiness = computeOfflineReadiness(inputs());
    const items = computeChecklist({ install: 'unknown', applied: null, videoCount: 3, missingVideos: 1, persisted: false, readiness });
    expect(items.map((i) => [i.id, i.done])).toEqual([
      ['install', false],
      ['config', false],
      ['videos', false],
      ['persisted', false],
      ['offline', true],
    ]);
    const all = computeChecklist({
      install: 'installed',
      applied: { source: 'published', updatedAt: null, appliedAt: '2026-10-11T00:00:00Z' },
      videoCount: 3,
      missingVideos: 0,
      persisted: true,
      readiness,
    });
    expect(all.every((i) => i.done)).toBe(true);
  });
});
