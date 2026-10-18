import { describe, expect, it } from 'vitest';
import { autostartUrl } from '../../src/app/autostart';

describe('autostartUrl', () => {
  it('adds the startup marker to the kiosk address, without the route', () => {
    expect(autostartUrl('https://example.com/')).toBe('https://example.com/?autostart');
    expect(autostartUrl('http://localhost:4173/kiosk-video-nfc-website/#/setup')).toBe('http://localhost:4173/kiosk-video-nfc-website/?autostart');
  });
});
