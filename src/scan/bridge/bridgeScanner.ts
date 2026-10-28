import { Emitter } from '../../app/emitter';
import { log } from '../../app/log';
import { ndefKeyError } from '../../config/schema';
import type { ScanEvent, ScanRecord } from '../scanEvent';
import { isCanonicalUid } from '../uid';
import { BridgeClient, type BridgeClientOptions } from './vendor/client';
import { describeRecord, matchKey, TNF_NAMES, type NdefRecord } from './vendor/ndef';
import { isType2, readNdef } from './vendor/ntag';
import type { CardPresentEvent, Reader, RecoveryAction, RecoveryEvent, RecoveryState, ServiceStatus, UsbReader } from './vendor/protocol';

export type BridgeStatus =
  | { state: 'off' }
  | { state: 'connecting' }
  /** Connecting for a while without reaching the bridge: it isn't running, or Chrome blocked the connection. */
  | { state: 'unreachable' }
  | {
      state: 'connected';
      version: string;
      service: ServiceStatus;
      readers: Reader[];
      /** Readers on USB, plugged in whether or not they work; null if the bridge can't see USB (not macOS). */
      usbReaders: UsbReader[] | null;
      /** The bridge bringing a stuck reader back; null if the bridge can't see USB. */
      recovery: RecoveryState | null;
    }
  | { state: 'protocol-mismatch'; message: string };

export interface BridgeScannerOptions {
  client?: BridgeClientOptions;
  /** How long to wait for the NDEF data before scanning with the UID alone. */
  ndefTimeoutMs?: number;
  /** The same card again within this window is ignored. */
  debounceMs?: number;
  /** How long "connecting" lasts before it counts as unreachable. */
  unreachableAfterMs?: number;
  now?: () => number;
}

/** Readers that can hold a visitor's card (not SAM slots). */
export function usableReaders(readers: readonly Reader[]): Reader[] {
  return readers.filter((r) => r.kind !== 'sam');
}

/** One line for the log; card changes don't change it. Null for states not worth logging. */
export function describeBridgeStatus(s: BridgeStatus): string | null {
  switch (s.state) {
    case 'off':
    case 'connecting':
    case 'protocol-mismatch': // logged as an error when it happens
      return null;
    case 'unreachable':
      return 'not reachable';
    case 'connected': {
      const names = (list: readonly { name: string }[]) => list.map((r) => r.name).join(', ') || 'none';
      const parts = [`bridge v${s.version}`, `readers: ${names(usableReaders(s.readers))}`];
      if (s.service !== 'ready') parts.push('smart-card service unavailable');
      if (s.usbReaders) parts.push(`on USB: ${names(s.usbReaders)}`);
      if (s.recovery && s.recovery !== 'idle') parts.push(`recovery ${s.recovery}`);
      return `connected (${parts.join('; ')})`;
    }
  }
}

const RECOVERY_TEXT: Record<RecoveryAction, string> = {
  reopen: 'The bridge reconnected to the smart-card service',
  usb_reset: 'The bridge reset the tag reader over USB',
  failed: 'The bridge could not bring the tag reader back; it needs unplugging and plugging back in',
  recovered: 'The tag reader works again',
};

