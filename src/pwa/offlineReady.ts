import type { Config } from '../config/schema';

export type ConditionStatus = 'pass' | 'fail' | 'warn';

export interface ReadinessCondition {
  id: 'appCached' | 'config' | 'loopVideo' | 'pairedVideos' | 'persisted';
  label: string;
  status: ConditionStatus;
  /** What is wrong and how to fix it; absent when passing. */
  detail?: string;
}

export interface ReadinessInputs {
  appCached: { ok: boolean; error?: string };
  /** Valid config loaded from IndexedDB; null if none or invalid. */
  config: Config | null;
  configError?: string;
  presentFiles: ReadonlySet<string>;
  persisted: boolean | null;
}

export interface Readiness {
  ready: boolean;
  conditions: ReadinessCondition[];
}

/** Pure "Ready to work offline" check (PLAN §9.3). Never cached: recompute each time. */
export function computeOfflineReadiness(inputs: ReadinessInputs): Readiness {
  const { config, presentFiles } = inputs;
  const conditions: ReadinessCondition[] = [];

  conditions.push(
    inputs.appCached.ok
      ? { id: 'appCached', label: 'App cached', status: 'pass' }
      : {
          id: 'appCached',
          label: 'App cached',
          status: 'fail',
          detail: inputs.appCached.error ?? 'The app is not cached for offline use yet. Stay online and reload the page.',
        },
  );

  conditions.push(
    config
      ? { id: 'config', label: 'Config present', status: 'pass' }
      : {
          id: 'config',
          label: 'Config present',
          status: 'fail',
          detail: inputs.configError ?? 'No config. Use "Update from published config".',
        },
  );

  if (!config?.loopVideo) {
    conditions.push({ id: 'loopVideo', label: 'Loop video present', status: 'fail', detail: 'No loop video selected. Pick one in Videos.' });
  } else if (!presentFiles.has(config.loopVideo)) {
    conditions.push({
      id: 'loopVideo',
      label: 'Loop video present',
      status: 'fail',
      detail: `Loop video missing: ${config.loopVideo} → Import folder`,
    });
  } else {
    conditions.push({ id: 'loopVideo', label: 'Loop video present', status: 'pass' });
  }

  const paired = [...new Set((config?.cards ?? []).map((c) => c.fileName))];
  const missing = paired.filter((name) => !presentFiles.has(name)).sort();
  conditions.push(
    missing.length === 0
      ? { id: 'pairedVideos', label: 'All paired videos present', status: 'pass' }
      : {
          id: 'pairedVideos',
          label: 'All paired videos present',
          status: 'fail',
          detail: `Missing videos: ${missing.join(', ')} → Import folder`,
        },
  );

  conditions.push(
    inputs.persisted
      ? { id: 'persisted', label: 'Storage persisted', status: 'pass' }
      : {
          id: 'persisted',
          label: 'Storage persisted',
          status: 'warn',
          detail: 'Storage is not persistent, so Chrome may clear videos when the disk is full.',
        },
  );

  return { ready: conditions.every((c) => c.status !== 'fail'), conditions };
}

/** Condition 1: an activated worker means Workbox finished precaching the shell. */
export async function checkAppCached(swError: string | null): Promise<ReadinessInputs['appCached']> {
  if (swError) return { ok: false, error: `Service worker failed to register: ${swError}` };
  if (!('serviceWorker' in navigator)) return { ok: false, error: 'Service workers are not supported in this browser.' };
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.active?.state !== 'activated') {
      return { ok: false, error: 'The app is still being cached for offline use. Stay online and wait a moment.' };
    }
    // Workbox keys precache entries with a __WB_REVISION__ query, hence ignoreSearch.
    const index = await caches.match(`${import.meta.env.BASE_URL}index.html`, { ignoreSearch: true });
    // Reloading doesn't help: an installed worker never downloads its files again. Its successor does.
    if (!index) return { ok: false, error: 'The offline copy of the app is missing files. Stay online: the next app update downloads it again.' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: `Could not check the offline cache: ${e instanceof Error ? e.message : String(e)}` };
  }
}
