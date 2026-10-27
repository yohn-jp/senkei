/** A local result is not an official settlement and cannot issue assets or currency. */
export function PostMatchProgression({ matchId, winner }: { matchId: string; winner: string }) {
  return <section aria-label="Post-match progression"><h3>Post-match progression</h3>
    <p>Match {matchId} · result: {winner}</p>
    <p>Official rewards and relationship settlement are unavailable because no authority is configured. This local result does not issue equipment, draw rights, or Libra.</p>
    <p>You can return to the match or start another local battle without waiting for progression.</p>
  </section>;
}
