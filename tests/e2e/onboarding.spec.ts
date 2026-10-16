import { expect, test, type Page } from '@playwright/test';
import { copyFile, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeBridge } from '../../src/scan/bridge/vendor/fakeBridge';
import { DEFAULT_URL } from '../../src/scan/bridge/vendor/protocol';
import { ADMIN_UID, FIXTURES, LION_UID, clickDialogButton, openSettings, scan, setUpKiosk, testConfig, waitForPlaying } from './helpers';

const step = (page: Page, id: string) => page.getByTestId(`step-${id}`);
const next = (page: Page) => page.getByTestId('onboarding-next').click();
const fakePlatform = (page: Page, platform: string) =>
  page.addInitScript((value) => Object.defineProperty(Navigator.prototype, 'platform', { get: () => value }), platform);

async function throughReader(page: Page) {
  await page.goto('./');
  await expect(step(page, 'welcome')).toContainText('Step 1 of 8');
  await expect(step(page, 'welcome')).toContainText('Welcome to the Topps Kiosk');
  // Step 1 shows the version where Back would be, and no Reset: a kiosk at step 1 has nothing to reset.
  await expect(page.getByTestId('onboarding-version')).toHaveText(/^v\d+\.\d+\.\d+(-dev)?$/);
  await expect(page.getByTestId('onboarding-reset')).toHaveCount(0);
  await expect(page.getByTestId('onboarding-back')).toHaveCount(0);
  await page.getByRole('button', { name: 'Get started' }).click();

  await expect(step(page, 'reader')).toContainText('Step 2 of 8');
  await expect(page.getByTestId('onboarding-next')).toBeDisabled();
  await scan(page, '04A23B1C');
  await expect(page.getByTestId('reader-status')).toHaveText('Reader is working ✓');
  await next(page);
  await expect(step(page, 'config')).toBeVisible();
}

