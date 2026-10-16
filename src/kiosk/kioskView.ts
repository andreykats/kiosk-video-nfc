import { readFillScreen, readInterruptPlayback } from './playbackOptions';
import type { AppContext } from '../app/context';
import { SETTINGS_SHORTCUT_LABEL } from '../admin/access';
import type { Diagnostics } from '../app/diagnostics';
import { log } from '../app/log';
import { h } from '../ui/dom';
import { keepFullscreen } from './fullscreen';
import { showShortcutHintOnMouseMove } from './shortcutHint';
import { initialKioskState, transition, type KioskEffect, type KioskEvent, type KioskState } from './stateMachine';
import { keepScreenOn } from './wakeLock';
import { ProgressWatch, retryDelay } from './watchdog';

/** How often playback is checked, and how long without progress counts as stalled. */
const WATCHDOG_INTERVAL_MS = 2_000;
const STALL_MS = 10_000;
/** A broken loop is reloaded after 1 s, 2 s, 4 s … then every 5 min. */
const LOOP_RETRY_BASE_MS = 1_000;
const LOOP_RETRY_MAX_MS = 5 * 60_000;

/**
 * Plays media, falling back to muted playback if Chrome blocks autoplay with
 * sound. Production kiosks launch with --autoplay-policy=no-user-gesture-required,
 * so the fallback is only hit when the launch flags are missing.
 */
async function playWithFallback(video: HTMLVideoElement, diagnostics: Diagnostics): Promise<void> {
  video.muted = false;
  try {
    await video.play();
    diagnostics.setAutoplay('ok');
    return;
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'NotAllowedError')) throw e;
  }
  log.warn('Autoplay with sound was blocked; retrying muted.');
  video.muted = true;
  try {
    await video.play();
    diagnostics.setAutoplay('muted');
  } catch (e) {
    diagnostics.setAutoplay('blocked');
    throw e;
  }
}

/** Ignore play() rejections caused by us replacing the source mid-start. */
const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

class VideoSlot {
  private url: string | null = null;
  fileName: string | null = null;

  constructor(readonly el: HTMLVideoElement) {}

  load(file: File, fileName: string): void {
    this.clear();
    this.url = URL.createObjectURL(file);
    this.fileName = fileName;
    this.el.dataset.file = fileName;
    this.el.src = this.url;
  }

  clear(): void {
    this.el.pause();
    if (this.url) {
      this.el.removeAttribute('src');
      this.el.load(); // releases the decoder and the file
      URL.revokeObjectURL(this.url);
    }
    this.url = null;
    this.fileName = null;
    delete this.el.dataset.file;
  }
}

