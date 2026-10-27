import type { SimulationSnapshot } from "../contracts/core";

function compareUnicodeScalars(left: string, right: string): number {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex)!;
    const rightPoint = right.codePointAt(rightIndex)!;
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return leftIndex === left.length ? (rightIndex === right.length ? 0 : -1) : 1;
}

/** Canonical JSON ordering used by serde_json::Value (Unicode scalar key order). */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const serialized = JSON.stringify(value);
    if (serialized === undefined) throw new Error("Diagnostics snapshot contains a non-JSON value.");
    return serialized;
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? "null" : canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort(compareUnicodeScalars);
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 of the complete input tuple, encoded like serde_json::Value. */
export async function reproductionSnapshotDigest(snapshot: SimulationSnapshot): Promise<string> {
  return sha256Hex(canonicalJson({
    attacker: snapshot.attacker,
    context: snapshot.context,
    defender: snapshot.defender,
  }));
}

