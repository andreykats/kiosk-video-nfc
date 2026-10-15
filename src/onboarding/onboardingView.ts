import type { AppContext } from '../app/context';
import { IdleTimer, SETTINGS_IDLE_MS, SETTINGS_SHORTCUT_LABEL } from '../admin/access';
import { saveEdit } from '../app/edits';
import { errorMessage, log } from '../app/log';
import { addAdminCard, cardsForVideo, findAdminCard, findCard, removeAdminCard, scanMatches, useAsLoopInstead } from '../config/ops';
import { emptyConfig, type CardMatch, type Config } from '../config/schema';
import type { AppliedInfo } from '../config/store';
import { downloadConfig, readConfigFile } from '../config/sync';
import type { ScanEvent } from '../scan/scanEvent';
import { formatMatch, formatUid } from '../scan/uid';
import { installCallToAction } from '../settings/checklist';
import { renderOfflineIndicator } from '../settings/diagnostics';
import { quickPair } from '../settings/cards';
import { matchAttrs } from '../settings/pairing';
import { readerControls } from '../settings/readerSection';
import { closeAllDialogs, confirmDialog, errorList } from '../ui/dialog';
import { h, replaceChildren } from '../ui/dom';
import { filePicker } from '../ui/filePicker';
import { importPickedFiles, importPickedFolder, type ImportHost } from '../videos/importFlow';
import { readFlags, writeFlags } from './progress';
import { nextStep, previousStep, resumeStep, stepSequence, type ConfigPath, type StepId } from './steps';

