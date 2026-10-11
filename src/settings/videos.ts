import type { AppContext } from '../app/context';
import { saveEdit } from '../app/edits';
import { errorMessage } from '../app/log';
import { cardsForVideo, removeVideo, setLoopVideo, setVideoTitle, upsertVideo } from '../config/ops';
import { formatUid } from '../scan/uid';
import { confirmDialog, errorList, messageDialog } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { filePicker } from '../ui/filePicker';
import { importPickedFiles, importPickedFolder, type ImportHost } from '../videos/importFlow';
import { formatBytes } from '../videos/opfsStore';
import { reactiveSection, type Section } from './section';
import type { SettingsEnv } from './settingsView';

export function renderVideos(ctx: AppContext, env: SettingsEnv): Section {
  const progress = h('div', { class: 'import-progress', 'data-testid': 'import-progress', hidden: true });
  const body = h('div');
  let busy = false;

  const host: ImportHost = {
    progress,
    hold: () => env.idle.hold(),
    onBusyChange: (value) => {
      busy = value;
      render();
    },
    summary: 'always',
  };

  const deleteVideo = async (fileName: string) => {
    const config = ctx.config.get();
    const cards = cardsForVideo(config, fileName);
    const nextLoop = config.loopVideo === fileName ? removeVideo(config, fileName).loopVideo : null;
    const ok = await confirmDialog({
      title: `Delete ${fileName}?`,
      content: [
        h('p', {}, 'The file is removed from this kiosk and the video is removed from the config.'),
        cards.length > 0
          ? h('div', {}, h('p', {}, 'These cards will be unpaired:'), errorList(cards.map((c) => formatUid(c.uid))))
          : '',
        config.loopVideo === fileName
          ? h('p', {}, nextLoop ? `This is the loop video. ${nextLoop} will become the loop video.` : 'This is the loop video, and there are no other videos to loop.')
          : '',
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

  const filesInput = filePicker({ folder: false, testId: 'import-files-input', onPick: (f) => void importPickedFiles(ctx, host, f) });
  const folderInput = filePicker({ folder: true, testId: 'import-folder-input', onPick: (f) => void importPickedFolder(ctx, host, f) });

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
