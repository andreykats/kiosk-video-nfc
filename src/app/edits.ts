import type { Config } from '../config/schema';
import { messageDialog } from '../ui/dialog';
import type { AppContext } from './context';
import { errorMessage, log } from './log';

/** Saves a config edit, reporting failures instead of leaving a half-applied UI. */
export async function saveEdit(ctx: AppContext, edit: (config: Config) => Config): Promise<boolean> {
  try {
    await ctx.config.update(edit);
    return true;
  } catch (e) {
    log.error('Saving config failed:', e);
    await messageDialog('Could not save', [errorMessage(e)]);
    return false;
  }
}
