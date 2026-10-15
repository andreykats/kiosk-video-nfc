/** Setup-guide flags that can't be derived from the kiosk's state. */
export interface OnboardingFlags {
  /** The user pressed Get started on the welcome step. */
  welcomeDone: boolean;
  readerDone: boolean;
  completed: boolean;
}

const KEY = 'kiosk.onboarding';
const DEFAULTS: OnboardingFlags = { welcomeDone: false, readerDone: false, completed: false };

export function readFlags(): OnboardingFlags {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS };
    const r = raw as Record<string, unknown>;
    return {
      // installStepDone is the flag's name from when step 1 was the install step.
      welcomeDone: r.welcomeDone === true || r.installStepDone === true,
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

/** Forgets all setup-guide progress, so the guide starts again at step 1. */
export function clearFlags(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Storage disabled: nothing was saved.
  }
}
