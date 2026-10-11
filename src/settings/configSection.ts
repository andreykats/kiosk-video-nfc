import type { AppContext } from '../app/context';
import { errorMessage, log } from '../app/log';
import type { Config } from '../config/schema';
import type { AppliedInfo } from '../config/store';
import { downloadConfig, fetchPublishedConfig, readConfigFile, summarizeConfig } from '../config/sync';
import type { Result } from '../result';
import { confirmDialog, errorList, messageDialog } from '../ui/dialog';
import { formatDate, h, replaceChildren } from '../ui/dom';
import { reactiveSection, type Section } from './section';

/** Validate → summarize → confirm → replace. Any failure keeps the current config. */
async function applyConfig(ctx: AppContext, result: Result<Config, string[]>, source: AppliedInfo['source']): Promise<void> {
  if (!result.ok) {
    await messageDialog(source === 'published' ? 'Could not update config' : 'Could not import config', [
      'The current config was kept.',
      errorList(result.error),
    ]);
    return;
  }
  const summary = summarizeConfig(result.value, ctx.videos.names());
  const ok = await confirmDialog({
    title: source === 'published' ? 'Apply published config?' : 'Apply config from file?',
    content: [
      h(
        'ul',
        { 'data-testid': 'config-summary' },
        h('li', {}, `Exported: ${formatDate(summary.updatedAt)}`),
        h('li', {}, `${summary.videos} video(s), ${summary.cards} card(s), ${summary.adminCards} admin card(s)`),
        h('li', {}, `Loop video: ${summary.loopVideo ?? 'none'}`),
      ),
      summary.missingLocally.length > 0
        ? h('div', {}, h('p', {}, `Videos not yet imported on this kiosk (${summary.missingLocally.length}):`), errorList(summary.missingLocally))
        : h('p', {}, 'All videos are already on this kiosk.'),
      h('p', { class: 'banner banner-warn' }, 'This replaces the local config entirely. Local edits made on this kiosk will be lost.'),
    ],
    confirmLabel: 'Replace local config',
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.config.replace(result.value, { source, updatedAt: result.value.updatedAt, appliedAt: new Date().toISOString() });
  } catch (e) {
    log.error('Applying config failed:', e);
    await messageDialog('Could not save config', ['The current config was kept.', errorMessage(e)]);
    return;
  }
  void ctx.readiness.recompute();
  if (summary.missingLocally.length > 0) {
    await messageDialog('Config applied', [`Next: Videos → Import folder to copy the ${summary.missingLocally.length} missing video(s).`]);
  }
}

export function renderConfigSection(ctx: AppContext): Section {
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, 'data-testid': 'import-config-input' });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (file) await applyConfig(ctx, await readConfigFile(file), 'file');
  });

  const status = h('p', { class: 'hint', 'data-testid': 'config-applied' });
  let updating = false;
  const updateButton = h('button', {
    type: 'button',
    'data-testid': 'update-published',
    onclick: async () => {
      if (updating) return;
      updating = true;
      updateButton.disabled = true;
      updateButton.textContent = 'Downloading…';
      try {
        await applyConfig(ctx, await fetchPublishedConfig(), 'published');
      } finally {
        updating = false;
        updateButton.disabled = false;
        updateButton.textContent = 'Update from published config';
      }
    },
  }, 'Update from published config');

  const render = () => {
    const applied = ctx.config.lastApplied();
    replaceChildren(
      status,
      applied
        ? `Last applied: config exported ${formatDate(applied.updatedAt)}, applied ${formatDate(applied.appliedAt)} from ${applied.source === 'published' ? 'the published site' : 'a file'}.`
        : 'No shared config has been applied on this kiosk yet.',
    );
  };

  const el = h(
    'section',
    { 'data-testid': 'config-section' },
    h('h2', {}, 'Config'),
    h(
      'div',
      { class: 'toolbar' },
      h('button', { type: 'button', 'data-testid': 'export-config', onclick: () => downloadConfig(ctx.config.get()) }, 'Export config'),
      updateButton,
      h('button', { type: 'button', onclick: () => fileInput.click() }, 'Import config from file'),
      fileInput,
    ),
    status,
    h('p', { class: 'hint' }, 'To share changes: Export config, upload it to public/config.json in the GitHub repo, wait for the deploy, then Update on each kiosk.'),
  );
  return reactiveSection(el, render, [(l) => ctx.config.changed.subscribe(l)]);
}
