import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { PairEpisodes } from '../../../apps/web/src/features/relationships/EpisodeReader';
import type { EpisodeProvider } from '../../../apps/web/src/features/relationships/episodes';

let failWrites = false;
const storage = {
  getItem: (key: string) => localStorage.getItem(key),
  setItem: (key: string, value: string) => { if (failWrites) throw new Error('storage unavailable'); localStorage.setItem(key, value); },
};
const provider: EpisodeProvider = {
  getEpisodes: request => ({
    schemaVersion: 1, ...request, state: 'available', episodes: [{ id: 'browser-sample', version: '1', title: 'Provider episode', pages: [
      { id: 'one', speaker: 'Alpha', text: 'First authorized line', transition: { kind: 'next', next: 'choice' } },
      { id: 'choice', speaker: 'Beta', text: 'Choose a direction', transition: { kind: 'choice', policy: { version: '1', mode: 'fixed', notice: 'This supplied policy locks the choice.' }, options: [
        { id: 'left', label: 'Left path', next: 'ending' }, { id: 'right', label: 'Right path', next: 'ending' },
      ] } },
      { id: 'ending', speaker: 'Alpha', text: 'Authorized ending', transition: { kind: 'next', next: null } },
    ] }],
  }),
};
function Fixture() {
  const [connected, setConnected] = useState(false);
  const [otherPair, setOtherPair] = useState(false);
  const pair = otherPair ? { from: 'alpha', to: 'gamma' } : { from: 'alpha', to: 'beta' };
  return <main>
    <h2>{otherPair ? 'Alpha and Gamma' : 'Alpha and Beta'}</h2>
    <button type="button" onClick={() => setConnected(true)}>Connect provider</button>
    <button type="button" onClick={() => setOtherPair(!otherPair)}>Change pair</button>
    <button type="button" onClick={() => { failWrites = true; }}>Fail writes</button>
    <button type="button" onClick={() => { failWrites = false; }}>Restore writes</button>
    <PairEpisodes playerId="player" pair={pair} provider={connected ? provider : undefined} storage={storage} />
  </main>;
}
createRoot(document.getElementById('episode-test-root')!).render(<Fixture />);
