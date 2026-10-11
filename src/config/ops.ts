import type { AdminCardEntry, CardEntry, Config, VideoEntry } from './schema';

/**
 * Pure edits on a Config. Each returns a new object; callers persist the result
 * through ConfigStore, which re-validates before saving.
 */

export function findCard(config: Config, uid: string): CardEntry | undefined {
  return config.cards.find((c) => c.uid === uid);
}

export function findAdminCard(config: Config, uid: string): AdminCardEntry | undefined {
  return config.adminCards.find((c) => c.uid === uid);
}

export function findVideo(config: Config, fileName: string): VideoEntry | undefined {
  return config.videos.find((v) => v.fileName === fileName);
}

/** Adds a video entry, or updates the stored size if it already exists. */
export function upsertVideo(config: Config, fileName: string, sizeBytes: number): Config {
  if (findVideo(config, fileName)) {
    return {
      ...config,
      videos: config.videos.map((v) => (v.fileName === fileName ? { ...v, sizeBytes } : v)),
    };
  }
  const title = fileName.replace(/\.[^.]+$/, '');
  return { ...config, videos: [...config.videos, { fileName, title, sizeBytes }] };
}

export function setVideoTitle(config: Config, fileName: string, title: string): Config {
  return {
    ...config,
    videos: config.videos.map((v) => (v.fileName === fileName ? { ...v, title } : v)),
  };
}

/** Cards that would be unpaired by removing this video (for the confirm dialog). */
export function cardsForVideo(config: Config, fileName: string): CardEntry[] {
  return config.cards.filter((c) => c.fileName === fileName);
}

export function removeVideo(config: Config, fileName: string): Config {
  return {
    ...config,
    videos: config.videos.filter((v) => v.fileName !== fileName),
    cards: config.cards.filter((c) => c.fileName !== fileName),
    loopVideo: config.loopVideo === fileName ? null : config.loopVideo,
  };
}

export function setLoopVideo(config: Config, fileName: string | null): Config {
  return { ...config, loopVideo: fileName };
}

/** Setup guide: a video is either the background loop or played by cards, not both. */
export function useAsLoopInstead(config: Config, fileName: string): Config {
  return { ...config, loopVideo: fileName, cards: config.cards.filter((c) => c.fileName !== fileName) };
}

/** Pairs or reassigns a video card. Callers must reject admin UIDs first. */
export function pairCard(config: Config, card: CardEntry): Config {
  const cards = findCard(config, card.uid)
    ? config.cards.map((c) => (c.uid === card.uid ? card : c))
    : [...config.cards, card];
  return { ...config, cards };
}

export function setCardVideo(config: Config, uid: string, fileName: string): Config {
  return { ...config, cards: config.cards.map((c) => (c.uid === uid ? { ...c, fileName } : c)) };
}

export function setCardLabel(config: Config, uid: string, label: string): Config {
  return { ...config, cards: config.cards.map((c) => (c.uid === uid ? { ...c, label } : c)) };
}

export function removeCard(config: Config, uid: string): Config {
  return { ...config, cards: config.cards.filter((c) => c.uid !== uid) };
}

/** Callers must reject UIDs already used as video cards first. */
export function addAdminCard(config: Config, card: AdminCardEntry): Config {
  const rest = config.adminCards.filter((c) => c.uid !== card.uid);
  return { ...config, adminCards: [...rest, card] };
}

export function setAdminCardLabel(config: Config, uid: string, label: string): Config {
  return {
    ...config,
    adminCards: config.adminCards.map((c) => (c.uid === uid ? { ...c, label } : c)),
  };
}

export function removeAdminCard(config: Config, uid: string): Config {
  return { ...config, adminCards: config.adminCards.filter((c) => c.uid !== uid) };
}
