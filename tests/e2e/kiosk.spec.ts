import { expect, test, type Page } from '@playwright/test';
import { ADMIN_UID, LION_UID, openSettings, scan, setUpKiosk, TIGER_UID, videoState, waitForPlaying } from './helpers';

test.beforeEach(async ({ page }) => {
  await setUpKiosk(page);
  await page.getByTestId('back-to-kiosk').click();
  await expect(page.getByTestId('kiosk')).toBeVisible();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
});

test('paired tag plays its video once, then the loop resumes where it paused', async ({ page }) => {
  await scan(page, LION_UID);
  await waitForPlaying(page, 'feature-video', 'lion.mp4');
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-state', 'feature');
  const loop = await videoState(page, 'loop-video');
  expect(loop.hidden).toBe(true);
  expect(loop.paused).toBe(true);

  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-state', 'loop', { timeout: 10_000 });
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  const resumed = await videoState(page, 'loop-video');
  expect(resumed.time).toBeGreaterThanOrEqual(loop.time);
  expect((await videoState(page, 'feature-video')).hidden).toBe(true);
  expect(resumed.muted).toBe(false);
});

test('scans during a feature video are ignored', async ({ page }) => {
  await scan(page, LION_UID);
  await waitForPlaying(page, 'feature-video', 'lion.mp4');
  await scan(page, TIGER_UID);
  await page.waitForTimeout(300);
  expect((await videoState(page, 'feature-video')).file).toBe('lion.mp4');
});

test('with Playback → interrupt on, a scan during a video starts the scanned video at once', async ({ page }) => {
  await openSettings(page);
  // The Playback section sits right above Config, and the option is off by default.
  const sections = page.locator('[data-testid="settings"] > section');
  const ids = await sections.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(ids[ids.indexOf('config-section') - 1]).toBe('playback-section');
  await expect(page.getByTestId('interrupt-playback')).not.toBeChecked();
  await page.getByTestId('interrupt-playback').check();
  await page.reload();
  await expect(page.getByTestId('interrupt-playback')).toBeChecked();
  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');

  await scan(page, LION_UID);
  await waitForPlaying(page, 'feature-video', 'lion.mp4');
  await scan(page, TIGER_UID);
  await waitForPlaying(page, 'feature-video', 'tiger.mp4');
  // Swapping the source mid-play isn't mistaken for a failure.
  await page.waitForTimeout(500);
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-state', 'feature');
  expect((await videoState(page, 'feature-video')).file).toBe('tiger.mp4');
  // Both plays count.
  await openSettings(page);
  for (const file of ['lion.mp4', 'tiger.mp4']) {
    await expect(page.locator(`[data-testid="videos-table"] tr[data-file="${file}"]`).getByTestId('play-count')).toHaveText('1');
  }
});

test('an unknown tag does nothing', async ({ page }) => {
  await scan(page, 'DEADBEEF');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-state', 'loop');
  expect((await videoState(page, 'feature-video')).hidden).toBe(true);
});

test('an admin tag opens settings, even during a feature video', async ({ page }) => {
  await scan(page, ADMIN_UID);
  await expect(page.getByTestId('settings')).toBeVisible();
  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await scan(page, LION_UID);
  await waitForPlaying(page, 'feature-video', 'lion.mp4');
  await scan(page, ADMIN_UID);
  await expect(page.getByTestId('settings')).toBeVisible();
});

