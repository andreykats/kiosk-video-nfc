import { expect, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

export const LION_UID = '04A23B1C5D8000';
export const TIGER_UID = '04A23B1C5D8011';
export const ADMIN_UID = '04FF001122AA80';

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
    { uid: LION_UID, fileName: 'lion.mp4', label: 'Lion card' },
    { uid: TIGER_UID, fileName: 'tiger.mp4', label: 'Tiger card' },
  ],
  adminCards: [{ uid: ADMIN_UID, label: 'Front desk' }],
};

/** Simulates the reader: a fast hex burst followed by Enter. */
export async function scan(page: Page, uid: string): Promise<void> {
  await page.keyboard.type(uid, { delay: 5 });
  await page.keyboard.press('Enter');
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