export function mountKiosk(root: HTMLElement, ctx: AppContext): () => void {
  const loopEl = h('video', { class: 'kiosk-video', 'data-testid': 'loop-video', loop: true, playsinline: true, preload: 'auto' });
  const featureEl = h('video', { class: 'kiosk-video', 'data-testid': 'feature-video', playsinline: true, preload: 'auto', hidden: true });
  const setupEl = h('div', { class: 'setup-screen', 'data-testid': 'setup-screen', hidden: true });
  const focusEl = h(
    'div',
    { class: 'focus-notice', 'data-testid': 'focus-notice', role: 'status', hidden: true },
    h('h1', {}, 'Paused'),
    h('p', {}, 'Tap or click the screen to resume.'),
  );
  const bridgeEl = h(
    'div',
    { class: 'focus-notice', 'data-testid': 'bridge-notice', role: 'status', hidden: true },
    h('h1', {}, 'Tag reader not available'),
    h('p', { 'data-testid': 'bridge-notice-detail' }),
  );
  const view = h('div', { class: 'kiosk', 'data-testid': 'kiosk', 'data-state': 'loop' }, loopEl, featureEl, setupEl, focusEl, bridgeEl);
  // Settings is its own route, so the choice is read each time the kiosk mounts.
  view.classList.toggle('fill-screen', readFillScreen());
  root.replaceChildren(view);

  const loop = new VideoSlot(loopEl);
  const feature = new VideoSlot(featureEl);
  let state: KioskState = initialKioskState;
  let disposed = false;
  const watch = new ProgressWatch(STALL_MS, performance.now());
  /** Consecutive loop failures with no playback in between. */
  let loopFailures = 0;
  let loopRetry: ReturnType<typeof setTimeout> | undefined;

  /** Why the kiosk can't play, in the words staff will see. */
  const setupReason = (): string => {
    const config = ctx.config.get();
    if (config.videos.length === 0) return 'There are no videos on this kiosk yet.';
    if (!config.loopVideo) return 'No background loop video is selected.';
    if (!ctx.videos.has(config.loopVideo)) return `The loop video “${config.loopVideo}” isn’t on this kiosk yet.`;
    return `The loop video “${config.loopVideo}” can’t be played.`;
  };

  /** Centred card, like the setup guide, shown instead of the loop. */
  const setSetupVisible = (visible: boolean) => {
    setupEl.hidden = !visible;
    view.classList.toggle('needs-setup', visible);
    if (!visible) return;
    setupEl.replaceChildren(
      h(
        'div',
        { class: 'setup-card' },
        h('h1', {}, 'Setup required'),
        h('p', { 'data-testid': 'setup-reason' }, setupReason()),
        h('p', { class: 'hint' }, `Run the setup guide to add videos and pair tags, or open settings. You can also press ${SETTINGS_SHORTCUT_LABEL} or hold an admin tag on the reader.`),
        h(
          'div',
          { class: 'onboarding-actions' },
          h('span'),
          h(
            'span',
            { class: 'right' },
            h('button', { type: 'button', 'data-testid': 'setup-open-settings', onclick: () => ctx.navigate('settings') }, 'Open settings'),
            h('button', { type: 'button', class: 'primary', 'data-testid': 'setup-open-guide', onclick: () => ctx.navigate('setup') }, 'Open setup guide'),
          ),
        ),
      ),
    );
  };

  /**
   * Reloads the loop from storage with backoff. One glitch (decoder error, GPU
   * process restart) must not leave visitors looking at "Setup required" for
   * the rest of the day; the setup screen only appears once a retry fails too.
   */
  const scheduleLoopRetry = (...parts: unknown[]) => {
    if (disposed || loopRetry !== undefined) return;
    loopFailures++;
    ctx.diagnostics.recordPlaybackFailure('loop');
    const delay = retryDelay(loopFailures, LOOP_RETRY_BASE_MS, LOOP_RETRY_MAX_MS);
    log.error(...parts, `Reloading it in ${Math.round(delay / 1000)} s.`);
    if (loopFailures > 1 && state.kind === 'loop') setSetupVisible(true);
    loopRetry = setTimeout(() => {
      loopRetry = undefined;
      loop.clear();
      void startLoop();
    }, delay);
  };

  /** (Re)loads the loop video from the current config, or shows the setup screen. */
  const startLoop = async () => {
    const name = ctx.config.get().loopVideo;
    let file: File | null = null;
    if (name) {
      try {
        file = await ctx.videos.getFile(name);
      } catch (e) {
        scheduleLoopRetry(`Reading loop video "${name}" failed:`, e);
        return;
      }
    }
    if (disposed) return;
    if (!name || !file) {
      // Nothing to retry: the config or the videos changing calls startLoop again.
      if (name) log.warn(`Loop video "${name}" is not imported on this kiosk.`);
      clearTimeout(loopRetry);
      loopRetry = undefined;
      loopFailures = 0;
      loop.clear();
      setSetupVisible(true);
      return;
    }
    // After failures, the setup screen stays up until the loop is seen playing.
    if (loopFailures === 0) setSetupVisible(false);
    if (loop.fileName !== name) loop.load(file, name);
    if (state.kind === 'loop') await resumeLoop();
  };

  const resumeLoop = async () => {
    feature.clear();
    featureEl.hidden = true;
    if (!loop.fileName) {
      setSetupVisible(true);
      return;
    }
    loopEl.hidden = false;
    try {
      await playWithFallback(loopEl, ctx.diagnostics);
    } catch (e) {
      if (!isAbort(e)) scheduleLoopRetry(`Loop video "${loop.fileName}" failed to play:`, e);
    }
  };

  const playFeature = async (fileName: string) => {
    // The watchdog may give up on this video and a new scan start another one
    // while we wait; only the run that still owns the state may act.
    const started = state;
    const file = await ctx.videos.getFile(fileName).catch((e) => (log.error(`Reading "${fileName}" failed:`, e), null));
    if (disposed || state !== started) return;
    if (!file) {
      log.warn(`Video "${fileName}" disappeared from storage.`);
      dispatch({ type: 'featureFailed' });
      return;
    }
    loopEl.pause();
    loopEl.hidden = true;
    setupEl.hidden = true;
    feature.load(file, fileName);
    featureEl.hidden = false;
    try {
      await playWithFallback(featureEl, ctx.diagnostics);
    } catch (e) {
      if (isAbort(e) || state !== started) return;
      log.error(`Video "${fileName}" failed to play:`, e);
      dispatch({ type: 'featureFailed' });
      return;
    }
    ctx.playCounts.increment(fileName);
  };

  const run = (effect: KioskEffect) => {
    switch (effect.type) {
      case 'playFeature':
        void playFeature(effect.fileName);
        break;
      case 'resumeLoop':
        void resumeLoop();
        break;
      case 'openSettings':
        ctx.navigate('settings');
        break;
      case 'warn':
        log.warn(effect.message);
        break;
    }
  };

  const dispatch = (event: KioskEvent) => {
    if (disposed) return;
    if (event.type === 'featureFailed' && state.kind === 'feature') ctx.diagnostics.recordPlaybackFailure('feature');
    const next = transition(state, event, {
      config: ctx.config.get(),
      hasFile: (n) => ctx.videos.has(n),
      cardKey: ctx.scanner.cardKey,
      interruptible: readInterruptPlayback(),
    });
    // A new state object is a new video, including one that interrupted another.
    if (next.state !== state) watch.reset(performance.now());
    state = next.state;
    view.dataset.state = state.kind;
    next.effects.forEach(run);
  };

  featureEl.addEventListener('ended', () => dispatch({ type: 'featureEnded' }));
  featureEl.addEventListener('error', () => {
    if (!feature.fileName) return; // error from clearing the source
    log.error(`Video "${feature.fileName}" failed:`, featureEl.error?.message ?? 'media error');
    dispatch({ type: 'featureFailed' });
  });
  loopEl.addEventListener('error', () => {
    if (!loop.fileName) return;
    scheduleLoopRetry(`Loop video "${loop.fileName}" failed:`, loopEl.error?.message || 'media error');
  });

  /** Catches playback that stops without an `ended` or `error` event. */
  const checkPlayback = () => {
    const now = performance.now();
    // Chrome pauses muted video in a hidden page; that isn't a stall.
    if (document.hidden) return watch.reset(now);
    if (state.kind === 'feature') {
      if (watch.sample(featureEl.currentTime, now) === 'stalled') {
        log.error(`Video "${state.fileName}" stopped playing; returning to the loop.`);
        dispatch({ type: 'featureFailed' });
      }
      return;
    }
    if (!loop.fileName || loopRetry !== undefined) return watch.reset(now);
    const status = watch.sample(loopEl.currentTime, now);
    if (status === 'progress' && loopFailures > 0) {
      loopFailures = 0;
      setSetupVisible(false);
    } else if (status === 'stalled') {
      scheduleLoopRetry(`Loop video "${loop.fileName}" stopped playing.`);
    }
  };
  const watchdog = setInterval(checkPlayback, WATCHDOG_INTERVAL_MS);

  // A reader in keyboard mode types into whichever window has focus. When that
  // stops being us, every scan is lost, so say so on screen (a tap brings focus
  // back) and record it for Diagnostics. Scans from the bridge app don't need focus.
  let focusLost = !document.hasFocus();
  const updateFocusNotice = () => {
    const shown = focusLost && ctx.scanner.mode === 'keyboard';
    focusEl.hidden = !shown;
    view.classList.toggle('unfocused', shown);
  };
  const onBlur = () => {
    focusLost = true;
    if (ctx.scanner.mode === 'keyboard') log.warn('The kiosk window lost keyboard focus. Tag scans are missed until the kiosk is clicked.');
    updateFocusNotice();
  };
  const onFocus = () => {
    focusLost = false;
    updateFocusNotice();
  };
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);

  // In bridge mode there is no fallback: if the bridge app or the reader is
  // missing, cards can't play, so say so instead of silently ignoring taps.
  const updateBridgeNotice = () => {
    const status = ctx.scanner.bridgeStatus;
    const problem =
      ctx.scanner.mode !== 'bridge' || ctx.scanner.bridgeReady || status.state === 'off' || status.state === 'connecting'
        ? null
        : status.state === 'connected'
          ? 'Plug in the NFC reader.'
          : status.state === 'protocol-mismatch'
            ? 'The bridge app needs updating.'
            : 'Start the NFC Browser Bridge app on this computer.';
    bridgeEl.hidden = problem === null;
    bridgeEl.querySelector('[data-testid="bridge-notice-detail"]')!.textContent = problem ?? '';
  };
  const onReaderChange = () => {
    updateFocusNotice();
    updateBridgeNotice();
  };
  onReaderChange();

  const blockContextMenu = (e: Event) => e.preventDefault();
  view.addEventListener('contextmenu', blockContextMenu);
  const stopFullscreen = keepFullscreen();
  const stopWakeLock = keepScreenOn();
  const stopShortcutHint = showShortcutHintOnMouseMove(view);

  const unsubscribers = [
    ctx.scanner.scans.subscribe((scan) => dispatch({ type: 'scan', card: scan })),
    ctx.scanner.changed.subscribe(onReaderChange),
    ctx.config.changed.subscribe(() => void startLoop()),
    ctx.videos.changed.subscribe(() => {
      if (!loop.fileName || !ctx.videos.has(loop.fileName)) void startLoop();
    }),
  ];

  void startLoop();

  return () => {
    disposed = true;
    clearInterval(watchdog);
    clearTimeout(loopRetry);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('focus', onFocus);
    stopWakeLock();
    stopFullscreen();
    stopShortcutHint();
    unsubscribers.forEach((u) => u());
    loop.clear();
    feature.clear();
    view.remove();
  };
}
