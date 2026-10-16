/**
 * Set once a person has opened the kiosk from settings or the setup guide. Until
 * then, interactions don't go fullscreen: on a fresh page load the first key
 * press is often the settings shortcut or an admin tag, and settings shouldn't
 * open fullscreen.
 */
let wanted = false;

function enter(): void {
  if (!document.fullscreenEnabled || document.fullscreenElement) return;
  document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
    // No user gesture and no policy: retried on the next interaction.
  });
}

/**
 * Call from the click or key press that opens the kiosk (← Back to kiosk, Start
 * kiosk, an admin tag in settings): Chrome only allows fullscreen during one.
 */
export function startFullscreen(): void {
  wanted = true;
  enter();
}

/**
 * Desktop Chrome ignores the manifest's `display: fullscreen` and opens the
 * installed app in a window with Chrome's own title bar, which a page can't
 * hide. The Fullscreen API does hide it, but Chrome only allows it after a click
 * or key press (a card scan counts), unless the AutomaticFullscreenAllowedForUrls
 * policy lists this site. So: try straight away (enough with the policy), then,
 * once startFullscreen() has been called, again on every interaction until it sticks.
 */
export function keepFullscreen(target: Window = window): () => void {
  enter();
  if (!wanted) return () => undefined;
  const options = { capture: true, passive: true } as const;
  target.addEventListener('pointerdown', enter, options);
  target.addEventListener('keydown', enter, options);
  return () => {
    target.removeEventListener('pointerdown', enter, options);
    target.removeEventListener('keydown', enter, options);
  };
}
