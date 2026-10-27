import { catalogStamp, sameCatalog, sameVersion } from "./catalog.js";
import type { CatalogStamp, DomainCatalogDocument, DomainType, Version } from "./catalog.js";
import type { ActorSelection } from "./editor.js";

/** Compiler-owned structures needed by the analysis. The caller must retain the
 * exact Catalog stamp and draft revision with the compiled AST and Program. */
export interface CoverageAst {
  readonly schema_version: Version;
  readonly declarations: readonly (
    | { readonly kind: "state"; readonly name: string; readonly predicates: readonly unknown[] }
    | { readonly kind: "action"; readonly name: string; readonly when: unknown; readonly do_call: { readonly capability: readonly string[]; readonly arguments: readonly unknown[] } }
  )[];
}
export interface CoverageProgram {
  readonly language_version: Version;
  readonly ir_version: Version;
  readonly bytecode_version: Version;
  readonly cost_schedule_id: string;
  readonly cost_schedule_version: Version;
  readonly ruleset: { readonly id: string; readonly version: Version; readonly digest: string };
  readonly content_digest: string;
}
export interface CoverageRulePackage {
  readonly ruleset: CoverageProgram["ruleset"];
  readonly minimum_engine_version: Version;
  readonly model_version: Version;
  readonly primitive_set_id: string;
  readonly primitive_set_version: Version;
  readonly jinrei_language_version: Version;
  readonly structured_ast_version: Version;
  readonly typed_ir_version: Version;
  readonly bytecode_version: Version;
  readonly cost_schedule: { readonly id: string; readonly version: Version };
}
export interface CoverageProfile {
  readonly catalog_identity: CatalogStamp;
  readonly actor_scope: ActorSelection["scope"];
  readonly actor_id: string;
  readonly side: ActorSelection["side"];
  readonly tick: number;
  readonly values: Readonly<Record<string, unknown>>;
  readonly provenance: Readonly<Record<string, { readonly layer: string; readonly source: string }>>;
}
export interface DecisionCoverageInput {
  readonly ast: CoverageAst | null;
  readonly program: CoverageProgram | null;
  /** Stamp retained with the current, revision-checked compilation. */
  readonly compilationStamp: CatalogStamp | null;
  readonly catalog: DomainCatalogDocument | null;
  readonly rulePackage: CoverageRulePackage | null;
  readonly actor: ActorSelection;
  /** Identity- and roster-checked no-Jinrei composition, if supplied by the resolver. */
  readonly profile: CoverageProfile | null;
}
export type CoverageTruth = "true" | "false" | "unknown" | "not_proven";
export type CoverageValueClass =
  | { readonly kind: "unknown"; readonly label: string }
  | { readonly kind: "bool"; readonly value: boolean; readonly label: string }
  | { readonly kind: "enum"; readonly value: string; readonly label: string }
  | { readonly kind: "range"; readonly min: number | null; readonly max: number | null; readonly scale: number | null; readonly label: string };
export interface CoverageAxis { readonly path: string; readonly values: readonly CoverageValueClass[]; }
export interface CoverageAction {
  readonly name: string;
  readonly capability: string;
  readonly condition: CoverageTruth;
  readonly actorScope: string;
  /** Literal actor only; dynamic actor expressions are never treated as equal. */
  readonly actorLiteral: string | null;
  /** Hypotheses describe a partition, not a claim about a real actor or legal action. */
  readonly hypothesis: "applies_legal" | "applies_illegal" | "other_actor" | "not_applicable" | "unresolved";
}
export interface CoverageObligation {
  readonly id: "condition" | "subject" | "legality" | "budget" | "ordering" | "profile_and_action" | "reachability";
  readonly status: "proven" | "unknown" | "not_proven";
  readonly explanation: string;
}
export interface DecisionClass {
  readonly obligations: readonly CoverageObligation[];
  readonly values: Readonly<Record<string, CoverageValueClass>>;
  readonly actions: readonly CoverageAction[];
  readonly conflict: string;
  readonly status: "UNKNOWN" | "NOT_PROVEN";
  readonly disposition: "default_candidate" | "explicit_candidate" | "unresolved";
  readonly reasons: readonly string[];
}
export type DecisionCoverageReport =
  | { readonly status: "unavailable"; readonly reason: string }
  | {
      readonly status: "analyzed";
      readonly axes: readonly CoverageAxis[];
      readonly classes: readonly DecisionClass[];
      readonly partitionComplete: boolean;
      readonly unresolved: readonly string[];
      readonly profile: CoverageProfile | null;
      readonly profileDeclared: boolean;
      readonly noAuthoredActions: boolean;
      readonly programDigest: string;
    };

