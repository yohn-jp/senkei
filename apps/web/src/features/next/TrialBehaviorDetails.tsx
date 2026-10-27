import type { ReactElement } from "react";
import type { TrialBehaviorEvidence } from "./coverage-trial";

export function TrialBehaviorDetails({ evidence }: { readonly evidence: TrialBehaviorEvidence }): ReactElement {
  return <details>
    <summary>Trial Behavior values · {evidence.slotId} · {evidence.decisionSource}</summary>
    <p>Test-only policy {evidence.policyId} · {evidence.catalogId}. Eligible candidates {evidence.eligibleCandidates} · Unknown candidates {evidence.unknownCandidates}{evidence.selectedScore !== null ? ` · selected score ${evidence.selectedScore}` : ""}.</p>
    <p>Policy digest <code>{evidence.policyDigest}</code>. Observation digest <code>{evidence.observationDigest}</code>; Observation content was not retained, so its independent verification is NOT CHECKED.</p>
    <div className="next-coverage-table-wrap"><table className="next-coverage-table"><thead><tr><th scope="col">Trial domain</th><th scope="col">Trial policy Hero default</th><th scope="col">Hero input and source</th><th scope="col">Squad aggregate</th><th scope="col">Effective at this Tick</th></tr></thead>
      <tbody>{evidence.rows.map(row => <tr key={row.domain}><th scope="row">{row.domain}</th><td data-label="Trial policy Hero default">{row.catalogDefault === null ? "Not supplied" : row.catalogDefault}</td><td data-label="Hero input and source">{row.memberValue} · {row.source.replaceAll("_", " ")}</td><td data-label="Squad aggregate">{row.sharedValue}</td><td data-label="Effective at this Tick">{row.effectiveValue}</td></tr>)}</tbody>
    </table></div>
  </details>;
}