test('first launch: new config → add videos → pair tags and pick the loop', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakePlatform(page, 'MacIntel');
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

  // The loop video can't be paired.
  await expect(page.locator('tr[data-file="loop.mp4"]').getByTestId('pair-card')).toBeDisabled();
  const count = (file: string) => page.locator(`tr[data-file="${file}"]`).getByTestId('pair-count');
  await expect(count('lion.mp4')).toHaveText('No tags yet');

  // Keep pairing is off by default: the dialog closes after one card.
  await page.locator('tr[data-file="lion.mp4"]').getByTestId('pair-card').click();
  await expect(page.getByTestId('keep-pairing')).not.toBeChecked();
  await page.waitForTimeout(1600); // past the debounce for the reader-test card
  await scan(page, LION_UID);
  await expect(page.getByTestId('quick-pair-dialog')).toHaveCount(0);
  await expect(count('lion.mp4')).toHaveText('1 tag paired');
  // The row shows a count, not the card's UID or payload.
  await expect(page.locator('tr[data-file="lion.mp4"]')).not.toContainText('04 A2');

  // With Keep pairing ticked, more cards pair to the same video until Done.
  await page.locator('tr[data-file="lion.mp4"]').getByTestId('pair-card').click();
  await page.getByTestId('keep-pairing').check();
  await scan(page, '0A0B0C0D');
  await expect(page.getByTestId('scan-status')).toContainText('Paired');
  await scan(page, '0A0B0C0E');
  await expect(count('lion.mp4')).toHaveText('3 tags paired');
  // A card already paired here is reported, and the dialog keeps waiting.
  await page.waitForTimeout(1600);
  await scan(page, LION_UID);
  await expect(page.getByTestId('scan-status')).toContainText('already plays this video');
  await page.getByRole('button', { name: 'Done' }).click();

  // A card that plays another video can be reassigned.
  await page.locator('tr[data-file="tiger.mp4"]').getByTestId('pair-card').click();
  await page.waitForTimeout(1600);
  await scan(page, LION_UID);
  await expect(page.getByTestId('scan-status')).toContainText('plays “lion.mp4”');
  await page.getByRole('button', { name: 'Reassign' }).click();
  await expect(page.getByTestId('quick-pair-dialog')).toHaveCount(0);
  await expect(count('tiger.mp4')).toHaveText('1 tag paired');
  await expect(count('lion.mp4')).toHaveText('2 tags paired');

  await next(page);

  // Admin card: video cards are refused, a fresh card is added.
  await expect(step(page, 'admin')).toBeVisible();
  await expect(step(page, 'admin')).toContainText('Ctrl+Shift+S (Control, not Cmd, on a Mac)');
  await expect(page.getByTestId('onboarding-skip')).toBeVisible();
  await page.waitForTimeout(1600);
  await scan(page, LION_UID);
  await expect(page.getByTestId('admin-message')).toContainText('Use a different tag for admin');
  await scan(page, 'AABBCCDD');
  await expect(page.getByTestId('admin-cards').locator('[data-uid="AABBCCDD"]')).toBeVisible();
  await next(page);

  // Step 7 on a Mac: a copyable command that runs the auto-start script.
  await expect(step(page, 'autostart')).toContainText('Step 7 of 8');
  const scriptUrl = new URL('mac-kiosk-autostart.sh', page.url()).href;
  const command = `curl -fsSL ${scriptUrl} | bash`;
  await expect(page.getByTestId('mac-autostart-command')).toHaveText(command);
  await page.getByTestId('mac-autostart-copy').click();
  await expect(page.getByTestId('mac-autostart-copy')).toHaveText('Copied ✓');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);
  // The URL in the command serves the script, which opens the kiosk with the startup marker.
  const script = await (await page.request.get(scriptUrl)).text();
  expect(script).toMatch(/^#!\/bin\/bash\n/);
  expect(script).toContain('--kiosk');
  expect(script).toContain('?autostart');
  await expect(page.getByTestId('autostart-status')).toHaveCount(0);
  await next(page);

  await expect(step(page, 'done')).toContainText('Step 8 of 8');
  await expect(step(page, 'done')).toContainText('3 video(s) and 3 tag(s). Background loop: loop.mp4.');

  // Export from the last step, for importing on other kiosks.
  const downloadPromise = page.waitForEvent('download');
  await page.getByTestId('onboarding-export').click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('config.json');
  const exported = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(exported.loopVideo).toBe('loop.mp4');
  expect(exported.cards).toEqual([
    { match: { kind: 'uid', value: LION_UID }, fileName: 'tiger.mp4', label: '' },
    { match: { kind: 'uid', value: '0A0B0C0D' }, fileName: 'lion.mp4', label: '' },
    { match: { kind: 'uid', value: '0A0B0C0E' }, fileName: 'lion.mp4', label: '' },
  ]);
  expect(exported.adminCards.map((a: { match: { value: string } }) => a.match.value)).toEqual(['AABBCCDD']);
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
  await fakePlatform(page, 'Win32');
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
  await expect(page.locator('tr[data-file="lion.mp4"]').getByTestId('pair-count')).toHaveText('1 tag paired');
  await next(page);

  // The imported config already has an admin card.
  await expect(step(page, 'admin').locator(`[data-uid="${ADMIN_UID}"]`)).toBeVisible();
  await next(page);
  // Windows gets a Startup shortcut instead of the Mac script.
  await expect(step(page, 'autostart')).toBeVisible();
  await expect(page.getByTestId('mac-autostart')).toHaveCount(0);
  const kioskUrl = new URL('./?autostart', page.url()).href;
  await expect(page.getByTestId('windows-autostart')).toContainText('shell:startup');
  await expect(page.getByTestId('windows-autostart-command')).toHaveText(
    `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk --autoplay-policy=no-user-gesture-required ${kioskUrl}`,
  );
  await next(page);
  await expect(step(page, 'done')).toBeVisible();
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

test('reader step: keyboard mode offers a copyable ACR1552U HID mode command on a Mac, and points elsewhere on Windows', async ({ page, context, browser, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'MacIntel' }));
  await page.goto('./');
  await next(page);
  await expect(step(page, 'reader')).toBeVisible();
  await expect(page.getByTestId('reader-mode')).toHaveValue('keyboard');
  const help = page.getByTestId('hid-mode-help');
  await expect(help).toContainText('Open Terminal');

  const scriptUrl = new URL('acr1552-mode.sh', baseURL).href;
  const command = `curl -fsSL ${scriptUrl} -o /tmp/acr1552-mode.sh && bash /tmp/acr1552-mode.sh hid`;
  await expect(page.getByTestId('hid-mode-command')).toHaveText(command);
  await page.getByTestId('hid-mode-copy').click();
  await expect(page.getByTestId('hid-mode-copy')).toHaveText('Copied ✓');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(command);

  // The URL in the command serves the script itself.
  const script = await (await page.request.get(scriptUrl)).text();
  expect(script).toMatch(/^#!\/bin\/bash\n/);
  expect(script).toContain('ACR1552U');

  // Only for keyboard input.
  await page.getByTestId('reader-mode').selectOption('bridge');
  await expect(help).toHaveCount(0);

  const windows = await browser.newPage();
  await windows.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Win32' }));
  await windows.goto('./');
  await next(windows);
  await expect(step(windows, 'reader')).toContainText('use ACS’s configuration tool');
  await expect(windows.getByTestId('hid-mode-copy')).toHaveCount(0);
  await windows.close();
});

test('reader step: bridge mode on a Mac explains allowing the unsigned bridge app, until it connects', async ({ page }) => {
  // No bridge at first: every connection attempt is refused.
  let bridge: FakeBridge | null = null;
  await page.routeWebSocket(DEFAULT_URL, (ws) => {
    if (!bridge) return void ws.close();
    const socket = new bridge.WebSocket(DEFAULT_URL);
    socket.onmessage = (ev) => ws.send(String(ev.data));
    socket.onclose = () => ws.close();
    ws.onMessage((message) => socket.send(String(message)));
    ws.onClose(() => socket.close());
  });
  await fakePlatform(page, 'MacIntel');
  await page.goto('./');
  await next(page);
  await expect(step(page, 'reader')).toBeVisible();
  const help = page.getByTestId('bridge-install-help');
  await expect(help).toHaveCount(0);

  await page.getByTestId('reader-mode').selectOption('bridge');
  await expect(page.getByTestId('bridge-download')).toBeVisible();
  await expect(help).toContainText('could not be verified');
  await expect(help).toContainText('Privacy & Security');
  await expect(help).toContainText('Open Anyway');

  // The app starts: the page reconnects by itself and the steps go away.
  bridge = new FakeBridge();
  bridge.addReader('ACS ACR1552U');
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-state', 'connected', { timeout: 15_000 });
  await expect(help).toHaveCount(0);
});

