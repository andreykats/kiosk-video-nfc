import { expect, test, type Page } from '@playwright/test';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADMIN_UID, FIXTURES, LION_UID, scan, testConfig, waitForPlaying } from './helpers';

const step = (page: Page, id: string) => page.getByTestId(`step-${id}`);
const next = (page: Page) => page.getByTestId('onboarding-next').click();

async function throughReader(page: Page) {
  await page.goto('./');
  await expect(step(page, 'install')).toBeVisible();
  await expect(step(page, 'install')).toContainText('Step 1 of 7');
  await expect(page.getByTestId('onboarding-version')).toHaveText(/^v\d+\.\d+\.\d+$/);
  await page.getByTestId('onboarding-skip').click();

  await expect(step(page, 'reader')).toBeVisible();
  await expect(page.getByTestId('onboarding-next')).toBeDisabled();
  await scan(page, '04A23B1C');
  await expect(page.getByTestId('reader-status')).toContainText('Reader is working ✓ Read card 04 A2 3B 1C');
  await next(page);
  await expect(step(page, 'config')).toBeVisible();
}

test('first launch: new config → add videos → pair cards and pick the loop', async ({ page }) => {
  await throughReader(page);
  await page.getByTestId('option-new').click();

  await expect(step(page, 'addVideos')).toBeVisible();
  await page.getByTestId('onboarding-files-input').setInputFiles([`${FIXTURES}loop.mp4`, `${FIXTURES}lion.mp4`, `${FIXTURES}tiger.mp4`]);

  // Import moves straight on to the list of added files.
  await expect(step(page, 'pair')).toBeVisible();
  const rows = page.getByTestId('pair-table').locator('tr');
  await expect(rows).toHaveCount(3);

  // The first video added is the loop until another one is ticked; it can't be cleared.
  await expect(page.getByLabel('Use loop.mp4 as background loop')).toBeChecked();
  await page.getByLabel('Use lion.mp4 as background loop').check();
  await expect(page.getByLabel('Use loop.mp4 as background loop')).not.toBeChecked();
  await page.getByLabel('Use lion.mp4 as background loop').click();
  await expect(page.getByLabel('Use lion.mp4 as background loop')).toBeChecked();
  await page.getByLabel('Use loop.mp4 as background loop').check();
  await expect(page.locator('tr[data-file="loop.mp4"]')).toContainText('Plays on repeat');

  await page.locator('tr[data-file="lion.mp4"]').getByTestId('pair-card').click();
  await expect(page.getByTestId('pair-waiting')).toBeVisible();
  await page.waitForTimeout(1600); // past the debounce for the reader-test card
  await scan(page, LION_UID);
  await expect(page.locator(`tr[data-file="lion.mp4"] .chip[data-uid="${LION_UID}"]`)).toBeVisible();

  // Scanning a card that already plays another video offers to move it.
  await page.locator('tr[data-file="tiger.mp4"]').getByTestId('pair-card').click();
  await page.waitForTimeout(1600);
  await scan(page, LION_UID);
  await expect(page.getByTestId('pair-conflict')).toContainText('plays “lion.mp4”');
  await page.getByRole('button', { name: 'Move card here' }).click();
  await expect(page.locator(`tr[data-file="tiger.mp4"] .chip[data-uid="${LION_UID}"]`)).toBeVisible();
  await expect(page.locator('tr[data-file="lion.mp4"] .chip')).toHaveCount(0);

  await next(page);

  // Admin card: video cards are refused, a fresh card is added.
  await expect(step(page, 'admin')).toBeVisible();
  await expect(step(page, 'admin')).toContainText('Ctrl+Shift+S (Control, not Cmd, on a Mac)');
  await expect(page.getByTestId('onboarding-skip')).toBeVisible();
  await page.waitForTimeout(1600);
  await scan(page, LION_UID);
  await expect(page.getByTestId('admin-message')).toContainText('Use a different card for admin');
  await scan(page, 'AABBCCDD');
  await expect(page.getByTestId('admin-cards').locator('[data-uid="AABBCCDD"]')).toBeVisible();
  await next(page);

  await expect(step(page, 'done')).toContainText('3 video(s) and 1 card(s). Background loop: loop.mp4.');

  // Export from the last step, for importing on other kiosks.
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('onboarding-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('config.json');
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.loopVideo).toBe('loop.mp4');
  expect(exported.cards).toEqual([{ uid: LION_UID, fileName: 'tiger.mp4', label: '' }]);
  expect(exported.adminCards.map((a: { uid: string }) => a.uid)).toEqual(['AABBCCDD']);
  await expect(step(page, 'done')).toBeVisible();

  await page.getByTestId('onboarding-start').click();

  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await page.waitForTimeout(1600);
  await scan(page, LION_UID);
  await waitForPlaying(page, 'feature-video', 'tiger.mp4');

  // The admin card added in the guide opens settings.
  await scan(page, 'AABBCCDD');
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('back-to-kiosk').click();

  // Finished: reloading goes straight to the kiosk, not the guide.
  await page.reload();
  await expect(page.getByTestId('kiosk')).toBeVisible();
});

