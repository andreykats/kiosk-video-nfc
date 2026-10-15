import { readFileSync } from 'node:fs';
import { crc32, inflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { executableZip } from '../../scripts/commandZip.ts';

/** Reads the single entry of a zip through its central directory, as unzippers do. */
function readOnlyEntry(zip: Buffer) {
  const end = zip.length - 22;
  expect(zip.readUInt32LE(end)).toBe(0x06054b50);
  expect(zip.readUInt16LE(end + 10)).toBe(1);
  const cd = zip.readUInt32LE(end + 16);
  expect(zip.readUInt32LE(cd)).toBe(0x02014b50);
  const nameLength = zip.readUInt16LE(cd + 28);
  const local = zip.readUInt32LE(cd + 42);
  expect(zip.readUInt32LE(local)).toBe(0x04034b50);
  const dataStart = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
  const data = inflateRawSync(zip.subarray(dataStart, dataStart + zip.readUInt32LE(cd + 20)));
  return {
    name: zip.toString('utf8', cd + 46, cd + 46 + nameLength),
    madeByHost: zip.readUInt16LE(cd + 4) >> 8,
    mode: zip.readUInt32LE(cd + 38) >>> 16,
    crc: zip.readUInt32LE(cd + 16),
    data,
  };
}

describe('executableZip', () => {
  it('stores the script as an executable Unix file, so a double-clicked .command runs', () => {
    const script = readFileSync(new URL('../../public/acr1552-mode.sh', import.meta.url));
    const entry = readOnlyEntry(executableZip('ACR1552U HID Mode.command', script));
    expect(entry.name).toBe('ACR1552U HID Mode.command');
    expect(entry.madeByHost).toBe(3);
    expect(entry.mode).toBe(0o100755);
    expect(entry.data.equals(script)).toBe(true);
    expect(entry.crc).toBe(crc32(script));
  });

  it('is reproducible', () => {
    const content = Buffer.from('#!/bin/bash\necho hi\n');
    expect(executableZip('a.command', content).equals(executableZip('a.command', content))).toBe(true);
  });
});
