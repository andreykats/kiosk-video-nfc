import type { AppContext } from '../app/context';
import { errorMessage, log } from '../app/log';
import { cardsForVideo, removeVideo, setLoopVideo, setVideoTitle, upsertVideo } from '../config/ops';
import { formatUid } from '../scan/uid';
import { confirmDialog, errorList, messageDialog } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { planFileImport, planFolderImport, totalBytes, type ImportItem, type ImportPlan } from '../videos/importPlan';
import { checkFreeSpace, formatBytes, requestPersistence } from '../videos/opfsStore';
import { reactiveSection, type Section } from './section';
import type { SettingsEnv } from './settingsView';

function filePicker(options: { folder: boolean; testId: string; onPick: (files: File[]) => void }): HTMLInputElement {
  const input = h('input', {
    type: 'file',
    hidden: true,
    multiple: true,
    accept: options.folder ? null : 'video/*',
    'data-testid': options.testId,
  });
  if (options.folder) input.webkitdirectory = true;
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])];
    input.value = '';
    if (files.length > 0) options.onPick(files);
  });
  return input;
}

/** Saves a config edit, reporting failures instead of leaving a half-applied UI. */
export async function saveEdit(ctx: AppContext, edit: Parameters<AppContext['config']['update']>[0]): Promise<boolean> {
  try {
    await ctx.config.update(edit);
    return true;
  } catch (e) {
    log.error('Saving config failed:', e);
    await messageDialog('Could not save', [errorMessage(e)]);
    return false;
  }
}

