import { log } from '../app/log';

/** How long to wait before asking again after the lock was refused or taken away. */
const RETRY_MS = 60_000;

export interface WakeLockDeps {
  wakeLock?: Pick<WakeLock, 'request'> | null;
  doc?: Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>;
  retryMs?: number;
}

/**
 * Keeps the display awake while the kiosk view is shown. Chrome doesn't hold the
 * screen on for muted videos or ones without an audio track, and the OS sleep
 * setting is easy to get wrong.
 *
 * The lock is dropped whenever the page is hidden, so it is requested again
 * each time the page becomes visible. The system can also refuse it or take it
 * away while the page is showing (low battery, power saving); then it is asked
 * for again right away once, and after that every RETRY_MS, logging only the
 * first failure and the recovery so a power-saving laptop can't flood the log.
 */
export function keepScreenOn(deps: WakeLockDeps = {}): () => void {
  const wakeLock = deps.wakeLock !== undefined ? deps.wakeLock : 'wakeLock' in navigator ? navigator.wakeLock : null;
  if (!wakeLock) return () => undefined;
  const doc = deps.doc ?? document;
  const retryMs = deps.retryMs ?? RETRY_MS;

  let sentinel: WakeLockSentinel | null = null;
  let requesting = false;
  let stopped = false;
  /** The lock was refused or taken away while visible, and hasn't been held for RETRY_MS since. */
  let failing = false;
  /** Either the next retry, or (while failing) the check that a new lock has lasted. */
  let timer: ReturnType<typeof setTimeout> | undefined;

  const visible = () => doc.visibilityState === 'visible';
  const schedule = (fn: () => void) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      fn();
    }, retryMs);
  };

  const fail = (...reason: unknown[]) => {
    // Hidden pages lose the lock by design; becoming visible asks again.
    if (stopped || !visible()) return;
    if (!failing) log.warn('Could not keep the screen awake:', ...reason, `Retrying every ${Math.round(retryMs / 1000)} s.`);
    failing = true;
    schedule(() => void acquire());
  };

  const confirmHeld = () => {
    if (!failing || !sentinel || sentinel.released) return;
    failing = false;
    log.info('The screen is kept awake again.');
  };

  const acquire = async () => {
    if (stopped || requesting || !visible() || (sentinel && !sentinel.released)) return;
    requesting = true;
    let lock: WakeLockSentinel;
    try {
      lock = await wakeLock.request('screen');
    } catch (e) {
      fail(e);
      return;
    } finally {
      requesting = false;
    }
    if (stopped) {
      void lock.release().catch(() => undefined);
      return;
    }
    sentinel = lock;
    lock.addEventListener('release', () => {
      if (sentinel !== lock) return;
      sentinel = null;
      clearTimeout(timer);
      timer = undefined;
      if (stopped || !visible()) return;
      // Taken away while showing: try again at once the first time.
      const first = !failing;
      fail('the system released it.');
      if (first) void acquire();
    });
    if (failing) schedule(confirmHeld);
  };

  const onVisibility = () => {
    if (!visible()) return;
    clearTimeout(timer);
    timer = undefined;
    void acquire();
  };
  doc.addEventListener('visibilitychange', onVisibility);
  void acquire();
  return () => {
    stopped = true;
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', onVisibility);
    void sentinel?.release().catch(() => undefined);
    sentinel = null;
  };
}
