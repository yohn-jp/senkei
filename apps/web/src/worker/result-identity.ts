import type { DomainValue, MatchResult } from "../contracts/core-model";
import { compareUnicodeScalars } from "./input-identity";

function jsonFields(fields: readonly (readonly [string, string])[]): string {
  return `{${fields.map(([key, value]) => `${JSON.stringify(key)}:${value}`).join(',')}}`;
}

function domainMapJson(values: Readonly<Record<string, DomainValue>>): string {
  return jsonFields(Object.keys(values).sort(compareUnicodeScalars).map(key => [key, domainValueJson(values[key])]));
}

function domainValueJson(value: DomainValue): string {
  const kind = JSON.stringify(value.kind);
  const tagged = (encoded: string) => jsonFields([['kind', kind], ['value', encoded]]);
  switch (value.kind) {
    case "null": return jsonFields([['kind', kind]]);
    case "fixed": return tagged(jsonFields([['coefficient', JSON.stringify(value.value.coefficient)], ['scale', JSON.stringify(value.value.scale)]]));
    case "list": return tagged(`[${value.value.map(domainValueJson).join(',')}]`);
    case "record": return tagged(domainMapJson(value.value));
    default: return tagged(JSON.stringify(value.value));
  }
}

/** Rust struct order plus BTreeMap scalar ordering, without JS numeric-key reordering. */
export function matchResultDigestJson(result: MatchResult): string {
  return jsonFields([
    ['match_id', JSON.stringify(result.match_id)], ['outcome', JSON.stringify(result.outcome)],
    ['termination_reason', JSON.stringify(result.termination_reason)], ['final_tick', JSON.stringify(result.final_tick)],
    ['statistics', domainMapJson(result.statistics)],
    ['cu_spent', jsonFields([['attacker', JSON.stringify(result.cu_spent.attacker)], ['defender', JSON.stringify(result.cu_spent.defender)]])],
    ['final_state_digest', JSON.stringify(result.final_state_digest)],
  ]);
}

