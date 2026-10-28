import { formatLog, safeLocalStorage, type LogEntry } from './log';

/**
 * "Upload log" in settings → Diagnostics sends the event log to Cloud Storage in the "Logs"
 * Firebase project, into a new folder per upload: `kiosk-video-nfc/<upload ID>/<UTC time>_v<version>/kiosk.log`.
 * The bucket's rules (NFC Browser Bridge repo, firebase/storage.rules) let anyone add files there
 * and nobody read, overwrite or delete them, so the kiosk carries no credentials.
 */
const ENDPOINT = 'https://firebasestorage.googleapis.com/v0/b/logs-wvmye.firebasestorage.app/o';
const ID_KEY = 'kiosk.uploadId';
const ID_PATTERN = /^kiosk-[0-9A-F]{8}$/;

/**
 * Tells this kiosk's uploads apart from other kiosks'. A web page cannot read the computer's name,
 * so it is random, made on first use and kept with the app's data (a new one if that is cleared).
 */
export function uploadId(storage: Storage | null = safeLocalStorage(), random: () => string = () => crypto.randomUUID()): string {
  let stored: string | null = null;
  try {
    stored = storage?.getItem(ID_KEY) ?? null;
  } catch {
    // Storage disabled: a new ID for each upload.
  }
  if (stored !== null && ID_PATTERN.test(stored)) return stored;
  const id = `kiosk-${random().replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  try {
    storage?.setItem(ID_KEY, id);
  } catch {
    // As above.
  }
  return id;
}

/** `kiosk-video-nfc/kiosk-1A2B3C4D/20261028T180000Z_v1.0.12` */
export function uploadFolder(id: string, now: Date, version: string): string {
  const stamp = `${now.toISOString().slice(0, 19).replace(/[-:]/g, '')}Z`;
  return `kiosk-video-nfc/${id}/${stamp}_v${version}`;
}

/** Uploads the log as `kiosk.log` (the text "Copy log" gives) and returns the folder it went to. */
export async function uploadLog(
  entries: readonly LogEntry[],
  folder: string,
  fetchFn: typeof fetch = (...args) => fetch(...args),
): Promise<string> {
  if (entries.length === 0) throw new Error('nothing logged yet');
  const url = `${ENDPOINT}?name=${encodeURIComponent(`${folder}/kiosk.log`)}`;
  const response = await fetchFn(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: `${formatLog(entries)}\n`,
  });
  if (!response.ok) throw new Error(`the server answered HTTP ${response.status}`);
  return folder;
}
