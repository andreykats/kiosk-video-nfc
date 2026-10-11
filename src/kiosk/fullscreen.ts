/**
 * Desktop Chrome ignores the manifest's `display: fullscreen` and opens the
 * installed app in a window with Chrome's own title bar, which a page can't
 * hide. The Fullscreen API does hide it, but Chrome only allows it after a click
 * or key press (a card scan counts), unless the AutomaticFullscreenAllowedForUrls
 * policy lists this site. So: try straight away, then again on every
 * interaction until it sticks.
 */
export function keepFullscreen(target: Window = window): () => void {
  const enter = () => {
    if (!document.fullscreenEnabled || document.fullscreenElement) return;
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
      // No user gesture yet and no policy: retried on the next interaction.
    });
  };
  enter();
  const options = { capture: true, passive: true } as const;
  target.addEventListener('pointerdown', enter, options);
  target.addEventListener('keydown', enter, options);
  return () => {
    target.removeEventListener('pointerdown', enter, options);
    target.removeEventListener('keydown', enter, options);
  };
}
