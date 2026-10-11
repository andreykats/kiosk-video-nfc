import { Emitter } from '../app/emitter';
import { errorMessage, log } from '../app/log';
import { fileNameError } from '../config/schema';

const VIDEOS_DIR = 'videos';
const PARTIAL_SUFFIX = '.partial';

export class StorageError extends Error {
  override name = 'StorageError';
}

export interface ImportOptions {
  onProgress?: (bytesWritten: number, totalBytes: number) => void;
  signal?: AbortSignal;
}

export function isQuotaError(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'QuotaExceededError';
}

/**
 * Video files in the origin private file system, one file per config fileName in
 * `/videos/`. Files are disk-backed, so playback uses getFile() + object URLs and
 * never reads a video into memory.
 */
export class VideoStore {
  readonly changed = new Emitter<void>();
  /** fileName → size in bytes, kept in sync with the directory. */
  private index = new Map<string, number>();

  private constructor(private readonly dir: FileSystemDirectoryHandle) {}

  static async open(): Promise<VideoStore> {
    if (!navigator.storage?.getDirectory) {
      throw new StorageError(
        'This browser cannot store videos (origin private file system unavailable). Use Google Chrome over HTTPS.',
      );
    }
    const root = await navigator.storage.getDirectory();
    const store = new VideoStore(await root.getDirectoryHandle(VIDEOS_DIR, { create: true }));
    await store.removeStalePartials();
    await store.refresh();
    return store;
  }

  /** Leftovers from imports interrupted by a crash or reload. */
  private async removeStalePartials(): Promise<void> {
    for await (const [name, handle] of this.dir.entries()) {
      if (handle.kind === 'file' && name.endsWith(PARTIAL_SUFFIX)) {
        await this.dir.removeEntry(name).catch((e) => log.warn(`Could not remove stale ${name}:`, e));
      }
    }
  }

  async refresh(): Promise<void> {
    const next = new Map<string, number>();
    for await (const [name, handle] of this.dir.entries()) {
      if (handle.kind !== 'file' || name.endsWith(PARTIAL_SUFFIX)) continue;
      try {
        next.set(name, (await handle.getFile()).size);
      } catch (e) {
        log.warn(`Could not read ${name} from storage:`, e);
      }
    }
    this.index = next;
    this.changed.emit();
  }

  files(): ReadonlyMap<string, number> {
    return this.index;
  }

  names(): ReadonlySet<string> {
    return new Set(this.index.keys());
  }

  has(fileName: string): boolean {
    return this.index.has(fileName);
  }

  /** Returns null if the file is missing (and drops it from the index). */
  async getFile(fileName: string): Promise<File | null> {
    try {
      const handle = await this.dir.getFileHandle(fileName);
      return await handle.getFile();
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') {
        if (this.index.delete(fileName)) this.changed.emit();
        return null;
      }
      throw e;
    }
  }

  /**
   * Streams `file` into OPFS as `<fileName>.partial`, then renames it over any
   * existing version. The final name only ever holds a complete file.
   */
  async importFile(file: File, fileName: string, options: ImportOptions = {}): Promise<void> {
    const nameErr = fileNameError(fileName);
    if (nameErr) throw new StorageError(`Cannot import: ${nameErr}.`);
    const partialName = fileName + PARTIAL_SUFFIX;
    try {
      const partial = await this.dir.getFileHandle(partialName, { create: true });
      const writable = await partial.createWritable();
      let written = 0;
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          written += chunk.byteLength;
          options.onProgress?.(written, file.size);
          controller.enqueue(chunk);
        },
      });
      await file.stream().pipeThrough(counter).pipeTo(writable, options.signal ? { signal: options.signal } : {});
      if (written !== file.size) {
        throw new StorageError(`Copy of "${fileName}" was incomplete (${written} of ${file.size} bytes).`);
      }
      await this.promote(partial, partialName, fileName);
    } catch (e) {
      await this.dir.removeEntry(partialName).catch(() => undefined);
      if (isQuotaError(e)) {
        throw new StorageError(`Not enough storage space for "${fileName}". Free up disk space and try again.`);
      }
      if (e instanceof StorageError) throw e;
      throw new StorageError(`Importing "${fileName}" failed: ${errorMessage(e)}`);
    }
    this.index.set(fileName, file.size);
    this.changed.emit();
  }

  private async promote(partial: FileSystemFileHandle, partialName: string, fileName: string): Promise<void> {
    if (partial.move) {
      try {
        await partial.move(fileName);
        return;
      } catch {
        // Some Chrome versions refuse to move over an existing entry: replace it.
        await this.dir.removeEntry(fileName).catch(() => undefined);
        await partial.move(fileName);
        return;
      }
    }
    // No rename support: copy the finished partial to the final name.
    await this.dir.removeEntry(fileName).catch(() => undefined);
    const target = await this.dir.getFileHandle(fileName, { create: true });
    await (await partial.getFile()).stream().pipeTo(await target.createWritable());
    await this.dir.removeEntry(partialName);
  }

  async delete(fileName: string): Promise<void> {
    try {
      await this.dir.removeEntry(fileName);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) {
        throw new StorageError(`Deleting "${fileName}" failed: ${errorMessage(e)}`);
      }
    }
    this.index.delete(fileName);
    this.changed.emit();
  }
}

export interface StorageInfo {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
}

export async function storageInfo(): Promise<StorageInfo> {
  const [estimate, persisted] = await Promise.all([
    navigator.storage?.estimate?.().catch(() => null) ?? null,
    navigator.storage?.persisted?.().catch(() => null) ?? null,
  ]);
  return { usage: estimate?.usage ?? null, quota: estimate?.quota ?? null, persisted };
}

/** Asks Chrome to make storage persistent. Chrome decides without prompting. */
export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch (e) {
    log.warn('navigator.storage.persist() failed:', e);
    return false;
  }
}

/** Returns an error message if `bytes` won't fit in the remaining quota. */
export async function checkFreeSpace(bytes: number): Promise<string | null> {
  const { usage, quota } = await storageInfo();
  if (usage === null || quota === null) return null;
  const free = quota - usage;
  if (bytes > free) {
    return `Not enough storage: these files need ${formatBytes(bytes)} but only ${formatBytes(free)} is available. Free up disk space and try again.`;
  }
  return null;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 || value >= 100 ? 0 : 1)} ${units[unit]}`;
}
