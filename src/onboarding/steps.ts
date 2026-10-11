/**
 * First-launch setup guide (pure logic). The guide shows one step at a time;
 * which step to resume at is derived from the kiosk's state plus a few saved
 * flags, so reloading (or Chrome opening the newly installed app in its own
 * window) picks up where the user left off.
 */

export type StepId = 'install' | 'reader' | 'config' | 'addVideos' | 'copyVideos' | 'pair' | 'done';

/** 'new' = config started from scratch here; 'existing' = imported or published. */
export type ConfigPath = 'new' | 'existing';

export function stepSequence(path: ConfigPath | null): StepId[] {
  const videos: StepId = path === 'existing' ? 'copyVideos' : 'addVideos';
  return ['install', 'reader', 'config', videos, 'pair', 'done'];
}

export interface ResumeInputs {
  installed: boolean;
  installSkipped: boolean;
  readerDone: boolean;
  path: ConfigPath | null;
  videoCount: number;
  missingCount: number;
}

/** The first step that still needs the user. Never 'done': that follows Finish. */
export function resumeStep(i: ResumeInputs): StepId {
  if (!i.installed && !i.installSkipped) return 'install';
  if (!i.readerDone) return 'reader';
  if (i.path === null) return 'config';
  if (i.path === 'new') return i.videoCount === 0 ? 'addVideos' : 'pair';
  return i.missingCount > 0 ? 'copyVideos' : 'pair';
}

export function nextStep(current: StepId, path: ConfigPath | null): StepId | null {
  const seq = stepSequence(path);
  return seq[seq.indexOf(current) + 1] ?? null;
}

export function previousStep(current: StepId, path: ConfigPath | null): StepId | null {
  const seq = stepSequence(path);
  const index = seq.indexOf(current);
  return index > 0 ? seq[index - 1]! : null;
}
