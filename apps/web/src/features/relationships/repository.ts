/** Local relationship storage. Hero IDs are opaque references supplied by an ownership authority. */
export const RELATIONSHIP_STORAGE_KEY = "senkei.relationships.v1";
export type RelationshipEvent = {
  eventId: string;
  source: "authoritative" | "replay" | "import";
  from: string;
  to: string;
  definitionVersion: string;
  value: number | null;
  tags: string[];
  history: string;
};
export type RelationshipArchive = { schemaVersion: 1; playerId: string; events: RelationshipEvent[] };
export type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;
export type HeroOwnershipResolver = (playerId: string, heroId: string) => boolean;
export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
const fail = (reason: string): Result<never> => ({ ok: false, reason });
const validString = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
function validEvent(v: unknown): v is RelationshipEvent {
  if (!v || typeof v !== "object" || Array.isArray(v)) return false;
  const e = v as Record<string, unknown>;
  return Object.keys(e).sort().join(",") === "definitionVersion,eventId,from,history,source,tags,to,value" &&
    validString(e.eventId) && e.source === "authoritative" && validString(e.from) && validString(e.to) && e.from !== e.to &&
    validString(e.definitionVersion) && (e.value === null || (typeof e.value === "number" && Number.isFinite(e.value))) &&
    Array.isArray(e.tags) && e.tags.every(validString) && new Set(e.tags).size === e.tags.length && validString(e.history);
}
function parse(raw: string): Result<RelationshipArchive> {
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return fail("invalid-schema");
    const a = v as Record<string, unknown>;
    if (Object.keys(a).sort().join(",") !== "events,playerId,schemaVersion" || a.schemaVersion !== 1 || !validString(a.playerId) || !Array.isArray(a.events) || !a.events.every(validEvent)) return fail("invalid-schema");
    const events = a.events as RelationshipEvent[];
    if (new Set(events.map(e => e.eventId)).size !== events.length) return fail("invalid-schema");
    return { ok: true, value: { schemaVersion: 1, playerId: a.playerId as string, events } };
  } catch { return fail("invalid-schema"); }
}
export function createRelationshipRepository(storage: Storage, playerId: string, owns: HeroOwnershipResolver = () => false) {
  if (!validString(playerId)) throw new Error("invalid-player-id");
  const key = `${RELATIONSHIP_STORAGE_KEY}:${encodeURIComponent(playerId)}`;
  const getRaw = (): string | null => storage.getItem(key);
  const exportRaw = (): string | null => {
    const raw = getRaw();
    if (raw === null) return null;
    const parsed = parse(raw);
    return parsed.ok && parsed.value.playerId !== playerId ? null : raw;
  };
  const read = (): Result<RelationshipArchive> => {
    try { const raw = getRaw();
      if (raw === null) return { ok: true, value: { schemaVersion: 1, playerId, events: [] } };
      const parsed = parse(raw);
      return parsed.ok && parsed.value.playerId !== playerId ? fail("player-mismatch") : parsed; }
    catch { return fail("storage-unavailable"); }
  };
  const verified = (events: RelationshipEvent[]) => {
    try { return events.every(e => owns(playerId, e.from) === true && owns(playerId, e.to) === true); } catch { return false; }
  };
  const save = (archive: RelationshipArchive): Result<RelationshipArchive> => {
    try { storage.setItem(key, JSON.stringify(archive)); return { ok: true, value: archive }; }
    catch { return fail("storage-write-failed"); }
  };
  const applyEvent = (event: RelationshipEvent): Result<RelationshipArchive> => {
    if (event.source === "replay" || event.source === "import") return fail("non-authoritative-event");
    if (!validEvent(event)) return fail("invalid-event");
    const current = read(); if (!current.ok) return current;
    const existing = current.value.events.find(e => e.eventId === event.eventId);
    if (existing) return JSON.stringify(existing) === JSON.stringify(event) ? current : fail("event-id-conflict");
    if (!verified([event])) return fail("hero-ownership-unverified");
    return save({ schemaVersion: 1, playerId, events: [...current.value.events, structuredClone(event)] });
  };
  /** Recovery restores a complete archive only to an empty store; it never merges progress. */
  const importArchive = (raw: string): Result<RelationshipArchive> => {
    const incoming = parse(raw); if (!incoming.ok) return incoming;
    if (incoming.value.playerId !== playerId) return fail("player-mismatch");
    const current = read(); if (!current.ok) return current;
    if (getRaw() !== null) return fail("store-not-empty");
    if (!verified(incoming.value.events)) return fail("hero-ownership-unverified");
    return save(incoming.value);
  };
  // The approved, versioned formula schema is undecided; no executable callback can
  // establish approval, determinism, or symmetry for the full input domain.
  const freezePair = (a: string, b: string): Result<never> => {
    if (!validString(a) || !validString(b) || a === b) return fail("invalid-pair");
    const current = read(); if (!current.ok) return current;
    return fail("decision-required");
  };
  return { read, exportRaw, applyEvent, importArchive, freezePair };
}