test('first launch: import config file → copy videos → review pairings', async ({ page }) => {
  await throughReader(page);
  await page.getByTestId('onboarding-config-input').setInputFiles({ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(testConfig)) });

  await expect(step(page, 'copyVideos')).toBeVisible();
  await expect(step(page, 'copyVideos')).toContainText('Still needed (3)');
  // The videos can't be skipped: the only way on is to copy them.
  await expect(page.getByTestId('onboarding-choose-folder')).toBeVisible();
  await expect(page.getByTestId('onboarding-next')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Continue without them' })).toHaveCount(0);

  // A folder with only some of the videos copies those and still blocks.
  const partial = await mkdtemp(join(tmpdir(), 'kiosk-partial-'));
  await copyFile(`${FIXTURES}loop.mp4`, join(partial, 'loop.mp4'));
  await page.getByTestId('onboarding-folder-input').setInputFiles(partial);
  await expect(step(page, 'copyVideos')).toContainText('Still needed (2)');
  await expect(step(page, 'copyVideos')).toContainText('That folder didn’t have all of them');
  await expect(page.getByTestId('onboarding-next')).toHaveCount(0);

  // A folder with extra videos asks whether to add them; "Do not add" copies only the listed ones.
  const extra = await mkdtemp(join(tmpdir(), 'kiosk-extra-'));
  for (const name of ['loop.mp4', 'lion.mp4', 'tiger.mp4']) await copyFile(`${FIXTURES}${name}`, join(extra, name));
  await copyFile(`${FIXTURES}lion.mp4`, join(extra, 'bonus.mp4'));
  await page.getByTestId('onboarding-folder-input').setInputFiles(extra);
  const ask = page.locator('dialog[open]', { hasText: 'Add new videos?' });
  await expect(ask.getByRole('button')).toHaveText(['Do not add', 'Add additional files']);
  await ask.getByRole('button', { name: 'Do not add' }).click();

  await expect(step(page, 'pair')).toBeVisible();
  await expect(page.locator('tr[data-file="bonus.mp4"]')).toHaveCount(0);
  await expect(page.getByLabel('Use loop.mp4 as background loop')).toBeChecked();
  await expect(page.locator(`tr[data-file="lion.mp4"] .chip[data-uid="${LION_UID}"]`)).toBeVisible();
  await next(page);

  // The imported config already has an admin card.
  await expect(step(page, 'admin').locator(`[data-uid="${ADMIN_UID}"]`)).toBeVisible();
  await next(page);
  await page.getByTestId('onboarding-start').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
});

test('an invalid config file is explained and nothing changes', async ({ page }) => {
  await throughReader(page);
  await page.getByTestId('onboarding-config-input').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schemaVersion":1}') });
  await expect(page.getByTestId('config-errors')).toContainText('“bad.json” can’t be used');
  await expect(step(page, 'config')).toBeVisible();
  await expect(page.getByTestId('onboarding-next')).toHaveCount(0);
});

test('the guide resumes where it left off after a reload', async ({ page }) => {
  await throughReader(page);
  await page.getByTestId('option-new').click();
  await expect(step(page, 'addVideos')).toBeVisible();
  await page.reload();
  await expect(step(page, 'addVideos')).toBeVisible();
  await page.getByTestId('onboarding-back').click();
  await expect(step(page, 'config')).toContainText('Started a new config ✓');
});

test('install step offers the install button and moves on once installed', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>;
    event.prompt = async () => undefined;
    event.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    window.dispatchEvent(event);
  });
  await expect(step(page, 'install').getByTestId('install-button')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(step(page, 'install')).toContainText('App installed ✓');
  await next(page);
  await expect(step(page, 'reader')).toBeVisible();
});
