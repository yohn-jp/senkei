import { useMemo } from "react";
import { analyzeDecisionCoverage } from "@senkei/jinrei-editor";
import type { ActorSelection, CatalogStamp, DomainCatalogDocument } from "@senkei/jinrei-editor";
import type { RulePackage, StructuredTacticsAst, TacticalProgram } from "../../contracts";
import type { BehaviorProfileComposition } from "../../contracts/behavior-resolution";
import { profileValueText } from "./coverage-composition";

export interface DecisionCoverageProps {
  readonly ast: StructuredTacticsAst | null;
  readonly program: TacticalProgram | null;
  /** Retained from the compiler response for this exact draft and Catalog. */
  readonly compilationStamp: CatalogStamp | null;
  readonly catalog: DomainCatalogDocument | null;
  readonly rulePackage: RulePackage | null;
  readonly actor: ActorSelection;
  /** The current subject's separately verified defaults-only composition. */
  readonly profile: BehaviorProfileComposition | null;
}

const hypothesisLabel = {
  applies_legal: "Selected subject · legal (hypothesis)",
  applies_illegal: "Selected subject · illegal (hypothesis)",
  other_actor: "Other subject (hypothesis)",
  not_applicable: "Condition does not select this candidate",
  unresolved: "Subject, argument, or condition not proven",
} as const;

/** Render static classes only; observations and accepted intents come from their own views. */
export function DecisionCoverage(props: DecisionCoverageProps) {
  const report = useMemo(() => analyzeDecisionCoverage(props), [props.ast, props.program, props.compilationStamp,
    props.catalog, props.rulePackage, props.actor, props.profile]);
  if (report.status === "unavailable") return <section className="next-coverage-provenance" aria-label="Decision classes">
    <strong>Decision classes · not checked</strong><p>{report.reason}</p>
  </section>;

  const unknown = report.classes.filter(item => item.status === "UNKNOWN").length;
  return <section className="next-coverage-provenance" aria-label="Decision classes">
    <h4>Decision classes</h4>
    <p>Selected {props.actor.scope} · {report.classes.length} constructed partitions · {unknown} contain Unknown.
      No final action or reachability is proved; the total number of classes is not established.</p>
    <p>Program {report.programDigest.slice(0, 12)}… · Catalog {props.catalog?.catalogDigest.slice(0, 12)}…</p>
    {report.noAuthoredActions && <p><strong>Default candidate:</strong> this Jinrei declares no actions. That alone is not an error;
      the Profile and RulePlan determine the eventual default or wait.</p>}
    {report.profile ? <div>
      <strong>Resolved no-Jinrei Profile · Tick {report.profile.tick}</strong>
      <p>This is a baseline preference, not proof of an effective action in every class.</p>
      <ul>{Object.entries(report.profile.values).map(([key, value]) => <li key={key}><code>{key}</code>: {profileValueText(value as Parameters<typeof profileValueText>[0])}
        {report.profile?.provenance[key] && <> · {report.profile.provenance[key].layer} / {report.profile.provenance[key].source}</>}</li>)}</ul>
    </div> : <p>{report.profileDeclared ? "The matching no-Jinrei Profile composition has not been supplied."
      : "This RulePackage does not declare a Behavior Profile; no Profile defaults are inferred."}</p>}
    {report.axes.length > 0 && <details><summary>Partitioned observation domains</summary><ul>{report.axes.map(axis =>
      <li key={axis.path}><code>{axis.path}</code>: {axis.values.map(value => value.label).join(" · ")}</li>)}</ul></details>}
    <p>Actor, legality and conflict branches are hypothetical constraints, not observations or legal rulings.
      Unsupported and unenumerated paths remain Not Proven.</p>
    {report.classes.length > 0 && <details><summary>Show {report.classes.length} constructed partitions</summary>
      <ol>{report.classes.map((item, index) => <li key={index}>
        <strong>{item.status === "UNKNOWN" ? "Unknown" : "Not Proven"}</strong> · {item.disposition === "default_candidate" ? "Default candidate"
          : item.disposition === "explicit_candidate" ? "Explicit candidate" : "Decision unresolved"}
        <p>{Object.entries(item.values).length ? Object.entries(item.values).map(([path, value]) => `${path}: ${value.label}`).join("; ") : "No supported observation predicates"}</p>
        {item.actions.length > 0 && <ul>{item.actions.map((action, actionIndex) => <li key={`${action.name}-${actionIndex}`}>
          <code>{action.name}</code> · {action.capability} · condition {action.condition.replaceAll("_", " ")} · {hypothesisLabel[action.hypothesis]} · scope {action.actorScope}
        </li>)}</ul>}
        <small>{item.conflict}. {item.reasons.join(" ")}</small>
      </li>)}</ol>
    </details>}
    <details><summary>Analysis limits and unenumerated cases</summary><ul>{report.unresolved.map(reason => <li key={reason}>{reason}</li>)}</ul></details>
  </section>;
}
