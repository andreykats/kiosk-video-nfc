import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BridgeScanner } from '../../src/scan/bridge/bridgeScanner';
import { FakeBridge, FakeTag } from '../../src/scan/bridge/vendor/fakeBridge';
import { mimeRecord, textRecord, uriRecord } from '../../src/scan/bridge/vendor/ndef';
import type { ScanEvent } from '../../src/scan/scanEvent';

const R = 'ACS ACR1255U-J1';
const URL_ID = 'https://example.com/c/BRONCOS-12';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

function setup(options: { ndefTimeoutMs?: number } = {}) {
  const fake = new FakeBridge();
  fake.addReader(R);
  let now = 10_000;
  const scanner = new BridgeScanner({ client: { WebSocket: fake.WebSocket }, now: () => now, ...options });
  const scans: ScanEvent[] = [];
  scanner.scans.subscribe((s) => scans.push(s));
  const advance = (ms: number) => {
    now += ms;
    return tick(ms);
  };
  return { fake, scanner, scans, advance };
}

/** Each tag gets its own UID so the debounce doesn't merge them. */
const tag = (n: number) => FakeTag.ntag('NTAG215', Uint8Array.from([0x04, 0x10, 0x20, 0x30, 0x40, 0x50, n]));

describe('BridgeScanner', () => {
  it('reports connected with the reader list', async () => {
    const { scanner } = setup();
    scanner.start();
    await tick();
    expect(scanner.status).toMatchObject({ state: 'connected', version: '0.0.0-fake', service: 'ready', readers: [{ name: R }] });
    scanner.stop();
    expect(scanner.status).toEqual({ state: 'off' });
  });

  it('uses the first URI record as the card ID and keeps every record', async () => {
    const { fake, scanner, scans } = setup();
    scanner.start();
    await tick();
    fake.placeCard(R, tag(1).withNdef([textRecord('hello'), uriRecord(URL_ID), mimeRecord('text/plain', 'x')]));
    await tick();
    expect(scans).toHaveLength(1);
    expect(scans[0]).toMatchObject({ uid: '04102030405001', source: 'bridge', ndefKey: URL_ID });
    expect(scans[0]!.records.map((r) => r.type)).toEqual(['T', 'U', 'text/plain']);
  });

  it('falls back to the first Text record, without its language code', async () => {
    const { fake, scanner, scans } = setup();
    scanner.start();
    await tick();
    fake.placeCard(R, tag(2).withNdef([textRecord('BRONCOS-12', 'de')]));
    await tick();
    expect(scans[0]?.ndefKey).toBe('BRONCOS-12');
  });

  it('scans a blank NTAG with no card ID', async () => {
    const { fake, scanner, scans } = setup();
    scanner.start();
    await tick();
    fake.placeCard(R, tag(3));
    await tick();
    expect(scans[0]).toMatchObject({ uid: '04102030405003', ndefKey: null, records: [] });
  });

  it('does not treat a card already on the reader at connect time as a tap', async () => {
    const { fake, scanner, scans } = setup();
    fake.placeCard(R, tag(4).withNdef([uriRecord(URL_ID)]));
    scanner.start();
    await tick();
    expect(scans).toEqual([]);
  });

  it('does not send NTAG reads to other card types', async () => {
    const { fake, scanner, scans } = setup();
    scanner.start();
    await tick();
    fake.placeCard(R, FakeTag.classic1k());
    await tick();
    expect(scans[0]).toMatchObject({ uid: 'DEADBEEF', ndefKey: null });
    expect(fake.apduLog).toEqual([]);
  });

  it('scans with the UID alone when the NDEF read takes too long', async () => {
    const { fake, scanner, scans } = setup({ ndefTimeoutMs: 1500 });
    scanner.start();
    await tick();
    fake.silent = true;
    fake.placeCard(R, tag(5).withNdef([uriRecord(URL_ID)]));
    await tick(1499);
    expect(scans).toEqual([]);
    await tick(1);
    expect(scans[0]).toMatchObject({ uid: '04102030405005', ndefKey: null });
  });

  it('ignores the same card again within the debounce window', async () => {
    const { fake, scanner, scans, advance } = setup();
    scanner.start();
    await tick();
    const t = tag(6);
    fake.placeCard(R, t);
    await tick();
    fake.removeCard(R);
    fake.placeCard(R, t);
    await advance(500);
    expect(scans).toHaveLength(1);
    fake.removeCard(R);
    await advance(1500);
    fake.placeCard(R, t);
    await tick();
    expect(scans).toHaveLength(2);
  });

  it('ignores SAM slots', async () => {
    const { fake, scanner, scans } = setup();
    fake.addReader('ACS ACR1552 1S CL Reader SAM 0', 'sam');
    scanner.start();
    await tick();
    fake.placeCard('ACS ACR1552 1S CL Reader SAM 0', tag(7));
    await tick();
    expect(scans).toEqual([]);
  });

  it('reports unreachable when the bridge is not running, and recovers when it starts', async () => {
    const { fake, scanner } = setup();
    fake.stop();
    scanner.start();
    await tick();
    expect(scanner.status.state).toBe('connecting');
    await tick(2500);
    expect(scanner.status.state).toBe('unreachable');
    fake.start();
    await tick(10_000);
    expect(scanner.status.state).toBe('connected');
  });
});
