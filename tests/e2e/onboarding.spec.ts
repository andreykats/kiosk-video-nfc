import { expect, test, type Page } from '@playwright/test';
import { FIXTURES, LION_UID, scan, testConfig, waitForPlaying } from './helpers';

const step = (page: Page, id: string) => page.getByTestId(`step-${id}`);
const next = (page: Page) => page.getByTestId('onboarding-next').click();

async function throughReader(page: Page) {
  await page.goto('./');
  await expect(step(page, 'install')).toBeVisible();
  await expect(step(page, 'install')).toContainText('Step 1 of 6');
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
  await expect(page.getByTestId('onboarding-finish')).toBeDisabled();

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
  await expect(page.getByTestId('pair-conflict')).toContainText('plays “lion”');
  await page.getByRole('button', { name: 'Move card here' }).click();
  await expect(page.locator(`tr[data-file="tiger.mp4"] .chip[data-uid="${LION_UID}"]`)).toBeVisible();
  await expect(page.locator('tr[data-file="lion.mp4"] .chip')).toHaveCount(0);

  await page.getByTestId('onboarding-finish').click();
  await expect(step(page, 'done')).toContainText('3 video(s) and 1 card(s). Background loop: loop.');
  await page.getByTestId('onboarding-start').click();

  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await page.waitForTimeout(1600);
  await scan(page, LION_UID);
  await waitForPlaying(page, 'feature-video', 'tiger.mp4');

  // Finished: reloading goes straight to the kiosk, not the guide.
  await page.reload();
  await expect(page.getByTestId('kiosk')).toBeVisible();
});

test('first launch: import config file → copy videos → review pairings', async ({ page }) => {
  await throughReader(page);
  await page.getByTestId('onboarding-config-input').setInputFiles({ name: 'config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(testConfig)) });

  await expect(step(page, 'copyVideos')).toBeVisible();
  await expect(step(page, 'copyVideos')).toContainText('Still needed (3)');
  await page.getByTestId('onboarding-folder-input').setInputFiles(FIXTURES);

  await expect(step(page, 'pair')).toBeVisible();
  await expect(page.getByLabel('Use loop.mp4 as background loop')).toBeChecked();
  await expect(page.locator(`tr[data-file="lion.mp4"] .chip[data-uid="${LION_UID}"]`)).toBeVisible();
  await page.getByTestId('onboarding-finish').click();
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
