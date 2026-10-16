import { expect, test, type Page } from '@playwright/test';
import { PUBLISHED_CONFIG_ENABLED } from '../../src/config/sync';
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_UID, clickDialogButton, FIXTURES, importConfig, LION_UID, openSettings, scan, setUpKiosk, testAdminCardsV2, testCardsV2, testConfig, TIGER_UID, waitForPlaying } from './helpers';

test('first run opens the setup guide', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveURL(/#\/setup$/);
  await expect(page.getByTestId('step-welcome')).toBeVisible();
});

test('pair a new tag, then reassign it', async ({ page }) => {
  await openSettings(page);
  await page.getByTestId('import-files-input').setInputFiles([`${FIXTURES}lion.mp4`, `${FIXTURES}tiger.mp4`]);
  await clickDialogButton(page, 'OK');

  await page.getByRole('button', { name: 'Pair new tag' }).click();
  await expect(page.getByTestId('scan-status')).toHaveText('Scan tag now…');
  await scan(page, '04A23B1C');
  await expect(page.getByTestId('pair-uid')).toHaveText('04 A2 3B 1C');
  await page.getByTestId('pair-video').selectOption('lion.mp4');
  await clickDialogButton(page, 'Save');
  const row = page.locator('[data-testid="cards-table"] tr[data-uid="04A23B1C"]');
  await expect(row).toContainText('04 A2 3B 1C');
  await expect(row.getByRole('combobox')).toHaveValue('lion.mp4');

  await page.waitForTimeout(1600); // past the reader debounce window
  await page.getByRole('button', { name: 'Pair new tag' }).click();
  await scan(page, '04A23B1C');
  await expect(page.locator('dialog[open]')).toContainText('Already paired');
  await page.getByTestId('pair-video').selectOption('tiger.mp4');
  await clickDialogButton(page, 'Reassign');
  await expect(row.getByRole('combobox')).toHaveValue('tiger.mp4');
  await expect(page.locator('[data-testid="cards-table"] tbody tr')).toHaveCount(1);
});

test('settings lists Tag reader below Videos, then Config, Diagnostics and Reset last', async ({ page }) => {
  await setUpKiosk(page);
  const ids = await page.locator('[data-testid="settings"] > section').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(ids.indexOf('reader-section')).toBeGreaterThan(ids.indexOf('videos-section'));
  expect(ids.slice(-3)).toEqual(['config-section', 'diagnostics-section', 'reset-section']);
});

test('quick pair from the Videos list, with reassign; the loop video cannot be paired', async ({ page }) => {
  await setUpKiosk(page);
  const row = (file: string) => page.locator(`[data-testid="videos-table"] tr[data-file="${file}"]`);
  await expect(row('loop.mp4').getByTestId('quick-pair')).toBeDisabled();
  await expect(row('lion.mp4').getByTestId('quick-pair')).toBeEnabled();

  // One card per press by default.
  await row('lion.mp4').getByTestId('quick-pair').click();
  await expect(page.getByTestId('quick-pair-dialog')).toBeVisible();
  await expect(page.getByTestId('match-chooser')).toHaveCount(0);
  await expect(page.getByTestId('keep-pairing')).not.toBeChecked();
  await scan(page, '0A0B0C0D');
  await expect(page.getByTestId('quick-pair-dialog')).toHaveCount(0);
  await expect(page.locator('[data-testid="cards-table"] tr[data-uid="0A0B0C0D"] select')).toHaveValue('lion.mp4');

  // Keep pairing: a card that plays another video is only moved after confirming, then the dialog waits for more.
  await row('lion.mp4').getByTestId('quick-pair').click();
  await page.getByTestId('keep-pairing').check();
  await scan(page, TIGER_UID);
  await expect(page.getByTestId('scan-status')).toContainText('tiger.mp4');
  await clickDialogButton(page, 'Reassign');
  await expect(page.getByTestId('scan-status')).toContainText('Paired');
  await clickDialogButton(page, 'Done');
  await expect(page.getByLabel(`Video for ${TIGER_UID}`)).toHaveValue('lion.mp4');

  // Moving the loop to a video greys out its Pair button.
  await row('tiger.mp4').getByRole('radio').check();
  await expect(row('tiger.mp4').getByTestId('quick-pair')).toBeDisabled();
  await expect(row('loop.mp4').getByTestId('quick-pair')).toBeEnabled();
});

