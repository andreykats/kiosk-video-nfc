import type { BridgeStatus } from '../scan/bridge/bridgeScanner';

/**
 * Why tag scans can't work in bridge mode, for the notice over the kiosk.
 * Null when they can, or while it's too early to tell.
 */
export function bridgeNotice(status: BridgeStatus, ready: boolean): string | null {
  if (ready) return null;
  switch (status.state) {
    case 'off':
    case 'connecting':
      return null;
    case 'protocol-mismatch':
      return 'The bridge app needs updating.';
    case 'unreachable':
      return 'Start the NFC Browser Bridge app on this computer.';
    case 'connected':
      if (status.recovery === 'failed') return 'The NFC reader isn’t responding. Unplug it and plug it back in.';
      // Plugged in but not listed: the bridge resets it.
      if (status.recovery === 'recovering' || (status.usbReaders?.length ?? 0) > 0) return 'The NFC reader isn’t responding. Restarting it…';
      return 'Plug in the NFC reader.';
  }
}
