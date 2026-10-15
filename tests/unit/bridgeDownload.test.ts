import { describe, expect, it } from 'vitest';
import { bridgeDownloadUrl } from '../../src/settings/readerSection';

describe('bridge download link', () => {
  it('points at the installer for this computer in the latest release', () => {
    expect(bridgeDownloadUrl('MacIntel')).toBe(
      'https://github.com/andreykats/nfc-browser-bridge/releases/latest/download/NFC-Browser-Bridge-macos.dmg',
    );
    expect(bridgeDownloadUrl('Win32')).toBe(
      'https://github.com/andreykats/nfc-browser-bridge/releases/latest/download/NFC-Browser-Bridge-windows-setup.exe',
    );
  });

  it('falls back to the releases page on other platforms', () => {
    expect(bridgeDownloadUrl('Linux x86_64')).toBe('https://github.com/andreykats/nfc-browser-bridge/releases');
  });
});