test('Ctrl+Shift+S opens settings', async ({ page }) => {
  await page.keyboard.press('Control+Shift+KeyS');
  await expect(page.getByTestId('settings')).toBeVisible();
  await expect(page).toHaveURL(/#\/settings$/);
});

test('moving the mouse shows the settings shortcut for 2 seconds', async ({ page }) => {
  const hint = page.getByTestId('shortcut-hint');
  await expect(hint).toContainText('Shift + S to open settings');
  await expect(hint).not.toHaveClass(/shown/);
  await page.mouse.move(100, 100);
  await page.mouse.move(200, 150);
  await expect(hint).toHaveClass(/shown/);
  await page.waitForTimeout(1_000);
  // Still moving keeps it up.
  await page.mouse.move(250, 200);
  await page.waitForTimeout(1_500);
  await expect(hint).toHaveClass(/shown/);
  await expect(hint).not.toHaveClass(/shown/, { timeout: 2_000 });
});

test('the kiosk goes fullscreen on the first click or tag scan', async ({ page }) => {
  const isFullscreen = () => page.evaluate(() => document.fullscreenElement !== null);
  if (await isFullscreen()) await page.evaluate(() => document.exitFullscreen());
  await expect.poll(isFullscreen).toBe(false);

  // A card scan is a key press, so it counts as the gesture Chrome needs.
  await scan(page, 'DEADBEEF');
  await expect.poll(isFullscreen).toBe(true);

  await page.evaluate(() => document.exitFullscreen());
  await expect.poll(isFullscreen).toBe(false);
  await page.mouse.click(10, 10);
  await expect.poll(isFullscreen).toBe(true);
});

const loopSrc = (page: Page) => page.getByTestId('loop-video').evaluate((v: HTMLVideoElement) => v.src);

test('a tag video that stops playing gives way to the loop, and tags work again', async ({ page }) => {
  await scan(page, LION_UID);
  await waitForPlaying(page, 'feature-video', 'lion.mp4');
  // A frozen decoder fires neither `ended` nor `error`; pausing looks the same.
  await page.getByTestId('feature-video').evaluate((v: HTMLVideoElement) => v.pause());
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-state', 'loop', { timeout: 20_000 });
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await scan(page, TIGER_UID);
  await waitForPlaying(page, 'feature-video', 'tiger.mp4');
});

test('a loop media error reloads the loop instead of showing "Setup required"', async ({ page }) => {
  const before = await loopSrc(page);
  await page.getByTestId('loop-video').evaluate((v) => v.dispatchEvent(new Event('error')));
  await expect.poll(() => loopSrc(page)).not.toBe(before);
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await expect(page.getByTestId('setup-screen')).toBeHidden();
});

test('a loop that stops playing is reloaded', async ({ page }) => {
  const before = await loopSrc(page);
  await page.getByTestId('loop-video').evaluate((v: HTMLVideoElement) => v.pause());
  await expect.poll(() => loopSrc(page), { timeout: 20_000 }).not.toBe(before);
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await expect(page.getByTestId('setup-screen')).toBeHidden();
});

test('losing window focus shows a notice until focus comes back', async ({ page }) => {
  const notice = page.getByTestId('focus-notice');
  await expect(notice).toBeHidden();
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(notice).toBeVisible();
  await expect(notice).toContainText('Tap or click the screen');
  const box = await notice.boundingBox();
  expect(box).toMatchObject({ x: 0, y: 0, width: page.viewportSize()!.width, height: page.viewportSize()!.height });
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(notice).toBeHidden();
});

test('Diagnostics counts playback failures since start, and the event log survives a restart', async ({ page, context }) => {
  const before = await loopSrc(page);
  await page.getByTestId('loop-video').evaluate((v) => v.dispatchEvent(new Event('error')));
  await expect.poll(() => loopSrc(page)).not.toBe(before);

  await page.getByTestId('kiosk').press('Control+Shift+S');
  await expect(page.getByTestId('diag-since-start')).toContainText('loop reloaded once · tag videos failed 0 times');

  await page.reload();
  await expect(page.getByTestId('settings')).toBeVisible();
  // The counters start again with the app; the log keeps the failure and marks each start.
  await expect(page.getByTestId('diag-since-start')).toContainText('loop reloaded 0 times');
  const eventLog = page.getByTestId('event-log');
  await eventLog.locator('summary').click();
  await expect(eventLog.locator('li.error', { hasText: 'Loop video "loop.mp4" failed' })).toHaveCount(1);
  expect(await eventLog.locator('li.start').count()).toBeGreaterThanOrEqual(2);

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await eventLog.getByTestId('copy-log').click();
  await expect(eventLog.getByTestId('copy-log')).toHaveText('Copied ✓');
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z START Kiosk started \(v/m);
  expect(copied).toContain('ERROR Loop video "loop.mp4" failed');
});
