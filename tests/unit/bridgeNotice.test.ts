import { describe, expect, it } from 'vitest';
import { bridgeNotice } from '../../src/kiosk/bridgeNotice';
import type { BridgeStatus } from '../../src/scan/bridge/bridgeScanner';

const R = { name: 'ACS ACR1255U-J1', kind: 'picc' as const, card: null };

function connected(over: Partial<Extract<BridgeStatus, { state: 'connected' }>> = {}): BridgeStatus {
  return { state: 'connected', version: '1.0.0', service: 'ready', readers: [], usbReaders: null, recovery: null, ...over };
}

describe('bridgeNotice', () => {
  it('says nothing while scans work or it is too early to tell', () => {
    expect(bridgeNotice(connected({ readers: [R] }), true)).toBeNull();
    expect(bridgeNotice({ state: 'off' }, false)).toBeNull();
    expect(bridgeNotice({ state: 'connecting' }, false)).toBeNull();
  });

  it('names what is missing', () => {
    expect(bridgeNotice({ state: 'unreachable' }, false)).toBe('Start the NFC Browser Bridge app on this computer.');
    expect(bridgeNotice({ state: 'protocol-mismatch', message: 'x' }, false)).toBe('The bridge app needs updating.');
    // A bridge that can't see USB, or no reader on USB: it's unplugged.
    expect(bridgeNotice(connected(), false)).toBe('Plug in the NFC reader.');
    expect(bridgeNotice(connected({ usbReaders: [], recovery: 'idle' }), false)).toBe('Plug in the NFC reader.');
  });

  it('tells a plugged-in reader that stopped working from an unplugged one', () => {
    const plugged = { usbReaders: [{ name: R.name }] };
    expect(bridgeNotice(connected({ ...plugged, recovery: 'idle' }), false)).toBe('The NFC reader isn’t responding. Restarting it…');
    expect(bridgeNotice(connected({ ...plugged, recovery: 'recovering' }), false)).toBe('The NFC reader isn’t responding. Restarting it…');
    expect(bridgeNotice(connected({ ...plugged, readers: [R], recovery: 'failed' }), false)).toBe(
      'The NFC reader isn’t responding. Unplug it and plug it back in.',
    );
  });
});
