import { describe, expect, it } from 'vitest';
import { addAdminCard, cardMatch, cardsForVideo, checkPairing, findCard, otherIdOf, pairCard, removeCard, removeVideo, resolveScan, scanMatches, setCardVideo, unrecognisedCardCount, upsertVideo } from '../../src/config/ops';
import { emptyConfig, validateConfig } from '../../src/config/schema';

describe('config ops', () => {
  const base = () => {
    let c = upsertVideo(emptyConfig(), 'loop.mp4', 10);
    c = upsertVideo(c, 'lion.mp4', 20);
    c = { ...c, loopVideo: 'lion.mp4' };
    c = pairCard(c, { match: { kind: 'uid', value: '04A23B1C' }, fileName: 'lion.mp4', label: 'Lion' });
    return pairCard(c, { match: { kind: 'uid', value: '04A23B1D' }, fileName: 'loop.mp4', label: 'Other' });
  };

  it('derives a title from the file name and updates size on re-import', () => {
    const c = upsertVideo(base(), 'lion.mp4', 99);
    expect(c.videos.find((v) => v.fileName === 'lion.mp4')).toEqual({ fileName: 'lion.mp4', title: 'lion', sizeBytes: 99 });
    expect(c.videos).toHaveLength(2);
  });

  it('makes the first video added the loop, and leaves an existing loop alone', () => {
    const one = upsertVideo(emptyConfig(), 'a.mp4', 1);
    expect(one.loopVideo).toBe('a.mp4');
    expect(upsertVideo(one, 'b.mp4', 1).loopVideo).toBe('a.mp4');
  });

  it('removing a video unpairs its cards; removing the loop moves it to another video', () => {
    const c = removeVideo(base(), 'lion.mp4');
    expect(cardsForVideo(base(), 'lion.mp4').map((x) => x.match.value)).toEqual(['04A23B1C']);
    expect(c.cards.map((x) => x.match.value)).toEqual(['04A23B1D']);
    expect(c.loopVideo).toBe('loop.mp4');
    expect(validateConfig(c).ok).toBe(true);
  });

  it('prefers a video no card plays when moving the loop', () => {
    let c = upsertVideo(base(), 'free.mp4', 1);
    c = removeVideo(c, 'lion.mp4');
    expect(c.loopVideo).toBe('free.mp4');
  });

  it('only clears the loop when the last video is removed', () => {
    const c = removeVideo(upsertVideo(emptyConfig(), 'a.mp4', 1), 'a.mp4');
    expect(c.loopVideo).toBeNull();
  });

  it('reassigning a card keeps one entry', () => {
    const c = pairCard(base(), { match: { kind: 'uid', value: '04A23B1C' }, fileName: 'loop.mp4', label: 'Moved' });
    expect(c.cards).toHaveLength(2);
    expect(c.cards[0]).toEqual({ match: { kind: 'uid', value: '04A23B1C' }, fileName: 'loop.mp4', label: 'Moved' });
  });

  it('adds admin cards without duplicates', () => {
    let c = addAdminCard(base(), { match: { kind: 'uid', value: 'AABBCCDD' }, label: 'A' });
    c = addAdminCard(c, { match: { kind: 'uid', value: 'AABBCCDD' }, label: 'B' });
    expect(c.adminCards).toEqual([{ match: { kind: 'uid', value: 'AABBCCDD' }, label: 'B' }]);
  });
});

