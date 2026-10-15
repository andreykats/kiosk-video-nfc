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
 * Resolves true once the kiosk was reset, false if cancelled or it failed;
 * the caller then opens the setup guide at step 1.
 */
export async function resetKiosk(ctx: AppContext): Promise<boolean> {
  const config = ctx.config.get();
  const files = ctx.videos.files();
  const bytes = [...files.values()].reduce((sum, size) => sum + size, 0);
  const ok = await confirmDialog({
    title: 'Reset this kiosk?',
    content: [
      h(
        'p',
        {},
        `This deletes all ${files.size} video file(s) (${formatBytes(bytes)}) from this kiosk, their play counts, the event log, and the config: ${config.videos.length} video(s), ${config.cards.length} tag(s) and ${config.adminCards.length} admin tag(s).`,
      ),
      h('p', {}, 'The setup guide then starts again from step 1. This can’t be undone. Export the config first if you want to keep it.'),
    ],
    confirmLabel: 'Reset everything',
    danger: true,
  });
  if (!ok) return false;

  try {
    await ctx.videos.clear();
    await ctx.config.clear();
    ctx.playCounts.clear();
  } catch (e) {
    log.error('Reset failed:', e);
    await messageDialog('Reset didn’t finish', ['Some data could not be deleted. Try again.', errorMessage(e)]);
    return false;
  }
  clearFlags();
  log.clear();
  log.info('Kiosk reset to first launch.');
  return true;
}

export function renderResetSection(ctx: AppContext): Section {
  const el = h(
    'section',
    { class: 'danger-zone', 'data-testid': 'reset-section' },
    h('h2', {}, 'Reset'),
    h('p', { class: 'hint' }, 'Remove all videos, tags, admin tags and settings from this kiosk, and start the setup guide again.'),
    h('button', { type: 'button', class: 'danger', 'data-testid': 'reset-kiosk', onclick: async () => { if (await resetKiosk(ctx)) ctx.navigate('setup'); } }, 'Reset configuration'),
  );
  return { el, destroy: () => undefined };
}
