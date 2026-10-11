import { describe, expect, it } from 'vitest';
import { ProgressWatch, retryDelay } from '../../src/kiosk/watchdog';

describe('ProgressWatch', () => {
  it('reports progress while currentTime moves, including a loop wrapping to 0', () => {
    const watch = new ProgressWatch(10_000, 0);
    expect(watch.sample(0, 2_000)).toBe('waiting'); // first sample is only a baseline
    expect(watch.sample(2, 4_000)).toBe('progress');
    expect(watch.sample(4, 6_000)).toBe('progress');
    expect(watch.sample(0.1, 8_000)).toBe('progress');
  });

  it('is stalled once currentTime has not moved for the stall time', () => {
    const watch = new ProgressWatch(10_000, 0);
    watch.sample(3, 2_000);
    watch.sample(5, 4_000);
    expect(watch.sample(5, 8_000)).toBe('waiting');
    expect(watch.sample(5, 13_999)).toBe('waiting');
    expect(watch.sample(5, 14_000)).toBe('stalled');
  });

  it('counts a video that never starts as stalled', () => {
    const watch = new ProgressWatch(10_000, 0);
    expect(watch.sample(0, 2_000)).toBe('waiting');
    expect(watch.sample(0, 10_000)).toBe('stalled');
  });

  it('reset gives a new grace period and forgets the last position', () => {
    const watch = new ProgressWatch(10_000, 0);
    watch.sample(5, 2_000);
    watch.reset(20_000);
    expect(watch.sample(5, 22_000)).toBe('waiting');
    expect(watch.sample(5, 29_999)).toBe('waiting');
    expect(watch.sample(5, 30_000)).toBe('stalled');
  });
});

describe('retryDelay', () => {
  it('doubles from the base and caps at the maximum', () => {
    expect([1, 2, 3, 4].map((n) => retryDelay(n, 1_000, 300_000))).toEqual([1_000, 2_000, 4_000, 8_000]);
    expect(retryDelay(20, 1_000, 300_000)).toBe(300_000);
  });
});