test('admin tags reject video-tag UIDs and vice versa', async ({ page }) => {
  await openSettings(page);
  await importConfig(page);
  await page.getByRole('button', { name: 'Add admin tag' }).click();
  await scan(page, LION_UID);
  await expect(page.getByTestId('scan-status')).toContainText('is paired to video');
  await scan(page, 'AABBCCDD');
  // A valid scan saves straight away; there is no label to fill in.
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(page.getByTestId('admin-list')).toContainText('AA BB CC DD');
  await expect(page.getByTestId('admin-section').locator('input')).toHaveCount(0);

  await page.waitForTimeout(1600);
  await page.getByRole('button', { name: 'Pair new tag' }).click();
  await scan(page, 'AABBCCDD');
  await expect(page.getByTestId('scan-status')).toContainText('is an admin tag');
  await clickDialogButton(page, 'Cancel');
});

test('scans outside a scan dialog are only recorded in diagnostics', async ({ page }) => {
  await setUpKiosk(page);
  await scan(page, LION_UID);
  await expect(page.getByTestId('diag-last-scan')).toContainText('04 A2 3B 1C 5D 80 00');
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
});

test('an admin tag closes settings, except while a dialog is waiting for a tag', async ({ page }) => {
  await setUpKiosk(page);
  // No online/offline label in the header.
  await expect(page.getByTestId('online-status')).toHaveCount(0);

  // While Add admin tag waits for a tag, the admin tag goes to the dialog.
  await page.getByRole('button', { name: 'Add admin tag' }).click();
  await scan(page, ADMIN_UID);
  await expect(page.getByTestId('scan-status')).toContainText('is already an admin tag');
  await expect(page.getByTestId('settings')).toBeVisible();
  await clickDialogButton(page, 'Cancel');

  await page.waitForTimeout(1600); // past the reader debounce for the same tag
  await scan(page, ADMIN_UID);
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByTestId('kiosk')).toBeVisible();
});

test('videos show how many times a tag played them, kept across reloads until Reset counter', async ({ page }) => {
  await setUpKiosk(page);
  const count = (file: string) => page.locator(`[data-testid="videos-table"] tr[data-file="${file}"]`).getByTestId('play-count');
  await expect(page.getByTestId('videos-table').locator('thead th').nth(5)).toHaveText('Plays');
  // Reset counter sits at the right end of the toolbar, away from the import buttons.
  const resetBox = (await page.getByTestId('reset-play-counts').boundingBox())!;
  const folderBox = (await page.getByRole('button', { name: 'Import folder' }).boundingBox())!;
  const sectionBox = (await page.getByTestId('videos-section').boundingBox())!;
  expect(resetBox.x - (folderBox.x + folderBox.width)).toBeGreaterThan(100);
  expect(sectionBox.x + sectionBox.width - (resetBox.x + resetBox.width)).toBeLessThan(40);
  await expect(count('lion.mp4')).toHaveText('0');

  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await scan(page, LION_UID);
  await waitForPlaying(page, 'feature-video', 'lion.mp4');

  await openSettings(page);
  await expect(count('lion.mp4')).toHaveText('1');
  await expect(count('tiger.mp4')).toHaveText('0');
  // The loop's repeats don't count.
  await expect(count('loop.mp4')).toHaveText('0');

  // Cancelling keeps the counts.
  await page.getByTestId('reset-play-counts').click();
  await clickDialogButton(page, 'Cancel');
  await expect(count('lion.mp4')).toHaveText('1');
  await page.getByTestId('reset-play-counts').click();
  await clickDialogButton(page, 'Reset counter');
  await expect(count('lion.mp4')).toHaveText('0');
  await page.reload();
  await expect(count('lion.mp4')).toHaveText('0');
});