test('reader step: bridge mode on Windows has no macOS steps', async ({ page }) => {
  await page.routeWebSocket(DEFAULT_URL, (ws) => ws.close());
  await fakePlatform(page, 'Win32');
  await page.goto('./');
  await next(page);
  await page.getByTestId('reader-mode').selectOption('bridge');
  await expect(page.getByTestId('bridge-download')).toBeVisible();
  await expect(page.getByTestId('bridge-install-help')).toHaveCount(0);
});

test('reset in the guide wipes videos and config and starts again at step 1', async ({ page }) => {
  await throughReader(page);
  await page.getByTestId('option-new').click();
  await page.getByTestId('onboarding-files-input').setInputFiles([`${FIXTURES}loop.mp4`, `${FIXTURES}lion.mp4`]);
  await expect(step(page, 'pair')).toBeVisible();

  // Reset sits to the left of Back.
  const reset = page.getByTestId('onboarding-reset');
  const resetBox = (await reset.boundingBox())!;
  const backBox = (await page.getByTestId('onboarding-back').boundingBox())!;
  expect(resetBox.x + resetBox.width).toBeLessThanOrEqual(backBox.x);

  // Cancelling changes nothing.
  await reset.click();
  await expect(page.locator('dialog[open]')).toContainText('2 video file(s)');
  await clickDialogButton(page, 'Cancel');
  await expect(page.getByTestId('pair-table').locator('tr')).toHaveCount(2);

  await reset.click();
  await clickDialogButton(page, 'Reset everything');
  await expect(step(page, 'welcome')).toContainText('Step 1 of 8');

  const left = await page.evaluate(async () => {
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('videos');
    const names: string[] = [];
    for await (const name of dir.keys()) names.push(name);
    return names;
  });
  expect(left).toEqual([]);

  // Nothing comes back after a reload: still at step 1, with an empty config.
  await page.reload();
  await expect(step(page, 'welcome')).toBeVisible();
  await page.goto('./#/settings');
  await expect(page.getByTestId('videos-section')).toContainText('No videos yet');
});

test('a launch by the startup command turns Opens at startup green, in the checklist and its settings section', async ({ page }) => {
  await fakePlatform(page, 'MacIntel');
  await setUpKiosk(page);
  const item = page.getByTestId('setup-checklist').locator('[data-item="autostart"]');
  await expect(item).toHaveClass(/todo/);
  await expect(item).toContainText('Opens at startup');
  await expect(item).toContainText('See Open at startup below');
  // Settings → Open at startup, just above Install as Chrome App, has the setup guide's instructions.
  const ids = await page.locator('[data-testid="settings"] > section').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
  expect(ids[ids.indexOf('install-section') - 1]).toBe('autostart-section');
  const section = page.getByTestId('autostart-section');
  await expect(section.getByTestId('mac-autostart-command')).toHaveText(`curl -fsSL ${new URL('mac-kiosk-autostart.sh', page.url()).href} | bash`);
  await expect(section.getByTestId('autostart-status')).toHaveCount(0);

  await page.goto('./?autostart');
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  // The marker is removed, so a reload doesn't count as a startup launch.
  expect(new URL(page.url()).search).toBe('');
  await openSettings(page);
  await expect(item).toHaveClass(/done/);
  await expect(section.getByTestId('autostart-status')).toContainText('This computer opened the kiosk at startup ✓');
  await expect(section.getByTestId('mac-autostart')).toHaveCount(0);

  // Now it shows how to undo it: the uninstall script, which tells the kiosk with ?autostart=removed.
  const uninstallUrl = new URL('mac-kiosk-autostart-uninstall.sh', page.url()).href;
  await expect(section.getByTestId('mac-autostart-uninstall-command')).toHaveText(`curl -fsSL ${uninstallUrl} | bash`);
  const script = await (await page.request.get(uninstallUrl)).text();
  expect(script).toMatch(/^#!\/bin\/bash\n/);
  expect(script).toContain('autostart=removed');

  // The tab the script opens forgets the launch without starting a second kiosk, and the open settings follow.
  const removed = await page.context().newPage();
  await removed.goto('./?autostart=removed');
  await expect(removed.getByTestId('autostart-removed')).toContainText('The kiosk no longer opens at startup');
  await expect(removed.getByTestId('loop-video')).toHaveCount(0);
  expect(new URL(removed.url()).search).toBe('');
  await expect(item).toHaveClass(/todo/);
  await expect(section.getByTestId('autostart-status')).toHaveCount(0);
  await expect(section.getByTestId('mac-autostart-uninstall')).toHaveCount(0);
  await expect(section.getByTestId('mac-autostart-command')).toBeVisible();
});
