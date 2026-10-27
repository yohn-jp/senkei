import type { Result, Storage } from './repository';

/** The provider is the authority for access and for the content of each version. */
export interface EpisodePair { readonly from: string; readonly to: string }
export interface EpisodeRequest { readonly playerId: string; readonly pair: EpisodePair }
export interface EpisodeChoicePolicy {
  readonly version: string;
  /** A fixed choice remains fixed when this episode version is read again. */
  readonly mode: 'fixed' | 'changeable';
  /** Supplied by the story authority and shown before the choice is made. */
  readonly notice: string;
}
export interface EpisodeOption { readonly id: string; readonly label: string; readonly next: string | null }
export type EpisodeTransition =
  | { readonly kind: 'next'; readonly next: string | null }
  | { readonly kind: 'choice'; readonly policy: EpisodeChoicePolicy; readonly options: readonly EpisodeOption[] };
export interface EpisodePage {
  readonly id: string;
  readonly speaker: string;
  readonly text: string;
  readonly transition: EpisodeTransition;
}
export interface Episode {
  readonly id: string;
  /** The provider must change this whenever the content or its choice policies change. */
  readonly version: string;
  readonly title: string;
  readonly pages: readonly EpisodePage[];
}
export type EpisodeProviderResponse =
  | { readonly schemaVersion: 1; readonly playerId: string; readonly pair: EpisodePair; readonly state: 'available'; readonly episodes: readonly Episode[] }
  | { readonly schemaVersion: 1; readonly playerId: string; readonly pair: EpisodePair; readonly state: 'unavailable'; readonly message: string };
export interface EpisodeProvider {
  /** Only return episode content that this player is authorized to read for this pair. */
  getEpisodes(request: EpisodeRequest): EpisodeProviderResponse | Promise<EpisodeProviderResponse>;
}
export const unavailableEpisodeProvider: EpisodeProvider = {
  getEpisodes: ({ playerId, pair }) => ({
    schemaVersion: 1, playerId, pair, state: 'unavailable', message: 'Episode content is not connected.',
  }),
};

const validString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (reason: string): Result<never> => ({ ok: false, reason });
const validPair = (pair: unknown): pair is EpisodePair => record(pair) && validString(pair.from) && validString(pair.to) && pair.from !== pair.to;
const orderedPair = (pair: EpisodePair): EpisodePair => pair.from < pair.to ? { from: pair.from, to: pair.to } : { from: pair.to, to: pair.from };
const samePair = (a: EpisodePair, b: EpisodePair): boolean => {
  const x = orderedPair(a); const y = orderedPair(b);
  return x.from === y.from && x.to === y.to;
};
const validTarget = (value: unknown): value is string | null => value === null || validString(value);

function validEpisode(value: unknown): value is Episode {
  if (!record(value) || !validString(value.id) || !validString(value.version) || !validString(value.title) || !Array.isArray(value.pages) || value.pages.length === 0) return false;
  const ids = new Set<string>();
  for (const page of value.pages) {
    if (!record(page) || !validString(page.id) || ids.has(page.id) || !validString(page.speaker) || !validString(page.text) || !record(page.transition)) return false;
    ids.add(page.id);
    const transition = page.transition;
    if (transition.kind === 'next') {
      if (!validTarget(transition.next)) return false;
    } else if (transition.kind === 'choice') {
      const policy = transition.policy;
      if (!record(policy) || !validString(policy.version) || (policy.mode !== 'fixed' && policy.mode !== 'changeable') || !validString(policy.notice) || !Array.isArray(transition.options) || transition.options.length === 0) return false;
      const options = new Set<string>();
      for (const option of transition.options) {
        if (!record(option) || !validString(option.id) || options.has(option.id) || !validString(option.label) || !validTarget(option.next)) return false;
        options.add(option.id);
      }
    } else return false;
  }
  return value.pages.every((page: EpisodePage) => page.transition.kind === 'next'
    ? page.transition.next === null || ids.has(page.transition.next)
    : page.transition.options.every(option => option.next === null || ids.has(option.next)));
}