test('Remove tag unpairs the scanned tag after a confirm; admin and unknown tags are refused', async ({ page }) => {
  await setUpKiosk(page);
  const rows = page.locator('[data-testid="cards-table"] tbody tr');
  await expect(rows).toHaveCount(2);
  // Videos → Tags counts the tags paired with each video.
  const tagCount = (file: string) => page.locator(`[data-testid="videos-table"] tr[data-file="${file}"]`).getByTestId('tag-count');
  await expect(tagCount('lion.mp4')).toHaveText('1');
  await expect(tagCount('tiger.mp4')).toHaveText('1');
  await expect(tagCount('loop.mp4')).toHaveText('0');
  // Next to Pair new tag.
  await expect(page.getByTestId('cards-section').locator('.toolbar button')).toHaveText(['Pair new tag', 'Remove tag']);
  await expect(page.getByTestId('cards-section')).not.toContainText('This kiosk identifies');

  await page.getByTestId('remove-tag').click();
  await scan(page, ADMIN_UID);
  await expect(page.getByTestId('scan-status')).toContainText('is an admin tag');
  await scan(page, 'DEADBEEF');
  await expect(page.getByTestId('scan-status')).toContainText('isn’t paired');
  await scan(page, LION_UID);
  await expect(page.getByTestId('scan-status')).toContainText('plays “lion.mp4”. Remove it?');
  // Nothing is removed until Remove is pressed.
  await clickDialogButton(page, 'Cancel');
  await expect(rows).toHaveCount(2);

  await page.getByTestId('remove-tag').click();
  await page.waitForTimeout(1600); // past the reader debounce for the same tag
  await scan(page, LION_UID);
  await clickDialogButton(page, 'Remove');
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  await expect(rows).toHaveCount(1);
  await expect(page.locator(`[data-testid="cards-table"] tr[data-uid="${LION_UID}"]`)).toHaveCount(0);
  await expect(tagCount('lion.mp4')).toHaveText('0');
  await expect(page.locator(`[data-testid="admin-list"] tr[data-uid="${ADMIN_UID}"]`)).toHaveCount(1);
});

test('the NDEF column lines up in the Tags and Admin tags tables', async ({ page }) => {
  await setUpKiosk(page);
  const x = async (table: string) => (await page.getByTestId(table).locator('tbody [data-col="ndef"]').first().boundingBox())!.x;
  expect(Math.abs((await x('cards-table')) - (await x('admin-list')))).toBeLessThan(1);
});

test('settings widens to keep long tag IDs on one line, and wraps them instead of scrolling sideways when the window is narrow', async ({ page, browser, baseURL }) => {
  const settingsWidth = async (p: typeof page) => (await p.getByTestId('settings').boundingBox())!.width;
  // Short strings: the usual width (70rem), even in a wide window.
  await page.setViewportSize({ width: 1920, height: 900 });
  await setUpKiosk(page);
  expect(await settingsWidth(page)).toBeLessThan(1200);

  // A fresh kiosk whose tag has a long NDEF payload.
  const LONG = 'https://topps.drey.dev/c/2026-series-one-chrome-refractor-autograph-LION-0001-of-0250';
  const context = await browser.newContext({ baseURL, viewport: { width: 1920, height: 900 } });
  const wide = await context.newPage();
  await openSettings(wide);
  const v = (fileName: string) => ({ fileName, title: '', sizeBytes: 0 });
  await importConfig(wide, {
    schemaVersion: 2,
    updatedAt: null,
    loopVideo: 'loop.mp4',
    videos: [v('loop.mp4'), v('lion.mp4'), v('tiger.mp4')],
    cards: [{ match: { kind: 'uid', value: LION_UID }, fileName: 'lion.mp4', label: '', otherId: { kind: 'ndef', value: LONG } }],
    adminCards: [],
  });
  const ndef = wide.locator(`[data-testid="cards-table"] tr[data-uid="${LION_UID}"] [data-col="ndef"] .mono`);
  await expect(ndef).toHaveText(LONG);
  const oneLine = (await wide.getByTestId('cards-table').locator('th').first().boundingBox())!.height;
  expect((await ndef.boundingBox())!.height).toBeLessThan(oneLine * 1.5);
  expect(await settingsWidth(wide)).toBeGreaterThan(1200);

  await wide.setViewportSize({ width: 900, height: 900 });
  expect((await ndef.boundingBox())!.height).toBeGreaterThan(oneLine * 1.5);
  expect(await wide.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(900);
  await context.close();
});

test('export → import round-trip', async ({ page }) => {
  await setUpKiosk(page);
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('export-config').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('config.json');
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.schemaVersion).toBe(2);
  expect(exported.cards).toEqual(testCardsV2);
  expect(exported.adminCards).toEqual(testAdminCardsV2);
  expect(Date.parse(exported.updatedAt)).toBeGreaterThan(Date.parse(testConfig.updatedAt));

  // Re-importing the export on a kiosk with local edits replaces them.
  await page.getByLabel('Video for 04A23B1C5D8000').selectOption('tiger.mp4');
  await expect(page.getByLabel('Video for 04A23B1C5D8000')).toHaveValue('tiger.mp4');
  await page.getByTestId('import-config-input').setInputFiles({ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(exported)) });
  await expect(page.getByTestId('config-summary')).toContainText('3 video(s), 2 tag(s), 1 admin tag(s)');
  await clickDialogButton(page, 'Replace local config');
  await expect(page.getByLabel('Video for 04A23B1C5D8000')).toHaveValue('lion.mp4');
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

test('update from published config is shown but disabled', async ({ page }) => {
  await openSettings(page);
  await expect(page.getByTestId('update-published')).toBeVisible();
  await expect(page.getByTestId('update-published')).toBeDisabled();
});

test('update from published config fetches config.json fresh and applies it', async ({ page, context }) => {
  test.skip(!PUBLISHED_CONFIG_ENABLED, 'Publishing is switched off (PUBLISHED_CONFIG_ENABLED)');
  let requests = 0;
  await context.route('**/config.json', (route) => {
    requests++;
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(testConfig) });
  });
  await openSettings(page);
  await page.getByTestId('update-published').click();
  await expect(page.getByTestId('config-summary')).toContainText('3 video(s), 2 tag(s), 1 admin tag(s)');
  await expect(page.locator('dialog[open]')).toContainText('Videos not yet imported on this kiosk (3)');
  await clickDialogButton(page, 'Replace local config');
  await clickDialogButton(page, 'OK');
  await expect(page.getByTestId('config-applied')).toContainText('from the published site');
  expect(requests).toBe(1);
});

