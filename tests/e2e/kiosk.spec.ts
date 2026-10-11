import { expect, test, type Page } from '@playwright/test';
import { ADMIN_UID, LION_UID, scan, setUpKiosk, TIGER_UID, videoState, waitForPlaying } from './helpers';

test.beforeEach(async ({ page }) => {
  await setUpKiosk(page);
  await page.getByTestId('back-to-kiosk').click();
  await expect(page.getByTestId('kiosk')).toBeVisible();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
});

test('paired card plays its video once, then the loop resumes where it paused', async ({ page }) => {
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

test('an unknown card does nothing', async ({ page }) => {
  await scan(page, 'DEADBEEF');
  await page.waitForTimeout(300);
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-state', 'loop');
  expect((await videoState(page, 'feature-video')).hidden).toBe(true);
});

test('an admin card opens settings, even during a feature video', async ({ page }) => {
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

test('the kiosk goes fullscreen on the first click or card scan', async ({ page }) => {
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

test('a card video that stops playing gives way to the loop, and cards work again', async ({ page }) => {
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
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(notice).toBeHidden();
});
