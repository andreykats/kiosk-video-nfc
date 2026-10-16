import { describe, expect, it } from 'vitest';
import { emptyConfig, type Config } from '../../src/config/schema';
import { isVideoFile, planFileImport, planFolderImport, planReplace } from '../../src/videos/importPlan';

const file = (name: string, type = 'video/mp4', size = 10) => new File([new Uint8Array(size)], name, { type });

const config: Config = {
  ...emptyConfig(),
  videos: [
    { fileName: 'lion.mp4', title: '', sizeBytes: 10 },
    { fileName: 'tiger.mp4', title: '', sizeBytes: 10 },
  ],
};

describe('isVideoFile', () => {
  it('uses MIME type or extension', () => {
    expect(isVideoFile(file('a.mp4', ''))).toBe(true);
    expect(isVideoFile(file('a.bin', 'video/webm'))).toBe(true);
    expect(isVideoFile(file('notes.txt', 'text/plain'))).toBe(false);
  });
});

describe('planFolderImport', () => {
  it('imports listed videos missing locally and separates unlisted ones', () => {
    const plan = planFolderImport(config, new Map([['tiger.mp4', 10]]), [file('lion.mp4'), file('tiger.mp4'), file('zebra.mp4'), file('readme.txt', 'text/plain')]);
    expect(plan.toImport.map((i) => [i.fileName, i.addToConfig])).toEqual([['lion.mp4', false]]);
    expect(plan.alreadyPresent).toEqual(['tiger.mp4']);
    expect(plan.unlisted.map((f) => f.name)).toEqual(['zebra.mp4']);
    expect(plan.rejected).toEqual([]);
  });

  it('overwrites a listed video whose local copy differs in size, and updates its config size', () => {
    const plan = planFolderImport(config, new Map([['lion.mp4', 10], ['tiger.mp4', 99]]), [file('lion.mp4'), file('tiger.mp4')]);
    expect(plan.alreadyPresent).toEqual(['lion.mp4']);
    expect(plan.toImport.map((i) => [i.fileName, i.addToConfig])).toEqual([['tiger.mp4', true]]);
    expect(plan.overwrites).toEqual(['tiger.mp4']);
  });

  it('rejects names picked twice from subfolders', () => {
    const plan = planFolderImport(config, new Map(), [file('lion.mp4'), file('lion.mp4'), file('tiger.mp4')]);
    expect(plan.toImport.map((i) => i.fileName)).toEqual(['tiger.mp4']);
    expect(plan.rejected).toHaveLength(1);
    expect(plan.rejected[0]!.name).toBe('lion.mp4');
  });
});

describe('planFileImport', () => {
  it('adds every video and flags overwrites', () => {
    const plan = planFileImport(new Set(['lion.mp4']), [file('lion.mp4'), file('new.mp4'), file('x.mp4.partial')]);
    expect(plan.toImport.map((i) => [i.fileName, i.addToConfig])).toEqual([
      ['lion.mp4', true],
      ['new.mp4', true],
    ]);
    expect(plan.overwrites).toEqual(['lion.mp4']);
    expect(plan.rejected.map((r) => r.name)).toEqual(['x.mp4.partial']);
  });
});

describe('planReplace', () => {
  const present = new Set(['lion.mp4', 'tiger.mp4', 'stray.mp4']);

  it('replaces with a new name, or the same name', () => {
    const renamed = planReplace(config, present, 'lion.mp4', file('lion_v2.mp4'));
    expect(renamed).toMatchObject({ item: { fileName: 'lion_v2.mp4', replaces: 'lion.mp4', addToConfig: false }, overwritesUnlisted: false });
    expect(planReplace(config, present, 'lion.mp4', file('lion.mp4'))).toMatchObject({ item: { fileName: 'lion.mp4', replaces: 'lion.mp4' }, overwritesUnlisted: false });
  });

  it('flags overwriting a local file the config does not list', () => {
    expect(planReplace(config, present, 'lion.mp4', file('stray.mp4'))).toMatchObject({ overwritesUnlisted: true });
  });

  it('rejects non-videos, bad names, other config videos and unknown originals', () => {
    expect(planReplace(config, present, 'lion.mp4', file('notes.txt', 'text/plain'))).toHaveProperty('error');
    expect(planReplace(config, present, 'lion.mp4', file('x.mp4.partial'))).toHaveProperty('error');
    expect(planReplace(config, present, 'lion.mp4', file('tiger.mp4'))).toEqual({ error: expect.stringContaining('already in the video list') });
    expect(planReplace(config, present, 'gone.mp4', file('new.mp4'))).toHaveProperty('error');
  });
});
