import { ndefKeyError, sameMatch, type AdminCardEntry, type CardEntry, type CardMatch, type Config, type VideoEntry } from './schema';

/**
 * Pure edits on a Config. Each returns a new object; callers persist the result
 * through ConfigStore, which re-validates before saving.
 *
 * Invariant kept here: whenever there is at least one video, one of them is the
 * loop video. The loop can be moved but never cleared.
 */

export function findCard(config: Config, match: CardMatch): CardEntry | undefined {
  return config.cards.find((c) => sameMatch(c.match, match));
}

export function findAdminCard(config: Config, uid: string): AdminCardEntry | undefined {
  return config.adminCards.find((c) => c.match.value === uid);
}

/** What a scan tells us about a card. `ndefKey` is only known when read through the bridge. */
export interface CardIdentity {
  uid: string;
  ndefKey: string | null;
}

/** The ways a scanned card can be matched, most specific first: card ID, then UID. */
export function scanMatches(card: CardIdentity): CardMatch[] {
  const uid: CardMatch = { kind: 'uid', value: card.uid };
  return card.ndefKey === null ? [uid] : [{ kind: 'ndef', value: card.ndefKey }, uid];
}

/**
 * How a scanned card is identified as a video card on a kiosk that identifies
 * cards by `key`. Null when the kiosk uses card IDs and this card has none.
 */
export function cardMatch(card: CardIdentity, key: CardMatch['kind']): CardMatch | null {
  if (key === 'uid') return { kind: 'uid', value: card.uid };
  return card.ndefKey === null ? null : { kind: 'ndef', value: card.ndefKey };
}

/**
 * The scanned tag's identifier that isn't `match`, to record next to a pairing
 * for display. Undefined when the scan didn't read it (keyboard readers have no
 * NDEF payload) or it isn't a valid tag ID.
 */
export function otherIdOf(card: CardIdentity, match: CardMatch): CardMatch | undefined {
  if (match.kind === 'ndef') return { kind: 'uid', value: card.uid };
  return card.ndefKey !== null && ndefKeyError(card.ndefKey) === null ? { kind: 'ndef', value: card.ndefKey } : undefined;
}

export type ResolvedScan = { kind: 'admin'; entry: AdminCardEntry } | { kind: 'video'; entry: CardEntry };

/**
 * Admin cards win over video cards (an admin card must always open settings),
 * and match by UID whatever the kiosk's card key. Video cards match only by the
 * kiosk's card key.
 */
export function resolveScan(config: Config, card: CardIdentity, key: CardMatch['kind']): ResolvedScan | null {
  const admin = findAdminCard(config, card.uid);
  if (admin) return { kind: 'admin', entry: admin };
  const match = cardMatch(card, key);
  const entry = match && findCard(config, match);
  return entry ? { kind: 'video', entry } : null;
}

/** Whether a scanned card can be paired as a video card, and what it's paired to already. */
export type PairingCheck =
  | { kind: 'admin'; entry: AdminCardEntry }
  | { kind: 'no-card-id' }
  | { kind: 'ok'; match: CardMatch; existing: CardEntry | undefined };

export function checkPairing(config: Config, card: CardIdentity, key: CardMatch['kind']): PairingCheck {
  const admin = findAdminCard(config, card.uid);
  if (admin) return { kind: 'admin', entry: admin };
  const match = cardMatch(card, key);
  if (!match) return { kind: 'no-card-id' };
  return { kind: 'ok', match, existing: findCard(config, match) };
}

export function findVideo(config: Config, fileName: string): VideoEntry | undefined {
  return config.videos.find((v) => v.fileName === fileName);
}

/** Adds a video entry, or updates the stored size if it already exists. The first video becomes the loop. */
export function upsertVideo(config: Config, fileName: string, sizeBytes: number): Config {
  if (findVideo(config, fileName)) {
    return {
      ...config,
      videos: config.videos.map((v) => (v.fileName === fileName ? { ...v, sizeBytes } : v)),
    };
  }
  return {
    ...config,
    videos: [...config.videos, { fileName, title: titleFor(fileName), sizeBytes }],
    loopVideo: config.loopVideo ?? fileName,
  };
}

function titleFor(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/**
 * Swaps a video's file for a new one in place: its cards and loop status move to
 * `newName`. Callers must reject a `newName` that is already another video.
 */
export function replaceVideo(config: Config, oldName: string, newName: string, sizeBytes: number): Config {
  const rename = (fileName: string) => (fileName === oldName ? newName : fileName);
  return {
    ...config,
    videos: config.videos.map((v) => (v.fileName === oldName ? { fileName: newName, title: titleFor(newName), sizeBytes } : v)),
    cards: config.cards.map((c) => (c.fileName === oldName ? { ...c, fileName: newName } : c)),
    loopVideo: config.loopVideo === null ? null : rename(config.loopVideo),
  };
}

/** Cards that would be unpaired by removing this video (for the confirm dialog). */
export function cardsForVideo(config: Config, fileName: string): CardEntry[] {
  return config.cards.filter((c) => c.fileName === fileName);
}

/**
 * Removes a video and unpairs its cards. If it was the loop, the loop moves to
 * a remaining video, preferring one that no card plays.
 */
export function removeVideo(config: Config, fileName: string): Config {
  const videos = config.videos.filter((v) => v.fileName !== fileName);
  const cards = config.cards.filter((c) => c.fileName !== fileName);
  let loopVideo = config.loopVideo;
  if (loopVideo === fileName) {
    const unpaired = videos.find((v) => !cards.some((c) => c.fileName === v.fileName));
    loopVideo = (unpaired ?? videos[0])?.fileName ?? null;
  }
  return { ...config, videos, cards, loopVideo };
}

export function setLoopVideo(config: Config, fileName: string): Config {
  return { ...config, loopVideo: fileName };
}

/** Setup guide: a video is either the background loop or played by cards, not both. */
export function useAsLoopInstead(config: Config, fileName: string): Config {
  return { ...config, loopVideo: fileName, cards: config.cards.filter((c) => c.fileName !== fileName) };
}

/**
 * Pairs or reassigns a video card. Callers must reject admin matches first. A
 * reassigned card keeps its recorded otherId if this scan didn't read one.
 */
export function pairCard(config: Config, card: CardEntry): Config {
  const existing = findCard(config, card.match);
  if (!existing) return { ...config, cards: [...config.cards, card] };
  const otherId = card.otherId ?? existing.otherId;
  const updated: CardEntry = { ...card, ...(otherId && { otherId }) };
  return { ...config, cards: config.cards.map((c) => (c === existing ? updated : c)) };
}

export function setCardVideo(config: Config, match: CardMatch, fileName: string): Config {
  return { ...config, cards: config.cards.map((c) => (sameMatch(c.match, match) ? { ...c, fileName } : c)) };
}

export function removeCard(config: Config, match: CardMatch): Config {
  return { ...config, cards: config.cards.filter((c) => !sameMatch(c.match, match)) };
}

/** Callers must reject matches already used by video cards first. */
export function addAdminCard(config: Config, card: AdminCardEntry): Config {
  const rest = config.adminCards.filter((c) => !sameMatch(c.match, card.match));
  return { ...config, adminCards: [...rest, card] };
}

export function removeAdminCard(config: Config, uid: string): Config {
  return { ...config, adminCards: config.adminCards.filter((c) => c.match.value !== uid) };
}

/** Video cards a kiosk won't recognise: the ones paired by the other key. */
export function unrecognisedCardCount(config: Config, key: CardMatch['kind']): number {
  return config.cards.filter((c) => c.match.kind !== key).length;
}
