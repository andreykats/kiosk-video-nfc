import { sameMatch, type AdminCardEntry, type CardEntry, type CardMatch, type Config, type VideoEntry } from './schema';

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

export function findAdminCard(config: Config, match: CardMatch): AdminCardEntry | undefined {
  return config.adminCards.find((c) => sameMatch(c.match, match));
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

export type ResolvedScan = { kind: 'admin'; entry: AdminCardEntry } | { kind: 'video'; entry: CardEntry };

/**
 * Admin cards win over video cards (an admin card must always open settings);
 * within each list the card ID wins over the UID.
 */
export function resolveScan(config: Config, card: CardIdentity): ResolvedScan | null {
  const matches = scanMatches(card);
  for (const m of matches) {
    const entry = findAdminCard(config, m);
    if (entry) return { kind: 'admin', entry };
  }
  for (const m of matches) {
    const entry = findCard(config, m);
    if (entry) return { kind: 'video', entry };
  }
  return null;
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
  const title = fileName.replace(/\.[^.]+$/, '');
  return {
    ...config,
    videos: [...config.videos, { fileName, title, sizeBytes }],
    loopVideo: config.loopVideo ?? fileName,
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

/** Pairs or reassigns a video card. Callers must reject admin matches first. */
export function pairCard(config: Config, card: CardEntry): Config {
  const cards = findCard(config, card.match)
    ? config.cards.map((c) => (sameMatch(c.match, card.match) ? card : c))
    : [...config.cards, card];
  return { ...config, cards };
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

export function removeAdminCard(config: Config, match: CardMatch): Config {
  return { ...config, adminCards: config.adminCards.filter((c) => !sameMatch(c.match, match)) };
}

/** Cards and admin cards recognised by card ID, which keyboard-mode kiosks can't read. */
export function ndefCardCount(config: Config): number {
  return [...config.cards, ...config.adminCards].filter((c) => c.match.kind === 'ndef').length;
}
