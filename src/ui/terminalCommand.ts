import { h } from './dom';

/** A Copy command button and the command itself, for pasting into a terminal. */
export function copyableCommand(command: string, testId: string): HTMLElement[] {
  const copy = h('button', { type: 'button', 'data-testid': `${testId}-copy` }, 'Copy command');
  copy.addEventListener('click', () => {
    navigator.clipboard.writeText(command).then(
      () => (copy.textContent = 'Copied ✓'),
      () => (copy.textContent = 'Couldn’t copy: select the command below and copy it'),
    );
  });
  return [copy, h('p', { class: 'mono command', 'data-testid': `${testId}-command` }, command)];
}

/** Absolute URL of a script served with the app (public/). */
export const scriptUrl = (script: string) => new URL(`${import.meta.env.BASE_URL}${script}`, location.href).href;

export const OPEN_TERMINAL = 'Open Terminal: press ⌘ Space, type Terminal, then press Return.';
