import { errorMessage } from '../app/log';
import { err, type Result } from '../result';
import { validateConfig, type Config } from './schema';

/** Largest config file we'll parse; real configs are a few KB. */
const MAX_CONFIG_BYTES = 5 * 1024 * 1024;

export function serializeForExport(config: Config, now: Date = new Date()): string {
  return `${JSON.stringify({ ...config, updatedAt: now.toISOString() }, null, 2)}\n`;
}

export function downloadConfig(config: Config): void {
  const blob = new Blob([serializeForExport(config)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'config.json';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function parseConfigText(text: string): Result<Config, string[]> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    return err([`Not valid JSON: ${errorMessage(e)}`]);
  }
  return validateConfig(json);
}

export function publishedConfigUrl(): string {
  return `${import.meta.env.BASE_URL}config.json`;
}

export async function fetchPublishedConfig(
  fetchFn: typeof fetch = fetch,
  url: string = publishedConfigUrl(),
): Promise<Result<Config, string[]>> {
  let response: Response;
  try {
    response = await fetchFn(url, { cache: 'no-store' });
  } catch (e) {
    const offline = typeof navigator !== 'undefined' && !navigator.onLine;
    return err([
      offline
        ? 'You are offline. Connect to the internet, or use "Import config from file".'
        : `Could not download the published config: ${errorMessage(e)}`,
    ]);
  }
  if (!response.ok) {
    return err([`Could not download the published config: HTTP ${response.status} ${response.statusText}`.trim()]);
  }
  const text = await response.text();
  if (text.length > MAX_CONFIG_BYTES) return err(['The published config is too large to be a valid config.']);
  return parseConfigText(text);
}

export async function readConfigFile(file: File): Promise<Result<Config, string[]>> {
  if (file.size > MAX_CONFIG_BYTES) return err([`"${file.name}" is too large to be a config file.`]);
  let text: string;
  try {
    text = await file.text();
  } catch (e) {
    return err([`Could not read "${file.name}": ${errorMessage(e)}`]);
  }
  return parseConfigText(text);
}

export interface ConfigSummary {
  updatedAt: string | null;
  videos: number;
  cards: number;
  adminCards: number;
  loopVideo: string | null;
  /** Videos in the config that this kiosk hasn't imported yet. */
  missingLocally: string[];
}

export function summarizeConfig(config: Config, presentFiles: ReadonlySet<string>): ConfigSummary {
  return {
    updatedAt: config.updatedAt,
    videos: config.videos.length,
    cards: config.cards.length,
    adminCards: config.adminCards.length,
    loopVideo: config.loopVideo,
    missingLocally: config.videos.map((v) => v.fileName).filter((n) => !presentFiles.has(n)),
  };
}