type Obj = Record<string, unknown>;
function obj(value: unknown): value is Obj { return value !== null && typeof value === "object" && !Array.isArray(value); }
function actorId(actor: ActorSelection): string {
  switch (actor.scope) {
    case "army": return actor.side;
    case "squad": return actor.squadId;
    case "hero": return actor.heroId;
    case "lane_limited_minion": return actor.lane;
  }
}
function sameRule(a: CoverageProgram["ruleset"], b: CoverageProgram["ruleset"]): boolean {
  return a.id === b.id && a.digest === b.digest && sameVersion(a.version, b.version);
}
function identityProblem(input: DecisionCoverageInput): string | null {
  const { catalog, rulePackage: rules, ast, program, compilationStamp, profile, actor } = input;
  if (!catalog || !rules) return "The current RulePackage and verified Catalog are required.";
  if (!ast || !program || !compilationStamp) return "Compile the current draft against this Catalog to analyze its decision classes.";
  const i = catalog.identity;
  if (!sameCatalog(compilationStamp, catalogStamp(catalog))
    || !sameRule(program.ruleset, rules.ruleset)
    || i.rulesetId !== rules.ruleset.id || i.rulesetDigest !== rules.ruleset.digest || !sameVersion(i.rulesetVersion, rules.ruleset.version)
    || !sameVersion(i.minimumEngineVersion, rules.minimum_engine_version) || !sameVersion(i.modelVersion, rules.model_version)
    || i.primitiveSetId !== rules.primitive_set_id || !sameVersion(i.primitiveSetVersion, rules.primitive_set_version)
    || !sameVersion(i.jinreiLanguageVersion, rules.jinrei_language_version) || !sameVersion(i.structuredAstVersion, rules.structured_ast_version)
    || !sameVersion(i.typedIrVersion, rules.typed_ir_version) || !sameVersion(i.bytecodeVersion, rules.bytecode_version)
    || !sameVersion(ast.schema_version, rules.structured_ast_version)
    || !sameVersion(program.language_version, rules.jinrei_language_version) || !sameVersion(program.ir_version, rules.typed_ir_version)
    || !sameVersion(program.bytecode_version, rules.bytecode_version)
    || program.cost_schedule_id !== rules.cost_schedule.id || !sameVersion(program.cost_schedule_version, rules.cost_schedule.version)
    || catalog.costSchedule.id !== rules.cost_schedule.id || !sameVersion(catalog.costSchedule.version, rules.cost_schedule.version)) {
    return "The compiled Program, Catalog stamp, or RulePackage identity is stale or does not match.";
  }
  if (profile && (!sameCatalog(profile.catalog_identity, catalogStamp(catalog)) || profile.actor_scope !== actor.scope
    || profile.actor_id !== actorId(actor) || profile.side !== actor.side)) return "The supplied Profile belongs to a different Catalog or subject.";
  return null;
}

