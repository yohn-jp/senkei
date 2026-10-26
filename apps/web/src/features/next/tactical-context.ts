import type { ActionSourceMap, CompileOutcome } from "../../contracts";
import type { Replay } from "@senkei/replay-contract";
import { compilerTextOffset } from "./compiler-location";

export interface BattleAnalysisContext {
  readonly experimentId: string;
  readonly matchId: string;
  readonly perspective: Replay["header"]["view"];
  readonly tick: number;
  readonly entityId: string | null;
  readonly event: { readonly tick: number; readonly order: number } | null;
  readonly trace: { readonly tick: number; readonly sequence: number } | null;
}

export interface AnalysisSourceContext {
  readonly identity: string;
  readonly context: BattleAnalysisContext;
  readonly actionId: string;
  readonly programDigest: string;
  readonly source: string;
  readonly range: { readonly start: number; readonly end: number };
}

export async function sourceDigest(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function verifyRunSourceMap(source: string, programDigest: string, result: CompileOutcome): Promise<{ map: ActionSourceMap | null; reason: string }> {
  const map = result.source_map;
  if (!map) return { map: null, reason: "Compiler supplied no Action source locations for this Run." };
  if (map.schema_version !== 1 || map.program_digest !== programDigest || result.program.content_digest !== programDigest) {
    return { map: null, reason: "Original Run Program differs from the recompiled Program. Source correspondence is unavailable." };
  }
  if (map.source_digest !== await sourceDigest(source)) return { map: null, reason: "Source locations belong to different source bytes." };
  return { map, reason: "Original Run source and Program digests verified." };
}

/** No string search or guessed lines: only one parser-produced Action span is usable. */
export function actionSourceRange(source: string, map: ActionSourceMap, actionId: string): { start: number; end: number } | null {
  const matches = map.actions.filter(action => action.action_id === actionId);
  if (matches.length !== 1) return null;
  const action = matches[0];
  if (!Number.isSafeInteger(action.declaration_index) || action.declaration_index < 0
    || !Number.isSafeInteger(action.start_utf8) || !Number.isSafeInteger(action.end_utf8) || action.start_utf8 >= action.end_utf8) return null;
  const start = compilerTextOffset(source, `source@${action.start_utf8}`);
  const end = compilerTextOffset(source, `source@${action.end_utf8}`);
  return start === null || end === null ? null : { start, end };
}

/** Native textarea values normalize CRLF and lone CR to LF. Raw source stays untouched. */
export function textareaSourceSelection(source: string, range: { readonly start: number; readonly end: number }): { source: string; start: number; end: number } {
  const normalize = (value: string) => value.replace(/\r\n?/g, "\n");
  return { source: normalize(source), start: normalize(source.slice(0, range.start)).length, end: normalize(source.slice(0, range.end)).length };
}
