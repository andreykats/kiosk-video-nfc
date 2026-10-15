import { resolveScan, type CardIdentity } from '../config/ops';
import { describeMatch, type CardMatch, type Config } from '../config/schema';

export type KioskState = { kind: 'loop' } | { kind: 'feature'; fileName: string };

export type KioskEvent =
  | { type: 'scan'; card: CardIdentity }
  | { type: 'featureEnded' }
  | { type: 'featureFailed' };

export type KioskEffect =
  | { type: 'playFeature'; fileName: string }
  | { type: 'resumeLoop' }
  | { type: 'openSettings' }
  | { type: 'warn'; message: string };

export interface KioskContext {
  config: Config;
  hasFile: (fileName: string) => boolean;
  /** What identifies video cards on this kiosk. */
  cardKey: CardMatch['kind'];
}

export interface Transition {
  state: KioskState;
  effects: KioskEffect[];
}

export const initialKioskState: KioskState = { kind: 'loop' };

/**
 * Pure playback state machine (PLAN §7). The settings shortcut is handled
 * globally in main.ts, since it applies to every view.
 */
export function transition(state: KioskState, event: KioskEvent, ctx: KioskContext): Transition {
  switch (event.type) {
    case 'featureEnded':
    case 'featureFailed':
      if (state.kind !== 'feature') return { state, effects: [] };
      return { state: { kind: 'loop' }, effects: [{ type: 'resumeLoop' }] };

    case 'scan': {
      const match = resolveScan(ctx.config, event.card, ctx.cardKey);
      // Admin cards open settings from any state.
      if (match?.kind === 'admin') return { state, effects: [{ type: 'openSettings' }] };
      if (state.kind === 'feature' || !match) return { state, effects: [] };
      const card = match.entry;
      if (!ctx.hasFile(card.fileName)) {
        return {
          state,
          effects: [{ type: 'warn', message: `Card with ${describeMatch(card.match)} is paired to "${card.fileName}", which is not imported on this kiosk.` }],
        };
      }
      return { state: { kind: 'feature', fileName: card.fileName }, effects: [{ type: 'playFeature', fileName: card.fileName }] };
    }
  }
}