interface AxisBuilder { type: DomainType; thresholds: Set<number>; }
interface Atom { path: string; literal: Obj; operator: string; }
const reverse: Record<string, string> = {
  equal: "equal", not_equal: "not_equal", less_than: "greater_than", less_than_or_equal: "greater_than_or_equal",
  greater_than: "less_than", greater_than_or_equal: "less_than_or_equal",
};
function pathOf(value: unknown): string | null {
  return obj(value) && value.kind === "path" && Array.isArray(value.value) && value.value.every(part => typeof part === "string")
    ? value.value.join(".") : null;
}
function literalOf(value: unknown): Obj | null { return obj(value) && value.kind === "literal" && obj(value.value) ? value.value : null; }
function atomOf(value: unknown, catalog: DomainCatalogDocument, states: Map<string, readonly unknown[]>): Atom | null {
  if (!obj(value) || !obj(value.value) || value.kind !== "compare" || typeof value.value.operator !== "string") return null;
  const { left, right, operator } = value.value;
  const lp = pathOf(left), rp = pathOf(right), ll = literalOf(left), rl = literalOf(right);
  if (lp && !states.has(lp) && rl) return { path: lp, literal: rl, operator };
  if (rp && !states.has(rp) && ll && reverse[operator]) return { path: rp, literal: ll, operator: reverse[operator]! };
  // In text-authored ASTs a bare enum constant is a path. The compiler
  // resolves the right operand against the left enum's expected domain, after
  // checking state and observation paths first. Use only Catalog-declared
  // symbols and never reinterpret a state or observation as a constant.
  const leftType = lp ? catalog.observations[lp]?.valueType : undefined;
  if (lp && rp && !states.has(lp) && !rp.includes(".") && !states.has(rp) && !catalog.observations[rp]
    && leftType?.kind === "enum" && catalog.symbols.some(symbol => symbol.id.domain === leftType.value.domain && symbol.id.symbol === rp)) {
    return { path: lp, literal: { kind: "enum", value: rp }, operator };
  }
  return null;
}
function scalar(literal: Obj, type: DomainType): boolean | string | number | null {
  if (type.kind === "bool" && literal.kind === "bool" && typeof literal.value === "boolean") return literal.value;
  if (type.kind === "enum" && literal.kind === "enum" && typeof literal.value === "string" && type.value.values.includes(literal.value)) return literal.value;
  if (type.kind === "integer" && literal.kind === "integer" && Number.isSafeInteger(literal.value) && Math.abs(literal.value as number) < Number.MAX_SAFE_INTEGER) return literal.value as number;
  if (type.kind === "fixed" && literal.kind === "fixed" && obj(literal.value) && literal.value.scale === type.value.scale
    && Number.isSafeInteger(literal.value.coefficient) && Math.abs(literal.value.coefficient as number) < Number.MAX_SAFE_INTEGER) return literal.value.coefficient as number;
  return null;
}
function readable(catalog: DomainCatalogDocument, path: string): DomainType | null {
  const definition = catalog.observations[path];
  return definition && definition.readPermission !== "internal_denied" && definition.visibility !== "internal" ? definition.valueType : null;
}
function validType(type: DomainType): boolean {
  if (type.kind === "bool") return true;
  if (type.kind === "enum") return type.value.values.length > 0 && new Set(type.value.values).size === type.value.values.length;
  if (type.kind === "integer" || type.kind === "fixed") {
    return (type.value.min === null || Number.isSafeInteger(type.value.min)) && (type.value.max === null || Number.isSafeInteger(type.value.max))
      && (type.value.min === null || type.value.max === null || type.value.min <= type.value.max);
  }
  return false;
}
function addPath(catalog: DomainCatalogDocument, axes: Map<string, AxisBuilder>, path: string): AxisBuilder | null {
  const type = readable(catalog, path);
  if (!type || !validType(type)) return null;
  let axis = axes.get(path);
  if (!axis) { axis = { type, thresholds: new Set() }; axes.set(path, axis); }
  return axis;
}
function collect(predicate: unknown, catalog: DomainCatalogDocument, axes: Map<string, AxisBuilder>, states: Map<string, readonly unknown[]>, visiting: Set<string>, unresolved: Set<string>): void {
  if (!obj(predicate) || typeof predicate.kind !== "string") { unresolved.add("Malformed or unsupported condition"); return; }
  if (predicate.kind === "literal_truth") return;
  if (predicate.kind === "state_reference" && typeof predicate.value === "string") {
    const children = states.get(predicate.value);
    if (!children || visiting.has(predicate.value)) { unresolved.add(`State ${predicate.value} cannot be expanded`); return; }
    const next = new Set(visiting); next.add(predicate.value);
    children.forEach(child => collect(child, catalog, axes, states, next, unresolved)); return;
  }
  if (["and", "or", "ordered_and", "ordered_or"].includes(predicate.kind) && Array.isArray(predicate.value)) {
    predicate.value.forEach(child => collect(child, catalog, axes, states, visiting, unresolved)); return;
  }
  if (predicate.kind === "not") { collect(predicate.value, catalog, axes, states, visiting, unresolved); return; }
  if (predicate.kind === "knownness" && obj(predicate.value)) {
    const path = pathOf(predicate.value.value);
    if (path && !states.has(path) && addPath(catalog, axes, path) && (predicate.value.test === "known" || predicate.value.test === "unknown")) return;
    if (literalOf(predicate.value.value) && (predicate.value.test === "known" || predicate.value.test === "unknown")) return;
    unresolved.add("Knownness of a dynamic, inaccessible, or unsupported value"); return;
  }
  const atom = atomOf(predicate, catalog, states);
  if (atom) {
    const axis = addPath(catalog, axes, atom.path);
    const v = axis && scalar(atom.literal, axis.type);
    const allowed = catalog.observations[atom.path]?.allowedOperators.includes(atom.operator);
    const orderable = axis && (axis.type.kind === "integer" || axis.type.kind === "fixed");
    if (axis && v !== null && allowed && (orderable || atom.operator === "equal" || atom.operator === "not_equal")) {
      if (typeof v === "number") axis.thresholds.add(v);
      return;
    }
    unresolved.add(`Comparison for ${atom.path} has an unsupported type, operand, or operator`); return;
  }
  unresolved.add(`Condition ${predicate.kind} is outside the supported scalar subset`);
}
function axisValues(axis: AxisBuilder): CoverageValueClass[] {
  const { type } = axis;
  const unknown: CoverageValueClass = { kind: "unknown", label: "Unknown" };
  if (type.kind === "bool") return [...[false, true].map(value => ({ kind: "bool" as const, value, label: String(value) })), unknown];
  if (type.kind === "enum") return [...type.value.values.map(value => ({ kind: "enum" as const, value, label: value })), unknown];
  if (type.kind !== "integer" && type.kind !== "fixed") return [unknown];
  const lo = type.value.min, hi = type.value.max;
  const scale = type.kind === "fixed" ? type.value.scale : null;
  const result: CoverageValueClass[] = [];
  const add = (min: number | null, max: number | null): void => {
    if (min !== null && max !== null && min > max) return;
    const suffix = scale === null ? "" : ` (coefficient, scale ${scale})`;
    result.push({ kind: "range", min, max, scale, label: `${min === null ? "−∞" : min}…${max === null ? "+∞" : max}${suffix}` });
  };
  let start = lo;
  for (const t of [...axis.thresholds].sort((a, b) => a - b)) {
    if ((lo !== null && t < lo) || (hi !== null && t > hi)) continue;
    add(start, t - 1);
    add(t, t);
    start = t + 1;
  }
  add(start, hi);
  return [...result, unknown];
}

