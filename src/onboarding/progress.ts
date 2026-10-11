/** Setup-guide flags that can't be derived from the kiosk's state. */
export interface OnboardingFlags {
  installSkipped: boolean;
  readerDone: boolean;
  completed: boolean;
}

const KEY = 'kiosk.onboarding';
const DEFAULTS: OnboardingFlags = { installSkipped: false, readerDone: false, completed: false };

export function readFlags(): OnboardingFlags {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS };
    const r = raw as Record<string, unknown>;
    return {
      installSkipped: r.installSkipped === true,
      readerDone: r.readerDone === true,
      completed: r.completed === true,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeFlags(patch: Partial<OnboardingFlags>): OnboardingFlags {
  const next = { ...readFlags(), ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Storage disabled: the guide simply restarts next load.
  }
  return next;
}
