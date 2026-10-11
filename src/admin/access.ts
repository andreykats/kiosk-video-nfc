/**
 * Ctrl+Shift+S opens settings from any view (Control, not Cmd, on a Mac).
 * Chrome has no shortcut of its own on this combination on Windows or macOS.
 */
export function isSettingsShortcut(e: KeyboardEvent): boolean {
  return e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyS';
}

export const SETTINGS_IDLE_MS = 3 * 60 * 1000;

const ACTIVITY_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'input', 'change'] as const;

/**
 * Calls onIdle after `ms` without user activity. `hold()` pauses the timer while
 * long work (a multi-GB import) is running, so settings doesn't close under it.
 */
export class IdleTimer {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private holds = 0;

  constructor(
    private readonly ms: number,
    private readonly onIdle: () => void,
    private readonly target: EventTarget = window,
  ) {
    for (const type of ACTIVITY_EVENTS) target.addEventListener(type, this.reset, { capture: true, passive: true });
    this.reset();
  }

  hold(): () => void {
    this.holds++;
    clearTimeout(this.timer);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.holds--;
      this.reset();
    };
  }

  destroy(): void {
    clearTimeout(this.timer);
    for (const type of ACTIVITY_EVENTS) this.target.removeEventListener(type, this.reset, { capture: true });
  }

  private readonly reset = (): void => {
    clearTimeout(this.timer);
    if (this.holds === 0) this.timer = setTimeout(this.onIdle, this.ms);
  };
}
