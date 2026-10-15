import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../src/app/log';
import { keepScreenOn } from '../../src/kiosk/wakeLock';

const RETRY_MS = 60_000;

class FakeSentinel extends EventTarget {
  released = false;
  readonly type = 'screen';
  onrelease = null;
  async release(): Promise<void> {
    this.drop();
  }
  /** What the system does when it takes the lock away. */
  drop(): void {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  }
}

function setup() {
  const sentinels: FakeSentinel[] = [];
  let refuse = false;
  const wakeLock = {
    request: vi.fn(async () => {
      if (refuse) throw new DOMException('Power saving', 'NotAllowedError');
      const s = new FakeSentinel();
      sentinels.push(s);
      return s as unknown as WakeLockSentinel;
    }),
  };
  const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' as DocumentVisibilityState });
  const setVisible = (visible: boolean) => {
    doc.visibilityState = visible ? 'visible' : 'hidden';
    if (!visible) sentinels.forEach((s) => s.drop()); // Chrome drops the lock when the page is hidden.
    doc.dispatchEvent(new Event('visibilitychange'));
  };
  const stop = keepScreenOn({ wakeLock, doc, retryMs: RETRY_MS });
  return {
    wakeLock,
    sentinels,
    stop,
    setVisible,
    refuse: (on: boolean) => (refuse = on),
    current: () => sentinels.at(-1)!,
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('keepScreenOn', () => {
  let warn: ReturnType<typeof vi.spyOn>;
  let info: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers();
    warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    info = vi.spyOn(log, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('asks again at once when the system takes the lock away, and logs the recovery once it lasts', async () => {
    const k = setup();
    await flush();
    expect(k.wakeLock.request).toHaveBeenCalledTimes(1);

    k.current().drop();
    await flush();
    expect(k.wakeLock.request).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(info).toHaveBeenCalledWith('The screen is kept awake again.');
    expect(k.wakeLock.request).toHaveBeenCalledTimes(2);
  });

  it('retries a refused lock every minute, warning only once', async () => {
    const k = setup();
    await flush();
    k.refuse(true);
    k.current().drop();
    await flush();
    expect(k.wakeLock.request).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    expect(k.wakeLock.request).toHaveBeenCalledTimes(5);
    expect(warn).toHaveBeenCalledTimes(1);

    k.refuse(false);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(k.wakeLock.request).toHaveBeenCalledTimes(6);
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(info).toHaveBeenCalledTimes(1);
    expect(k.wakeLock.request).toHaveBeenCalledTimes(6);
  });

  it('a lock taken away right after each grant is asked for at most once a minute', async () => {
    const k = setup();
    await flush();
    k.current().drop();
    await flush();
    expect(k.wakeLock.request).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 3; i++) {
      k.current().drop();
      await vi.advanceTimersByTimeAsync(RETRY_MS - 1);
      const before = k.wakeLock.request.mock.calls.length;
      await vi.advanceTimersByTimeAsync(1);
      expect(k.wakeLock.request.mock.calls.length).toBe(before + 1);
    }
    expect(warn).toHaveBeenCalledTimes(1);
    expect(info).not.toHaveBeenCalled();
  });

  it('losing the lock while hidden is expected: no warning, and it is asked for again when visible', async () => {
    const k = setup();
    await flush();
    k.setVisible(false);
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2);
    expect(k.wakeLock.request).toHaveBeenCalledTimes(1);
    k.setVisible(true);
    await flush();
    expect(k.wakeLock.request).toHaveBeenCalledTimes(2);
    expect(warn).not.toHaveBeenCalled();
  });

  it('stopping releases the lock and stops asking', async () => {
    const k = setup();
    await flush();
    k.refuse(true);
    k.current().drop();
    await flush();
    k.stop();
    expect(k.sentinels.every((s) => s.released)).toBe(true);
    const calls = k.wakeLock.request.mock.calls.length;
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);
    k.setVisible(true);
    await flush();
    expect(k.wakeLock.request).toHaveBeenCalledTimes(calls);
  });

  it('does nothing where the API is missing', () => {
    expect(() => keepScreenOn({ wakeLock: null })()).not.toThrow();
  });
});
