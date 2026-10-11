import { describe, expect, it } from 'vitest';
import { addAdminCard, cardsForVideo, pairCard, removeVideo, upsertVideo } from '../../src/config/ops';
import { emptyConfig, validateConfig } from '../../src/config/schema';

describe('config ops', () => {
  const base = () => {
    let c = upsertVideo(emptyConfig(), 'loop.mp4', 10);
    c = upsertVideo(c, 'lion.mp4', 20);
    c = { ...c, loopVideo: 'lion.mp4' };
    c = pairCard(c, { uid: '04A23B1C', fileName: 'lion.mp4', label: 'Lion' });
    return pairCard(c, { uid: '04A23B1D', fileName: 'loop.mp4', label: 'Other' });
  };

  it('derives a title from the file name and updates size on re-import', () => {
    const c = upsertVideo(base(), 'lion.mp4', 99);
    expect(c.videos.find((v) => v.fileName === 'lion.mp4')).toEqual({ fileName: 'lion.mp4', title: 'lion', sizeBytes: 99 });
    expect(c.videos).toHaveLength(2);
  });

  it('removing a video unpairs its cards and clears the loop', () => {
    const c = removeVideo(base(), 'lion.mp4');
    expect(cardsForVideo(base(), 'lion.mp4').map((x) => x.uid)).toEqual(['04A23B1C']);
    expect(c.cards.map((x) => x.uid)).toEqual(['04A23B1D']);
    expect(c.loopVideo).toBeNull();
    expect(validateConfig(c).ok).toBe(true);
  });

  it('reassigning a card keeps one entry', () => {
    const c = pairCard(base(), { uid: '04A23B1C', fileName: 'loop.mp4', label: 'Moved' });
    expect(c.cards).toHaveLength(2);
    expect(c.cards[0]).toEqual({ uid: '04A23B1C', fileName: 'loop.mp4', label: 'Moved' });
  });

  it('adds admin cards without duplicates', () => {
    let c = addAdminCard(base(), { uid: 'AABBCCDD', label: 'A' });
    c = addAdminCard(c, { uid: 'AABBCCDD', label: 'B' });
    expect(c.adminCards).toEqual([{ uid: 'AABBCCDD', label: 'B' }]);
  });
});
