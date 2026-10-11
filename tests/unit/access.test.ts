import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IdleTimer, isSettingsShortcut } from '../../src/admin/access';

describe('isSettingsShortcut', () => {
  const key = (init: Partial<KeyboardEvent>) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, code: '', ...init }) as KeyboardEvent;

  it('matches Ctrl+Shift+S by physical key', () => {
    expect(isSettingsShortcut(key({ ctrlKey: true, shiftKey: true, code: 'KeyS' }))).toBe(true);
    // Extra modifiers are a different shortcut (Ctrl+Alt is AltGr on many layouts).
    expect(isSettingsShortcut(key({ ctrlKey: true, altKey: true, shiftKey: true, code: 'KeyS' }))).toBe(false);
    expect(isSettingsShortcut(key({ ctrlKey: true, code: 'KeyS' }))).toBe(false);
    expect(isSettingsShortcut(key({ ctrlKey: true, shiftKey: true, metaKey: true, code: 'KeyS' }))).toBe(false);
  });
});

describe('IdleTimer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('fires after the idle period and resets on activity', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    new IdleTimer(1000, onIdle, target);
    vi.advanceTimersByTime(900);
    target.dispatchEvent(new Event('pointerdown'));
    vi.advanceTimersByTime(900);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does not fire while held, and restarts the period on release', () => {
    const target = new EventTarget();
    const onIdle = vi.fn();
    const timer = new IdleTimer(1000, onIdle, target);
    const release = timer.hold();
    target.dispatchEvent(new Event('keydown'));
    vi.advanceTimersByTime(5000);
    expect(onIdle).not.toHaveBeenCalled();
    release();
    release(); // idempotent
    vi.advanceTimersByTime(999);
    expect(onIdle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });
});
