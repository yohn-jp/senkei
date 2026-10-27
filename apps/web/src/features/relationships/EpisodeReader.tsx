import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { Storage } from './repository';
import {
  advanceEpisode, createEpisodeProgressStore, loadAuthorizedEpisodes, openEpisode, unavailableEpisodeProvider,
  type Episode, type EpisodePair, type EpisodeProgress, type EpisodeProvider,
} from './episodes';

const browserStorage: Storage = {
  getItem: key => window.localStorage.getItem(key),
  setItem: (key, value) => window.localStorage.setItem(key, value),
};

type Item = { readonly episode: Episode; readonly progress: EpisodeProgress };
type Catalog =
  | { readonly key: string; readonly provider: EpisodeProvider; readonly storage: Storage; readonly state: 'loading' }
  | { readonly key: string; readonly provider: EpisodeProvider; readonly storage: Storage; readonly state: 'unavailable'; readonly message: string }
  | { readonly key: string; readonly provider: EpisodeProvider; readonly storage: Storage; readonly state: 'error'; readonly reason: string }
  | { readonly key: string; readonly provider: EpisodeProvider; readonly storage: Storage; readonly state: 'available'; readonly items: readonly Item[] };
type Pending = { readonly reason: string; readonly retry: () => void };
const itemKey = (episode: Episode): string => JSON.stringify([episode.id, episode.version]);

export interface PairEpisodesProps {
  readonly playerId: string;
  readonly pair: EpisodePair;
  readonly provider?: EpisodeProvider;
  readonly storage?: Storage;
}