function compareAtom(atom: Atom, catalog: DomainCatalogDocument, values: Readonly<Record<string, CoverageValueClass>>): CoverageTruth {
  const type = readable(catalog, atom.path), value = values[atom.path];
  const literal = type && scalar(atom.literal, type);
  const allowed = catalog.observations[atom.path]?.allowedOperators.includes(atom.operator);
  if (!type || literal === null || !value || !allowed || !reverse[atom.operator]) return "not_proven";
  if (value.kind === "unknown") return "unknown";
  if (value.kind === "bool" || value.kind === "enum") {
    if (atom.operator !== "equal" && atom.operator !== "not_equal") return "not_proven";
    const equal = value.value === literal;
    return (atom.operator === "equal" ? equal : !equal) ? "true" : "false";
  }
  if (typeof literal !== "number") return "not_proven";
  const below = value.max !== null && value.max < literal;
  const above = value.min !== null && value.min > literal;
  const equal = value.min === literal && value.max === literal;
  if (!below && !above && !equal) return "not_proven";
  const yes = atom.operator === "equal" ? equal : atom.operator === "not_equal" ? !equal
    : atom.operator === "less_than" ? below : atom.operator === "less_than_or_equal" ? below || equal
      : atom.operator === "greater_than" ? above : above || equal;
  return yes ? "true" : "false";
}
function logical(items: readonly CoverageTruth[], and: boolean): CoverageTruth {
  // An unsupported term is retained even when another term decides Boolean truth;
  // evaluation cost and failures have not been modeled by this analysis.
  if (items.includes("not_proven")) return "not_proven";
  if (and && items.includes("false")) return "false";
  if (!and && items.includes("true")) return "true";
  if (items.includes("unknown")) return "unknown";
  return and ? "true" : "false";
}
function condition(predicate: unknown, catalog: DomainCatalogDocument, values: Readonly<Record<string, CoverageValueClass>>, states: Map<string, readonly unknown[]>, visiting: Set<string>): CoverageTruth {
  if (!obj(predicate) || typeof predicate.kind !== "string") return "not_proven";
  if (predicate.kind === "literal_truth" && typeof predicate.value === "boolean") return predicate.value ? "true" : "false";
  if (predicate.kind === "state_reference" && typeof predicate.value === "string") {
    const children = states.get(predicate.value);
    if (!children || visiting.has(predicate.value)) return "not_proven";
    const next = new Set(visiting); next.add(predicate.value);
    return logical(children.map(child => condition(child, catalog, values, states, next)), true);
  }
  if (["and", "or", "ordered_and", "ordered_or"].includes(predicate.kind) && Array.isArray(predicate.value)) {
    return logical(predicate.value.map(child => condition(child, catalog, values, states, visiting)), predicate.kind === "and" || predicate.kind === "ordered_and");
  }
  if (predicate.kind === "not") {
    const result = condition(predicate.value, catalog, values, states, visiting);
    return result === "true" ? "false" : result === "false" ? "true" : result;
  }
  if (predicate.kind === "knownness" && obj(predicate.value)) {
    const path = pathOf(predicate.value.value);
    const value = path && !states.has(path) ? values[path] : undefined;
    const literal = literalOf(predicate.value.value);
    if ((!value && !literal) || (predicate.value.test !== "known" && predicate.value.test !== "unknown")) return "not_proven";
    const known = literal !== null || value?.kind !== "unknown";
    return (predicate.value.test === "known" ? known : !known) ? "true" : "false";
  }
  const atom = atomOf(predicate, catalog, states);
  return atom ? compareAtom(atom, catalog, values) : "not_proven";
}

