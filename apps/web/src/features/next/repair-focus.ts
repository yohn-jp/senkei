import type { PreflightRepairTarget } from "./preflight-problem";
import { compilerTextOffset } from "./compiler-location";
import { textareaSourceSelection } from "./tactical-context";

/** Each explicit navigation attempt needs a new ID, even when its target is unchanged. */
export interface HeroRepairFocusRequest {
  readonly requestId: string;
  readonly target: Extract<PreflightRepairTarget, { kind: "own_hero" }>;
}
export interface JinreiRepairFocusRequest {
  readonly requestId: string;
  readonly target: Extract<PreflightRepairTarget, { kind: "own_jinrei" }>;
  /** Raw text captured from the failed compile; null for AST/no exact text. */
  readonly exactSource: string | null;
}
type Slot = { readonly slot_id: string; readonly catalog_id: string; readonly skill_path: string; readonly squad: string; readonly node: string };
export function resolveHeroRepair(slots: readonly Slot[], target: HeroRepairFocusRequest["target"]) {
  if (target.slotId.length === 0 || !["catalog_id", "skill_path", "squad", "node"].includes(target.field)) return null;
  const matches = slots.map((slot, index) => ({ slot, index })).filter(item => item.slot.slot_id === target.slotId);
  if (matches.length !== 1 || matches[0].index !== target.recordIndex || target.field === "slot_id") return null;
  const screen: HeroRepairFocusRequest["target"]["screen"] = target.field === "skill_path" ? "skills" : target.field === "node" || target.field === "squad" ? "squads" : "collection";
  if (target.screen !== screen) return null;
  return { index: matches[0].index, slot: matches[0].slot, screen, stage: target.field === "node" ? "deploy" as const : "assign" as const };
}
export function repairSourceCursor(currentSource: string | null, request: JinreiRepairFocusRequest) {
  if (request.exactSource !== null && currentSource !== request.exactSource) return { cursor: null, stale: true, reason: "Source repair unavailable: captured source differs from the current Draft." };
  const offset = request.exactSource === null ? null : compilerTextOffset(request.exactSource, request.target.path);
  if (offset === null) return { cursor: null, stale: false, reason: "Source location unavailable. No text position was inferred from an AST or missing path." };
  return { cursor: textareaSourceSelection(request.exactSource!, { start: offset, end: offset }), stale: false, reason: "Requested compiler source location." };
}
