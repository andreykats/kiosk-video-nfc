import { readFileSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** Unix regular file, rwxr-xr-x. */
const EXECUTABLE_MODE = 0o100755;
/** "Version made by" host 3 (Unix), so unzippers apply the mode bits. */
const MADE_BY_UNIX = (3 << 8) | 20;
const VERSION_NEEDED = 20;
const DEFLATE = 8;
/** DOS date for 2026-01-01, fixed so builds are reproducible. */
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

/**
 * A zip holding one executable file. Browsers drop the execute bit on
 * downloads, and a .command file without it won't run when double-clicked;
 * Archive Utility restores it from the zip's Unix mode bits.
 */
export function executableZip(entryName: string, content: Buffer): Buffer {
  const name = Buffer.from(entryName, 'utf8');
  const data = deflateRawSync(content);
  const crc = crc32(content);
  const flags = 0x0800; // UTF-8 file name

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(VERSION_NEEDED, 4);
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(DEFLATE, 8);
  local.writeUInt16LE(0, 10); // time
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28); // extra length

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(MADE_BY_UNIX, 4);
  central.writeUInt16LE(VERSION_NEEDED, 6);
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(DEFLATE, 10);
  central.writeUInt16LE(0, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  // extra, comment, disk number, internal attributes: 0
  central.writeUInt32LE((EXECUTABLE_MODE << 16) >>> 0, 38);
  central.writeUInt32LE(0, 42); // local header offset

  const centralOffset = local.length + name.length + data.length;
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8); // entries on this disk
  end.writeUInt16LE(1, 10); // entries
  end.writeUInt32LE(central.length + name.length, 12);
  end.writeUInt32LE(centralOffset, 16);

  return Buffer.concat([local, name, data, central, name, end]);
}

/** Emits `fileName` (a zip of `source` as `entryName`) into the build output. */
export function commandZip(options: { source: string; entryName: string; fileName: string }): Plugin {
  return {
    name: 'command-zip',
    apply: 'build',
    generateBundle() {
      this.addWatchFile(options.source);
      this.emitFile({ type: 'asset', fileName: options.fileName, source: executableZip(options.entryName, readFileSync(options.source)) });
    },
  };
}
