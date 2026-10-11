import type { AppContext } from '../app/context';
import { errorMessage, log } from '../app/log';
import { upsertVideo } from '../config/ops';
import { confirmDialog, errorList, messageDialog } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { isVideoFile, planFileImport, planFolderImport, totalBytes, type ImportItem, type ImportPlan } from './importPlan';
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

/** Copies items one by one with a progress bar. Returns null if refused up front. */
async function runImport(ctx: AppContext, host: ImportHost, items: ImportItem[]): Promise<ImportOutcome | null> {
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
        if (item.addToConfig) await ctx.config.update((c) => upsertVideo(c, item.fileName, item.file.size));
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
    const summary: (HTMLElement | string)[] = [`Imported ${outcome.imported.length} of ${items.length} video(s).`];
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
      content: [
        plan.overwrites.length > 0
          ? h('div', {}, h('p', {}, 'These videos already exist on this kiosk and will be replaced:'), errorList(plan.overwrites))
          : '',
        rejectedList(plan) ?? '',
      ],
      confirmLabel: `Import ${plan.toImport.length}`,
    });
    if (!ok) return null;
  }
  return runImport(ctx, host, plan.toImport);
}

/**
 * "Import folder": copies the config's videos that are missing on this kiosk,
 * and offers to add videos the config doesn't list.
 */
export async function importPickedFolder(ctx: AppContext, host: ImportHost, files: File[]): Promise<ImportOutcome | null> {
  const plan = planFolderImport(ctx.config.get(), ctx.videos.names(), files);
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
  if (plan.rejected.length > 0) {
    const ok = await confirmDialog({ title: 'Import folder', content: [rejectedList(plan)!], confirmLabel: `Import ${items.length}` });
    if (!ok) return null;
  }
  return runImport(ctx, host, items);
}
