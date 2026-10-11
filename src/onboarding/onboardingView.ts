import type { AppContext } from '../app/context';
import { SETTINGS_SHORTCUT_LABEL } from '../admin/access';
import { saveEdit } from '../app/edits';
import { errorMessage, log } from '../app/log';
import { addAdminCard, cardsForVideo, findAdminCard, findCard, pairCard, removeAdminCard, removeCard, useAsLoopInstead } from '../config/ops';
import { emptyConfig, type Config } from '../config/schema';
import type { AppliedInfo } from '../config/store';
import { downloadConfig, readConfigFile } from '../config/sync';
import { formatUid } from '../scan/uid';
import { installCallToAction } from '../settings/checklist';
import { renderOfflineIndicator } from '../settings/diagnostics';
import { confirmDialog, errorList } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { filePicker } from '../ui/filePicker';
import { importPickedFiles, importPickedFolder, type ImportHost } from '../videos/importFlow';
import { readFlags, writeFlags } from './progress';
import { nextStep, previousStep, resumeStep, stepSequence, type ConfigPath, type StepId } from './steps';

interface Nav {
  next(): void;
  back(): void;
  path(): ConfigPath | null;
}

interface StepView {
  el: HTMLElement;
  destroy(): void;
}

interface Action {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
}

/** The centred card every step renders into. */
function stepCard(
  nav: Nav,
  step: StepId,
  options: { title: string; body: (Node | string | null)[]; primary?: Action; secondary?: Action; wide?: boolean; busy?: boolean },
): HTMLElement {
  const seq = stepSequence(nav.path());
  const index = seq.indexOf(step);
  const button = (a: Action, cls: string) =>
    h('button', { type: 'button', class: cls, disabled: a.disabled, 'data-testid': a.testId, onclick: a.onClick }, a.label);
  return h(
    'div',
    { class: `onboarding-card${options.wide ? ' wide' : ''}`, 'data-step': step, 'data-testid': `step-${step}` },
    h(
      'div',
      { class: 'onboarding-progress' },
      h('span', {}, `Step ${index + 1} of ${seq.length}`),
      h('span', { class: 'dots' }, ...seq.map((_, i) => h('span', { class: `dot${i === index ? ' current' : i < index ? ' past' : ''}` }))),
    ),
    h('h1', {}, options.title),
    h('div', { class: 'onboarding-body' }, ...options.body),
    h(
      'div',
      { class: 'onboarding-actions' },
      index > 0 ? button({ label: 'Back', onClick: nav.back, disabled: options.busy, testId: 'onboarding-back' }, 'link') : h('span'),
      h(
        'span',
        { class: 'right' },
        options.secondary ? button(options.secondary, '') : null,
        options.primary ? button(options.primary, 'primary') : null,
      ),
    ),
  );
}

const p = (text: string, cls = '') => h('p', { class: cls }, text);

interface ReactiveStep extends StepView {
  rerender(): void;
}

/** Renders a step now and on every change of the given sources. */
function reactiveStep(
  render: (el: HTMLElement) => void,
  sources: ((l: () => void) => () => void)[] = [],
  cleanup?: () => void,
): ReactiveStep {
  const el = h('div', { class: 'onboarding-step' });
  const rerender = () => render(el);
  rerender();
  const unsubscribers = sources.map((s) => s(rerender));
  return {
    el,
    rerender,
    destroy: () => {
      unsubscribers.forEach((u) => u());
      cleanup?.();
    },
  };
}

function installStep(ctx: AppContext, nav: Nav): StepView {
  return reactiveStep(
    (el) => {
      const installed = ctx.install.get() === 'installed';
      replaceChildren(
        el,
        stepCard(nav, 'install', {
          title: 'Install the Topps Kiosk',
          body: [
            p('Installing keeps the kiosk working offline and stops Chrome from deleting videos when the disk fills up.'),
            installed ? p('App installed ✓', 'success') : installCallToAction(ctx),
            installed ? null : p('Chrome may only offer to install after you’ve clicked the page and spent about 30 seconds on it.', 'hint'),
          ],
          primary: installed
            ? {
                label: 'Next',
                testId: 'onboarding-next',
                onClick: () => {
                  writeFlags({ installStepDone: true });
                  nav.next();
                },
              }
            : undefined,
          secondary: installed
            ? undefined
            : {
                label: 'Skip for now',
                testId: 'onboarding-skip',
                onClick: () => {
                  writeFlags({ installStepDone: true });
                  nav.next();
                },
              },
        }),
      );
    },
    [(l) => ctx.install.changed.subscribe(l)],
  );
}

