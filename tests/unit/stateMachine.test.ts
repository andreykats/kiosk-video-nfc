import { describe, expect, it } from 'vitest';
import { emptyConfig, type Config } from '../../src/config/schema';
import { initialKioskState, transition, type KioskContext } from '../../src/kiosk/stateMachine';

const config: Config = {
  ...emptyConfig(),
  loopVideo: 'loop.mp4',
  videos: [
    { fileName: 'loop.mp4', title: 'Loop', sizeBytes: 1 },
    { fileName: 'lion.mp4', title: 'Lion', sizeBytes: 1 },
    { fileName: 'tiger.mp4', title: 'Tiger', sizeBytes: 1 },
  ],
  cards: [
    { match: { kind: 'uid', value: '04A23B1C' }, fileName: 'lion.mp4', label: '' },
    { match: { kind: 'uid', value: '04A23B1D' }, fileName: 'tiger.mp4', label: '' },
  ],
  adminCards: [{ match: { kind: 'uid', value: 'ADADADAD' }, label: 'admin' }],
};
const ctx: KioskContext = { config, hasFile: (n) => n !== 'tiger.mp4', cardKey: 'uid', interruptible: false };
const playing = { kind: 'feature', fileName: 'lion.mp4' } as const;
const scan = (uid: string, ndefKey: string | null = null) => ({ type: 'scan', card: { uid, ndefKey } }) as const;

describe('kiosk state machine', () => {
  it('plays a paired card from the loop', () => {
    expect(transition(initialKioskState, scan('04A23B1C'), ctx)).toEqual({
      state: playing,
      effects: [{ type: 'playFeature', fileName: 'lion.mp4' }],
    });
  });

  it('returns to the loop when the feature ends or fails', () => {
    for (const type of ['featureEnded', 'featureFailed'] as const) {
      expect(transition(playing, { type }, ctx)).toEqual({ state: { kind: 'loop' }, effects: [{ type: 'resumeLoop' }] });
    }
  });

  it('ignores a stray ended event in the loop', () => {
    expect(transition(initialKioskState, { type: 'featureEnded' }, ctx).effects).toEqual([]);
  });

  it('ignores video-card scans while a feature plays', () => {
    expect(transition(playing, scan('04A23B1C'), ctx)).toEqual({ state: playing, effects: [] });
  });

  it('with interrupts on, a scan during a feature starts the scanned video at once', () => {
    const interrupting: KioskContext = {
      ...ctx,
      interruptible: true,
      config: {
        ...config,
        videos: [...config.videos, { fileName: 'bear.mp4', title: '', sizeBytes: 1 }],
        cards: [...config.cards, { match: { kind: 'uid', value: '04A23B1E' }, fileName: 'bear.mp4', label: '' }],
      },
    };
    const bear = transition(playing, scan('04A23B1E'), interrupting);
    expect(bear).toEqual({ state: { kind: 'feature', fileName: 'bear.mp4' }, effects: [{ type: 'playFeature', fileName: 'bear.mp4' }] });
    // The same tag starts its video over, as a new state.
    const again = transition(playing, scan('04A23B1C'), interrupting);
    expect(again.effects).toEqual([{ type: 'playFeature', fileName: 'lion.mp4' }]);
    expect(again.state).not.toBe(playing);
    // A tag whose video is missing, or an unknown tag, leaves the playing video alone.
    expect(transition(playing, scan('04A23B1D'), interrupting).state).toBe(playing);
    expect(transition(playing, scan('11111111'), interrupting)).toEqual({ state: playing, effects: [] });
  });

  it('opens settings for admin cards from both states', () => {
    for (const state of [initialKioskState, playing]) {
      expect(transition(state, scan('ADADADAD'), ctx).effects).toEqual([{ type: 'openSettings' }]);
    }
  });

  it('does nothing for unknown UIDs', () => {
    expect(transition(initialKioskState, scan('11111111'), ctx)).toEqual({ state: initialKioskState, effects: [] });
  });

  it('plays a card paired by card ID on a card-ID kiosk, and opens settings for an admin card ID', () => {
    const withIds: KioskContext = {
      ...ctx,
      cardKey: 'ndef',
      config: {
        ...config,
        cards: [...config.cards, { match: { kind: 'ndef', value: 'https://example.com/c/LION' }, fileName: 'lion.mp4', label: '' }],
        adminCards: [...config.adminCards, { match: { kind: 'ndef', value: 'STAFF' }, label: '' }],
      },
    };
    expect(transition(initialKioskState, scan('99999999', 'https://example.com/c/LION'), withIds).effects).toEqual([{ type: 'playFeature', fileName: 'lion.mp4' }]);
    expect(transition(playing, scan('99999999', 'STAFF'), withIds).effects).toEqual([{ type: 'openSettings' }]);
    // UID pairings don't play on a kiosk that identifies cards by card ID.
    expect(transition(initialKioskState, scan('04A23B1C', 'https://example.com/other'), withIds).effects).toEqual([]);
    // Nor card-ID pairings on a UID kiosk.
    expect(transition(initialKioskState, scan('99999999', 'https://example.com/c/LION'), { ...withIds, cardKey: 'uid' }).effects).toEqual([]);
  });

  it('warns but stays in the loop when the paired file is missing', () => {
    const r = transition(initialKioskState, scan('04A23B1D'), ctx);
    expect(r.state).toEqual(initialKioskState);
    expect(r.effects).toEqual([{ type: 'warn', message: expect.stringContaining('tiger.mp4') }]);
  });
});
