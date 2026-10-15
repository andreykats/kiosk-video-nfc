import { expect, test, type Page } from '@playwright/test';
import { FakeBridge, FakeTag } from '../../src/scan/bridge/vendor/fakeBridge';
import { textRecord, uriRecord } from '../../src/scan/bridge/vendor/ndef';
import { DEFAULT_URL } from '../../src/scan/bridge/vendor/protocol';
import { clickDialogButton, LION_UID, openSettings, scan, setUpKiosk, waitForPlaying } from './helpers';

const READER = 'ACS ACR1255U-J1';
const CARD_ID = 'https://topps.drey.dev/c/TIGER';

const uidBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
let serial = 0;
/** A blank NTAG215 with a fresh 7-byte UID, or the given one. */
const ntag = (uid?: string) => FakeTag.ntag('NTAG215', uid ? uidBytes(uid) : Uint8Array.from([0x04, 0x77, 0x00, 0x00, 0x00, 0x00, ++serial]));

/** Serves the in-memory fake bridge at ws://127.0.0.1:38241/v1 for this page. */
async function useFakeBridge(page: Page): Promise<{ fake: FakeBridge; connections: () => number }> {
  const fake = new FakeBridge();
  fake.addReader(READER);
  let connections = 0;
  await page.routeWebSocket(DEFAULT_URL, (ws) => {
    connections++;
    const socket = new fake.WebSocket(DEFAULT_URL);
    socket.onmessage = (ev) => ws.send(String(ev.data));
    socket.onclose = () => ws.close();
    ws.onMessage((message) => socket.send(String(message)));
    ws.onClose(() => socket.close());
  });
  return { fake, connections: () => connections };
}

/** A tap: the card arrives, and leaves again shortly after. */
async function tap(page: Page, fake: FakeBridge, tag: FakeTag): Promise<void> {
  fake.placeCard(READER, tag);
  await page.waitForTimeout(300);
  fake.removeCard(READER);
}

async function setReaderMode(page: Page, mode: 'keyboard' | 'bridge'): Promise<void> {
  await page.getByTestId('reader-mode').selectOption(mode);
}

test('bridge mode: pair a tag by its tag ID, then tapping any tag with that ID plays the video', async ({ page }) => {
  const { fake } = await useFakeBridge(page);
  await setUpKiosk(page);
  await setReaderMode(page, 'bridge');
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-state', 'connected');
  await expect(page.getByTestId('bridge-status')).toContainText(READER);

  // Bridge kiosks identify tags by UID unless staff choose NDEF payload.
  await expect(page.getByTestId('card-key')).toHaveValue('uid');
  await page.getByTestId('card-key').selectOption('ndef');
  await page.getByRole('button', { name: 'Pair new tag' }).click();
  fake.placeCard(READER, ntag().withNdef([uriRecord(CARD_ID)]));
  await expect(page.getByTestId('match-chooser')).toHaveCount(0);
  await expect(page.getByTestId('pair-uid')).toHaveText(CARD_ID);
  await page.getByTestId('pair-video').selectOption('tiger.mp4');
  await clickDialogButton(page, 'Save');
  fake.removeCard(READER);
  await expect(page.locator(`[data-testid="cards-table"] tr[data-match="ndef:${CARD_ID}"]`)).toBeVisible();

  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  // A different physical card written with the same ID.
  await tap(page, fake, ntag().withNdef([uriRecord(CARD_ID)]));
  await waitForPlaying(page, 'feature-video', 'tiger.mp4');
});

test('bridge mode: tags play by the kiosk tag identifier only, and keyboard scans are ignored', async ({ page }) => {
  const { fake } = await useFakeBridge(page);
  await setUpKiosk(page);
  await setReaderMode(page, 'bridge');
  await page.getByTestId('card-key').selectOption('ndef');
  // The config's cards are paired by UID, which this kiosk doesn't use now.
  await expect(page.getByTestId('reader-card-key-warning')).toContainText('2 tag(s)');
  await expect(page.getByTestId('card-unused')).toHaveCount(2);
  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await tap(page, fake, ntag(LION_UID));
  await page.waitForTimeout(500);
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-state', 'loop');

  await openSettings(page);
  await page.getByTestId('card-key').selectOption('uid');
  await expect(page.getByTestId('reader-card-key-warning')).toHaveCount(0);
  await expect(page.getByTestId('card-unused')).toHaveCount(0);
  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');

  await scan(page, LION_UID);
  await page.waitForTimeout(500);
  await expect(page.getByTestId('kiosk')).toHaveAttribute('data-state', 'loop');

  await page.waitForTimeout(1600); // past the reader debounce window for the earlier tap of this tag
  await tap(page, fake, ntag(LION_UID));
  await waitForPlaying(page, 'feature-video', 'lion.mp4');
});

