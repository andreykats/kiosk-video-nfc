import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export const LION_UID = '04A23B1C5D8000';
export const TIGER_UID = '04A23B1C5D8011';
export const ADMIN_UID = '04FF001122AA80';

/** A v1 config (cards keyed by `uid`), so imports also exercise the upgrade to v2. */
export const testConfig = {
  schemaVersion: 1,
  updatedAt: '2026-10-11T15:00:00.000Z',
  loopVideo: 'loop.mp4',
  videos: [
    { fileName: 'loop.mp4', title: 'Loop', sizeBytes: 0 },
    { fileName: 'lion.mp4', title: 'Lion', sizeBytes: 0 },
    { fileName: 'tiger.mp4', title: 'Tiger', sizeBytes: 0 },
  ],
  cards: [
    { uid: LION_UID, fileName: 'lion.mp4', label: 'Lion tag' },
    { uid: TIGER_UID, fileName: 'tiger.mp4', label: 'Tiger tag' },
  ],
  adminCards: [{ uid: ADMIN_UID, label: 'Front desk' }],
};

/** `testConfig`'s cards as the app stores and exports them (schema v2). */
export const uidMatch = (value: string) => ({ kind: 'uid', value });
export const testCardsV2 = testConfig.cards.map(({ uid, ...rest }) => ({ match: uidMatch(uid), ...rest }));
export const testAdminCardsV2 = testConfig.adminCards.map(({ uid, ...rest }) => ({ match: uidMatch(uid), ...rest }));

/**
 * Simulates the reader: hex keys 5 ms apart, then Enter. Each key carries its
 * own timestamp (like OS-stamped reader input), and the whole burst is sent in
 * one go, so a busy test machine can't stretch the gaps and drop the scan.
 */
export async function scan(page: Page, uid: string): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const start = Date.now() / 1000;
  const keys = [...uid].map((ch) => ({ key: ch, code: /\d/.test(ch) ? `Digit${ch}` : `Key${ch.toUpperCase()}`, text: ch }));
  const sends = [...keys, { key: 'Enter', code: 'Enter', text: '\r', windowsVirtualKeyCode: 13 }].flatMap((k, i) => {
    const timestamp = start + i * 0.005;
    return [
      cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', ...k, timestamp }),
      cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k.key, code: k.code, timestamp: timestamp + 0.002 }),
    ];
  });
  await Promise.all(sends);
  await cdp.detach();
}

export async function openSettings(page: Page): Promise<void> {
  await page.goto('./#/settings');
  await expect(page.getByTestId('settings')).toBeVisible();
}

export async function clickDialogButton(page: Page, name: string | RegExp): Promise<void> {
  await page.locator('dialog[open]').getByRole('button', { name }).click();
}

/** Applies a config file on a kiosk that doesn't have its videos yet. */
export async function importConfig(page: Page, config: unknown = testConfig): Promise<void> {
  await page.getByTestId('import-config-input').setInputFiles({
    name: 'config.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(config)),
  });
  await clickDialogButton(page, 'Replace local config');
  await expect(page.locator('dialog[open]', { hasText: 'Config applied' })).toBeVisible();
  await clickDialogButton(page, 'OK');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
}

export async function importFixtureFolder(page: Page): Promise<void> {
  await page.getByTestId('import-folder-input').setInputFiles(FIXTURES);
  await expect(page.locator('dialog[open]', { hasText: 'Import finished' })).toBeVisible({ timeout: 30_000 });
  await clickDialogButton(page, 'OK');
}

/** Fresh kiosk: config from file + videos from the fixtures folder. */
export async function setUpKiosk(page: Page): Promise<void> {
  await openSettings(page);
  await importConfig(page);
  await importFixtureFolder(page);
  await expect(page.getByTestId('videos-table').locator('.status.bad')).toHaveCount(0);
}

export async function videoState(page: Page, testId: 'loop-video' | 'feature-video') {
  return page.getByTestId(testId).evaluate((v: HTMLVideoElement) => ({
    file: v.dataset.file ?? null,
    hidden: v.hidden,
    paused: v.paused,
    muted: v.muted,
    time: v.currentTime,
  }));
}

export async function waitForPlaying(page: Page, testId: 'loop-video' | 'feature-video', file: string): Promise<void> {
  await expect
    .poll(async () => {
      const s = await videoState(page, testId);
      return s.file === file && !s.hidden && !s.paused && s.time > 0;
    }, { timeout: 15_000 })
    .toBe(true);
}
