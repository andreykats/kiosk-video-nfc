export interface Section {
  el: HTMLElement;
  destroy(): void;
}

/** Re-renders `render()` into `el` now and whenever any subscribed source fires. */
export function reactiveSection(
  el: HTMLElement,
  render: () => void,
  subscribe: ((listener: () => void) => () => void)[],
): Section {
  render();
  const unsubscribers = subscribe.map((s) => s(render));
  return { el, destroy: () => unsubscribers.forEach((u) => u()) };
}
