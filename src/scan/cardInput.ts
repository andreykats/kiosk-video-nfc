import { Emitter } from '../app/emitter';
import { BridgeScanner, usableReaders, type BridgeStatus } from './bridge/bridgeScanner';
import { KeyboardScanner } from './keyboardScanner';
import { readCardKey, readReaderMode, writeCardKey, writeReaderMode, type CardKey, type ReaderMode } from './readerMode';
import type { ScanEvent } from './scanEvent';

/** Chrome's "Apps on device" permission, which an https page needs to reach the bridge on 127.0.0.1. */
export type LoopbackPermission = PermissionState | 'unknown';

export interface PermissionStatusLike {
  readonly state: PermissionState;
  onchange: ((this: PermissionStatus, ev: Event) => unknown) | null;
}

/** "loopback-network" is the current name (Chrome 146+); "local-network-access" is the older alias. */
export async function queryLoopbackPermission(): Promise<PermissionStatusLike | null> {
  for (const name of ['loopback-network', 'local-network-access']) {
    try {
      return await navigator.permissions.query({ name: name as PermissionName });
    } catch {
      // Unknown permission name in this Chrome; try the next.
    }
  }
  return null;
}

export interface CardInputDeps {
  keyboard?: { scans: Emitter<ScanEvent>; destroy(): void };
  bridge?: BridgeScanner;
  mode?: ReaderMode;
  saveMode?: (mode: ReaderMode) => void;
  cardKey?: CardKey;
  saveCardKey?: (key: CardKey) => void;
  queryPermission?: () => Promise<PermissionStatusLike | null>;
}

/**
 * The app's single source of card scans, from the input staff chose for this
 * kiosk. The keyboard scanner always listens, so a reader in HID mode never
 * types into inputs, but its scans only count in keyboard mode.
 */
export class CardInput {
  readonly scans = new Emitter<ScanEvent>();
  /** A tap the reader couldn't read (bridge mode only; a keyboard-mode reader types nothing for one). */
  readonly unreadable = new Emitter<void>();
  /** Mode, card key, permission or bridge status changed. */
  readonly changed = new Emitter<void>();
  /** The effective card key changed (also fires `changed`). */
  readonly cardKeyChanged = new Emitter<void>();
  private mode_: ReaderMode;
  private cardKey_: CardKey;
  private permission_: LoopbackPermission = 'unknown';
  private readonly keyboard: NonNullable<CardInputDeps['keyboard']>;
  private readonly bridge: BridgeScanner;
  private readonly saveMode: (mode: ReaderMode) => void;
  private readonly saveCardKey: (key: CardKey) => void;
  private readonly unsubscribers: (() => void)[];
  private permissionStatus: PermissionStatusLike | null = null;

  constructor(deps: CardInputDeps = {}) {
    this.keyboard = deps.keyboard ?? new KeyboardScanner();
    this.bridge = deps.bridge ?? new BridgeScanner();
    this.mode_ = deps.mode ?? readReaderMode();
    this.saveMode = deps.saveMode ?? writeReaderMode;
    this.cardKey_ = deps.cardKey ?? readCardKey();
    this.saveCardKey = deps.saveCardKey ?? writeCardKey;
    this.unsubscribers = [
      this.keyboard.scans.subscribe((scan) => {
        if (this.mode_ === 'keyboard') this.scans.emit(scan);
      }),
      this.bridge.scans.subscribe((scan) => {
        if (this.mode_ === 'bridge') this.scans.emit(scan);
      }),
      this.bridge.unreadable.subscribe(() => {
        if (this.mode_ === 'bridge') this.unreadable.emit();
      }),
      this.bridge.changed.subscribe(() => this.changed.emit()),
    ];
    this.bridge.readsCardIds = this.cardKey_ === 'ndef';
    this.apply();
    void this.watchPermission(deps.queryPermission ?? queryLoopbackPermission);
  }

  get mode(): ReaderMode {
    return this.mode_;
  }

  /** What identifies video cards on this kiosk. Keyboard mode only reads UIDs, so it's always the UID there. */
  get cardKey(): CardKey {
    return this.mode_ === 'keyboard' ? 'uid' : this.cardKey_;
  }

  get permission(): LoopbackPermission {
    return this.permission_;
  }

  get bridgeStatus(): BridgeStatus {
    return this.bridge.status;
  }

  /** The bridge is connected and has a working reader that can take a visitor's card. */
  get bridgeReady(): boolean {
    const s = this.bridge.status;
    return s.state === 'connected' && s.service === 'ready' && usableReaders(s.readers).length > 0 && s.recovery !== 'failed';
  }

  setMode(mode: ReaderMode): void {
    if (mode === this.mode_) return;
    const key = this.cardKey;
    this.mode_ = mode;
    this.saveMode(mode);
    this.apply();
    this.changed.emit();
    if (this.cardKey !== key) this.cardKeyChanged.emit();
  }

  /** Kept even in keyboard mode, so it applies again when the kiosk switches back to the bridge. */
  setCardKey(key: CardKey): void {
    if (key === this.cardKey_) return;
    const before = this.cardKey;
    this.cardKey_ = key;
    this.bridge.readsCardIds = key === 'ndef';
    this.saveCardKey(key);
    this.changed.emit();
    if (this.cardKey !== before) this.cardKeyChanged.emit();
  }

  destroy(): void {
    this.unsubscribers.forEach((u) => u());
    if (this.permissionStatus) this.permissionStatus.onchange = null;
    this.bridge.stop();
    this.keyboard.destroy();
  }

  /** Only bridge mode connects. In Chrome the first connection shows the "Apps on device" prompt. */
  private apply(): void {
    if (this.mode_ === 'bridge') this.bridge.start();
    else this.bridge.stop();
  }

  /** Tracked only to tell staff when Chrome is blocking the bridge. */
  private async watchPermission(query: () => Promise<PermissionStatusLike | null>): Promise<void> {
    const status = await query().catch(() => null);
    if (!status) return;
    this.permissionStatus = status;
    const update = () => {
      this.permission_ = status.state;
      this.changed.emit();
    };
    status.onchange = update;
    update();
  }
}