test('videos and tags tables show file names only: no title, label or "no loop" row', async ({ page }) => {
  await setUpKiosk(page);
  await expect(page.getByTestId('videos-table').locator('th')).toHaveText(['Loop', 'File', 'Size', 'Status', 'Tags', 'Plays', '']);
  await expect(page.getByTestId('settings').locator('input[type="text"]')).toHaveCount(0);
  await expect(page.getByLabel(`Video for ${LION_UID}`).locator('option:checked')).toHaveText('lion.mp4');
  await expect(page.getByTestId('cards-table').locator('th')).toHaveText(['UID', 'NDEF', 'Video file', '']);
  // Keyboard readers only read UIDs, so the NDEF column has a dash.
  const lionRow = page.locator(`[data-testid="cards-table"] tr[data-uid="${LION_UID}"]`);
  await expect(lionRow.locator('[data-col="uid"]')).toHaveText('04 A2 3B 1C 5D 80 00');
  await expect(lionRow.locator('[data-col="ndef"]')).toHaveText('—');
  await expect(page.getByTestId('cards-table').locator('input[type="text"]')).toHaveCount(0);
  await expect(page.getByLabel('No loop video')).toHaveCount(0);
  await expect(page.getByTestId('videos-table').locator('input[type="radio"]')).toHaveCount(3);
  // The UID stays on one line.
  const uid = page.locator(`[data-testid="cards-table"] tr[data-uid="${LION_UID}"] td.uid`);
  const lineHeight = await uid.evaluate((td) => parseFloat(getComputedStyle(td).lineHeight) || 20);
  expect((await uid.boundingBox())!.height).toBeLessThan(lineHeight * 2 + 16);
});

test('deleting the loop video moves the loop to another video', async ({ page }) => {
  await setUpKiosk(page);
  await page.locator('tr[data-file="loop.mp4"]').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('dialog[open]')).toContainText('lion.mp4 will become the loop video');
  await clickDialogButton(page, 'Delete');
  await expect(page.getByLabel('Use lion.mp4 as loop video')).toBeChecked();
});

test('deleting a video lists and unpairs its tags', async ({ page }) => {
  await setUpKiosk(page);
  await page.locator('tr[data-file="lion.mp4"]').getByRole('button', { name: 'Delete' }).click();
  await expect(page.locator('dialog[open]')).toContainText('04 A2 3B 1C 5D 80 00');
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

const videoRow = (page: Page, file: string) => page.locator(`[data-testid="videos-table"] tr[data-file="${file}"]`);

async function opfsVideoFiles(page: Page): Promise<[string, number][]> {
  return page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('videos');
    const out: [string, number][] = [];
    for await (const [name, h] of dir.entries()) out.push([name, h.kind === 'file' ? (await (h as FileSystemFileHandle).getFile()).size : -1]);
    return out.sort();
  });
}

