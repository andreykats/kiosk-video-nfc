import { h } from '../ui/dom';

/** How long the hint stays up after the mouse last moved. */
export const SHORTCUT_HINT_MS = 2_000;

/**
 * Like Chrome's "Press Esc to exit full screen": moving a mouse over the kiosk
 * briefly shows the settings shortcut, so staff don't have to remember it.
 * Touch doesn't show it: that's visitors tapping the screen.
 */
export function showShortcutHintOnMouseMove(view: HTMLElement): () => void {
  // On a Mac, "Ctrl" is easily read as Cmd, which doesn't work.
  const ctrl = navigator.platform.startsWith('Mac') ? 'Control' : 'Ctrl';
  const el = h(
    'div',
    { class: 'shortcut-hint', 'data-testid': 'shortcut-hint', role: 'status' },
    'Press ',
    h('kbd', {}, ctrl),
    ' + ',
    h('kbd', {}, 'Shift'),
    ' + ',
    h('kbd', {}, 'S'),
    ' to open settings',
  );
  view.append(el);

  let timer: ReturnType<typeof setTimeout> | undefined;
  /** Chrome also fires pointermove when the page changes under a still cursor (a video swap); only real movement counts. */
  let last: { x: number; y: number } | null = null;
  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    const moved = last !== null && (e.screenX !== last.x || e.screenY !== last.y);
    last = { x: e.screenX, y: e.screenY };
    if (!moved) return;
    el.classList.add('shown');
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove('shown'), SHORTCUT_HINT_MS);
  };
  view.addEventListener('pointermove', onMove, { passive: true });
  return () => {
    clearTimeout(timer);
    view.removeEventListener('pointermove', onMove);
    el.remove();
  };
}
