import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { clickDialogButton, FIXTURES, importConfig, LION_UID, openSettings, scan, setUpKiosk, testConfig } from './helpers';

test('first run shows the setup screen with the checklist', async ({ page }) => {
  await page.goto('./');
  await expect(page.getByTestId('setup-screen')).toBeVisible();
  await expect(page.getByTestId('setup-screen')).toContainText('Setup required — open settings');
  await expect(page.getByTestId('setup-checklist').locator('[data-item="install"]')).toBeVisible();
});

test('pair a new card, then reassign it', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('import-files-input').setInputFiles([`${FIXTURES}lion.mp4`, `${FIXTURES}tiger.mp4`]);
  await clickDialogButton(page, 'OK');

  await page.getByRole('button', { name: 'Pair new card' }).click();
  await expect(page.getByTestId('scan-status')).toHaveText('Scan card now…');
  await scan(page, '04A23B1C');
  await expect(page.getByTestId('pair-uid')).toHaveText('04 A2 3B 1C');
  await page.getByTestId('pair-video').selectOption('lion.mp4');
  await page.getByTestId('pair-label').fill('Lion card');
  await clickDialogButton(page, 'Save');
  const row = page.locator('[data-testid="cards-table"] tr[data-uid="04A23B1C"]');
  await expect(row).toContainText('04 A2 3B 1C');
  await expect(row.getByRole('combobox')).toHaveValue('lion.mp4');

  await page.waitForTimeout(1600); // past the reader debounce window
  await page.getByRole('button', { name: 'Pair new card' }).click();
  await scan(page, '04A23B1C');
  await expect(page.locator('dialog[open]')).toContainText('Already paired');
  await page.getByTestId('pair-video').selectOption('tiger.mp4');
  await clickDialogButton(page, 'Reassign');
  await expect(row.getByRole('combobox')).toHaveValue('tiger.mp4');
  await expect(page.locator('[data-testid="cards-table"] tbody tr')).toHaveCount(1);
});

test('admin cards reject video-card UIDs and vice versa', async ({ page }) => {
  await openSettings(page);
  await importConfig(page);
  await page.getByRole('button', { name: 'Add admin card' }).click();
  await scan(page, LION_UID);
  await expect(page.getByTestId('scan-status')).toContainText('is paired to video');
  await scan(page, 'AABBCCDD');
  await page.getByTestId('admin-label').fill('Manager');
  await clickDialogButton(page, 'Save');
  await expect(page.getByTestId('admin-list')).toContainText('AA BB CC DD');

  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: 'Pair new card' }).click();
  await scan(page, 'AABBCCDD');
  await expect(page.getByTestId('scan-status')).toContainText('is an admin card');
  await clickDialogButton(page, 'Cancel');
});

test('scans outside a scan dialog are ignored by settings and do not type into inputs', async ({ page }) => {
  await setUpKiosk(page);
  const title = page.getByLabel('Title for lion.mp4');
  await title.fill('');
  await title.focus();
  await scan(page, '04A23B1C');
  // The first key can't be distinguished from typing; the rest of the burst is swallowed.
  await expect(title).toHaveValue('0');
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page.getByTestId('diag-last-scan')).toContainText('04 A2 3B 1C');
});

test('export → import round-trip', async ({ page }) => {
  await setUpKiosk(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-config').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('config.json');
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.cards).toEqual(testConfig.cards);
  expect(exported.adminCards).toEqual(testConfig.adminCards);
  expect(Date.parse(exported.updatedAt)).toBeGreaterThan(Date.parse(testConfig.updatedAt));

  // Re-importing the export on a kiosk with local edits replaces them.
  await page.getByLabel('Label for 04A23B1C5D8000').fill('Edited locally');
  await page.getByLabel('Label for 04A23B1C5D8000').press('Tab');
  await page.getByTestId('import-config-input').setInputFiles({ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(page.getByTestId('config-summary')).toContainText('3 video(s), 2 card(s), 1 admin card(s)');
  await clickDialogButton(page, 'Replace local config');
  await expect(page.getByLabel('Label for 04A23B1C5D8000')).toHaveValue('Lion card');
  await expect(page.getByTestId('config-applied')).toContainText('from a file');
});

test('invalid config files are rejected and the current config is kept', async ({ page }) => {
  await openSettings(page);
  await importConfig(page);
  await page.getByTestId('import-config-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1,"videos":[],"cards":[{"uid":"zz"}],"adminCards":[]}') });
  await expect(page.locator('dialog[open]')).toContainText('The current config was kept.');
  await expect(page.locator('dialog[open]')).toContainText('uppercase hex');
  await clickDialogButton(page, 'OK');
  await expect(page.locator('[data-testid="cards-table"] tbody tr')).toHaveCount(2);
});

test('update from published config fetches config.json fresh and applies it', async ({ page, context }) => {
  let requests = 0;
  await context.route('**/config.json', (route) => {
    requests++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(testConfig) });
  });
  await openSettings(page);
  await page.getByTestId('update-published').click();
  await expect(page.getByTestId('config-summary')).toContainText('3 video(s), 2 card(s), 1 admin card(s)');
  await expect(page.locator('dialog[open]')).toContainText('Videos not yet imported on this kiosk (3)');
  await clickDialogButton(page, 'Replace local config');
  await clickDialogButton(page, 'OK');
  await expect(page.getByTestId('config-applied')).toContainText('from the published site');
  expect(requests).toBe(1);
});

test('deleting a video lists and unpairs its cards', async ({ page }) => {
  await setUpKiosk(page);
  await page.locator('tr[data-file="lion.mp4"]').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('dialog[open]')).toContainText('04 A2 3B 1C 5D 80 00 Lion card');
  await clickDialogButton(page, 'Delete');
  await expect(page.locator('tr[data-file="lion.mp4"]')).toHaveCount(0);
  await expect(page.locator(`[data-testid="cards-table"] tr[data-uid="${LION_UID}"]`)).toHaveCount(0);
  const stillThere = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('videos');
    const names: string[] = [];
    for await (const name of dir.keys()) names.push(name);
    return names.sort();
  });
  expect(stillThere).toEqual(['loop.mp4', 'tiger.mp4']);
});

test('importing over an existing file asks first and leaves no .partial files', async ({ page }) => {
  await setUpKiosk(page);
  await page.getByTestId('import-files-input').setInputFiles([`${FIXTURES}tiger.mp4`]);
  await expect(page.locator('dialog[open]')).toContainText('will be replaced');
  await clickDialogButton(page, 'Import 1');
  await expect(page.locator('dialog[open]', { hasText: 'Import finished' })).toBeVisible();
  await clickDialogButton(page, 'OK');
  const names = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('videos');
    const out: [string, number][] = [];
    for await (const [name, h] of dir.entries()) out.push([name, h.kind === 'file' ? (await (h as FileSystemFileHandle).getFile()).size : -1]);
    return out.sort();
  });
  const tigerSize = (await readFile(`${FIXTURES}tiger.mp4`)).byteLength;
  expect(names.map((n) => n[0])).toEqual(['lion.mp4', 'loop.mp4', 'tiger.mp4']);
  expect(names.find((n) => n[0] === 'tiger.mp4')![1]).toBe(tigerSize);
});
