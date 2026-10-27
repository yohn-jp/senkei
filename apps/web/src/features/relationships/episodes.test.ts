import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EpisodeReader, PairEpisodes } from './EpisodeReader';
import {
  advanceEpisode, createEpisodeProgressStore, EPISODE_PROGRESS_STORAGE_KEY, loadAuthorizedEpisodes, openEpisode, unavailableEpisodeProvider,
  type Episode, type EpisodePair, type EpisodeProgress, type EpisodeProvider,
} from './episodes';

const pair: EpisodePair = { from: 'hero-a', to: 'hero-b' };
const episode: Episode = {
  id: 'sample', version: 'story-1', title: 'A test episode', pages: [
    { id: 'start', speaker: 'A', text: 'First line', transition: { kind: 'next', next: 'decision' } },
    { id: 'decision', speaker: 'B', text: 'Choose a path', transition: { kind: 'choice', policy: { version: 'policy-1', mode: 'fixed', notice: 'The story provider explains the choice.' }, options: [
      { id: 'left', label: 'Left', next: 'ending-left' }, { id: 'right', label: 'Right', next: 'ending-right' },
    ] } },
    { id: 'ending-left', speaker: 'A', text: 'Left ending', transition: { kind: 'next', next: null } },
    { id: 'ending-right', speaker: 'B', text: 'Right ending', transition: { kind: 'next', next: null } },
  ],
};
const provider: EpisodeProvider = { getEpisodes: request => ({ schemaVersion: 1, ...request, state: 'available', episodes: [episode] }) };
function setup() {
  const data = new Map<string, string>();
  let readFails = false; let writeFails = false;
  const storage = {
    getItem: (key: string) => { if (readFails) throw new Error('read'); return data.get(key) ?? null; },
    setItem: (key: string, value: string) => { if (writeFails) throw new Error('write'); data.set(key, value); },
  };
  return { data, storage, store: createEpisodeProgressStore(storage, 'player'), failRead: (value: boolean) => { readFails = value; }, failWrite: (value: boolean) => { writeFails = value; } };
}
function value<T>(result: { ok: true; value: T } | { ok: false; reason: string }): T {
  if (!result.ok) throw new Error(result.reason);
  return result.value;
}

describe('authorized episode boundary', () => {
  it('is unavailable by default and accepts only a versioned response for the requesting player and pair', async () => {
    const request = { playerId: 'player', pair };
    expect(value(await loadAuthorizedEpisodes(unavailableEpisodeProvider, request))).toMatchObject({ state: 'unavailable' });
    expect(value(await loadAuthorizedEpisodes(provider, request))).toMatchObject({ state: 'available', episodes: [episode] });
    const wrongPlayer: EpisodeProvider = { getEpisodes: () => ({ schemaVersion: 1, playerId: 'other', pair, state: 'available', episodes: [episode] }) };
    const wrongPair: EpisodeProvider = { getEpisodes: () => ({ schemaVersion: 1, playerId: 'player', pair: { from: 'hero-a', to: 'other' }, state: 'available', episodes: [episode] }) };
    expect(await loadAuthorizedEpisodes(wrongPlayer, request)).toEqual({ ok: false, reason: 'invalid-provider-response' });
    expect(await loadAuthorizedEpisodes(wrongPair, request)).toEqual({ ok: false, reason: 'invalid-provider-response' });
    expect(value(await loadAuthorizedEpisodes({ getEpisodes: () => ({ schemaVersion: 1, playerId: 'player', pair: { from: 'hero-b', to: 'hero-a' }, state: 'available', episodes: [episode] }) }, request))).toMatchObject({ state: 'available' });
    expect(await loadAuthorizedEpisodes({ getEpisodes: () => { throw new Error('offline'); } }, request)).toEqual({ ok: false, reason: 'provider-unavailable' });
  });

  it('rejects missing choice policies, dangling page targets and duplicate versions before rendering content', async () => {
    const request = { playerId: 'player', pair };
    const response = (content: unknown) => ({ getEpisodes: () => ({ schemaVersion: 1, ...request, state: 'available', episodes: content }) }) as EpisodeProvider;
    const noPolicy = structuredClone(episode) as unknown as { pages: { transition: { policy?: unknown } }[] };
    delete noPolicy.pages[1].transition.policy;
    expect(await loadAuthorizedEpisodes(response([noPolicy]), request)).toEqual({ ok: false, reason: 'invalid-provider-response' });
    const dangling = structuredClone(episode) as unknown as { pages: { transition: { next?: string } }[] };
    dangling.pages[0].transition.next = 'missing';
    expect(await loadAuthorizedEpisodes(response([dangling]), request)).toEqual({ ok: false, reason: 'invalid-provider-response' });
    expect(await loadAuthorizedEpisodes(response([episode, episode]), request)).toEqual({ ok: false, reason: 'invalid-provider-response' });
    const locked = { getEpisodes: () => ({ schemaVersion: 1, ...request, state: 'unavailable', message: 'Locked', episodes: [episode] }) } as EpisodeProvider;
    expect(value(await loadAuthorizedEpisodes(locked, request))).toEqual({ schemaVersion: 1, ...request, state: 'unavailable', message: 'Locked' });
  });
});

