import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Options = {
  onNeedRefresh?: () => void;
  onRegisteredSW?: (url: string, registration: ServiceWorkerRegistration | undefined) => void;
};
let options: Options = {};
const updateSW = vi.fn(async () => {});
vi.mock('virtual:pwa-register', () => ({
  registerSW: (o: Options) => {
    options = o;
    return updateSW;
  },
}));

const { ServiceWorkerManager, LAUNCH_UPDATE_WINDOW_MS } = await import('../../src/pwa/sw');

/** A registration whose update() check finds nothing new unless the test says otherwise. */
function registration(update: () => Promise<unknown> = async () => {}): { update: () => Promise<unknown>; installing: null; waiting: unknown } {
  return { update, installing: null, waiting: null };
}

/** Lets the launch check's promises settle. */
const settle = () => new Promise((r) => setTimeout(r, 0));

function launch(reg: ReturnType<typeof registration> | undefined) {
  const sw = new ServiceWorkerManager();
  sw.start();
  options.onRegisteredSW?.('sw.js', reg as unknown as ServiceWorkerRegistration | undefined);
  return sw;
}

beforeEach(() => {
  vi.stubGlobal('navigator', { serviceWorker: { addEventListener: () => {} } });
  updateSW.mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('ServiceWorkerManager updates', () => {
  it('switches to a new version found while launching', async () => {
    const sw = launch(registration(() => new Promise(() => {}))); // check still running
    options.onNeedRefresh?.();
    expect(updateSW).toHaveBeenCalledTimes(1);
    expect(updateSW).toHaveBeenCalledWith(true);
    expect(sw.get().needRefresh).toBe(false);
  });

  it('switches when the launch check leaves a waiting worker behind', async () => {
    const reg = registration();
    reg.update = async () => void Object.assign(reg, { waiting: {} });
    launch(reg);
    await vi.waitFor(() => expect(updateSW).toHaveBeenCalledWith(true));
  });

  it('only offers a version found after the launch check', async () => {
    const sw = launch(registration());
    await settle();
    options.onNeedRefresh?.();
    expect(updateSW).not.toHaveBeenCalled();
    expect(sw.get().needRefresh).toBe(true);
  });

  it('keeps running the cached version when offline at launch, and only offers later versions', async () => {
    const sw = launch(registration(() => Promise.reject(new TypeError('offline'))));
    await settle();
    options.onNeedRefresh?.();
    expect(sw.get().needRefresh).toBe(true);
    expect(updateSW).not.toHaveBeenCalled();
  });

  it('stops applying updates once the launch window has passed', () => {
    vi.useFakeTimers();
    const sw = launch(registration(() => new Promise(() => {}))); // check never finishes
    vi.advanceTimersByTime(LAUNCH_UPDATE_WINDOW_MS);
    options.onNeedRefresh?.();
    expect(updateSW).not.toHaveBeenCalled();
    expect(sw.get().needRefresh).toBe(true);
  });
});