test('quick pair rejects a tag without an NDEF payload on an NDEF kiosk', async ({ page }) => {
  const { fake } = await useFakeBridge(page);
  await setUpKiosk(page);
  await setReaderMode(page, 'bridge');
  await page.getByTestId('card-key').selectOption('ndef');
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-state', 'connected');
  await page.locator('[data-testid="videos-table"] tr[data-file="tiger.mp4"]').getByTestId('quick-pair').click();
  await tap(page, fake, ntag());
  await expect(page.getByTestId('scan-status')).toContainText('no NDEF payload');
  await tap(page, fake, ntag().withNdef([uriRecord(CARD_ID)]));
  await expect(page.getByTestId('quick-pair-dialog')).toHaveCount(0);
  await expect(page.locator(`[data-testid="cards-table"] tr[data-match="ndef:${CARD_ID}"] select`)).toHaveValue('tiger.mp4');
});

test('admin tags are added by UID even on an NDEF kiosk, and open settings', async ({ page }) => {
  const { fake } = await useFakeBridge(page);
  await setUpKiosk(page);
  await setReaderMode(page, 'bridge');
  await page.getByTestId('card-key').selectOption('ndef');
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-state', 'connected');

  const staff = ntag().withNdef([textRecord('STAFF')]);
  await page.getByRole('button', { name: 'Add admin tag' }).click();
  fake.placeCard(READER, staff);
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  fake.removeCard(READER);
  await expect(page.locator('[data-testid="admin-list"] [data-match^="uid:"]')).toHaveCount(2);

  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await page.waitForTimeout(1600); // past the reader debounce window for the same card
  await tap(page, fake, staff);
  await expect(page.getByTestId('settings')).toBeVisible();
});

test('bridge mode shows a notice while the bridge app is not running', async ({ page }) => {
  const { fake } = await useFakeBridge(page);
  await setUpKiosk(page);
  await setReaderMode(page, 'bridge');
  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await expect(page.getByTestId('bridge-notice')).toBeHidden();

  fake.stop();
  await expect(page.getByTestId('bridge-notice')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('bridge-notice')).toContainText('Start the NFC Browser Bridge app');

  fake.start();
  await expect(page.getByTestId('bridge-notice')).toBeHidden({ timeout: 15_000 });
});

test('bridge mode asks for the reader when the bridge has none', async ({ page }) => {
  const { fake } = await useFakeBridge(page);
  await setUpKiosk(page);
  await setReaderMode(page, 'bridge');
  await page.getByTestId('back-to-kiosk').click();
  fake.removeReader(READER);
  await expect(page.getByTestId('bridge-notice')).toContainText('Plug in the NFC reader');
});

test('keyboard mode never opens a connection to the bridge, and the mode and tag identifier are kept across reloads', async ({ page }) => {
  const { connections } = await useFakeBridge(page);
  await setUpKiosk(page);
  await expect(page.getByTestId('reader-mode')).toHaveValue('keyboard');
  // HID keyboard readers only read UIDs.
  await expect(page.getByTestId('card-key')).toBeDisabled();
  await expect(page.getByTestId('card-key')).toHaveValue('uid');
  // Reader setup is manual: only HID Keyboard and the bridge are offered.
  await expect(page.getByTestId('reader-mode').locator('option')).toHaveText(['HID Keyboard (Read tag’s UID only)', 'NFC Browser Bridge (Read tag’s UID or NDEF payload)']);
  await page.getByTestId('back-to-kiosk').click();
  await waitForPlaying(page, 'loop-video', 'loop.mp4');
  await scan(page, LION_UID);
  await waitForPlaying(page, 'feature-video', 'lion.mp4');
  expect(connections()).toBe(0);

  await openSettings(page);
  await setReaderMode(page, 'bridge');
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-state', 'connected');
  // UID is the default in bridge mode too.
  await expect(page.getByTestId('card-key')).toHaveValue('uid');
  await page.getByTestId('card-key').selectOption('ndef');
  await page.reload();
  await expect(page.getByTestId('reader-mode')).toHaveValue('bridge');
  await expect(page.getByTestId('card-key')).toHaveValue('ndef');
});

test('diagnostics show the tag ID and records of the last bridge scan', async ({ page }) => {
  const { fake } = await useFakeBridge(page);
  await setUpKiosk(page);
  await setReaderMode(page, 'bridge');
  await expect(page.getByTestId('bridge-status')).toHaveAttribute('data-state', 'connected');
  await tap(page, fake, ntag().withNdef([uriRecord(CARD_ID), textRecord('hello')]));
  await expect(page.getByTestId('diag-ndef')).toContainText(CARD_ID);
  await expect(page.getByTestId('diag-ndef')).toContainText('hello');
  await expect(page.getByTestId('diag-last-scan')).toContainText('via the bridge app');
});
