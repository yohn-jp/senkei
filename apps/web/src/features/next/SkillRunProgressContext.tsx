import type { ReactElement } from "react";
import type { SkillRunProgress } from "./skill-run-progress";
import "./skill-run-progress.css";

/** Read-only evidence from the selected Run; branch editing remains in the Draft tree. */
export function SkillRunProgressContext({ progress }: { readonly progress: SkillRunProgress }): ReactElement {
  const names = new Map(progress.skills.map(skill => [skill.id, skill.name]));
  return <aside className="skill-run-context" aria-label="Run skill acquisition context">
    <header><strong>Run skill acquisition · {progress.status === "known" ? "Observed" : "Unavailable"}</strong><p>Match {progress.matchId} · Tick {progress.tick} · Experiment {progress.experimentId}</p><p>{progress.status === "known" ? "Submitted Run slot" : "Draft slot compared with Run"} {progress.slotId} · {progress.catalogId}{progress.level === null ? "" : ` · Level ${progress.level}`}</p></header>
    <p>Acquisition states refer to this Run. The editable Draft acquisition plan remains separate.</p>
    {progress.reason && <p role="status">{progress.reason}</p>}
    <ul>{progress.skills.map(skill => <li key={skill.id}><strong>{skill.name}</strong><span>{skill.planned ? "Planned" : "Other branch"} · {skill.acquisition === "acquired" ? "Acquired" : skill.acquisition === "not_acquired" ? "Not acquired" : "Unknown"}</span>{skill.missingPrerequisiteIds && skill.missingPrerequisiteIds.length > 0 && <small>Missing prerequisites: {skill.missingPrerequisiteIds.map(id => names.get(id) ?? id).join(", ")}</small>}</li>)}</ul>
  </aside>;
}
