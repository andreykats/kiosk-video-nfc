import { expect, test } from '@playwright/test';
import { PUBLISHED_CONFIG_ENABLED } from '../../src/config/sync';
import { openSettings, setUpKiosk, waitForPlaying } from './helpers';

const offlineReady = (page: import('@playwright/test').Page) => page.getByTestId('offline-ready');

test('becomes ready to work offline, then runs with no network', async ({ page, context }) => {
  await setUpKiosk(page);
  await expect(offlineReady(page)).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });
  await expect(offlineReady(page)).toContainText('Ready to work offline ✓');

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('online-status')).toContainText('Offline');
  await expect(offlineReady(page)).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });

  await page.goto('./#/');
  await page.reload();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');

  // The startup command's address works offline too: a restart without network.
  await page.goto('./?autostart');
  await waitForPlaying(page, 'loop-video', 'loop.mp4');

  // Updating while offline fails cleanly and keeps the config.
  if (PUBLISHED_CONFIG_ENABLED) {
    await page.keyboard.press('Control+Shift+KeyS');
    await page.getByTestId('update-published').click();
    await expect(page.locator('dialog[open]')).toContainText('The current config was kept.');
  }
});

test('readiness turns red when a video or the app cache is missing', async ({ page }) => {
  await setUpKiosk(page);
  await expect(offlineReady(page)).toHaveAttribute('data-ready', 'true', { timeout: 20_000 });

  await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('videos');
    await dir.removeEntry('tiger.mp4');
  });
  await page.reload();
  await expect(offlineReady(page)).toHaveAttribute('data-ready', 'false');
  await expect(offlineReady(page).locator('[data-condition="pairedVideos"]')).toContainText('Missing videos: tiger.mp4 → Import folder');

  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const key of await caches.keys()) await caches.delete(key);
  });
  // Re-entering settings recomputes readiness.
  await page.getByTestId('back-to-kiosk').click();
  await page.keyboard.press('Control+Shift+KeyS');
  await expect(offlineReady(page).locator('[data-condition="appCached"]')).toHaveAttribute('data-status', 'fail');
});

test('Install app in settings is optional, sits just above Reset, and follows beforeinstallprompt and appinstalled', async ({ page }) => {
  await openSettings(page);
  const section = page.getByTestId('install-section');
  await expect(page.locator('[data-testid="settings"] > section').nth(-2)).toHaveAttribute('data-testid', 'install-section');
  await expect(section.getByTestId('install-manual')).toBeVisible();
  // Not a setup requirement.
  await expect(page.getByTestId('setup-checklist').locator('[data-item="install"]')).toHaveCount(0);

  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true }) as Event & Record<string, unknown>;
    (window as unknown as { promptCalls: number }).promptCalls = 0;
    event.prompt = async () => {
      (window as unknown as { promptCalls: number }).promptCalls++;
    };
    event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' });
    event.platforms = ['web'];
    window.dispatchEvent(event);
  });
  await expect(page.getByTestId('diag-installed')).toHaveText('no');
  const button = section.getByTestId('install-button');
  await expect(button).toBeVisible();
  await button.click();
  expect(await page.evaluate(() => (window as unknown as { promptCalls: number }).promptCalls)).toBe(1);
  // Dismissed: the event is spent, so the section falls back to manual steps.
  await expect(section.getByTestId('install-manual')).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(section.getByTestId('install-done')).toHaveText('App installed ✓');
  await expect(section.getByTestId('install-button')).toHaveCount(0);
  await expect(page.getByTestId('diag-installed')).toHaveText('yes');

  // The flag survives a reload (kiosk-mode tabs report display-mode: browser).
  await page.reload();
  await expect(page.getByTestId('install-done')).toBeVisible();
});
