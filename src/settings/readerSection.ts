import type { AppContext } from '../app/context';
import { unrecognisedCardCount } from '../config/ops';
import { usableReaders } from '../scan/bridge/bridgeScanner';
import { CARD_KEYS, isCardKey, isReaderMode, type ReaderMode } from '../scan/readerMode';
import { h, replaceChildren } from '../ui/dom';
import { CARD_KEY_LABELS } from './pairing';
import { reactiveSection, type Section } from './section';

export const BRIDGE_DOWNLOAD_URL = 'https://github.com/andreykats/nfc-browser-bridge/releases';

const MODE_LABELS: Record<ReaderMode, string> = {
  keyboard: 'HID Keyboard (Read card’s UID only)',
  bridge: 'NFC Browser Bridge (Read card’s NDEF payload)',
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
 * Mode select, card identifier and bridge status. Choosing Bridge app connects
 * straight away, so Chrome's "Apps on device" prompt appears while staff are
 * there to answer it.
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
    const cardKey = ctx.scanner.cardKey;
    const keySelect = h(
      'select',
      { 'data-testid': 'card-key', 'aria-label': 'Card identifier', disabled: !usesBridge },
      ...CARD_KEYS.map((k) => h('option', { value: k, selected: k === cardKey }, CARD_KEY_LABELS[k])),
    );
    keySelect.addEventListener('change', () => {
      if (isCardKey(keySelect.value)) ctx.scanner.setCardKey(keySelect.value);
    });
    replaceChildren(
      el,
      h('label', {}, 'Card reader input method: ', select),
      h('label', {}, 'Card identifier: ', keySelect),
      h(
        'p',
        { class: 'hint' },
        !usesBridge
          ? 'HID Keyboard readers only read the UID.'
          : cardKey === 'ndef'
            ? 'Cards are paired and played by the first URI or Text record on the card. Every card written with the same payload plays the same video.'
            : 'Cards are paired and played by their UID. Each physical card is paired on its own.',
      ),
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
      const key = ctx.scanner.cardKey;
      const count = unrecognisedCardCount(ctx.config.get(), key, ctx.scanner.mode === 'bridge');
      const other = key === 'uid' ? CARD_KEY_LABELS.ndef : CARD_KEY_LABELS.uid;
      replaceChildren(
        warning,
        count > 0
          ? h(
              'p',
              { class: 'banner banner-warn', 'data-testid': 'reader-card-key-warning' },
              `${count} card(s) in the config are identified by ${other}, so this kiosk won’t recognise them. It identifies cards by ${CARD_KEY_LABELS[key]}.`,
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
