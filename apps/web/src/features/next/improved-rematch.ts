import type { SenkeiSnapshot, SimulationSnapshot } from "../../contracts";
import { canonicalInputKey, classifyRunComparison, type RunComparison } from "./run-comparison";

export type ImprovedRematchRejection =
  | "non_json_input"
  | "unavailable_inputs"
  | "fixed_own_conditions_changed"
  | "revision_without_improvement";
export type ImprovedRematchResult =
  | { readonly status: "ready"; readonly snapshot: SimulationSnapshot; readonly comparison: RunComparison }
  | { readonly status: "rejected"; readonly reason: ImprovedRematchRejection; readonly paths: readonly string[]; readonly requires: "current_conditions" };

/** Clone the actual JSON boundary; never silently drop unsupported input fields. */
function cloneJson<T>(input: T): T {
  const ancestors = new Set<object>();
  const check = (value: unknown, depth: number): void => {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || depth > 128 || ancestors.has(value)) throw new TypeError("Non-JSON input");
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new TypeError("Non-JSON object");
    const properties = Object.getOwnPropertyDescriptors(value);
    if (Object.getOwnPropertySymbols(value).length || (array && (Object.keys(value).length !== value.length || Object.keys(value).some((key, index) => key !== String(index))))) throw new TypeError("Non-JSON properties");
    ancestors.add(value);
    for (const [key, property] of Object.entries(properties)) {
      if (array && key === "length") continue;
      if (!property.enumerable || !("value" in property)) throw new TypeError("Non-JSON property");
      check(property.value, depth + 1);
    }
    ancestors.delete(value);
  };
  check(input, 0);
  return JSON.parse(JSON.stringify(input)) as T;
}

/**
 * Derive an own-improvement comparison from the immutable submitted Run inputs.
 * Keep the original opponent and ENTIRE context, including match_id (which Core
 * may use to derive runtime IDs). Only own configuration/code/associated revision
 * may change. Unknown future fields are fixed conditions too. `ready` validates
 * the merge contract; the caller must still submit this exact snapshot to Core
 * preflight. No current World, opponent or execution context is synthesized.
 */
export function buildImprovedRematch(original: SimulationSnapshot, currentOwn: SenkeiSnapshot): ImprovedRematchResult {
  const reject = (reason: ImprovedRematchRejection, paths: readonly string[]): ImprovedRematchResult =>
    ({ status: "rejected", reason, paths, requires: "current_conditions" });
  let base: SimulationSnapshot, own: SenkeiSnapshot;
  try { base = cloneJson(original); } catch { return reject("non_json_input", ["original"]); }
  try { own = cloneJson(currentOwn); } catch { return reject("non_json_input", ["currentOwn"]); }
  const snapshot = { ...base, attacker: own };
  const comparison = classifyRunComparison({ snapshot: base }, { snapshot });
  if (comparison.unavailable.length) return reject("unavailable_inputs", comparison.unavailable);
  const fixed = comparison.changes.filter(change => !change.ownTarget);
  if (fixed.length) return reject(fixed.every(change => change.path === "attacker.revision")
    ? "revision_without_improvement" : "fixed_own_conditions_changed", fixed.map(change => change.path));
  // This check also guards future changes to comparison classification: a merge
  // must never return a silently altered fixed context or opponent.
  if (canonicalInputKey(snapshot.context) !== canonicalInputKey(base.context)
    || canonicalInputKey(snapshot.defender) !== canonicalInputKey(base.defender)) {
    return reject("fixed_own_conditions_changed", ["context", "defender"]);
  }
  return { status: "ready", snapshot, comparison };
}
