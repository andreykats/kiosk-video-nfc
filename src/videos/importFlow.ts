import type { AppContext } from '../app/context';
import { errorMessage, log } from '../app/log';
import { cardsForVideo, replaceVideo, upsertVideo } from '../config/ops';
import { confirmDialog, errorList, messageDialog } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { isVideoFile, planFileImport, planFolderImport, planReplace, totalBytes, type ImportItem, type ImportPlan } from './importPlan';
import { checkFreeSpace, formatBytes, requestPersistence } from './opfsStore';

/** Where an import runs: settings and the setup guide each provide one. */
export interface ImportHost {
  /** Container the progress bar is rendered into while copying. */
  progress: HTMLElement;
  /** Pauses the settings idle timeout; returns the release function. */
  hold?: () => () => void;
  onBusyChange?: (busy: boolean) => void;
  /** 'always' shows a summary dialog; 'problems' only on errors or cancel. */
  summary: 'always' | 'problems';
}

export interface ImportOutcome {
  imported: string[];
  failed: string[];
  cancelled: boolean;
}

function rejectedList(plan: ImportPlan): HTMLElement | null {
  return plan.rejected.length === 0
    ? null
    : h('div', {}, h('p', {}, 'Skipped:'), errorList(plan.rejected.map((r) => `${r.name}: ${r.reason}`)));
}

function overwritesList(plan: ImportPlan): HTMLElement | null {
  return plan.overwrites.length === 0
    ? null
    : h('div', {}, h('p', {}, 'These videos already exist on this kiosk and will be replaced:'), errorList(plan.overwrites));
}

/**
 * After the new file is copied: moves the old video's tags and loop to it, starts
 * its play count from 0, and deletes the old file. Returns a problem to report
 * if the old file couldn't be deleted (it is then listed as not in the config).
 */
async function applyReplacement(ctx: AppContext, item: ImportItem, oldName: string): Promise<string | null> {
  await ctx.config.update((c) => replaceVideo(c, oldName, item.fileName, item.file.size));
  ctx.playCounts.reset(oldName);
  ctx.playCounts.reset(item.fileName);
  if (item.fileName === oldName) return null;
  try {
    await ctx.videos.delete(oldName);
    return null;
  } catch (e) {
    log.error(`Deleting the replaced ${oldName} failed:`, e);
    return `${item.fileName} replaced ${oldName}, but the old file could not be deleted: ${errorMessage(e)}`;
  }
}

/** Copies items one by one with a progress bar. Returns null if refused up front. */
async function runImport(
  ctx: AppContext,
  host: ImportHost,
  items: ImportItem[],
  headline: (outcome: ImportOutcome) => string = (o) => `Imported ${o.imported.length} of ${items.length} video(s).`,
): Promise<ImportOutcome | null> {
  if (items.length === 0) return null;
  const spaceErr = await checkFreeSpace(totalBytes(items));
  if (spaceErr) {
    await messageDialog('Not enough storage', [spaceErr]);
    return null;
  }

  host.onBusyChange?.(true);
  const release = host.hold?.() ?? (() => undefined);
  const abort = new AbortController();
  const bar = h('progress', { max: 1, value: 0 });
  const label = h('span');
  const overall = h('span');
  replaceChildren(
    host.progress,
    h('div', {}, overall, ' ', label),
    bar,
    h('button', { type: 'button', onclick: () => abort.abort(new DOMException('Import cancelled', 'AbortError')) }, 'Cancel'),
  );
  host.progress.hidden = false;

  const outcome: ImportOutcome = { imported: [], failed: [], cancelled: false };
  try {
    for (const [index, item] of items.entries()) {
      if (abort.signal.aborted) break;
      overall.textContent = `Importing ${index + 1} of ${items.length}:`;
      label.textContent = item.fileName;
      let lastPaint = 0;
      try {
        await ctx.videos.importFile(item.file, item.fileName, {
          signal: abort.signal,
          onProgress: (written, total) => {
            const now = performance.now();
            if (now - lastPaint < 100 && written < total) return;
            lastPaint = now;
            bar.value = total === 0 ? 1 : written / total;
            label.textContent = `${item.fileName} — ${formatBytes(written)} of ${formatBytes(total)}`;
          },
        });
        if (item.replaces !== undefined) {
          const problem = await applyReplacement(ctx, item, item.replaces);
          if (problem) outcome.failed.push(problem);
        } else if (item.addToConfig) {
          await ctx.config.update((c) => upsertVideo(c, item.fileName, item.file.size));
        }
        outcome.imported.push(item.fileName);
      } catch (e) {
        if (abort.signal.aborted) break;
        log.error(`Import of ${item.fileName} failed:`, e);
        outcome.failed.push(errorMessage(e));
      }
    }
  } finally {
    outcome.cancelled = abort.signal.aborted;
    release();
    host.progress.hidden = true;
    replaceChildren(host.progress);
    host.onBusyChange?.(false);
  }
  await requestPersistence();
  void ctx.readiness.recompute();

  if (host.summary === 'always' || outcome.failed.length > 0 || outcome.cancelled) {
    const summary: (HTMLElement | string)[] = [headline(outcome)];
    if (outcome.cancelled) summary.push(h('p', {}, 'Import was cancelled.'));
    if (outcome.failed.length > 0) summary.push(errorList(outcome.failed));
    await messageDialog(outcome.failed.length > 0 ? 'Import finished with errors' : 'Import finished', summary);
  }
  return outcome;
}

