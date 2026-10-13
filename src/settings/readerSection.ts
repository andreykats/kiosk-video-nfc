import type { AppContext } from '../app/context';
import { ndefCardCount } from '../config/ops';
import { usableReaders } from '../scan/bridge/bridgeScanner';
import { isReaderMode, type ReaderMode } from '../scan/readerMode';
import { h, replaceChildren } from '../ui/dom';
import { reactiveSection, type Section } from './section';

export const BRIDGE_DOWNLOAD_URL = 'https://github.com/andreykats/nfc-browser-bridge/releases';

const MODE_LABELS: Record<ReaderMode, string> = {
  keyboard: 'HID Keyboard - Read card’s UID only',
  bridge: 'NFC Browser Bridge (install separately) - Read card’s NDEF payload',
};

/** One line describing the bridge connection, for settings and diagnostics. */
export function bridgeStatusText(ctx: AppContext): string {
  const s = ctx.scanner.bridgeStatus;
  switch (s.state) {
    case 'off':
      return 'Not connected';
    case 'connecting':
      return 'Connecting…';
    case 'unreachable':
      return ctx.scanner.permission === 'denied'
        ? 'Blocked by Chrome — allow “Apps on device” for this site'
        : 'Not running — start the NFC Browser Bridge app';
    case 'protocol-mismatch':
      return `${s.message}. Update the bridge app or reload the kiosk.`;
    case 'connected': {
      const prefix = `Connected (bridge v${s.version})`;
      if (s.service !== 'ready') return `${prefix} — no smart-card service; plug in the reader`;
      const readers = usableReaders(s.readers);
      return readers.length === 0 ? `${prefix} — no reader plugged in` : `${prefix} — ${readers.map((r) => r.name).join(', ')}`;
    }
  }
}

/**
 * Mode select and bridge status. Choosing Bridge app connects straight away, so
 * Chrome's "Apps on device" prompt appears while staff are there to answer it.
 */
export function readerControls(ctx: AppContext): Section {
  const el = h('div', { class: 'reader-controls', 'data-testid': 'reader-controls' });
  const render = () => {
    const mode = ctx.scanner.mode;
    const status = ctx.scanner.bridgeStatus;
    const select = h(
      'select',
      { 'data-testid': 'reader-mode', 'aria-label': 'Card reader input method' },
      ...(Object.keys(MODE_LABELS) as ReaderMode[]).map((m) => h('option', { value: m, selected: m === mode }, MODE_LABELS[m])),
    );
    select.addEventListener('change', () => {
      if (isReaderMode(select.value)) ctx.scanner.setMode(select.value);
    });
    const usesBridge = mode === 'bridge';
    replaceChildren(
      el,
      h('label', {}, 'Card reader input method: ', select),
      usesBridge
        ? h(
            'div',
            { class: 'bridge-status' },
            h('p', {}, h('strong', { 'data-testid': 'bridge-status', 'data-state': status.state }, bridgeStatusText(ctx))),
            status.state === 'connected'
              ? null
              : h('p', {}, h('a', { href: BRIDGE_DOWNLOAD_URL, target: '_blank', rel: 'noopener' }, 'Download the bridge app')),
            ctx.scanner.permission === 'denied'
              ? h('p', { class: 'banner banner-warn' }, 'Chrome is blocking this site from reaching the bridge app. Click the site settings icon left of the address bar, set “Apps on device” to Allow, then reload.')
              : h('p', { class: 'hint' }, 'The first connection makes Chrome ask to allow “Apps on device”. Choose Allow.'),
          )
        : null,
    );
  };
  return reactiveSection(el, render, [(l) => ctx.scanner.changed.subscribe(l)]);
}

export function renderReaderSection(ctx: AppContext): Section {
  const controls = readerControls(ctx);
  const warning = h('div');
  const warn = reactiveSection(
    warning,
    () => {
      const count = ndefCardCount(ctx.config.get());
      replaceChildren(
        warning,
        ctx.scanner.mode === 'keyboard' && count > 0
          ? h(
              'p',
              { class: 'banner banner-warn', 'data-testid': 'reader-ndef-warning' },
              `${count} card(s) are recognised by card ID, which needs the bridge app. They won’t work while this kiosk uses keyboard input.`,
            )
          : null,
      );
    },
    [(l) => ctx.scanner.changed.subscribe(l), (l) => ctx.config.changed.subscribe(l)],
  );
  const el = h('section', { 'data-testid': 'reader-section' }, h('h2', {}, 'Card reader'), controls.el, warning);
  return {
    el,
    destroy: () => {
      controls.destroy();
      warn.destroy();
    },
  };
}