const MAX_CLASSES = 256;
type ActionDeclaration = Extract<CoverageAst["declarations"][number], { readonly kind: "action" }>;
function classActions(actions: readonly ActionDeclaration[], catalog: DomainCatalogDocument, values: Readonly<Record<string, CoverageValueClass>>, states: Map<string, readonly unknown[]>): CoverageAction[] {
  return actions.map(action => {
    const capability = action.do_call.capability.join(".");
    const metadata = catalog.capabilities[capability];
    const result = condition(action.when, catalog, values, states, new Set());
    const index = metadata?.actorArgument;
    const actor = typeof index === "number" && Number.isInteger(index) ? literalOf(action.do_call.arguments[index]) : null;
    const actorLiteral = actor?.kind === "entity" && typeof actor.value === "string" ? actor.value : null;
    const actorScope = metadata ? `${metadata.actorScope.kind.replaceAll("_", " ")}${metadata.actorScope.entityType ? ` · ${metadata.actorScope.entityType}` : ""}` : "Not declared by Catalog";
    return { name: action.name, capability, condition: result, actorScope, actorLiteral,
      hypothesis: result === "false" || result === "unknown" ? "not_applicable" : "unresolved" };
  });
}
function splitActions(actions: readonly CoverageAction[]): CoverageAction[][] {
  let rows: CoverageAction[][] = [[]];
  for (const action of actions) {
    const hypotheses: CoverageAction["hypothesis"][] = action.condition === "true" && action.actorScope !== "Not declared by Catalog"
      ? ["applies_legal", "applies_illegal", "other_actor", "unresolved"] : [action.hypothesis];
    if (rows.length * hypotheses.length > MAX_CLASSES) return [];
    rows = rows.flatMap(row => hypotheses.map(hypothesis => [...row, { ...action, hypothesis }]));
  }
  return rows;
}
function conflictPartitions(actions: readonly CoverageAction[], catalog: DomainCatalogDocument): string[] {
  const legal = actions.filter(action => action.hypothesis === "applies_legal");
  if (legal.length < 2) return ["No pair of legal candidates in this hypothesis"];
  const hypotheses: string[][] = [];
  for (let i = 0; i < legal.length; i++) for (let j = i + 1; j < legal.length; j++) {
    const left = legal[i]!, right = legal[j]!;
    const arbitration = catalog.capabilities[left.capability]?.arbitration;
    if (left.capability !== right.capability || !obj(arbitration) || !Array.isArray(arbitration.conflict_keys)) {
      hypotheses.push([`${left.name} / ${right.name}: cross-capability conflict not proven`]);
      continue;
    }
    const keys = arbitration.conflict_keys;
    if (keys.length > 0 && keys.every(key => obj(key) && key.kind === "actor") && left.actorLiteral !== null && right.actorLiteral !== null) {
      hypotheses.push([`${left.name} / ${right.name}: ${left.actorLiteral === right.actorLiteral ? "matching" : "different"} literal actor conflict key`]);
    } else {
      const names = keys.map(key => obj(key) && typeof key.kind === "string" ? key.kind : "unknown").join(", ") || "unspecified";
      hypotheses.push([`${left.name} / ${right.name}: matching conflict keys (${names})`, `${left.name} / ${right.name}: different conflict keys (${names})`]);
    }
  }
  let results = [""];
  for (const pair of hypotheses) {
    if (results.length * pair.length > MAX_CLASSES) return [];
    results = results.flatMap(result => pair.map(item => result ? `${result}; ${item}` : item));
  }
  return results;
}

