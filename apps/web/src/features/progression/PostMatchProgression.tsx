import { OfficialReadPanel, type OfficialReadPanelProps } from './OfficialReadPanel';
import { OfficialOperationPanel, type OfficialOperationPanelProps } from './OfficialOperationPanel';

/** A local result is not an official settlement and cannot issue assets or currency. */
export function PostMatchProgression<Credentials = never>({ matchId, winner, officialRead, officialOperation }: { matchId: string; winner: string; officialRead?: OfficialReadPanelProps<Credentials>; officialOperation?: OfficialOperationPanelProps }) {
  const read = officialRead ?? {configuration:{kind:'not-configured' as const}};
  const mismatch = 'request' in read && (read.request.query.kind !== 'post_match' || read.request.query.matchId !== matchId);
  return <section aria-label="Post-match progression"><h3>Post-match progression</h3>
    <p>Match {matchId} · result: {winner}</p>
    <p>{read.configuration.kind === 'not-configured'
      ? 'Official progression status is unavailable because no read provider is configured.'
      : 'The configured authority supplies progression status separately from this local result.'} This local result does not issue equipment, draw rights, or Libra.</p>
    <p>You can return to the match or start another local battle without waiting for progression.</p>
    {mismatch ? <p role="alert">The official progression request does not identify this Match.</p> : <OfficialReadPanel<Credentials> {...read} />}
    <OfficialOperationPanel {...(officialOperation ?? {configuration:{kind:'not-configured' as const}})} />
  </section>;
}