function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function summarize(records: NdefRecord[]): ScanRecord[] {
  return records.map((r) => ({ tnf: TNF_NAMES[r.tnf] ?? String(r.tnf), type: textOf(r.type), value: describeRecord(r) }));
}

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(`no answer within ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Card scans from the NFC Browser Bridge app (ws://127.0.0.1:38241). For each
 * new tap it reads the card's NDEF message and derives the card ID; a card that
 * can't be read in time still scans with its UID.
 */
export class BridgeScanner {
  readonly scans = new Emitter<ScanEvent>();
  readonly changed = new Emitter<void>();
  private client: BridgeClient | null = null;
  private status_: BridgeStatus = { state: 'off' };
  private unreachableTimer: ReturnType<typeof setTimeout> | undefined;
  private lastUid: string | null = null;
  private lastAt = -Infinity;
  private logged: string | null = null;
  private readonly unsubscribers: (() => void)[] = [];
  private readonly opts: Required<Omit<BridgeScannerOptions, 'client'>> & { client: BridgeClientOptions };

  constructor(options: BridgeScannerOptions = {}) {
    this.opts = {
      client: options.client ?? {},
      ndefTimeoutMs: options.ndefTimeoutMs ?? 1500,
      debounceMs: options.debounceMs ?? 1500,
      unreachableAfterMs: options.unreachableAfterMs ?? 2500,
      now: options.now ?? (() => performance.now()),
    };
  }

  get status(): BridgeStatus {
    return this.status_;
  }

  get active(): boolean {
    return this.client !== null;
  }

  /** Opens the connection (and keeps reconnecting). In Chrome this may show the "Apps on device" prompt. */
  start(): void {
    if (this.client) return;
    const client = new BridgeClient(this.opts.client);
    this.client = client;
    this.unsubscribers.push(
      client.on('state', (state) => {
        if (state === 'connecting') this.onConnecting();
        // 'open' is reported through hello/readers, which carry the details.
      }),
      client.on('readers', ({ service, readers, usbReaders, recovery }) => {
        if (client.state !== 'open') return;
        clearTimeout(this.unreachableTimer);
        this.setStatus({
          state: 'connected',
          version: client.version ?? 'unknown',
          service,
          readers,
          usbReaders: usbReaders ?? null,
          recovery: recovery ?? null,
        });
      }),
      client.on('recovery', (ev) => logRecovery(ev)),
      client.on('card_present', (ev) => void this.onCard(client, ev)),
      client.on('error', (e) => {
        log.error('Tag reader bridge:', e.message);
        this.setStatus({ state: 'protocol-mismatch', message: e.message });
      }),
    );
    client.connect();
  }

  stop(): void {
    clearTimeout(this.unreachableTimer);
    this.unsubscribers.splice(0).forEach((u) => u());
    this.client?.close();
    this.client = null;
    this.setStatus({ state: 'off' });
  }

  private onConnecting(): void {
    if (this.status_.state === 'connected') log.warn('Lost the connection to the tag reader bridge; reconnecting.');
    if (this.status_.state !== 'unreachable') this.setStatus({ state: 'connecting' });
    clearTimeout(this.unreachableTimer);
    this.unreachableTimer = setTimeout(() => {
      if (this.client?.state !== 'open') this.setStatus({ state: 'unreachable' });
    }, this.opts.unreachableAfterMs);
  }

  private setStatus(status: BridgeStatus): void {
    this.status_ = status;
    const text = describeBridgeStatus(status);
    if (text !== null && text !== this.logged) {
      const degraded = status.state !== 'connected' || usableReaders(status.readers).length === 0 || (status.recovery ?? 'idle') !== 'idle';
      (degraded ? log.warn : log.info)(`Tag reader bridge: ${text}.`);
    }
    if (text !== null) this.logged = text;
    this.changed.emit();
  }

  private async onCard(client: BridgeClient, ev: CardPresentEvent): Promise<void> {
    const reader = client.readers.find((r) => r.name === ev.reader);
    if (reader?.kind === 'sam') return;
    if (ev.uid === null || !isCanonicalUid(ev.uid)) {
      log.warn(`Tag on "${ev.reader}" has no usable UID (${ev.uid ?? 'none'}); ignored.`);
      return;
    }
    const at = this.opts.now();
    if (ev.uid === this.lastUid && at - this.lastAt < this.opts.debounceMs) return;
    this.lastUid = ev.uid;
    this.lastAt = at;

    let records: NdefRecord[] = [];
    if (isType2(ev.atr)) {
      try {
        records = (await withTimeout(readNdef(client, ev.reader, ev.atr), this.opts.ndefTimeoutMs)).records;
      } catch (e) {
        log.warn(`Reading the NDEF data of tag ${ev.uid} failed; matching by UID only.`, e);
      }
    }
    if (this.client !== client) return; // stopped while reading
    let ndefKey = matchKey(records);
    const problem = ndefKey === null ? null : ndefKeyError(ndefKey);
    if (problem) {
      log.warn(`Tag ${ev.uid} has a tag ID that can't be used (it ${problem}); matching by UID only.`);
      ndefKey = null;
    }
    this.scans.emit({ uid: ev.uid, at, source: 'bridge', ndefKey, records: summarize(records) });
  }
}

function logRecovery(ev: RecoveryEvent): void {
  const text = ev.action === 'recovered' ? `${RECOVERY_TEXT.recovered}.` : `${RECOVERY_TEXT[ev.action]}: ${ev.reason}.`;
  if (ev.action === 'failed') log.error(text);
  else if (ev.action === 'recovered') log.info(text);
  else log.warn(text);
}