function obligations(actions: readonly CoverageAction[], profile: CoverageProfile | null): CoverageObligation[] {
  const conditionStatus = actions.some(action => action.condition === "not_proven") ? "not_proven"
    : actions.some(action => action.condition === "unknown") ? "unknown" : "proven";
  const conditionExplanation = conditionStatus === "proven"
    ? "Every condition has one truth value throughout this range, assuming type-valid observations and completed evaluation."
    : conditionStatus === "unknown" ? "At least one condition evaluates to Unknown in this observation class."
      : "A condition uses a state or expression whose class-wide value is not derived.";
  return [
    { id: "condition", status: conditionStatus, explanation: conditionExplanation },
    { id: "subject", status: "not_proven", explanation: "Candidate actor, ownership, scope and arguments are hypotheses, not established facts for the selected subject." },
    { id: "legality", status: "not_proven", explanation: "The resolver requires current KnownLegal evidence for each exact candidate, actor and Tick; no class-wide certificate is supplied." },
    { id: "budget", status: "not_proven", explanation: "The execution request's allowed capabilities and available CU are not established for all represented states." },
    { id: "ordering", status: "not_proven", explanation: "Conflict-key branches are hypotheses; final cross-capability and RulePlan selection are not established." },
    { id: "profile_and_action", status: "not_proven", explanation: profile
      ? "The supplied defaults-only Profile is limited to its Tick and roster; it does not certify a default candidate, no-op fallback, or final action for this class."
      : "No class-wide resolved Profile, default candidate, or certified no-op fallback is supplied." },
    { id: "reachability", status: "not_proven", explanation: "No reachability certificate is supplied for every represented state and possible path." },
  ];
}

