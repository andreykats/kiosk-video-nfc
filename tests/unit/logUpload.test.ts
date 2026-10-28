import { describe, expect, it } from 'vitest';
import type { LogEntry } from '../../src/app/log';
import { uploadFolder, uploadId, uploadLog } from '../../src/app/logUpload';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => void data.delete(k),
    setItem: (k, v) => void data.set(k, v),
  };
}

const entries: LogEntry[] = [
  { at: Date.UTC(2026, 9, 28, 18, 0, 0), level: 'start', message: 'Kiosk started (v1.0.12).' },
  { at: Date.UTC(2026, 9, 28, 18, 0, 5), level: 'error', message: 'Loop video "loop.mp4" failed' },
];

describe('uploadId', () => {
  it('is made once and then kept', () => {
    const storage = memoryStorage();
    const id = uploadId(storage, () => '1a2b3c4d-5e6f-4a8b-9c0d-112233445566');
    expect(id).toBe('kiosk-1A2B3C4D');
    expect(uploadId(storage, () => 'ffffffff-0000-4000-8000-000000000000')).toBe(id);
  });

  it('replaces a stored value that is not an ID', () => {
    const storage = memoryStorage();
    storage.setItem('kiosk.uploadId', '../../evil');
    expect(uploadId(storage, () => 'abcdef12-0000-4000-8000-000000000000')).toBe('kiosk-ABCDEF12');
  });

  it('still gives an ID without storage', () => {
    expect(uploadId(null, () => '0123abcd-0000-4000-8000-000000000000')).toBe('kiosk-0123ABCD');
  });
});

describe('uploadFolder', () => {
  it('names the kiosk, the UTC time and the version', () => {
    expect(uploadFolder('kiosk-1A2B3C4D', new Date(Date.UTC(2026, 9, 28, 9, 5, 3, 120)), '1.0.12')).toBe(
      'kiosk-video-nfc/kiosk-1A2B3C4D/20261028T090503Z_v1.0.12',
    );
  });
});

describe('uploadLog', () => {
  it('posts the log as plain text to the folder', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const fetchFn = async (input: RequestInfo | URL, i?: RequestInit) => {
      url = String(input);
      init = i;
      return new Response('{}', { status: 200 });
    };
    const folder = 'kiosk-video-nfc/kiosk-1A2B3C4D/20261028T180010Z_v1.0.12';
    await expect(uploadLog(entries, folder, fetchFn)).resolves.toBe(folder);
    expect(url).toBe(
      'https://firebasestorage.googleapis.com/v0/b/logs-wvmye.firebasestorage.app/o?name=' +
        'kiosk-video-nfc%2Fkiosk-1A2B3C4D%2F20261028T180010Z_v1.0.12%2Fkiosk.log',
    );
    expect(init?.method).toBe('POST');
    expect(init?.headers).toEqual({ 'Content-Type': 'text/plain' });
    expect(init?.body).toBe(
      '2026-10-28T18:00:00.000Z START Kiosk started (v1.0.12).\n2026-10-28T18:00:05.000Z ERROR Loop video "loop.mp4" failed\n',
    );
  });

  it('fails on an error status or an empty log', async () => {
    const refused = async () => new Response('', { status: 403 });
    await expect(uploadLog(entries, 'f', refused)).rejects.toThrow('HTTP 403');
    await expect(uploadLog([], 'f', refused)).rejects.toThrow('nothing logged yet');
  });
});