interface Nav {
  next(): void;
  back(): void;
  path(): ConfigPath | null;
  /** Pauses the idle return to the kiosk while a long import runs. */
  hold(): () => void;
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
      index > 0
        ? button({ label: 'Back', onClick: nav.back, disabled: options.busy, testId: 'onboarding-back' }, 'link')
        : h('span', { class: 'version', 'data-testid': 'onboarding-version' }, `v${__APP_VERSION__}`),
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

/** Built from public/acr1552-mode.sh (see vite.config.ts); unzips to "ACR1552U HID Mode.command". */
const ACR1552_HID_ZIP = 'acr1552-hid-mode.zip';

/**
 * Keyboard input needs the reader in HID keyboard mode; the ACR1552U ships in
 * CCID mode. The switch is a double-clickable macOS script.
 */
function hidModeHelp(): HTMLElement {
  if (!navigator.platform.startsWith('Mac')) {
    return p('Using an ACR1552U? It only types tags in HID keyboard mode. To switch it, use ACS’s configuration tool.', 'hint');
  }
  return h(
    'div',
    { 'data-testid': 'hid-mode-help' },
    p('Using an ACR1552U? It only types tags in HID keyboard mode. To switch it, download the switch, double-click the zip to unpack it, then double-click “ACR1552U HID Mode”. Terminal opens and asks for this Mac’s password.', 'hint'),
    p('The first time, macOS won’t open it. Go to System Settings → Privacy & Security, click Open Anyway, then Open.', 'hint'),
    h('p', {}, h('a', { href: `${import.meta.env.BASE_URL}${ACR1552_HID_ZIP}`, download: ACR1552_HID_ZIP, 'data-testid': 'hid-mode-download' }, 'Download the ACR1552U HID mode switch')),
  );
}

function readerStep(ctx: AppContext, nav: Nav): StepView {
  let scanned: ScanEvent | null = null;
  const done = () => {
    writeFlags({ readerDone: true });
    nav.next();
  };
  const controls = readerControls(ctx);
  const unsubscribe = ctx.scanner.scans.subscribe((scan) => {
    scanned = scan;
    view.rerender();
  });
  const view = reactiveStep(
    (el) =>
      replaceChildren(
        el,
        stepCard(nav, 'reader', {
          title: 'Connect the NFC reader',
          body: [
            p('Plug the NFC reader into a USB port. Choose how this kiosk reads tags, then hold any tag on the reader.'),
            controls.el,
            scanned
              ? h(
                  'p',
                  { class: 'success', 'data-testid': 'reader-status' },
                  `Reader is working ✓ Read tag ${formatUid(scanned.uid)}`,
                  scanned.ndefKey !== null ? ` with tag ID ${scanned.ndefKey}` : '',
                )
              : h('p', { class: 'waiting', 'data-testid': 'reader-status' }, 'Waiting for a tag…'),
            ctx.scanner.mode === 'keyboard'
              ? p('On a Mac, close Keyboard Setup Assistant if it opens. While it’s open, tag reads are lost.', 'hint')
              : null,
            ctx.scanner.mode === 'keyboard' ? hidModeHelp() : null,
          ],
          primary: { label: 'Next', onClick: done, disabled: scanned === null && !readFlags().readerDone, testId: 'onboarding-next' },
          secondary: scanned ? undefined : { label: 'Skip', onClick: done, testId: 'onboarding-skip' },
        }),
      ),
    [(l) => ctx.scanner.changed.subscribe(l)],
    () => {
      unsubscribe();
      controls.destroy();
    },
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
        content: [`This kiosk already has ${current.videos.length} video(s) and ${current.cards.length} tag(s) set up. They will be replaced.`],
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
          p('The config lists the videos, which tag plays which video, and the admin tags.'),
          path && applied
            ? h(
                'p',
                { class: 'success', 'data-testid': 'config-current' },
                `${applied.source === 'new' ? 'Started a new config' : 'Config loaded'} ✓ ${config.videos.length} video(s), ${config.cards.length} tag(s). Pick an option below to replace it, or continue.`,
              )
            : null,
          h(
            'div',
            { class: 'options' },
            option('Import a config file', 'Use a config.json exported from another kiosk.', 'option-import', () => fileInput.click()),
            option('Start a new config', 'Add videos and pair tags on this kiosk.', 'option-new', () => void apply(emptyConfig(), 'new')),
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

function importHost(nav: Nav, progress: HTMLElement, onBusy: (busy: boolean) => void): ImportHost {
  return { progress, summary: 'problems', onBusyChange: onBusy, hold: nav.hold };
}

function addVideosStep(ctx: AppContext, nav: Nav): StepView {
  const progress = h('div', { class: 'import-progress', 'data-testid': 'import-progress', hidden: true });
  let busy = false;
  const host = importHost(nav, progress, (b) => {
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
  const host = importHost(nav, progress, (b) => {
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

function pairStep(ctx: AppContext, nav: Nav): StepView {
  let busy = false;
  const progress = h('div', { class: 'import-progress', 'data-testid': 'import-progress', hidden: true });
  const host = importHost(nav, progress, (b) => {
    busy = b;
    view.rerender();
  });
  const filesInput = filePicker({ folder: false, testId: 'onboarding-files-input', onPick: (f) => void importPickedFiles(ctx, host, f) });

  /** There is always a loop video: it can be moved to another video but not cleared. */
  const toggleLoop = async (fileName: string, checked: boolean) => {
    if (!checked) return view.rerender();
    const cards = cardsForVideo(ctx.config.get(), fileName);
    if (cards.length > 0) {
      const ok = await confirmDialog({
        title: `Use ${fileName} as the background loop?`,
        content: [`The loop plays on repeat instead of being started by a tag, so its ${cards.length} tag(s) will be unpaired.`],
        confirmLabel: 'Use as loop',
      });
      if (!ok) return view.rerender();
    }
    await saveEdit(ctx, (c) => useAsLoopInstead(c, fileName));
  };

  const view = reactiveStep(renderInto, [(l) => ctx.config.changed.subscribe(l), (l) => ctx.videos.changed.subscribe(l)]);

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
          h(
            'div',
            { class: 'pair-cell' },
            // Counts pairings: in NDEF mode, every card with the same payload is one.
            h(
              'span',
              { class: 'hint', 'data-testid': 'pair-count' },
              isLoop ? 'Plays on repeat between tags' : cards.length === 0 ? 'No tags yet' : `${cards.length} tag${cards.length === 1 ? '' : 's'} paired`,
            ),
            h(
              'button',
              {
                type: 'button',
                'data-testid': 'pair-card',
                // The loop plays between cards, so no card can start it.
                disabled: busy || isLoop,
                title: isLoop ? 'The loop video plays between tags and can’t be paired' : null,
                onclick: () => void quickPair(ctx, v.fileName),
              },
              'Pair tag',
            ),
          ),
        ),
      );
    });
    replaceChildren(
      el,
      stepCard(nav, 'pair', {
        title: 'Pair videos with tags',
        wide: true,
        busy,
        body: [
          p('Press Pair tag, then hold a tag on the reader. That tag will play the video. To pair several tags in a row, tick Keep pairing in the dialog. One video is the background loop and plays on repeat between tags. Tick Loop on another video to move it.'),
          config.videos.length === 0
            ? p('There are no videos yet. Add some first.', 'error')
            : h('table', { class: 'pair-table', 'data-testid': 'pair-table' }, h('tbody', {}, ...rows)),
          h('div', { class: 'toolbar' }, h('button', { type: 'button', disabled: busy, onclick: () => filesInput.click() }, 'Add more videos')),
          filesInput,
          progress,
          loopReady ? null : p('Tick Loop on one video to continue.', 'hint'),
        ],
        primary: { label: 'Next', onClick: nav.next, disabled: !loopReady || busy, testId: 'onboarding-next' },
      }),
    );
  }

  return view;
}

function adminStep(ctx: AppContext, nav: Nav): StepView {
  let message: { text: string; kind: 'error' | 'success' } | null = null;

  // Admin cards are always paired by UID here: a card ID may be shared by many
  // visitor cards, and none of those may open settings.
  const unsubscribe = ctx.scanner.scans.subscribe(async (scan) => {
    const config = ctx.config.get();
    const match: CardMatch = { kind: 'uid', value: scan.uid };
    const card = scanMatches(scan)
      .map((m) => findCard(config, m))
      .find((c) => c !== undefined);
    if (card) {
      message = { text: `${formatMatch(card.match)} plays “${card.fileName}”. Use a different tag for admin.`, kind: 'error' };
    } else if (findAdminCard(config, match)) {
      message = { text: `${formatUid(scan.uid)} is already an admin tag.`, kind: 'error' };
    } else if (await saveEdit(ctx, (c) => addAdminCard(c, { match, label: '' }))) {
      message = { text: `Added ${formatUid(scan.uid)} as an admin tag ✓`, kind: 'success' };
    }
    view.rerender();
  });

  const view = reactiveStep(
    (el) => {
      const admins = ctx.config.get().adminCards;
      replaceChildren(
        el,
        stepCard(nav, 'admin', {
          title: 'Pair an admin tag',
          body: [
            p('Staff hold an admin tag on the reader to open settings. Hold the tag you want to use on the reader now.'),
            h('p', { class: 'waiting', 'data-testid': 'admin-waiting' }, admins.length === 0 ? 'Waiting for a tag…' : 'Hold another tag to add more, or press Next.'),
            message ? h('p', { class: message.kind, 'data-testid': 'admin-message' }, message.text) : null,
            admins.length > 0
              ? h(
                  'div',
                  { 'data-testid': 'admin-cards' },
                  ...admins.map((a) =>
                    h(
                      'span',
                      { class: 'chip mono', ...matchAttrs(a.match) },
                      formatMatch(a.match),
                      h('button', { type: 'button', class: 'chip-remove', 'aria-label': `Remove admin tag ${a.match.value}`, onclick: () => void saveEdit(ctx, (c) => removeAdminCard(c, a.match)) }, '×'),
                    ),
                  ),
                )
              : null,
            p(`Without an admin tag, settings can still be opened with ${SETTINGS_SHORTCUT_LABEL}.`, 'hint'),
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
          p(`${config.videos.length} video(s) and ${config.cards.length} tag(s). Background loop: ${config.loopVideo ?? 'none'}.`),
          offline.el,
          p(`To open settings, hold an admin tag on the reader or press ${SETTINGS_SHORTCUT_LABEL}.`, 'hint'),
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
  // Once the kiosk has been set up, a guide left open (from settings or the
  // "Setup required" screen) goes back to the kiosk like settings does. A
  // first-launch setup stays put: there is nothing to go back to yet.
  const idle = new IdleTimer(SETTINGS_IDLE_MS, () => {
    if (readFlags().completed) ctx.navigate('kiosk');
  });

  const nav: Nav = {
    path: () => pathFromApplied(ctx.config.lastApplied()),
    hold: () => idle.hold(),
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
    idle.destroy();
    current?.destroy();
    closeAllDialogs();
    container.remove();
  };
}