/** Place this inside a pair detail. The provider grants access; no provider means no entry. */
export function PairEpisodes({ playerId, pair, provider = unavailableEpisodeProvider, storage = browserStorage }: PairEpisodesProps): ReactElement {
  const key = JSON.stringify([playerId, pair.from, pair.to]);
  const store = useMemo(() => createEpisodeProgressStore(storage, playerId), [storage, playerId]);
  const [attempt, setAttempt] = useState(0);
  const [catalog, setCatalog] = useState<Catalog>({ key, provider, storage, state: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  useEffect(() => {
    let active = true;
    const scope = { key, provider, storage };
    setCatalog({ ...scope, state: 'loading' });
    setSelected(null);
    setPending(null);
    void loadAuthorizedEpisodes(provider, { playerId, pair: { from: pair.from, to: pair.to } }).then(result => {
      if (!active) return;
      if (!result.ok) { setCatalog({ ...scope, state: 'error', reason: result.reason }); return; }
      if (result.value.state === 'unavailable') { setCatalog({ ...scope, state: 'unavailable', message: result.value.message }); return; }
      const items: Item[] = [];
      for (const episode of result.value.episodes) {
        const progress = store.read(pair, episode);
        if (!progress.ok) { setCatalog({ ...scope, state: 'error', reason: progress.reason }); return; }
        items.push({ episode, progress: progress.value });
      }
      setCatalog({ ...scope, state: 'available', items });
    });
    return () => { active = false; };
  }, [key, provider, storage, store, playerId, pair.from, pair.to, attempt]);

  // Never show the previous pair's or provider's content while a new request is pending.
  const current = catalog.key === key && catalog.provider === provider && catalog.storage === storage ? catalog : null;
  const replaceProgress = (episode: Episode, progress: EpisodeProgress): void => {
    setCatalog(value => value.state === 'available' && value.key === key && value.provider === provider && value.storage === storage
      ? { ...value, items: value.items.map(item => itemKey(item.episode) === itemKey(episode) ? { episode: item.episode, progress } : item) }
      : value);
  };
  const open = (episode: Episode): void => {
    const result = openEpisode(store, pair, episode);
    if (!result.ok) { setPending({ reason: result.reason, retry: () => open(episode) }); return; }
    replaceProgress(episode, result.value);
    setPending(null);
    setSelected(itemKey(episode));
  };
  const move = (item: Item, optionId?: string): void => {
    const result = advanceEpisode(store, pair, item.episode, item.progress, optionId);
    if (!result.ok) {
      setPending({ reason: result.reason, retry: result.reason === 'progress-changed' ? () => {
        const saved = store.read(pair, item.episode);
        if (!saved.ok) { setPending({ reason: saved.reason, retry: () => setAttempt(value => value + 1) }); return; }
        replaceProgress(item.episode, saved.value);
        if (!saved.value.interrupted) setSelected(null);
        setPending(null);
      } : () => move(item, optionId) });
      return;
    }
    replaceProgress(item.episode, result.value);
    setPending(null);
    if (!result.value.interrupted) setSelected(null);
  };
  const active = current?.state === 'available' && selected ? current.items.find(item => itemKey(item.episode) === selected) : undefined;
  return <section aria-label="Pair episodes">
    <h4>Episodes</h4>
    {!current || current.state === 'loading' ? <p role="status">Checking episode access…</p> : null}
    {current?.state === 'unavailable' && <p>{current.message}</p>}
    {current?.state === 'error' && <div role="alert"><p>{errorMessage(current.reason)}</p><button type="button" onClick={() => setAttempt(value => value + 1)}>Retry episode access</button></div>}
    {pending && <div role="alert"><p>{errorMessage(pending.reason)}</p><button type="button" onClick={pending.retry}>{pending.reason === 'progress-changed' ? 'Reload saved position' : 'Retry'}</button></div>}
    {current?.state === 'available' && !active && <>
      {current.items.length === 0 ? <p>No episodes are available for this pair.</p> : <ul>{current.items.map(item => <li key={itemKey(item.episode)}>
        <strong>{item.episode.title}</strong> · {progressLabel(item.progress)}{' '}
        <button type="button" onClick={() => open(item.episode)}>{item.progress.interrupted ? (item.progress.completed ? 'Continue replay' : 'Continue') : item.progress.completed ? 'Read again' : 'Read episode'}</button>
      </li>)}</ul>}
    </>}
    {active && <EpisodeReader key={`${itemKey(active.episode)}:${active.progress.cursor}`} episode={active.episode} progress={active.progress}
      onAdvance={optionId => move(active, optionId)} onReturn={() => { setPending(null); setSelected(null); }} />}
  </section>;
}

function progressLabel(progress: EpisodeProgress): string {
  if (!progress.read) return 'Unread';
  if (progress.completed) return progress.interrupted ? 'Read · Completed · Replay interrupted' : 'Read · Completed';
  return progress.interrupted ? 'Read · Interrupted' : 'Read';
}
function errorMessage(reason: string): string {
  if (reason === 'provider-unavailable') return 'Episode access could not be checked. Please retry.';
  if (reason === 'invalid-provider-response' || reason === 'invalid-request') return 'Episode access could not be verified. No content was opened.';
  if (reason === 'invalid-progress') return 'Saved episode progress could not be read. The existing data has been preserved.';
  if (reason === 'progress-changed') return 'Episode progress changed elsewhere. Reload the saved position before continuing.';
  if (reason === 'storage-unavailable' || reason === 'storage-write-failed') return 'Episode progress could not be saved or read. Retry or return to the pair.';
  return 'The episode could not be continued. Retry or return to the pair.';
}

export interface EpisodeReaderProps {
  readonly episode: Episode;
  readonly progress: EpisodeProgress;
  onAdvance(optionId?: string): void;
  onReturn(): void;
}

/** Controlled reader: it presents the authorized page and delegates durable movement. */
export function EpisodeReader({ episode, progress, onAdvance, onReturn }: EpisodeReaderProps): ReactElement {
  const page = episode.pages.find(candidate => candidate.id === progress.cursor);
  const previousChoice = progress.choices.find(choice => choice.pageId === progress.cursor)?.optionId;
  const [option, setOption] = useState(previousChoice ?? '');
  if (!page) return <div role="alert"><p>The saved position is not present in this episode version.</p><button type="button" onClick={onReturn}>Return to pair</button></div>;
  const pageNumber = episode.pages.findIndex(candidate => candidate.id === page.id) + 1;
  return <article aria-label={`Reading ${episode.title}`}>
    <h5>{episode.title}</h5>
    <p>Position {pageNumber} / {episode.pages.length} · {page.id}</p>
    <p>{progress.completed ? 'Read · Replaying' : 'Read · In progress'}</p>
    <p><strong>{page.speaker}</strong></p>
    <p>{page.text}</p>
    {page.transition.kind === 'next' ? <button type="button" onClick={() => onAdvance()}>{page.transition.next === null ? 'Finish episode' : 'Next'}</button> : <>
      <p>{page.transition.policy.notice}</p>
      <p>{page.transition.policy.mode === 'fixed' ? 'This choice cannot be changed for this episode version.' : 'This choice can be changed when revisited.'}</p>
      {previousChoice && page.transition.policy.mode === 'fixed' ? <>
        <p>Saved choice: {page.transition.options.find(candidate => candidate.id === previousChoice)?.label}</p>
        <button type="button" onClick={() => onAdvance(previousChoice)}>Continue with saved choice</button>
      </> : <fieldset><legend>Choose how to continue</legend>
        {page.transition.options.map(candidate => <label key={candidate.id} style={{ display: 'block' }}><input type="radio" name={`episode-choice-${page.id}`} value={candidate.id} checked={option === candidate.id} onChange={() => setOption(candidate.id)} /> {candidate.label}</label>)}
        <button type="button" disabled={!option} onClick={() => onAdvance(option)}>Confirm choice</button>
      </fieldset>}
    </>}
    <p>Progress is saved at this position. Returning now leaves the episode interrupted.</p>
    <button type="button" onClick={onReturn}>Return to pair</button>
  </article>;
}