/**
 * Enumerate symbolic classes for direct, readable bool/enum and integer/fixed
 * threshold predicates. This is a static partition, not a VM or a combat
 * simulation: candidate actor, legality, conflict and reachability are open
 * constraints. No class is called proved without an authoritative resolver.
 */
export function analyzeDecisionCoverage(input: DecisionCoverageInput): DecisionCoverageReport {
  const issue = identityProblem(input);
  if (issue) return { status: "unavailable", reason: issue };
  const { ast, catalog, program } = input as DecisionCoverageInput & { ast: CoverageAst; catalog: DomainCatalogDocument; program: CoverageProgram };
  const states = new Map<string, readonly unknown[]>();
  for (const declaration of ast.declarations) if (declaration.kind === "state") states.set(declaration.name, declaration.predicates);
  const actions = ast.declarations.filter((item): item is ActionDeclaration => item.kind === "action");
  const axes = new Map<string, AxisBuilder>();
  const unresolved = new Set<string>();
  for (const action of actions) collect(action.when, catalog, axes, states, new Set(), unresolved);
  const builtAxes: CoverageAxis[] = [...axes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([path, axis]) => ({ path, values: axisValues(axis) }));
  const common = { status: "analyzed" as const, axes: builtAxes, profile: input.profile,
    profileDeclared: catalog.behaviorProfiles.status === "authored_extension", noAuthoredActions: actions.length === 0, programDigest: program.content_digest };
  const pending = "Reachability, capability legality, execution budget, Profile effect, and final RulePlan action are not statically proved.";
  let values: Array<Record<string, CoverageValueClass>> = [{}];
  for (const axis of builtAxes) {
    if (values.length * axis.values.length > MAX_CLASSES) return { ...common, classes: [], partitionComplete: false,
      unresolved: [...unresolved, `Class limit (${MAX_CLASSES}) reached; the full Cartesian product remains unenumerated.`, pending] };
    values = values.flatMap(row => axis.values.map(value => ({ ...row, [axis.path]: value })));
  }
  const classes: DecisionClass[] = [];
  for (const value of values) {
    const evaluated = classActions(actions, catalog, value, states);
    const combinations = splitActions(evaluated);
    if (!combinations.length) return { ...common, classes: [], partitionComplete: false,
      unresolved: [...unresolved, `Class limit (${MAX_CLASSES}) reached while partitioning actors and legality; all classes remain unenumerated.`, pending] };
    for (const combination of combinations) {
      const conflicts = conflictPartitions(combination, catalog);
      if (!conflicts.length || classes.length + conflicts.length > MAX_CLASSES) return { ...common, classes: [], partitionComplete: false,
        unresolved: [...unresolved, `Class limit (${MAX_CLASSES}) reached while partitioning conflicts; all classes remain unenumerated.`, pending] };
      for (const conflict of conflicts) {
        const unknown = Object.values(value).some(item => item.kind === "unknown") || combination.some(item => item.condition === "unknown");
        const dynamic = combination.some(item => item.condition === "not_proven" || item.hypothesis === "unresolved");
        const explicit = combination.some(item => item.hypothesis === "applies_legal");
        classes.push({ values: value, actions: combination, conflict, obligations: obligations(combination, input.profile), status: unknown ? "UNKNOWN" : "NOT_PROVEN",
          disposition: dynamic || unknown ? "unresolved" : explicit ? "explicit_candidate" : "default_candidate",
          reasons: [pending, ...(dynamic ? ["An unsupported condition, actor, argument, or capability can represent further decision classes."] : []),
            ...(unknown ? ["Unknown is an observation class, not a substituted value."] : [])] });
      }
    }
  }
  // Reachability and final decision are still unproved even if the scalar
  // observation and hypothetical actor/legality dimensions were enumerated.
  return { ...common, classes, partitionComplete: false, unresolved: [...unresolved, pending] };
}