/** Validate scope and structure before any provider content is rendered. */
export async function loadAuthorizedEpisodes(provider: EpisodeProvider, request: EpisodeRequest): Promise<Result<EpisodeProviderResponse>> {
  if (!validString(request.playerId) || !validPair(request.pair)) return fail('invalid-request');
  try {
    const response: unknown = await provider.getEpisodes({ playerId: request.playerId, pair: { ...request.pair } });
    if (!record(response) || response.schemaVersion !== 1 || response.playerId !== request.playerId || !validPair(response.pair) || !samePair(response.pair, request.pair)) return fail('invalid-provider-response');
    if (response.state === 'unavailable') {
      if (!validString(response.message)) return fail('invalid-provider-response');
      return { ok: true, value: { schemaVersion: 1, playerId: request.playerId, pair: { ...request.pair }, state: 'unavailable', message: response.message } };
    }
    if (response.state !== 'available' || !Array.isArray(response.episodes) || !response.episodes.every(validEpisode)) return fail('invalid-provider-response');
    const episodes = response.episodes as Episode[];
    if (new Set(episodes.map(episode => JSON.stringify([episode.id, episode.version]))).size !== episodes.length) return fail('invalid-provider-response');
    return { ok: true, value: { schemaVersion: 1, playerId: request.playerId, pair: { ...request.pair }, state: 'available', episodes: structuredClone(episodes) } };
  } catch { return fail('provider-unavailable'); }
}

export const EPISODE_PROGRESS_STORAGE_KEY = 'senkei.episode-progress.v1';
export interface EpisodeProgress {
  readonly schemaVersion: 1;
  readonly playerId: string;
  readonly pair: EpisodePair;
  readonly episodeId: string;
  readonly version: string;
  readonly cursor: string;
  readonly read: boolean;
  readonly completed: boolean;
  /** Set before entering the reader, so an unexpected close can also be resumed. */
  readonly interrupted: boolean;
  readonly choices: readonly { readonly pageId: string; readonly optionId: string }[];
}
export interface EpisodeProgressStore {
  read(pair: EpisodePair, episode: Episode): Result<EpisodeProgress>;
  write(pair: EpisodePair, episode: Episode, previous: EpisodeProgress, next: EpisodeProgress): Result<EpisodeProgress>;
}

function keyFor(playerId: string, pair: EpisodePair, episode: Episode): string {
  const ordered = orderedPair(pair);
  return `${EPISODE_PROGRESS_STORAGE_KEY}:${encodeURIComponent(JSON.stringify([playerId, ordered.from, ordered.to, episode.id, episode.version]))}`;
}
function initialProgress(playerId: string, pair: EpisodePair, episode: Episode): EpisodeProgress {
  return { schemaVersion: 1, playerId, pair: orderedPair(pair), episodeId: episode.id, version: episode.version,
    cursor: episode.pages[0].id, read: false, completed: false, interrupted: false, choices: [] };
}
function validProgress(value: unknown, playerId: string, pair: EpisodePair, episode: Episode): value is EpisodeProgress {
  if (!record(value) || value.schemaVersion !== 1 || value.playerId !== playerId || !validPair(value.pair) || !samePair(value.pair, pair) || value.episodeId !== episode.id || value.version !== episode.version || !validString(value.cursor) || !episode.pages.some(page => page.id === value.cursor) || typeof value.read !== 'boolean' || typeof value.completed !== 'boolean' || typeof value.interrupted !== 'boolean' || !Array.isArray(value.choices)) return false;
  if (!value.read && (value.completed || value.interrupted || value.choices.length > 0)) return false;
  const seen = new Set<string>();
  for (const choice of value.choices) {
    if (!record(choice) || !validString(choice.pageId) || !validString(choice.optionId) || seen.has(choice.pageId)) return false;
    const page = episode.pages.find(candidate => candidate.id === choice.pageId);
    if (!page || page.transition.kind !== 'choice' || !page.transition.options.some(option => option.id === choice.optionId)) return false;
    seen.add(choice.pageId);
  }
  return true;
}

