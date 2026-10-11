import { describe, expect, it } from 'vitest';
import { emptyConfig, type Config } from '../../src/config/schema';
import { isVideoFile, planFileImport, planFolderImport } from '../../src/videos/importPlan';

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
    const plan = planFolderImport(config, new Set(['tiger.mp4']), [file('lion.mp4'), file('tiger.mp4'), file('zebra.mp4'), file('readme.txt', 'text/plain')]);
    expect(plan.toImport.map((i) => [i.fileName, i.addToConfig])).toEqual([['lion.mp4', false]]);
    expect(plan.alreadyPresent).toEqual(['tiger.mp4']);
    expect(plan.unlisted.map((f) => f.name)).toEqual(['zebra.mp4']);
    expect(plan.rejected).toEqual([]);
  });

  it('rejects names picked twice from subfolders', () => {
    const plan = planFolderImport(config, new Set(), [file('lion.mp4'), file('lion.mp4'), file('tiger.mp4')]);
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