/** Plays `file` once with `uid` from the kiosk, then comes back to settings. */
async function playOnce(page: Page, uid: string, file: string): Promise<void> {
  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await scan(page, uid);
  await waitForPlaying(page, 'feature-video', file);
  await openSettings(page);
  await expect(videoRow(page, file).getByTestId('play-count')).toHaveText('1');
}

test('Replace swaps in a new file: tags stay paired, the play count restarts, the old file is deleted', async ({ page }) => {
  await setUpKiosk(page);
  await playOnce(page, LION_UID, 'lion.mp4');

  const lion = await readFile(`${FIXTURES}lion.mp4`);
  // Cancelling the confirm changes nothing.
  await videoRow(page, 'lion.mp4').getByTestId('replace-video').click();
  await page.getByTestId('replace-file-input').setInputFiles({ name: 'lion_v2.mp4', mimeType: 'video/mp4', buffer: lion });
  await expect(page.locator('dialog[open]')).toContainText('Replace lion.mp4 with lion_v2.mp4?');
  await expect(page.locator('dialog[open]')).toContainText('Its 1 tag(s) stay paired');
  await clickDialogButton(page, 'Cancel');
  await expect(videoRow(page, 'lion.mp4')).toHaveCount(1);

  await videoRow(page, 'lion.mp4').getByTestId('replace-video').click();
  await page.getByTestId('replace-file-input').setInputFiles({ name: 'lion_v2.mp4', mimeType: 'video/mp4', buffer: lion });
  await clickDialogButton(page, 'Replace');
  await expect(page.locator('dialog[open]', { hasText: 'Replaced lion.mp4 with lion_v2.mp4.' })).toBeVisible();
  await clickDialogButton(page, 'OK');

  await expect(videoRow(page, 'lion.mp4')).toHaveCount(0);
  // It keeps its place in the list.
  await expect(page.locator('[data-testid="videos-table"] tbody tr').nth(1)).toHaveAttribute('data-file', 'lion_v2.mp4');
  await expect(videoRow(page, 'lion_v2.mp4').getByTestId('tag-count')).toHaveText('1');
  await expect(videoRow(page, 'lion_v2.mp4').getByTestId('play-count')).toHaveText('0');
  await expect(videoRow(page, 'lion_v2.mp4').locator('.status.good')).toHaveText('present');
  await expect(page.locator(`[data-testid="cards-table"] tr[data-uid="${LION_UID}"]`).getByRole('combobox')).toHaveValue('lion_v2.mp4');
  expect((await opfsVideoFiles(page)).map((n) => n[0])).toEqual(['lion_v2.mp4', 'loop.mp4', 'tiger.mp4']);

  await page.waitForTimeout(1600); // past the reader debounce window for the same tag
  await playOnce(page, LION_UID, 'lion_v2.mp4');
});

test('Replace refuses a file named like another video in the list', async ({ page }) => {
  await setUpKiosk(page);
  await videoRow(page, 'lion.mp4').getByTestId('replace-video').click();
  await page.getByTestId('replace-file-input').setInputFiles(`${FIXTURES}tiger.mp4`);
  await expect(page.locator('dialog[open]', { hasText: 'Cannot replace' })).toContainText('tiger.mp4 is already in the video list');
  await clickDialogButton(page, 'OK');
  await expect(videoRow(page, 'lion.mp4')).toHaveCount(1);
});