describe('episode progress', () => {
  it('saves interruption and cursor, completes, and preserves completed state and fixed choices through replay', () => {
    const { store, data } = setup();
    expect(value(store.read(pair, episode))).toMatchObject({ cursor: 'start', read: false, completed: false, interrupted: false });
    let progress = value(openEpisode(store, pair, episode));
    progress = value(advanceEpisode(store, pair, episode, progress));
    expect(value(store.read({ from: 'hero-b', to: 'hero-a' }, episode))).toMatchObject({ cursor: 'decision', read: true, interrupted: true, completed: false });
    // Leaving and reopening resumes at the saved page.
    progress = value(openEpisode(store, pair, episode));
    expect(progress.cursor).toBe('decision');
    expect(advanceEpisode(store, pair, episode, progress)).toEqual({ ok: false, reason: 'choice-required' });
    progress = value(advanceEpisode(store, pair, episode, progress, 'left'));
    progress = value(advanceEpisode(store, pair, episode, progress));
    expect(progress).toMatchObject({ cursor: 'ending-left', read: true, completed: true, interrupted: false, choices: [{ pageId: 'decision', optionId: 'left' }] });
    progress = value(openEpisode(store, pair, episode));
    expect(progress).toMatchObject({ cursor: 'start', completed: true, interrupted: true });
    progress = value(advanceEpisode(store, pair, episode, progress));
    expect(advanceEpisode(store, pair, episode, progress, 'right')).toEqual({ ok: false, reason: 'fixed-choice' });
    progress = value(advanceEpisode(store, pair, episode, progress, 'left'));
    progress = value(advanceEpisode(store, pair, episode, progress));
    expect(progress).toMatchObject({ completed: true, interrupted: false });
    expect([...data.keys()]).toHaveLength(1);
    expect([...data.keys()][0]).toContain(EPISODE_PROGRESS_STORAGE_KEY);
  });

  it('allows a change only when the supplied policy permits it', () => {
    const { store } = setup();
    const changeable: Episode = { ...episode, version: 'story-2', pages: episode.pages.map(page => page.transition.kind === 'choice'
      ? { ...page, transition: { ...page.transition, policy: { ...page.transition.policy, mode: 'changeable' } } } : page) };
    let progress = value(openEpisode(store, pair, changeable));
    progress = value(advanceEpisode(store, pair, changeable, progress));
    progress = value(advanceEpisode(store, pair, changeable, progress, 'left'));
    progress = value(advanceEpisode(store, pair, changeable, progress));
    progress = value(openEpisode(store, pair, changeable));
    progress = value(advanceEpisode(store, pair, changeable, progress));
    progress = value(advanceEpisode(store, pair, changeable, progress, 'right'));
    expect(progress).toMatchObject({ cursor: 'ending-right', choices: [{ pageId: 'decision', optionId: 'right' }], completed: true, interrupted: true });
  });

  it('separates player, pair and content version; handles failed storage without overwriting progress', () => {
    const { store, storage, data, failRead, failWrite } = setup();
    let progress = value(openEpisode(store, pair, episode));
    const before = [...data.values()][0];
    failWrite(true);
    expect(advanceEpisode(store, pair, episode, progress)).toEqual({ ok: false, reason: 'storage-write-failed' });
    expect([...data.values()][0]).toBe(before);
    failWrite(false);
    progress = value(advanceEpisode(store, pair, episode, progress));
    expect(progress.cursor).toBe('decision');
    failRead(true);
    expect(openEpisode(store, pair, episode)).toEqual({ ok: false, reason: 'storage-unavailable' });
    failRead(false);
    expect(value(openEpisode(store, pair, episode)).cursor).toBe('decision');
    expect(value(createEpisodeProgressStore(storage, 'another-player').read(pair, episode)).read).toBe(false);
    expect(value(store.read({ from: 'hero-a', to: 'hero-c' }, episode)).read).toBe(false);
    expect(value(store.read(pair, { ...episode, version: 'story-2' })).read).toBe(false);
    const key = [...data.keys()][0];
    data.set(key, '{bad json');
    expect(openEpisode(store, pair, episode)).toEqual({ ok: false, reason: 'invalid-progress' });
    expect(data.get(key)).toBe('{bad json');
  });

  it('detects a stale reader instead of overwriting another saved position', () => {
    const { store } = setup();
    const stale = value(openEpisode(store, pair, episode));
    value(advanceEpisode(store, pair, episode, stale));
    expect(advanceEpisode(store, pair, episode, stale)).toEqual({ ok: false, reason: 'progress-changed' });
    expect(value(store.read(pair, episode)).cursor).toBe('decision');
  });
});

describe('episode reader presentation', () => {
  it('shows no entry or body until access is checked, and displays the provider policy before a choice', () => {
    const waiting = renderToStaticMarkup(createElement(PairEpisodes, { playerId: 'player', pair }));
    expect(waiting).toContain('Checking episode access');
    expect(waiting).not.toContain('Read episode');
    const progress: EpisodeProgress = { schemaVersion: 1, playerId: 'player', pair, episodeId: episode.id, version: episode.version, cursor: 'decision', read: true, completed: false, interrupted: true, choices: [] };
    const html = renderToStaticMarkup(createElement(EpisodeReader, { episode, progress, onAdvance: () => {}, onReturn: () => {} }));
    expect(html).toContain('B');
    expect(html).toContain('Choose a path');
    expect(html).toContain('Position 2 / 4');
    expect(html).toContain('The story provider explains the choice.');
    expect(html).toContain('This choice cannot be changed');
    expect(html).toContain('disabled=""');
    expect(html).toContain('Return to pair');
  });
});
