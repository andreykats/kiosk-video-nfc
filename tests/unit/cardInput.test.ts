import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../../src/app/emitter';
import { BridgeScanner } from '../../src/scan/bridge/bridgeScanner';
import { FakeBridge, FakeTag } from '../../src/scan/bridge/vendor/fakeBridge';
import { CardInput, type PermissionStatusLike } from '../../src/scan/cardInput';
import type { ReaderMode } from '../../src/scan/readerMode';
import type { ScanEvent } from '../../src/scan/scanEvent';

const R = 'ACS ACR1255U-J1';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

class FakePermission implements PermissionStatusLike {
  onchange: PermissionStatusLike['onchange'] = null;
  constructor(public state: PermissionState) {}
  set(state: PermissionState) {
    this.state = state;
    this.onchange?.call(this as unknown as PermissionStatus, new Event('change'));
  }
}

function setup(mode: ReaderMode, permission: PermissionState | null = 'prompt') {
  const fake = new FakeBridge();
  fake.addReader(R);
  const keyboard = { scans: new Emitter<ScanEvent>(), destroy: vi.fn() };
  const bridge = new BridgeScanner({ client: { WebSocket: fake.WebSocket } });
  const perm = permission === null ? null : new FakePermission(permission);
  const saved: ReaderMode[] = [];
  const input = new CardInput({ keyboard, bridge, mode, saveMode: (m) => saved.push(m), queryPermission: async () => perm });
  const scans: ScanEvent[] = [];
  input.scans.subscribe((s) => scans.push(s));
  const typeUid = (uid: string) => keyboard.scans.emit({ uid, at: 0, source: 'keyboard', ndefKey: null, records: [] });
  return { fake, input, scans, typeUid, perm, saved, keyboard };
}

describe('CardInput', () => {
  it('keyboard mode never contacts the bridge', async () => {
    const { fake, scans, typeUid } = setup('keyboard', 'granted');
    await tick(5000);
    expect(fake.connections).toBe(0);
    typeUid('04A23B1C');
    expect(scans.map((s) => s.uid)).toEqual(['04A23B1C']);
  });

  it('bridge mode takes bridge scans and drops keyboard ones', async () => {
    const { fake, input, scans, typeUid } = setup('bridge');
    await tick();
    expect(fake.connections).toBe(1);
    expect(input.bridgeReady).toBe(true);
    typeUid('04A23B1C');
    fake.placeCard(R, FakeTag.ntag('NTAG213'));
    await tick();
    expect(scans.map((s) => s.source)).toEqual(['bridge']);
  });

  it('keyboard mode stays on the keyboard even when Chrome already allows the bridge', async () => {
    const { fake, perm, input } = setup('keyboard', 'granted');
    perm!.set('granted');
    await tick(5000);
    expect(fake.connections).toBe(0);
    expect(input.permission).toBe('granted');
  });

  it('bridge mode stays on the bridge while it is down: keyboard scans never take over', async () => {
    const { fake, input, scans, typeUid } = setup('bridge');
    await tick();
    fake.stop();
    await tick(5000);
    typeUid('04A23B1C');
    expect(scans).toEqual([]);
    expect(input.bridgeReady).toBe(false);
  });

  it('reports the permission state without acting on it', async () => {
    const { fake, input, perm } = setup('bridge', 'prompt');
    await tick();
    expect(fake.connections).toBe(1);
    perm!.set('denied');
    await tick();
    expect(input.permission).toBe('denied');
    expect(input.mode).toBe('bridge');
  });

  it('switching modes saves the mode and applies it live', async () => {
    const { fake, input, saved } = setup('keyboard');
    await tick();
    input.setMode('bridge');
    await tick();
    expect(fake.connections).toBe(1);
    input.setMode('keyboard');
    await tick();
    expect(fake.connections).toBe(0);
    expect(saved).toEqual(['bridge', 'keyboard']);
  });

  it('destroy closes the bridge and the keyboard listener', async () => {
    const { fake, input, keyboard } = setup('bridge');
    await tick();
    input.destroy();
    await tick();
    expect(fake.connections).toBe(0);
    expect(keyboard.destroy).toHaveBeenCalled();
  });
});