test('Import folder skips same-size videos and overwrites a changed one, keeping its tags and play count', async ({ page }) => {
  await setUpKiosk(page);
  await playOnce(page, TIGER_UID, 'tiger.mp4');

  // The same folder again: every video is already here at the same size.
  await page.getByTestId('import-folder-input').setInputFiles(FIXTURES);
  await expect(page.locator('dialog[open]', { hasText: 'Nothing to import' })).toContainText('already on this kiosk');
  await clickDialogButton(page, 'OK');

  // A folder with a new tiger.mp4 (a different size). The browser reads the files during the import.
  const folder = await mkdtemp(join(tmpdir(), 'kiosk-folder-'));
  try {
    await copyFile(`${FIXTURES}loop.mp4`, join(folder, 'loop.mp4'));
    await copyFile(`${FIXTURES}lion.mp4`, join(folder, 'tiger.mp4'));
    await page.getByTestId('import-folder-input').setInputFiles(folder);
    await expect(page.locator('dialog[open]')).toContainText('will be replaced');
    await clickDialogButton(page, 'Import 1');
    await expect(page.locator('dialog[open] h2')).toHaveText('Import finished');
    await clickDialogButton(page, 'OK');
  } finally {
    await rm(folder, { recursive: true, force: true });
  }

  const lionSize = (await readFile(`${FIXTURES}lion.mp4`)).byteLength;
  expect((await opfsVideoFiles(page)).find((n) => n[0] === 'tiger.mp4')![1]).toBe(lionSize);
  // The config's size follows the new file, so it isn't flagged as a mismatch.
  await expect(videoRow(page, 'tiger.mp4').locator('.status.good')).toHaveText('present');
  await expect(videoRow(page, 'tiger.mp4').getByTestId('tag-count')).toHaveText('1');
  await expect(videoRow(page, 'tiger.mp4').getByTestId('play-count')).toHaveText('1');
});

test('importing over an existing file asks first and leaves no .partial files', async ({ page }) => {
  await setUpKiosk(page);
  await playOnce(page, TIGER_UID, 'tiger.mp4');
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
  // Same name, same video: its tags and play count are kept.
  await expect(videoRow(page, 'tiger.mp4').getByTestId('tag-count')).toHaveText('1');
  await expect(videoRow(page, 'tiger.mp4').getByTestId('play-count')).toHaveText('1');
});

test('with no videos the kiosk shows a centred "Setup required" tag', async ({ page }) => {
  await setUpKiosk(page);
  // Visit the kiosk once while it can play, which completes first-launch setup.
  await page.getByTestId('back-to-kiosk').click();
  await expect(page.getByTestId('kiosk')).toBeVisible();
  await page.keyboard.press('Control+Shift+KeyS');
  for (const file of ['loop.mp4', 'lion.mp4', 'tiger.mp4']) {
    await page.locator(`tr[data-file="${file}"]`).getByRole('button', { name: 'Delete' }).click();
    await clickDialogButton(page, 'Delete');
    await expect(page.locator(`tr[data-file="${file}"]`)).toHaveCount(0);
  }
  await page.getByTestId('back-to-kiosk').click();

  const screen = page.getByTestId('setup-screen');
  await expect(screen).toBeVisible();
  await expect(page.getByTestId('setup-reason')).toHaveText('There are no videos on this kiosk yet.');
  const card = (await screen.locator('.setup-card').boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(Math.abs(card.x + card.width / 2 - viewport.width / 2)).toBeLessThan(2);
  expect(Math.abs(card.y + card.height / 2 - viewport.height / 2)).toBeLessThan(2);

  await page.getByTestId('setup-open-guide').click();
  await expect(page).toHaveURL(/#\/setup$/);
});

test('reset configuration wipes videos and config and restarts the setup guide', async ({ page }) => {
  await setUpKiosk(page);
  const reset = page.getByTestId('reset-section');
  // It's the last section on the page.
  await expect(page.locator('[data-testid="settings"] > section').last()).toHaveAttribute('data-testid', 'reset-section');

  // Cancelling changes nothing.
  await reset.getByTestId('reset-kiosk').click();
  await expect(page.locator('dialog[open]')).toContainText('3 video file(s)');
  await expect(page.locator('dialog[open]')).toContainText('2 tag(s) and 1 admin tag(s)');
  await clickDialogButton(page, 'Cancel');
  await expect(page.locator('[data-testid="cards-table"] tbody tr')).toHaveCount(2);

  await reset.getByTestId('reset-kiosk').click();
  await clickDialogButton(page, 'Reset everything');
  await expect(page).toHaveURL(/#\/setup$/);
  await expect(page.getByTestId('step-welcome')).toContainText('Step 1 of 8');

  const left = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('videos');
    const names: string[] = [];
    for await (const name of dir.keys()) names.push(name);
    return names;
  });
  expect(left).toEqual([]);

  // Nothing comes back after a reload: still a fresh kiosk at step 1, with an empty config.
  await page.reload();
  await expect(page.getByTestId('step-welcome')).toBeVisible();
  await page.goto('./#/settings');
  await expect(page.getByTestId('cards-section')).toContainText('No tags paired yet.');
  await expect(page.getByTestId('videos-section')).toContainText('No videos yet');
});
