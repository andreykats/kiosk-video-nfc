import type { AdminCardEntry, CardEntry, Config, VideoEntry } from './schema';

/**
 * Pure edits on a Config. Each returns a new object; callers persist the result
 * through ConfigStore, which re-validates before saving.
 *
 * Invariant kept here: whenever there is at least one video, one of them is the
 * loop video. The loop can be moved but never cleared.
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

export function removeCard(config: Config, uid: string): Config {
  return { ...config, cards: config.cards.filter((c) => c.uid !== uid) };
}

/** Callers must reject UIDs already used as video cards first. */
export function addAdminCard(config: Config, card: AdminCardEntry): Config {
  const rest = config.adminCards.filter((c) => c.uid !== card.uid);
  return { ...config, adminCards: [...rest, card] };
}

export function removeAdminCard(config: Config, uid: string): Config {
  return { ...config, adminCards: config.adminCards.filter((c) => c.uid !== uid) };
}