function readerStep(ctx: AppContext, nav: Nav): StepView {
  let scanned: string | null = null;
  const done = () => {
    writeFlags({ readerDone: true });
    nav.next();
  };
  const unsubscribe = ctx.scanner.scans.subscribe((scan) => {
    scanned = scan.uid;
    view.rerender();
  });
  const view = reactiveStep(
    (el) =>
      replaceChildren(
        el,
        stepCard(nav, 'reader', {
          title: 'Connect the NFC reader',
          body: [
            p('Plug the NFC reader into a USB port, then hold any card on it.'),
            scanned
              ? h('p', { class: 'success', 'data-testid': 'reader-status' }, `Reader is working ✓ Read card ${formatUid(scanned)}`)
              : h('p', { class: 'waiting', 'data-testid': 'reader-status' }, 'Waiting for a card…'),
            p('On a Mac, close Keyboard Setup Assistant if it opens. While it’s open, card reads are lost.', 'hint'),
          ],
          primary: { label: 'Next', onClick: done, disabled: scanned === null && !readFlags().readerDone, testId: 'onboarding-next' },
          secondary: scanned ? undefined : { label: 'Skip', onClick: done, testId: 'onboarding-skip' },
        }),
      ),
    [],
    unsubscribe,
  );
  return view;
}

function hasContent(config: Config): boolean {
  return config.videos.length > 0 || config.cards.length > 0 || config.adminCards.length > 0;
}

