import { describe, expect, it } from 'vitest';
import { useAsLoopInstead } from '../../src/config/ops';
import { emptyConfig } from '../../src/config/schema';
import { nextStep, previousStep, resumeStep, stepSequence, type ResumeInputs } from '../../src/onboarding/steps';

const fresh: ResumeInputs = { installed: false, installSkipped: false, readerDone: false, path: null, videoCount: 0, missingCount: 0 };

describe('setup guide steps', () => {
  it('orders steps by config path', () => {
    expect(stepSequence('new')).toEqual(['install', 'reader', 'config', 'addVideos', 'pair', 'done']);
    expect(stepSequence('existing')).toEqual(['install', 'reader', 'config', 'copyVideos', 'pair', 'done']);
  });

  it('starts at install on a fresh kiosk', () => {
    expect(resumeStep(fresh)).toBe('install');
  });

  it('skips install once installed or skipped', () => {
    expect(resumeStep({ ...fresh, installed: true })).toBe('reader');
    expect(resumeStep({ ...fresh, installSkipped: true })).toBe('reader');
  });

  it('resumes at config, then at videos for the chosen path', () => {
    const base = { ...fresh, installed: true, readerDone: true };
    expect(resumeStep(base)).toBe('config');
    expect(resumeStep({ ...base, path: 'new' })).toBe('addVideos');
    expect(resumeStep({ ...base, path: 'new', videoCount: 2 })).toBe('pair');
    expect(resumeStep({ ...base, path: 'existing', videoCount: 3, missingCount: 1 })).toBe('copyVideos');
    expect(resumeStep({ ...base, path: 'existing', videoCount: 3, missingCount: 0 })).toBe('pair');
  });

  it('moves forward and back along the current path', () => {
    expect(nextStep('config', 'new')).toBe('addVideos');
    expect(nextStep('config', 'existing')).toBe('copyVideos');
    expect(nextStep('pair', 'new')).toBe('done');
    expect(nextStep('done', 'new')).toBeNull();
    expect(previousStep('pair', 'existing')).toBe('copyVideos');
    expect(previousStep('install', null)).toBeNull();
  });
});

describe('useAsLoopInstead', () => {
  it('sets the loop and unpairs that video’s cards only', () => {
    const config = {
      ...emptyConfig(),
      videos: [
        { fileName: 'a.mp4', title: 'A', sizeBytes: 1 },
        { fileName: 'b.mp4', title: 'B', sizeBytes: 1 },
      ],
      cards: [
        { uid: '04A23B1C', fileName: 'a.mp4', label: '' },
        { uid: '04A23B1D', fileName: 'b.mp4', label: '' },
      ],
    };
    const next = useAsLoopInstead(config, 'a.mp4');
    expect(next.loopVideo).toBe('a.mp4');
    expect(next.cards.map((c) => c.uid)).toEqual(['04A23B1D']);
  });
});
