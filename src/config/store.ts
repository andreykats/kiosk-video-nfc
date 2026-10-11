import { Emitter } from '../app/emitter';
import { emptyConfig, validateConfig, type Config } from './schema';

const DB_NAME = 'nfc-kiosk';
const DB_VERSION = 1;
const STORE = 'kv';
const CONFIG_KEY = 'activeConfig';
const APPLIED_KEY = 'lastApplied';

export interface AppliedInfo {
  source: 'published' | 'file';
  /** updatedAt of the config that was applied. */
  updatedAt: string | null;
  appliedAt: string;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
  });
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  const req = factory.open(DB_NAME, DB_VERSION);
  req.onupgradeneeded = () => req.result.createObjectStore(STORE);
  return request(req);
}

export interface LoadResult {
  config: Config;
  applied: AppliedInfo | null;
  /** Set when a stored config existed but failed validation; config is then empty. */
  error: string[] | null;
  /** True when a valid config was read from IndexedDB. */
  stored: boolean;
}

/**
 * Holds the active config in memory and persists every change to IndexedDB.
 * Changes are validated and written before the in-memory copy is replaced, so a
 * failed save never leaves the app with unsaved state.
 */
export class ConfigStore {
  readonly changed = new Emitter<Config>();
  private config: Config = emptyConfig();
  private applied: AppliedInfo | null = null;
  private loadError: string[] | null = null;
  private stored = false;

  private constructor(private readonly db: IDBDatabase) {}

  static async open(factory: IDBFactory = indexedDB): Promise<ConfigStore> {
    const store = new ConfigStore(await openDb(factory));
    await store.load();
    return store;
  }

  private async load(): Promise<void> {
    const tx = this.db.transaction(STORE, 'readonly');
    const os = tx.objectStore(STORE);
    const [raw, applied] = await Promise.all([request(os.get(CONFIG_KEY)), request(os.get(APPLIED_KEY))]);
    this.applied = (applied as AppliedInfo | undefined) ?? null;
    if (raw === undefined) return;
    const result = validateConfig(raw);
    if (result.ok) {
      this.config = result.value;
      this.stored = true;
    } else {
      this.loadError = result.error;
    }
  }

  get(): Config {
    return this.config;
  }

  lastApplied(): AppliedInfo | null {
    return this.applied;
  }

  status(): Pick<LoadResult, 'error' | 'stored'> {
    return { error: this.loadError, stored: this.stored };
  }

  /** Applies a local edit. Throws (leaving state untouched) if invalid or unsaved. */
  async update(edit: (config: Config) => Config): Promise<Config> {
    return this.write(edit(this.config), undefined);
  }

  /** Replaces the whole config, e.g. from the published file or an imported file. */
  async replace(config: Config, applied: AppliedInfo): Promise<Config> {
    return this.write(config, applied);
  }

  private async write(next: Config, applied: AppliedInfo | undefined): Promise<Config> {
    const result = validateConfig(next);
    if (!result.ok) throw new Error(`Invalid config: ${result.error.join(' ')}`);
    const tx = this.db.transaction(STORE, 'readwrite');
    const os = tx.objectStore(STORE);
    os.put(result.value, CONFIG_KEY);
    if (applied) os.put(applied, APPLIED_KEY);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Saving config failed'));
      tx.onabort = () => reject(tx.error ?? new Error('Saving config was aborted'));
    });
    this.config = result.value;
    if (applied) this.applied = applied;
    this.loadError = null;
    this.stored = true;
    this.changed.emit(this.config);
    return this.config;
  }
}
