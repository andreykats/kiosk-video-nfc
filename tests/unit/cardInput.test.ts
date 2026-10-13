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
    const { fake, input, scans, typeUid } = setup('keyboard', 'granted');
    await tick(5000);
    expect(fake.connections).toBe(0);
    expect(input.activeSource).toBe('keyboard');
    typeUid('04A23B1C');
    expect(scans.map((s) => s.uid)).toEqual(['04A23B1C']);
  });

  it('bridge mode takes bridge scans and drops keyboard ones', async () => {
    const { fake, input, scans, typeUid } = setup('bridge');
    await tick();
    expect(fake.connections).toBe(1);
    expect(input.activeSource).toBe('bridge');
    typeUid('04A23B1C');
    fake.placeCard(R, FakeTag.ntag('NTAG213'));
    await tick();
    expect(scans.map((s) => s.source)).toEqual(['bridge']);
  });

  it('automatic mode does not connect until the permission is granted, so Chrome never prompts by itself', async () => {
    const { fake, input, perm } = setup('auto', 'prompt');
    await tick(5000);
    expect(fake.connections).toBe(0);
    expect(input.activeSource).toBe('keyboard');
    perm!.set('granted');
    await tick();
    expect(fake.connections).toBe(1);
    expect(input.activeSource).toBe('bridge');
  });

  it('automatic mode does not connect when the permission state is unknown', async () => {
    const { fake } = setup('auto', null);
    await tick(5000);
    expect(fake.connections).toBe(0);
  });

  it('automatic mode uses the keyboard while the bridge is down or has no reader', async () => {
    const { fake, input, scans, typeUid } = setup('auto', 'granted');
    await tick();
    expect(input.activeSource).toBe('bridge');
    typeUid('04A23B1C');
    expect(scans).toEqual([]);

    fake.removeReader(R);
    await tick();
    expect(input.activeSource).toBe('keyboard');
    typeUid('04A23B1C');
    expect(scans.map((s) => s.source)).toEqual(['keyboard']);

    fake.addReader(R);
    await tick();
    expect(input.activeSource).toBe('bridge');
    fake.stop();
    await tick();
    expect(input.activeSource).toBe('keyboard');
  });

  it('connectBridge connects in automatic mode before the permission is granted (staff action)', async () => {
    const { fake, input } = setup('auto', 'prompt');
    await tick();
    input.connectBridge();
    await tick();
    expect(fake.connections).toBe(1);
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
