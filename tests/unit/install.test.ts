import { describe, expect, it } from 'vitest';
import { reduceInstallState } from '../../src/pwa/install';

describe('install-state reducer', () => {
  it('trusts the display-mode media query first', () => {
    expect(reduceInstallState('unknown', { type: 'init', stored: 'not-installed', runningAsApp: true })).toBe('installed');
  });

  it('falls back to the stored flag (kiosk tabs report display-mode browser)', () => {
    expect(reduceInstallState('unknown', { type: 'init', stored: 'installed', runningAsApp: false })).toBe('installed');
    expect(reduceInstallState('unknown', { type: 'init', stored: 'not-installed', runningAsApp: false })).toBe('not-installed');
    expect(reduceInstallState('unknown', { type: 'init', stored: null, runningAsApp: false })).toBe('unknown');
  });

  it('beforeinstallprompt means not installed, even if the flag said installed (uninstalled since)', () => {
    expect(reduceInstallState('installed', { type: 'beforeinstallprompt' })).toBe('not-installed');
  });

  it('appinstalled means installed', () => {
    expect(reduceInstallState('not-installed', { type: 'appinstalled' })).toBe('installed');
  });

  it('switching into app display mode marks installed; leaving it keeps state', () => {
    expect(reduceInstallState('unknown', { type: 'displayModeChanged', runningAsApp: true })).toBe('installed');
    expect(reduceInstallState('installed', { type: 'displayModeChanged', runningAsApp: false })).toBe('installed');
  });
});
