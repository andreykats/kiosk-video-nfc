import type { AppContext } from '../app/context';
import { errorMessage, log } from '../app/log';
import { clearFlags } from '../onboarding/progress';
import { confirmDialog, messageDialog } from '../ui/dialog';
import { h } from '../ui/dom';
import { formatBytes } from '../videos/opfsStore';
import type { Section } from './section';

/**
 * Wipes this kiosk back to first launch: videos, config and setup-guide
 * progress. The app itself stays installed and cached for offline use.
 */
async function resetKiosk(ctx: AppContext): Promise<void> {
  const config = ctx.config.get();
  const files = ctx.videos.files();
  const bytes = [...files.values()].reduce((sum, size) => sum + size, 0);
  const ok = await confirmDialog({
    title: 'Reset this kiosk?',
    content: [
      h(
        'p',
        {},
        `This deletes all ${files.size} video file(s) (${formatBytes(bytes)}) from this kiosk, and the config: ${config.videos.length} video(s), ${config.cards.length} card(s) and ${config.adminCards.length} admin card(s).`,
      ),
      h('p', {}, 'The setup guide then starts again from step 1. This can’t be undone. Export the config first if you want to keep it.'),
    ],
    confirmLabel: 'Reset everything',
    danger: true,
  });
  if (!ok) return;

  try {
    await ctx.videos.clear();
    await ctx.config.clear();
  } catch (e) {
    log.error('Reset failed:', e);
    await messageDialog('Reset didn’t finish', ['Some data could not be deleted. Try again.', errorMessage(e)]);
    return;
  }
  clearFlags();
  log.info('Kiosk reset to first launch.');
  ctx.navigate('setup');
}

export function renderResetSection(ctx: AppContext): Section {
  const el = h(
    'section',
    { class: 'danger-zone', 'data-testid': 'reset-section' },
    h('h2', {}, 'Reset'),
    h('p', { class: 'hint' }, 'Remove all videos, cards, admin cards and settings from this kiosk, and start the setup guide again.'),
    h('button', { type: 'button', class: 'danger', 'data-testid': 'reset-kiosk', onclick: () => void resetKiosk(ctx) }, 'Reset configuration'),
  );
  return { el, destroy: () => undefined };
}