export function renderVideos(ctx: AppContext, env: SettingsEnv): Section {
  const progress = h('div', { class: 'import-progress', 'data-testid': 'import-progress', hidden: true });
  const body = h('div');
  let busy = false;

  const runImport = async (items: ImportItem[]) => {
    if (items.length === 0) return;
    const spaceErr = await checkFreeSpace(totalBytes(items));
    if (spaceErr) return messageDialog('Not enough storage', [spaceErr]);

    busy = true;
    render();
    const release = env.idle.hold();
    const abort = new AbortController();
    const bar = h('progress', { max: 1, value: 0 });
    const label = h('span');
    const overall = h('span');
    replaceChildren(
      progress,
      h('div', {}, overall, ' ', label),
      bar,
      h('button', { type: 'button', onclick: () => abort.abort(new DOMException('Import cancelled', 'AbortError')) }, 'Cancel'),
    );
    progress.hidden = false;

    const done: string[] = [];
    const failed: string[] = [];
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
          done.push(item.fileName);
        } catch (e) {
          if (abort.signal.aborted) break;
          log.error(`Import of ${item.fileName} failed:`, e);
          failed.push(errorMessage(e));
        }
      }
    } finally {
      release();
      busy = false;
      progress.hidden = true;
      render();
    }
    await requestPersistence();
    void ctx.readiness.recompute();
    const summary: (HTMLElement | string)[] = [`Imported ${done.length} of ${items.length} video(s).`];
    if (abort.signal.aborted) summary.push(h('p', {}, 'Import was cancelled.'));
    if (failed.length > 0) summary.push(errorList(failed));
    await messageDialog(failed.length > 0 ? 'Import finished with errors' : 'Import finished', summary);
  };

  const reportRejected = (plan: ImportPlan): HTMLElement | null =>
    plan.rejected.length === 0
      ? null
      : h('div', {}, h('p', {}, 'Skipped:'), errorList(plan.rejected.map((r) => `${r.name}: ${r.reason}`)));

  const importFiles = async (files: File[]) => {
    const plan = planFileImport(ctx.videos.names(), files);
    if (plan.toImport.length === 0) {
      return messageDialog('Nothing to import', [reportRejected(plan) ?? 'No video files were picked.']);
    }
    if (plan.overwrites.length > 0 || plan.rejected.length > 0) {
      const ok = await confirmDialog({
        title: 'Import videos',
        content: [
          plan.overwrites.length > 0
            ? h('div', {}, h('p', {}, 'These videos already exist on this kiosk and will be replaced:'), errorList(plan.overwrites))
            : '',
          reportRejected(plan) ?? '',
        ],
        confirmLabel: `Import ${plan.toImport.length}`,
      });
      if (!ok) return;
    }
    await runImport(plan.toImport);
  };

  const importFolder = async (files: File[]) => {
    const plan = planFolderImport(ctx.config.get(), ctx.videos.names(), files);
    const items = [...plan.toImport];
    if (plan.unlisted.length > 0) {
      const addUnlisted = await confirmDialog({
        title: 'Add new videos?',
        content: [
          h('p', {}, `${plan.unlisted.length} video(s) in this folder are not in the config. Add them as new videos?`),
          errorList(plan.unlisted.map((f) => f.name)),
        ],
        confirmLabel: 'Add them too',
      });
      if (addUnlisted) items.push(...plan.unlisted.map((file) => ({ file, fileName: file.name, addToConfig: true })));
    }
    if (items.length === 0) {
      return messageDialog('Nothing to import', [
        plan.alreadyPresent.length > 0
          ? `All ${plan.alreadyPresent.length} listed video(s) in this folder are already on this kiosk.`
          : 'No videos from the config were found in this folder.',
        reportRejected(plan) ?? '',
      ]);
    }
    if (plan.rejected.length > 0) {
      const ok = await confirmDialog({ title: 'Import folder', content: [reportRejected(plan)!], confirmLabel: `Import ${items.length}` });
      if (!ok) return;
    }
    await runImport(items);
  };

  const deleteVideo = async (fileName: string) => {
    const cards = cardsForVideo(ctx.config.get(), fileName);
    const isLoop = ctx.config.get().loopVideo === fileName;
    const ok = await confirmDialog({
      title: `Delete ${fileName}?`,
      content: [
        h('p', {}, 'The file is removed from this kiosk and the video is removed from the config.'),
        cards.length > 0
          ? h('div', {}, h('p', {}, 'These cards will be unpaired:'), errorList(cards.map((c) => `${formatUid(c.uid)} ${c.label}`)))
          : '',
        isLoop ? h('p', {}, 'This is the loop video; no loop video will be selected.') : '',
      ],
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await ctx.videos.delete(fileName);
    } catch (e) {
      return messageDialog('Could not delete', [errorMessage(e)]);
    }
    await saveEdit(ctx, (c) => removeVideo(c, fileName));
  };

  const deleteOrphan = async (fileName: string) => {
    const ok = await confirmDialog({ title: `Delete ${fileName}?`, content: ['This file is not in the config.'], confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    await ctx.videos.delete(fileName).catch((e) => messageDialog('Could not delete', [errorMessage(e)]));
  };

  const filesInput = filePicker({ folder: false, testId: 'import-files-input', onPick: (f) => void importFiles(f) });
  const folderInput = filePicker({ folder: true, testId: 'import-folder-input', onPick: (f) => void importFolder(f) });

  function render() {
    const config = ctx.config.get();
    const local = ctx.videos.files();
    const orphans = [...local.keys()].filter((n) => !config.videos.some((v) => v.fileName === n)).sort();

    const rows = config.videos.map((v) => {
      const size = local.get(v.fileName);
      const status =
        size === undefined
          ? h('span', { class: 'status bad' }, 'missing')
          : size !== v.sizeBytes
            ? h('span', { class: 'status warn', title: `Config says ${formatBytes(v.sizeBytes)}` }, 'size mismatch')
            : h('span', { class: 'status good' }, 'present');
      return h(
        'tr',
        { 'data-file': v.fileName },
        h(
          'td',
          {},
          h('input', {
            type: 'radio',
            name: 'loopVideo',
            'aria-label': `Use ${v.fileName} as loop video`,
            checked: config.loopVideo === v.fileName,
            onchange: () => void saveEdit(ctx, (c) => setLoopVideo(c, v.fileName)),
          }),
        ),
        h('td', { class: 'mono' }, v.fileName),
        h(
          'td',
          {},
          h('input', {
            type: 'text',
            value: v.title,
            'aria-label': `Title for ${v.fileName}`,
            onchange: (e: Event) => void saveEdit(ctx, (c) => setVideoTitle(c, v.fileName, (e.target as HTMLInputElement).value)),
          }),
        ),
        h('td', {}, formatBytes(size ?? v.sizeBytes)),
        h('td', {}, status),
        h('td', {}, h('button', { type: 'button', class: 'danger', disabled: busy, onclick: () => void deleteVideo(v.fileName) }, 'Delete')),
      );
    });

    replaceChildren(
      body,
      h(
        'div',
        { class: 'toolbar' },
        h('button', { type: 'button', disabled: busy, onclick: () => filesInput.click() }, 'Import files'),
        h('button', { type: 'button', disabled: busy, onclick: () => folderInput.click() }, 'Import folder'),
      ),
      config.videos.length === 0
        ? h('p', { class: 'hint' }, 'No videos yet. Update from the published config, then Import folder.')
        : h(
            'table',
            { 'data-testid': 'videos-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Loop'), h('th', {}, 'File'), h('th', {}, 'Title'), h('th', {}, 'Size'), h('th', {}, 'Status'), h('th'))),
            h(
              'tbody',
              {},
              ...rows,
              h(
                'tr',
                {},
                h(
                  'td',
                  {},
                  h('input', {
                    type: 'radio',
                    name: 'loopVideo',
                    'aria-label': 'No loop video',
                    checked: config.loopVideo === null,
                    onchange: () => void saveEdit(ctx, (c) => setLoopVideo(c, null)),
                  }),
                ),
                h('td', { colspan: 5, class: 'hint' }, 'No loop video'),
              ),
            ),
          ),
      orphans.length > 0
        ? h(
            'div',
            { class: 'orphans' },
            h('h3', {}, 'Files on this kiosk that are not in the config'),
            h(
              'ul',
              {},
              ...orphans.map((name) =>
                h(
                  'li',
                  {},
                  h('span', { class: 'mono' }, name),
                  ` (${formatBytes(local.get(name) ?? 0)}) `,
                  h('button', { type: 'button', disabled: busy, onclick: () => void saveEdit(ctx, (c) => upsertVideo(c, name, local.get(name) ?? 0)) }, 'Add to config'),
                  ' ',
                  h('button', { type: 'button', class: 'danger', disabled: busy, onclick: () => void deleteOrphan(name) }, 'Delete file'),
                ),
              ),
            ),
          )
        : null,
    );
  }

  const el = h('section', { 'data-testid': 'videos-section' }, h('h2', {}, 'Videos'), filesInput, folderInput, progress, body);
  return reactiveSection(el, render, [(l) => ctx.config.changed.subscribe(l), (l) => ctx.videos.changed.subscribe(l)]);
}
