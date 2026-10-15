import { describe, expect, it } from 'vitest';
import { autostartUrl } from '../../src/app/autostart';

describe('autostartUrl', () => {
  it('adds the startup marker to the kiosk address, without the route', () => {
    expect(autostartUrl('https://topps.drey.dev/')).toBe('https://topps.drey.dev/?autostart');
    expect(autostartUrl('http://localhost:4173/topps-nfc-kiosk/#/setup')).toBe('http://localhost:4173/topps-nfc-kiosk/?autostart');
  });
});
