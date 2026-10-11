import type { AppContext } from '../app/context';
import type { Diagnostics } from '../app/diagnostics';
import { log } from '../app/log';
import { h } from '../ui/dom';
import { keepFullscreen } from './fullscreen';
import { initialKioskState, transition, type KioskEffect, type KioskEvent, type KioskState } from './stateMachine';

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
  const view = h('div', { class: 'kiosk', 'data-testid': 'kiosk', 'data-state': 'loop' }, loopEl, featureEl, setupEl);
  root.replaceChildren(view);

  const loop = new VideoSlot(loopEl);
  const feature = new VideoSlot(featureEl);
  let state: KioskState = initialKioskState;
  let disposed = false;

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
        h('p', { class: 'hint' }, 'Run the setup guide to add videos and pair cards, or open settings. You can also press Ctrl+Shift+S or hold an admin card on the reader.'),
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

  /** (Re)loads the loop video from the current config, or shows the setup screen. */
  const startLoop = async () => {
    const name = ctx.config.get().loopVideo;
    const file = name ? await ctx.videos.getFile(name).catch((e) => (log.error('Reading loop video failed:', e), null)) : null;
    if (disposed) return;
    if (!name || !file) {
      if (name) log.warn(`Loop video "${name}" is not imported on this kiosk.`);
      loop.clear();
      setSetupVisible(true);
      return;
    }
    setSetupVisible(false);
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
      if (!isAbort(e)) log.error('Loop video failed to play:', e);
    }
  };

  const playFeature = async (fileName: string) => {
    const file = await ctx.videos.getFile(fileName).catch((e) => (log.error(`Reading "${fileName}" failed:`, e), null));
    if (disposed || state.kind !== 'feature') return;
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
      if (isAbort(e)) return;
      log.error(`Video "${fileName}" failed to play:`, e);
      dispatch({ type: 'featureFailed' });
    }
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
    const next = transition(state, event, { config: ctx.config.get(), hasFile: (n) => ctx.videos.has(n) });
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
    log.error(`Loop video "${loop.fileName}" failed:`, loopEl.error?.message ?? 'media error');
    loop.clear();
    if (state.kind === 'loop') setSetupVisible(true);
  });

  const blockContextMenu = (e: Event) => e.preventDefault();
  view.addEventListener('contextmenu', blockContextMenu);
  const stopFullscreen = keepFullscreen();

  const unsubscribers = [
    ctx.scanner.scans.subscribe((scan) => dispatch({ type: 'scan', uid: scan.uid })),
    ctx.config.changed.subscribe(() => void startLoop()),
    ctx.videos.changed.subscribe(() => {
      if (!loop.fileName || !ctx.videos.has(loop.fileName)) void startLoop();
    }),
  ];

  void startLoop();

  return () => {
    disposed = true;
    stopFullscreen();
    unsubscribers.forEach((u) => u());
    loop.clear();
    feature.clear();
    view.remove();
  };
}