/** Progress is separate from relationships, rewards and combat. Invalid data is never overwritten. */
export function createEpisodeProgressStore(storage: Storage, playerId: string): EpisodeProgressStore {
  if (!validString(playerId)) throw new Error('invalid-player-id');
  const read = (pair: EpisodePair, episode: Episode): Result<EpisodeProgress> => {
    if (!validPair(pair) || !validEpisode(episode)) return fail('invalid-episode');
    try {
      const raw = storage.getItem(keyFor(playerId, pair, episode));
      if (raw === null) return { ok: true, value: initialProgress(playerId, pair, episode) };
      let value: unknown;
      try { value = JSON.parse(raw); } catch { return fail('invalid-progress'); }
      if (!validProgress(value, playerId, pair, episode)) return fail('invalid-progress');
      return { ok: true, value: structuredClone(value) };
    } catch { return fail('storage-unavailable'); }
  };
  const write = (pair: EpisodePair, episode: Episode, previous: EpisodeProgress, next: EpisodeProgress): Result<EpisodeProgress> => {
    const current = read(pair, episode);
    if (!current.ok) return current;
    if (JSON.stringify(current.value) !== JSON.stringify(previous)) return fail('progress-changed');
    if (!validProgress(next, playerId, pair, episode) || (previous.read && !next.read) || (previous.completed && !next.completed)) return fail('invalid-progress');
    for (const choice of previous.choices) {
      const page = episode.pages.find(candidate => candidate.id === choice.pageId);
      if (page?.transition.kind === 'choice' && page.transition.policy.mode === 'fixed' && !next.choices.some(candidate => candidate.pageId === choice.pageId && candidate.optionId === choice.optionId)) return fail('fixed-choice');
    }
    try { storage.setItem(keyFor(playerId, pair, episode), JSON.stringify(next)); return { ok: true, value: structuredClone(next) }; }
    catch { return fail('storage-write-failed'); }
  };
  return { read, write };
}

/** A completed read remains completed during replay; the replay cursor is still saved. */
export function openEpisode(store: EpisodeProgressStore, pair: EpisodePair, episode: Episode): Result<EpisodeProgress> {
  const current = store.read(pair, episode); if (!current.ok) return current;
  const next = { ...current.value, cursor: current.value.interrupted ? current.value.cursor : episode.pages[0].id, read: true, interrupted: true };
  return store.write(pair, episode, current.value, next);
}

/** Only explicit reader movement changes this local record; it never awards gameplay state. */
export function advanceEpisode(store: EpisodeProgressStore, pair: EpisodePair, episode: Episode, progress: EpisodeProgress, optionId?: string): Result<EpisodeProgress> {
  if (!validProgress(progress, progress.playerId, pair, episode) || !progress.read || !progress.interrupted) return fail('episode-not-open');
  const page = episode.pages.find(candidate => candidate.id === progress.cursor)!;
  let target: string | null;
  let choices = [...progress.choices];
  if (page.transition.kind === 'choice') {
    const choice = page.transition.options.find(candidate => candidate.id === optionId);
    if (!choice) return fail('choice-required');
    const prior = choices.find(candidate => candidate.pageId === page.id);
    if (prior && page.transition.policy.mode === 'fixed' && prior.optionId !== choice.id) return fail('fixed-choice');
    choices = [...choices.filter(candidate => candidate.pageId !== page.id), { pageId: page.id, optionId: choice.id }];
    target = choice.next;
  } else {
    if (optionId !== undefined) return fail('unexpected-choice');
    target = page.transition.next;
  }
  const next: EpisodeProgress = { ...progress, choices, cursor: target ?? page.id,
    completed: progress.completed || target === null, interrupted: target !== null };
  return store.write(pair, episode, progress, next);
}
