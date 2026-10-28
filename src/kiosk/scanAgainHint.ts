import { h } from '../ui/dom';

/** How long the message stays up after the last tap that couldn't be read. */
export const SCAN_AGAIN_MS = 2_500;

export interface ScanAgainHint {
  /** Shows the message, or keeps it up for another SCAN_AGAIN_MS if it already is. */
  show(): void;
  hide(): void;
  dispose(): void;
}

/**
 * A tap the reader only partly read plays nothing, so the visitor is asked to
 * try again. It sits over whatever is playing without stopping it.
 */
export function scanAgainHint(view: HTMLElement): ScanAgainHint {
  const el = h('div', { class: 'scan-again-hint', 'data-testid': 'scan-again-hint', role: 'status' }, 'Couldn’t read the tag. Please scan again.');
  view.append(el);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const hide = () => {
    clearTimeout(timer);
    el.classList.remove('shown');
  };
  return {
    show() {
      el.classList.add('shown');
      clearTimeout(timer);
      timer = setTimeout(hide, SCAN_AGAIN_MS);
    },
    hide,
    dispose() {
      clearTimeout(timer);
      el.remove();
    },
  };
}
