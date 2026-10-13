/** One NDEF record, decoded for display. */
export interface ScanRecord {
  /** "Well-known", "Media", … */
  tnf: string;
  /** Record type, e.g. "U" (URI), "T" (Text), "text/plain". */
  type: string;
  /** Decoded payload, or a byte count for binary data. */
  value: string;
}

/** A card held on the reader, from either input. */
export interface ScanEvent {
  /** Canonical UID: uppercase hex, no separators. */
  uid: string;
  /** Time in ms (performance.now() or event.timeStamp). */
  at: number;
  source: 'keyboard' | 'bridge';
  /** The card ID from the first URI or Text record. Only the bridge can read it. */
  ndefKey: string | null;
  /** Every NDEF record on the card (bridge only; empty if the card has none). */
  records: ScanRecord[];
}
