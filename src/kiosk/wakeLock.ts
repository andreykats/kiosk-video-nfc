import { log } from '../app/log';

/**
 * Keeps the display awake while the kiosk view is shown. Chrome doesn't hold the
 * screen on for muted videos or ones without an audio track, and the OS sleep
 * setting is easy to get wrong. The lock is dropped whenever the page is hidden,
 * so it is requested again each time the page becomes visible.
 */
export function keepScreenOn(): () => void {
  if (!('wakeLock' in navigator)) return () => undefined;
  let sentinel: WakeLockSentinel | null = null;
  let stopped = false;

  const acquire = async () => {
    if (stopped || document.visibilityState !== 'visible' || (sentinel && !sentinel.released)) return;
    try {
      const lock = await navigator.wakeLock.request('screen');
      if (stopped) void lock.release();
      else sentinel = lock;
    } catch (e) {
      log.warn('Could not keep the screen awake:', e);
    }
  };

  const onVisibility = () => void acquire();
  document.addEventListener('visibilitychange', onVisibility);
  void acquire();
  return () => {
    stopped = true;
    document.removeEventListener('visibilitychange', onVisibility);
    void sentinel?.release().catch(() => undefined);
    sentinel = null;
  };
}
