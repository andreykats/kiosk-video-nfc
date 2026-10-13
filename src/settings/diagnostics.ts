import type { AppContext } from '../app/context';
import { log, logChanged } from '../app/log';
import { formatUid } from '../scan/uid';
import { formatBytes } from '../videos/opfsStore';
import { h, replaceChildren } from '../ui/dom';
import { bridgeStatusText } from './readerSection';
import { reactiveSection, type Section } from './section';

const AUTOPLAY_TEXT = {
  unknown: 'not tested yet (open the kiosk view)',
  ok: 'OK — plays with sound',
  muted: 'Blocked with sound — playing muted. Launch Chrome with --autoplay-policy=no-user-gesture-required.',
  blocked: 'Blocked — videos cannot autoplay. Launch Chrome with --autoplay-policy=no-user-gesture-required.',
} as const;

const READER_MODE_TEXT = { keyboard: 'HID Keyboard', bridge: 'NFC Browser Bridge' } as const;

function row(label: string, value: Node | string, testId?: string): HTMLElement {
  return h('div', { class: 'diag-row' }, h('dt', {}, label), h('dd', { 'data-testid': testId }, value));
}

export function renderOfflineIndicator(ctx: AppContext): Section {
  const el = h('div', { class: 'offline-ready', 'data-testid': 'offline-ready' });
  return reactiveSection(
    el,
    () => {
      const snapshot = ctx.readiness.get();
      if (!snapshot) return replaceChildren(el, 'Checking…');
      const { ready, conditions } = snapshot.readiness;
      el.dataset.ready = String(ready);
      const justCached = ctx.sw.get().justCachedAt;
      replaceChildren(
        el,
        h('p', { class: `overall ${ready ? 'good' : 'bad'}` }, ready ? 'Ready to work offline ✓' : 'Not ready to work offline'),
        justCached && Date.now() - justCached < 10_000 ? h('p', { class: 'hint' }, 'App cached for offline use.') : null,
        h(
          'ul',
          {},
          ...conditions.map((c) =>
            h(
              'li',
              { class: `status-${c.status}`, 'data-condition': c.id, 'data-status': c.status },
              h('span', { class: 'mark' }, c.status === 'pass' ? '✓' : c.status === 'warn' ? '!' : '✗'),
              ' ',
              c.label,
              c.detail ? h('span', { class: 'hint' }, ` — ${c.detail}`) : null,
            ),
          ),
        ),
      );
    },
    [(l) => ctx.readiness.changed.subscribe(l)],
  );
}

export function renderDiagnostics(ctx: AppContext): Section {
  const offline = renderOfflineIndicator(ctx);
  const body = h('dl', { class: 'diag' });
  const logList = h('ol', { class: 'log', reversed: true });

  const render = () => {
    const snapshot = ctx.readiness.get();
    const storage = snapshot?.storage;
    const sw = ctx.sw.get();
    const scan = ctx.diagnostics.lastScan;
    replaceChildren(
      body,
      row('Installed', ctx.install.get() === 'installed' ? 'yes' : ctx.install.get() === 'not-installed' ? 'no' : 'unknown', 'diag-installed'),
      row(
        'Storage',
        storage?.usage != null && storage.quota != null ? `${formatBytes(storage.usage)} used of ${formatBytes(storage.quota)}` : 'unknown',
      ),
      row('Persisted', storage?.persisted == null ? 'unknown' : storage.persisted ? 'yes' : 'no — install the app to make storage persistent', 'diag-persisted'),
      row('Card reader', READER_MODE_TEXT[ctx.scanner.mode], 'diag-reader'),
      ctx.scanner.mode === 'keyboard' ? null : row('Bridge app', bridgeStatusText(ctx), 'diag-bridge'),
      row(
        'Last scanned UID',
        scan
          ? h(
              'span',
              {},
              h('strong', { class: 'mono' }, formatUid(scan.uid)),
              ` (${scan.uid}) at ${new Date(scan.at).toLocaleTimeString()} via ${scan.source === 'bridge' ? 'the bridge app' : 'the keyboard'}`,
            )
          : 'none yet — scan a card to test the reader',
        'diag-last-scan',
      ),
      scan?.source === 'bridge'
        ? row(
            'Card ID (NDEF)',
            h(
              'div',
              {},
              h('strong', { class: 'mono' }, scan.ndefKey ?? 'none — the card has no URI or Text record'),
              scan.records.length > 0
                ? h('ol', { class: 'ndef-records' }, ...scan.records.map((r) => h('li', {}, `${r.tnf} ${r.type}: `, h('span', { class: 'mono' }, r.value))))
                : null,
            ),
            'diag-ndef',
          )
        : null,
      row(
        'Autoplay',
        h('span', { class: ctx.diagnostics.autoplay === 'ok' || ctx.diagnostics.autoplay === 'unknown' ? '' : 'banner banner-warn' }, AUTOPLAY_TEXT[ctx.diagnostics.autoplay]),
        'diag-autoplay',
      ),
      row(
        'Service worker',
        h(
          'span',
          {},
          sw.state === 'error' ? `error: ${sw.error}` : sw.state,
          sw.needRefresh ? h('button', { type: 'button', class: 'primary', onclick: () => void ctx.sw.applyUpdate() }, 'App update available → Reload') : null,
        ),
        'diag-sw',
      ),
    );
    replaceChildren(
      logList,
      ...[...log.recent()].reverse().map((e) => h('li', { class: e.level }, `${new Date(e.at).toLocaleTimeString()} ${e.message}`)),
    );
  };

  const el = h(
    'section',
    { 'data-testid': 'diagnostics-section' },
    h('h2', {}, 'Diagnostics'),
    offline.el,
    body,
    h('details', {}, h('summary', {}, 'Recent errors and warnings'), logList),
  );
  const section = reactiveSection(el, render, [
    (l) => ctx.readiness.changed.subscribe(l),
    (l) => ctx.diagnostics.changed.subscribe(l),
    (l) => ctx.sw.changed.subscribe(l),
    (l) => ctx.install.changed.subscribe(l),
    (l) => logChanged.subscribe(l),
    (l) => ctx.scanner.changed.subscribe(l),
  ]);
  return { el, destroy: () => (offline.destroy(), section.destroy()) };
}
