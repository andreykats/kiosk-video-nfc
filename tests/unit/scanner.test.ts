import { describe, expect, it } from 'vitest';
import { hexForCode, ScanParser, type FeedResult, type KeyInput } from '../../src/scan/keyboardScanner';

const CODE_FOR_CHAR: Record<string, string> = {
  ...Object.fromEntries('0123456789'.split('').map((d) => [d, `Digit${d}`])),
  ...Object.fromEntries('ABCDEF'.split('').map((l) => [l, `Key${l}`])),
  ' ': 'Space',
  '-': 'Minus',
  ':': 'Semicolon',
};

/** Feeds a string as reader keystrokes, `gap` ms apart, returning every result. */
function type(parser: ScanParser, text: string, opts: { start?: number; gap?: number; enter?: boolean } = {}) {
  let at = opts.start ?? 1000;
  const gap = opts.gap ?? 5;
  const results: FeedResult[] = [];
  for (const ch of text) {
    results.push(parser.feed({ code: CODE_FOR_CHAR[ch.toUpperCase()]!, at }));
    at += gap;
  }
  if (opts.enter ?? true) results.push(parser.feed({ code: 'Enter', at }));
  return { results, end: at, scans: results.flatMap((r) => (r.scan ? [r.scan.uid] : [])) };
}

describe('hexForCode', () => {
  it('maps digit, numpad and A–F key codes', () => {
    expect(hexForCode('Digit7')).toBe('7');
    expect(hexForCode('Numpad0')).toBe('0');
    expect(hexForCode('KeyA')).toBe('A');
    expect(hexForCode('KeyF')).toBe('F');
    expect(hexForCode('KeyG')).toBeNull();
    expect(hexForCode('Enter')).toBeNull();
  });
});