function configStep(ctx: AppContext, nav: Nav): StepView {
  let errors: string[] = [];

  const apply = async (config: Config, source: AppliedInfo['source']) => {
    const current = ctx.config.get();
    if (hasContent(current)) {
      const ok = await confirmDialog({
        title: 'Replace the current config?',
        content: [`This kiosk already has ${current.videos.length} video(s) and ${current.cards.length} card(s) set up. They will be replaced.`],
        confirmLabel: 'Replace',
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await ctx.config.replace(config, { source, updatedAt: config.updatedAt, appliedAt: new Date().toISOString() });
    } catch (e) {
      log.error('Applying config failed:', e);
      errors = [errorMessage(e)];
      view.rerender();
      return;
    }
    nav.next();
  };

  const fileInput = filePicker({
    folder: false,
    multiple: false,
    accept: 'application/json,.json',
    testId: 'onboarding-config-input',
    onPick: async ([file]) => {
      const result = await readConfigFile(file!);
      if (!result.ok) {
        errors = [`“${file!.name}” can’t be used:`, ...result.error];
        view.rerender();
        return;
      }
      await apply(result.value, 'file');
    },
  });

  const option = (title: string, detail: string, testId: string, onClick: () => void) =>
    h('button', { type: 'button', class: 'option', 'data-testid': testId, onclick: onClick }, h('strong', {}, title), h('span', {}, detail));

  const view = reactiveStep(renderInto);

  function renderInto(el: HTMLElement) {
    const path = nav.path();
    const applied = ctx.config.lastApplied();
    const config = ctx.config.get();
    replaceChildren(
      el,
      stepCard(nav, 'config', {
        title: 'Import configuration',
        body: [
          p('The config lists the videos, which card plays which video, and the admin cards.'),
          path && applied
            ? h(
                'p',
                { class: 'success', 'data-testid': 'config-current' },
                `${applied.source === 'new' ? 'Started a new config' : 'Config loaded'} ✓ ${config.videos.length} video(s), ${config.cards.length} card(s). Pick an option below to replace it, or continue.`,
              )
            : null,
          h(
            'div',
            { class: 'options' },
            option('Import a config file', 'Use a config.json exported from another kiosk.', 'option-import', () => fileInput.click()),
            option('Start a new config', 'Add videos and pair cards on this kiosk.', 'option-new', () => void apply(emptyConfig(), 'new')),
          ),
          fileInput,
          errors.length > 0 ? h('div', { class: 'error', 'data-testid': 'config-errors' }, errorList(errors)) : null,
        ],
        primary: path ? { label: 'Next', onClick: nav.next, testId: 'onboarding-next' } : undefined,
      }),
    );
  }

  return view;
}

function importHost(progress: HTMLElement, onBusy: (busy: boolean) => void): ImportHost {
  return { progress, summary: 'problems', onBusyChange: onBusy };
}

function addVideosStep(ctx: AppContext, nav: Nav): StepView {
  const progress = h('div', { class: 'import-progress', 'data-testid': 'import-progress', hidden: true });
  let busy = false;
  const host = importHost(progress, (b) => {
    busy = b;
    view.rerender();
  });
  const afterImport = (outcome: { imported: string[] } | null) => {
    if (outcome && outcome.imported.length > 0) nav.next();
  };
  const filesInput = filePicker({ folder: false, testId: 'onboarding-files-input', onPick: (f) => void importPickedFiles(ctx, host, f).then(afterImport) });
  const folderInput = filePicker({
    folder: true,
    testId: 'onboarding-folder-input',
    onPick: (f) => void importPickedFiles(ctx, host, f, { videosOnly: true }).then(afterImport),
  });

  const view = reactiveStep(
    renderInto,
    [(l) => ctx.config.changed.subscribe(l)],
  );
  return view;

  function renderInto(el: HTMLElement) {
    const count = ctx.config.get().videos.length;
    replaceChildren(
      el,
      stepCard(nav, 'addVideos', {
        title: 'Add videos',
        busy,
        body: [
          p('Choose the video files to play. They’re copied into this browser, so the kiosk doesn’t need the USB stick afterwards.'),
          h(
            'div',
            { class: 'toolbar' },
            h('button', { type: 'button', class: 'primary', disabled: busy, onclick: () => filesInput.click() }, 'Choose video files'),
            h('button', { type: 'button', disabled: busy, onclick: () => folderInput.click() }, 'Choose a folder'),
          ),
          filesInput,
          folderInput,
          progress,
          count > 0 ? p(`${count} video(s) added.`, 'success') : null,
        ],
        primary: count > 0 ? { label: 'Next', onClick: nav.next, disabled: busy, testId: 'onboarding-next' } : undefined,
      }),
    );
  }
}

function copyVideosStep(ctx: AppContext, nav: Nav): StepView {
  const progress = h('div', { class: 'import-progress', 'data-testid': 'import-progress', hidden: true });
  let busy = false;
  const host = importHost(progress, (b) => {
    busy = b;
    view.rerender();
  });
  const missing = () => ctx.config.get().videos.filter((v) => !ctx.videos.has(v.fileName));
  /** Set after a folder that didn't contain every video. */
  let incomplete = false;
  const folderInput = filePicker({
    folder: true,
    testId: 'onboarding-folder-input',
    onPick: (f) =>
      void importPickedFolder(ctx, host, f).then(() => {
        if (missing().length === 0) return nav.next();
        incomplete = true;
        view.rerender();
      }),
  });

  const view = reactiveStep(
    renderInto,
    [(l) => ctx.config.changed.subscribe(l), (l) => ctx.videos.changed.subscribe(l)],
  );
  return view;

  function renderInto(el: HTMLElement) {
    const total = ctx.config.get().videos.length;
    const absent = missing();
    replaceChildren(
      el,
      stepCard(nav, 'copyVideos', {
        title: 'Copy the videos',
        busy,
        body: [
          total === 0
            ? p('This config has no videos yet. You can add them in the next step.')
            : p(`This config uses ${total} video(s). Choose the folder that has them, for example on a USB stick.`),
          absent.length > 0
            ? h('div', {}, p(`Still needed (${absent.length}):`), errorList(absent.map((v) => v.fileName)))
            : total > 0
              ? p('All videos are on this kiosk ✓', 'success')
              : null,
          incomplete && absent.length > 0
            ? p('That folder didn’t have all of them. Choose a folder that has the videos still needed.', 'error')
            : null,
          folderInput,
          progress,
        ],
        // Every video the config uses must be on the kiosk before moving on.
        primary:
          absent.length > 0
            ? { label: 'Choose folder', onClick: () => folderInput.click(), disabled: busy, testId: 'onboarding-choose-folder' }
            : { label: 'Next', onClick: nav.next, disabled: busy, testId: 'onboarding-next' },
      }),
    );
  }
}

interface PairingState {
  fileName: string;
  message: { text: string; kind: 'error' | 'info' } | null;
  /** Card already plays another video; waiting for the user to move it. */
  conflict: { uid: string; otherFile: string } | null;
}

function pairStep(ctx: AppContext, nav: Nav): StepView {
  let pairing: PairingState | null = null;
  let busy = false;
  const progress = h('div', { class: 'import-progress', 'data-testid': 'import-progress', hidden: true });
  const host = importHost(progress, (b) => {
    busy = b;
    view.rerender();
  });
  const filesInput = filePicker({ folder: false, testId: 'onboarding-files-input', onPick: (f) => void importPickedFiles(ctx, host, f) });

  const pair = async (uid: string, fileName: string) => {
    if (await saveEdit(ctx, (c) => pairCard(c, { uid, fileName, label: '' }))) pairing = null;
    view.rerender();
  };

  const unsubscribeScans = ctx.scanner.scans.subscribe((scan) => {
    if (!pairing || pairing.conflict) return;
    const config = ctx.config.get();
    const admin = findAdminCard(config, scan.uid);
    const existing = findCard(config, scan.uid);
    if (admin) {
      pairing.message = { text: `${formatUid(scan.uid)} is an admin card. Use a different card.`, kind: 'error' };
    } else if (existing?.fileName === pairing.fileName) {
      pairing.message = { text: `${formatUid(scan.uid)} already plays this video. Hold another card on the reader, or press Cancel.`, kind: 'info' };
    } else if (existing) {
      pairing.conflict = { uid: scan.uid, otherFile: existing.fileName };
      pairing.message = null;
    } else {
      void pair(scan.uid, pairing.fileName);
      return;
    }
    view.rerender();
  });

  /** There is always a loop video: it can be moved to another video but not cleared. */
  const toggleLoop = async (fileName: string, checked: boolean) => {
    if (!checked) return view.rerender();
    const cards = cardsForVideo(ctx.config.get(), fileName);
    if (cards.length > 0) {
      const ok = await confirmDialog({
        title: `Use ${fileName} as the background loop?`,
        content: [`The loop plays on repeat instead of being started by a card, so its ${cards.length} card(s) will be unpaired.`],
        confirmLabel: 'Use as loop',
      });
      if (!ok) return view.rerender();
    }
    if (pairing?.fileName === fileName) pairing = null;
    await saveEdit(ctx, (c) => useAsLoopInstead(c, fileName));
  };

  function pairCell(fileName: string): HTMLElement {
    if (pairing?.fileName !== fileName) {
      return h(
        'button',
        { type: 'button', 'data-testid': 'pair-card', disabled: busy || pairing !== null, onclick: () => ((pairing = { fileName, message: null, conflict: null }), view.rerender()) },
        'Pair card',
      );
    }
    const cancel = h('button', { type: 'button', class: 'link', onclick: () => ((pairing = null), view.rerender()) }, 'Cancel');
    if (pairing.conflict) {
      const { uid, otherFile } = pairing.conflict;
      return h(
        'div',
        { class: 'pairing', 'data-testid': 'pair-conflict' },
        h('p', {}, `${formatUid(uid)} plays “${otherFile}”. Use it for this video instead?`),
        h('button', { type: 'button', class: 'primary', onclick: () => void pair(uid, fileName) }, 'Move card here'),
        ' ',
        cancel,
      );
    }
    return h(
      'div',
      { class: 'pairing' },
      h('p', { class: 'waiting', 'data-testid': 'pair-waiting' }, 'Hold a card on the reader…'),
      pairing.message ? h('p', { class: pairing.message.kind, 'data-testid': 'pair-message' }, pairing.message.text) : null,
      cancel,
    );
  }

  const view = reactiveStep(
    renderInto,
    [(l) => ctx.config.changed.subscribe(l), (l) => ctx.videos.changed.subscribe(l)],
    unsubscribeScans,
  );

  function renderInto(el: HTMLElement) {
    const config = ctx.config.get();
    const loopReady = config.loopVideo !== null && ctx.videos.has(config.loopVideo);
    const rows = config.videos.map((v) => {
      const isLoop = config.loopVideo === v.fileName;
      const cards = cardsForVideo(config, v.fileName);
      return h(
        'tr',
        { 'data-file': v.fileName },
        h(
          'td',
          {},
          h(
            'label',
            { class: 'loop-toggle' },
            h('input', {
              type: 'checkbox',
              checked: isLoop,
              'aria-label': `Use ${v.fileName} as background loop`,
              title: isLoop ? 'Tick another video to move the loop' : null,
              onchange: (e: Event) => void toggleLoop(v.fileName, (e.target as HTMLInputElement).checked),
            }),
            ' Loop',
          ),
        ),
        h(
          'td',
          {},
          h('div', { class: 'video-name mono' }, v.fileName),
          ctx.videos.has(v.fileName) ? null : h('div', { class: 'hint' }, 'Not on this kiosk'),
        ),
        h(
          'td',
          { class: 'cards-cell' },
          isLoop
            ? h('span', { class: 'hint' }, 'Plays on repeat between cards')
            : h(
                'div',
                {},
                ...cards.map((c) =>
                  h(
                    'span',
                    { class: 'chip mono', 'data-uid': c.uid },
                    formatUid(c.uid),
                    h('button', { type: 'button', class: 'chip-remove', 'aria-label': `Unpair ${c.uid}`, onclick: () => void saveEdit(ctx, (cfg) => removeCard(cfg, c.uid)) }, '×'),
                  ),
                ),
                cards.length === 0 && pairing?.fileName !== v.fileName ? h('span', { class: 'hint' }, 'No card yet ') : null,
                pairCell(v.fileName),
              ),
        ),
      );
    });
    replaceChildren(
      el,
      stepCard(nav, 'pair', {
        title: 'Pair videos with cards',
        wide: true,
        busy,
        body: [
          p('Press Pair card, then hold a card on the reader. That card will play the video. One video is the background loop and plays on repeat between cards. Tick Loop on another video to move it.'),
          config.videos.length === 0
            ? p('There are no videos yet. Add some first.', 'error')
            : h('table', { class: 'pair-table', 'data-testid': 'pair-table' }, h('tbody', {}, ...rows)),
          h('div', { class: 'toolbar' }, h('button', { type: 'button', disabled: busy, onclick: () => filesInput.click() }, 'Add more videos')),
          filesInput,
          progress,
          loopReady ? null : p('Tick Loop on one video to continue.', 'hint'),
        ],
        primary: { label: 'Next', onClick: nav.next, disabled: !loopReady || busy || pairing !== null, testId: 'onboarding-next' },
      }),
    );
  }

  return view;
}

function adminStep(ctx: AppContext, nav: Nav): StepView {
  let message: { text: string; kind: 'error' | 'success' } | null = null;

  const unsubscribe = ctx.scanner.scans.subscribe(async (scan) => {
    const config = ctx.config.get();
    const card = findCard(config, scan.uid);
    if (card) {
      message = { text: `${formatUid(scan.uid)} plays “${card.fileName}”. Use a different card for admin.`, kind: 'error' };
    } else if (findAdminCard(config, scan.uid)) {
      message = { text: `${formatUid(scan.uid)} is already an admin card.`, kind: 'error' };
    } else if (await saveEdit(ctx, (c) => addAdminCard(c, { uid: scan.uid, label: '' }))) {
      message = { text: `Added ${formatUid(scan.uid)} as an admin card ✓`, kind: 'success' };
    }
    view.rerender();
  });

  const view = reactiveStep(
    (el) => {
      const admins = ctx.config.get().adminCards;
      replaceChildren(
        el,
        stepCard(nav, 'admin', {
          title: 'Pair an admin card',
          body: [
            p('Staff hold an admin card on the reader to open settings. Hold the card you want to use on the reader now.'),
            h('p', { class: 'waiting', 'data-testid': 'admin-waiting' }, admins.length === 0 ? 'Waiting for a card…' : 'Hold another card to add more, or press Next.'),
            message ? h('p', { class: message.kind, 'data-testid': 'admin-message' }, message.text) : null,
            admins.length > 0
              ? h(
                  'div',
                  { 'data-testid': 'admin-cards' },
                  ...admins.map((a) =>
                    h(
                      'span',
                      { class: 'chip mono', 'data-uid': a.uid },
                      formatUid(a.uid),
                      h('button', { type: 'button', class: 'chip-remove', 'aria-label': `Remove admin card ${a.uid}`, onclick: () => void saveEdit(ctx, (c) => removeAdminCard(c, a.uid)) }, '×'),
                    ),
                  ),
                )
              : null,
            p(`Without an admin card, settings can still be opened with ${SETTINGS_SHORTCUT_LABEL}.`, 'hint'),
          ],
          primary: admins.length > 0 ? { label: 'Next', onClick: nav.next, testId: 'onboarding-next' } : undefined,
          secondary: admins.length > 0 ? undefined : { label: 'Skip', onClick: nav.next, testId: 'onboarding-skip' },
        }),
      );
    },
    [(l) => ctx.config.changed.subscribe(l)],
    unsubscribe,
  );
  return view;
}

function doneStep(ctx: AppContext, nav: Nav): StepView {
  const offline = renderOfflineIndicator(ctx);
  void ctx.readiness.recompute();
  const view = reactiveStep((el) => {
    const config = ctx.config.get();
    replaceChildren(
      el,
      stepCard(nav, 'done', {
        title: 'You’re all set',
        body: [
          p(`${config.videos.length} video(s) and ${config.cards.length} card(s). Background loop: ${config.loopVideo ?? 'none'}.`),
          offline.el,
          p(`To open settings, hold an admin card on the reader or press ${SETTINGS_SHORTCUT_LABEL}.`, 'hint'),
          p('To use this setup on other kiosks, press Export config to save config.json. Import that file on another kiosk.', 'hint'),
        ],
        secondary: { label: 'Export config', testId: 'onboarding-export', onClick: () => downloadConfig(ctx.config.get()) },
        primary: {
          label: 'Start kiosk',
          testId: 'onboarding-start',
          onClick: () => {
            writeFlags({ completed: true });
            ctx.navigate('kiosk');
          },
        },
      }),
    );
  }, [(l) => ctx.config.changed.subscribe(l)]);
  return { el: view.el, destroy: () => (view.destroy(), offline.destroy()) };
}

const STEPS: Record<StepId, (ctx: AppContext, nav: Nav) => StepView> = {
  install: installStep,
  reader: readerStep,
  config: configStep,
  addVideos: addVideosStep,
  copyVideos: copyVideosStep,
  pair: pairStep,
  admin: adminStep,
  done: doneStep,
};

export function pathFromApplied(applied: AppliedInfo | null): ConfigPath | null {
  if (!applied) return null;
  return applied.source === 'new' ? 'new' : 'existing';
}

/** First-launch setup guide: one centred card per step. */
export function mountOnboarding(root: HTMLElement, ctx: AppContext): () => void {
  const container = h('div', { class: 'onboarding', 'data-testid': 'onboarding' });
  root.replaceChildren(container);
  let current: StepView | null = null;

  const nav: Nav = {
    path: () => pathFromApplied(ctx.config.lastApplied()),
    next: () => {
      const step = container.dataset.step as StepId;
      const next = nextStep(step, nav.path());
      if (next) show(next);
    },
    back: () => {
      const prev = previousStep(container.dataset.step as StepId, nav.path());
      if (prev) show(prev);
    },
  };

  function show(step: StepId) {
    current?.destroy();
    container.dataset.step = step;
    current = STEPS[step](ctx, nav);
    container.replaceChildren(current.el);
  }

  const flags = readFlags();
  const config = ctx.config.get();
  show(
    resumeStep({
      installStepDone: flags.installStepDone,
      readerDone: flags.readerDone,
      path: nav.path(),
      videoCount: config.videos.length,
      missingCount: config.videos.filter((v) => !ctx.videos.has(v.fileName)).length,
    }),
  );

  return () => {
    current?.destroy();
    container.remove();
  };
}