describe('matching scans to cards', () => {
  const ID = 'https://topps.drey.dev/c/BRONCOS-12';
  const config = () => {
    let c = upsertVideo(emptyConfig(), 'loop.mp4', 1);
    c = upsertVideo(c, 'lion.mp4', 1);
    c = upsertVideo(c, 'tiger.mp4', 1);
    c = pairCard(c, { match: { kind: 'uid', value: '04A23B1C' }, fileName: 'lion.mp4', label: '' });
    c = pairCard(c, { match: { kind: 'ndef', value: ID }, fileName: 'tiger.mp4', label: '' });
    return addAdminCard(c, { match: { kind: 'uid', value: 'ADADADAD' }, label: '' });
  };

  it('lists the card ID before the UID', () => {
    expect(scanMatches({ uid: '04A23B1C', ndefKey: ID })).toEqual([
      { kind: 'ndef', value: ID },
      { kind: 'uid', value: '04A23B1C' },
    ]);
    expect(scanMatches({ uid: '04A23B1C', ndefKey: null })).toEqual([{ kind: 'uid', value: '04A23B1C' }]);
  });

  it('identifies a card by the kiosk card key only', () => {
    expect(cardMatch({ uid: '04A23B1C', ndefKey: ID }, 'uid')).toEqual({ kind: 'uid', value: '04A23B1C' });
    expect(cardMatch({ uid: '04A23B1C', ndefKey: ID }, 'ndef')).toEqual({ kind: 'ndef', value: ID });
    expect(cardMatch({ uid: '04A23B1C', ndefKey: null }, 'ndef')).toBeNull();
  });

  it('plays video cards by the kiosk card key, never falling back to the other', () => {
    expect(resolveScan(config(), { uid: '04A23B1C', ndefKey: ID }, 'ndef')).toMatchObject({ kind: 'video', entry: { fileName: 'tiger.mp4' } });
    expect(resolveScan(config(), { uid: '04A23B1C', ndefKey: ID }, 'uid')).toMatchObject({ kind: 'video', entry: { fileName: 'lion.mp4' } });
    expect(resolveScan(config(), { uid: '04A23B1C', ndefKey: 'https://example.com/other' }, 'ndef')).toBeNull();
    expect(resolveScan(config(), { uid: '11111111', ndefKey: ID }, 'uid')).toBeNull();
    expect(resolveScan(config(), { uid: '04A23B1C', ndefKey: null }, 'ndef')).toBeNull();
  });

  it('matches admin cards by UID whatever the card key, and lets them win over video cards', () => {
    expect(resolveScan(config(), { uid: 'ADADADAD', ndefKey: ID }, 'ndef')).toMatchObject({ kind: 'admin' });
    expect(resolveScan(config(), { uid: 'ADADADAD', ndefKey: null }, 'uid')).toMatchObject({ kind: 'admin' });
  });

  it('checks a scan before pairing it', () => {
    expect(checkPairing(config(), { uid: 'ADADADAD', ndefKey: null }, 'uid')).toMatchObject({ kind: 'admin' });
    expect(checkPairing(config(), { uid: '22222222', ndefKey: null }, 'ndef')).toEqual({ kind: 'no-card-id' });
    expect(checkPairing(config(), { uid: '22222222', ndefKey: ID }, 'ndef')).toMatchObject({ kind: 'ok', match: { kind: 'ndef', value: ID }, existing: { fileName: 'tiger.mp4' } });
    expect(checkPairing(config(), { uid: '22222222', ndefKey: ID }, 'uid')).toEqual({ kind: 'ok', match: { kind: 'uid', value: '22222222' }, existing: undefined });
  });

  it('edits and removes cards by match', () => {
    let c = setCardVideo(config(), { kind: 'ndef', value: ID }, 'lion.mp4');
    expect(findCard(c, { kind: 'ndef', value: ID })?.fileName).toBe('lion.mp4');
    c = removeCard(c, { kind: 'ndef', value: ID });
    expect(findCard(c, { kind: 'ndef', value: ID })).toBeUndefined();
    expect(c.cards).toHaveLength(1);
    expect(validateConfig(c).ok).toBe(true);
  });

  it('counts cards a kiosk will not recognise', () => {
    const c = addAdminCard(config(), { match: { kind: 'ndef', value: 'STAFF' }, label: '' });
    expect(unrecognisedCardCount(c, 'uid', true)).toBe(1); // the card-ID video card
    expect(unrecognisedCardCount(c, 'ndef', true)).toBe(1); // the UID video card
    expect(unrecognisedCardCount(c, 'uid', false)).toBe(2); // plus the card-ID admin card, without the bridge
  });
});

describe('otherIdOf and pairCard', () => {
  const lion = { kind: 'uid', value: '04A23B1C' } as const;
  it('records the identifier the match doesn’t use, when the scan read it', () => {
    expect(otherIdOf({ uid: '04A23B1C', ndefKey: 'https://x/c/1' }, lion)).toEqual({ kind: 'ndef', value: 'https://x/c/1' });
    expect(otherIdOf({ uid: '04A23B1C', ndefKey: null }, lion)).toBeUndefined();
    expect(otherIdOf({ uid: '04A23B1C', ndefKey: 'x'.repeat(300) }, lion)).toBeUndefined();
    expect(otherIdOf({ uid: '04A23B1C', ndefKey: 'https://x/c/1' }, { kind: 'ndef', value: 'https://x/c/1' })).toEqual(lion);
  });

  it('keeps a recorded otherId when the tag is reassigned by a scan that didn’t read one', () => {
    let c = upsertVideo(upsertVideo(emptyConfig(), 'loop.mp4', 1), 'lion.mp4', 1);
    c = pairCard(c, { match: lion, fileName: 'lion.mp4', label: '', otherId: { kind: 'ndef', value: 'ID' } });
    c = pairCard(c, { match: lion, fileName: 'loop.mp4', label: '' });
    expect(findCard(c, lion)).toEqual({ match: lion, fileName: 'loop.mp4', label: '', otherId: { kind: 'ndef', value: 'ID' } });
    expect(validateConfig(c).ok).toBe(true);
  });
});
