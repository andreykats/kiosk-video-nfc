import { findVideo } from '../config/ops';
import { fileNameError, type Config } from '../config/schema';

export interface ImportItem {
  file: File;
  fileName: string;
  /** Add (or update the size of) the config entry once copied. */
  addToConfig: boolean;
}

export interface ImportPlan {
  toImport: ImportItem[];
  /** Folder import: video files not listed in the config (user decides). */
  unlisted: File[];
  /** Folder import: listed videos already on this kiosk (skipped). */
  alreadyPresent: string[];
  /** Files-mode import: names that will replace an existing local file. */
  overwrites: string[];
  rejected: { name: string; reason: string }[];
}

const VIDEO_EXTENSIONS = /\.(mp4|m4v|webm|mov|mkv|ogv)$/i;

export function isVideoFile(file: Pick<File, 'name' | 'type'>): boolean {
  return file.type.startsWith('video/') || VIDEO_EXTENSIONS.test(file.name);
}

/** Splits out invalid names and names picked more than once (nested folders). */
function screen(files: readonly File[]): { valid: File[]; rejected: ImportPlan['rejected'] } {
  const rejected: ImportPlan['rejected'] = [];
  const counts = new Map<string, number>();
  for (const f of files) counts.set(f.name, (counts.get(f.name) ?? 0) + 1);
  const valid: File[] = [];
  const reportedDuplicates = new Set<string>();
  for (const f of files) {
    const nameErr = fileNameError(f.name);
    if (nameErr) {
      rejected.push({ name: f.name, reason: nameErr });
    } else if ((counts.get(f.name) ?? 0) > 1) {
      if (!reportedDuplicates.has(f.name)) {
        reportedDuplicates.add(f.name);
        rejected.push({ name: f.name, reason: 'more than one file with this name was picked (check subfolders)' });
      }
    } else {
      valid.push(f);
    }
  }
  return { valid, rejected };
}

/** "Import files": every picked video is copied and added to the config. */
export function planFileImport(present: ReadonlySet<string>, files: readonly File[]): ImportPlan {
  const { valid, rejected } = screen(files);
  const toImport: ImportItem[] = [];
  for (const file of valid) {
    if (!isVideoFile(file)) rejected.push({ name: file.name, reason: 'not a video file' });
    else toImport.push({ file, fileName: file.name, addToConfig: true });
  }
  return {
    toImport,
    unlisted: [],
    alreadyPresent: [],
    overwrites: toImport.filter((i) => present.has(i.fileName)).map((i) => i.fileName),
    rejected,
  };
}

/**
 * "Import folder": copies listed videos missing on this kiosk; unlisted videos
 * are returned separately so the user can choose to add them.
 */
export function planFolderImport(config: Config, present: ReadonlySet<string>, files: readonly File[]): ImportPlan {
  const { valid, rejected } = screen(files.filter(isVideoFile));
  const plan: ImportPlan = { toImport: [], unlisted: [], alreadyPresent: [], overwrites: [], rejected };
  for (const file of valid) {
    if (!findVideo(config, file.name)) plan.unlisted.push(file);
    else if (present.has(file.name)) plan.alreadyPresent.push(file.name);
    else plan.toImport.push({ file, fileName: file.name, addToConfig: false });
  }
  return plan;
}

export function totalBytes(items: readonly ImportItem[]): number {
  return items.reduce((sum, i) => sum + i.file.size, 0);
}