describe('ScanParser', () => {
  it.each([
    ['4-byte', '04A23B1C'],
    ['7-byte', '04A23B1C5D8000'],
    ['8-byte', '04A23B1C5D800011'],
    ['10-byte', '04A23B1C5D8000112233'],
  ])('accepts a %s UID burst ending in Enter', (_, uid) => {
    expect(type(new ScanParser(), uid).scans).toEqual([uid]);
  });

  it('rejects bursts of other lengths', () => {
    const parser = new ScanParser();
    expect(type(parser, '04A23B').scans).toEqual([]);
    expect(type(parser, '04A23B1C5', { start: 5000 }).scans).toEqual([]);
  });

  it('strips space, dash and colon separators', () => {
    const parser = new ScanParser();
    expect(type(parser, '04 A2 3B 1C 5D 80 00').scans).toEqual(['04A23B1C5D8000']);
    expect(type(parser, '04-A2-3B-1C', { start: 9000 }).scans).toEqual(['04A23B1C']);
    expect(type(parser, '04:A2:3B:1C:5D:80:00:11', { start: 20000 }).scans).toEqual(['04A23B1C5D800011']);
  });

  it('accepts lowercase output because it decodes key codes', () => {
    expect(type(new ScanParser(), '04a23b1c').scans).toEqual(['04A23B1C']);
  });

  it('accepts NumpadEnter as terminator and numpad digits', () => {
    const parser = new ScanParser();
    const keys = ['Numpad0', 'Numpad4', 'KeyA', 'Numpad2', 'KeyB', 'Numpad3', 'KeyC', 'Numpad1'];
    keys.forEach((code, i) => parser.feed({ code, at: 100 + i * 5 }));
    expect(parser.feed({ code: 'NumpadEnter', at: 150 }).scan?.uid).toBe('04A2B3C1');
  });

  it('flushes on idle when the reader sends no Enter', () => {
    const parser = new ScanParser();
    const { end } = type(parser, '04A23B1C', { enter: false });
    expect(parser.active).toBe(true);
    expect(parser.flush(end + 150)?.uid).toBe('04A23B1C');
    expect(parser.active).toBe(false);
  });

  it('validates the idle flush the same way', () => {
    const parser = new ScanParser();
    const { end } = type(parser, '04A2', { enter: false });
    expect(parser.flush(end + 150)).toBeUndefined();
  });

  it('rejects slow human typing', () => {
    expect(type(new ScanParser(), '04A23B1C', { gap: 120 }).scans).toEqual([]);
  });

  it('restarts the buffer after a long gap', () => {
    const parser = new ScanParser();
    type(parser, '99', { enter: false, start: 0 });
    // A fresh fast burst after the gap still scans cleanly.
    expect(type(parser, '04A23B1C', { start: 500 }).scans).toEqual(['04A23B1C']);
  });

  it('aborts the burst on a non-hex key', () => {
    const parser = new ScanParser();
    parser.feed({ code: 'Digit0', at: 0 });
    parser.feed({ code: 'Digit4', at: 5 });
    expect(parser.feed({ code: 'KeyZ', at: 10 }).consumed).toBe(false);
    expect(parser.active).toBe(false);
    ['KeyA', 'Digit2', 'KeyB', 'Digit3', 'KeyC', 'Digit1'].forEach((code, i) => parser.feed({ code, at: 15 + i * 5 }));
    expect(parser.feed({ code: 'Enter', at: 60 }).scan).toBeUndefined();
  });

  it('ignores Shift, which readers press for uppercase letters', () => {
    const parser = new ScanParser();
    const keys: KeyInput[] = [];
    let at = 0;
    for (const ch of '04A23B1C') {
      if (/[A-F]/.test(ch)) keys.push({ code: 'ShiftLeft', at: (at += 3) });
      keys.push({ code: CODE_FOR_CHAR[ch]!, at: (at += 3) });
    }
    keys.forEach((k) => parser.feed(k));
    expect(parser.feed({ code: 'Enter', at: at + 3 }).scan?.uid).toBe('04A23B1C');
  });

  it('rejects auto-repeat from a held key', () => {
    const parser = new ScanParser();
    parser.feed({ code: 'KeyA', at: 0 });
    for (let i = 1; i < 10; i++) parser.feed({ code: 'KeyA', at: i * 33, repeat: true });
    expect(parser.flush(10 * 33 + 150)).toBeUndefined();
  });

  it('never treats modifier shortcuts as reader output', () => {
    const parser = new ScanParser();
    parser.feed({ code: 'Digit0', at: 0 });
    const r = parser.feed({ code: 'KeyS', at: 5, ctrlKey: true, altKey: true });
    expect(r.consumed).toBe(false);
    expect(parser.active).toBe(false);
  });

  it('decodes by physical key, so an AZERTY layout gives the same UID', () => {
    // On AZERTY the digit row types "&é\"'(" unshifted; event.code is still DigitN.
    const azertyKeys = ['à', '\'', 'a', 'é', '"', 'b', '&', 'c'];
    const codes = ['Digit0', 'Digit4', 'KeyA', 'Digit2', 'Digit3', 'KeyB', 'Digit1', 'KeyC'];
    const parser = new ScanParser();
    codes.forEach((code, i) => parser.feed({ code, at: i * 5, key: azertyKeys[i] } as KeyInput));
    expect(parser.feed({ code: 'Enter', at: 50 }).scan?.uid).toBe('04A23B1C');
  });

  it('consumes keys only once a burst is under way', () => {
    const { results } = type(new ScanParser(), '04A23B1C');
    expect(results[0]!.consumed).toBe(false);
    expect(results.slice(1).every((r) => r.consumed)).toBe(true);
  });

  it('lets a lone Enter through', () => {
    expect(new ScanParser().feed({ code: 'Enter', at: 0 }).consumed).toBe(false);
  });

  it('debounces the same UID within 1.5 s and extends the window while the card rests', () => {
    const parser = new ScanParser();
    expect(type(parser, '04A23B1C', { start: 0 }).scans).toEqual(['04A23B1C']);
    expect(type(parser, '04A23B1C', { start: 1000 }).scans).toEqual([]);
    expect(type(parser, '04A23B1C', { start: 2000 }).scans).toEqual([]);
    expect(type(parser, '04A23B1C', { start: 4000 }).scans).toEqual(['04A23B1C']);
  });

  it('does not debounce a different UID', () => {
    const parser = new ScanParser();
    expect(type(parser, '04A23B1C', { start: 0 }).scans).toEqual(['04A23B1C']);
    expect(type(parser, '04A23B1D', { start: 200 }).scans).toEqual(['04A23B1D']);
  });
});