/**
 * "Import files": every picked video is copied and added to the config.
 * `videosOnly` silently drops non-video files (for whole-folder picks).
 */
export async function importPickedFiles(
  ctx: AppContext,
  host: ImportHost,
  files: File[],
  options: { videosOnly?: boolean } = {},
): Promise<ImportOutcome | null> {
  const plan = planFileImport(ctx.videos.names(), options.videosOnly ? files.filter(isVideoFile) : files);
  if (plan.toImport.length === 0) {
    await messageDialog('Nothing to import', [rejectedList(plan) ?? 'No video files were picked.']);
    return null;
  }
  if (plan.overwrites.length > 0 || plan.rejected.length > 0) {
    const ok = await confirmDialog({
      title: 'Import videos',
      content: [overwritesList(plan) ?? '', rejectedList(plan) ?? ''],
      confirmLabel: `Import ${plan.toImport.length}`,
    });
    if (!ok) return null;
  }
  return runImport(ctx, host, plan.toImport);
}

/**
 * "Import folder": copies the config's videos that are missing on this kiosk or
 * differ in size from the local copy, and offers to add videos the config
 * doesn't list.
 */
export async function importPickedFolder(ctx: AppContext, host: ImportHost, files: File[]): Promise<ImportOutcome | null> {
  const plan = planFolderImport(ctx.config.get(), ctx.videos.files(), files);
  const items = [...plan.toImport];
  if (plan.unlisted.length > 0) {
    const addUnlisted = await confirmDialog({
      title: 'Add new videos?',
      content: [
        h('p', {}, `${plan.unlisted.length} video(s) in this folder are not in the config. Add them as new videos?`),
        errorList(plan.unlisted.map((f) => f.name)),
      ],
      confirmLabel: 'Add additional files',
      cancelLabel: 'Do not add',
    });
    if (addUnlisted) items.push(...plan.unlisted.map((file) => ({ file, fileName: file.name, addToConfig: true })));
  }
  if (items.length === 0) {
    await messageDialog('Nothing to import', [
      plan.alreadyPresent.length > 0
        ? `All ${plan.alreadyPresent.length} listed video(s) in this folder are already on this kiosk.`
        : 'No videos from the config were found in this folder.',
      rejectedList(plan) ?? '',
    ]);
    return null;
  }
  if (plan.overwrites.length > 0 || plan.rejected.length > 0) {
    const ok = await confirmDialog({
      title: 'Import folder',
      content: [overwritesList(plan) ?? '', rejectedList(plan) ?? ''],
      confirmLabel: `Import ${items.length}`,
    });
    if (!ok) return null;
  }
  return runImport(ctx, host, items);
}

/**
 * "Replace": copies one new file in place of config video `oldName`. Its tags
 * and loop status move to the new file; its play count starts again from 0.
 */
export async function importReplacement(ctx: AppContext, host: ImportHost, oldName: string, files: File[]): Promise<ImportOutcome | null> {
  if (files.length !== 1) {
    await messageDialog('Choose one file', [`Pick the single video file to replace ${oldName} with.`]);
    return null;
  }
  const config = ctx.config.get();
  const plan = planReplace(config, ctx.videos.names(), oldName, files[0]!);
  if ('error' in plan) {
    await messageDialog('Cannot replace', [plan.error]);
    return null;
  }
  const { item } = plan;
  const tags = cardsForVideo(config, oldName).length;
  const ok = await confirmDialog({
    title: item.fileName === oldName ? `Replace ${oldName}?` : `Replace ${oldName} with ${item.fileName}?`,
    content: [
      h('p', {}, tags > 0 ? `Its ${tags} tag(s) stay paired and will play the new file.` : 'No tags are paired with it.'),
      config.loopVideo === oldName ? h('p', {}, 'It stays the loop video.') : '',
      h('p', {}, 'Its play count goes back to 0.'),
      plan.overwritesUnlisted ? h('p', {}, `${item.fileName} is already on this kiosk (not in the config) and will be overwritten.`) : '',
    ],
    confirmLabel: 'Replace',
  });
  if (!ok) return null;
  return runImport(ctx, host, [item], (o) =>
    o.imported.length === 0
      ? `${oldName} was not replaced.`
      : item.fileName === oldName
        ? `Replaced ${oldName}.`
        : `Replaced ${oldName} with ${item.fileName}.`,
  );
}
