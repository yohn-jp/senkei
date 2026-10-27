import { describe, expect, it } from "vitest";
import { createRelationshipRepository, RELATIONSHIP_STORAGE_KEY, type RelationshipEvent } from "./repository";

function setup(owns?: (id: string) => boolean) {
  let raw: string | null = null;
  const storage = { getItem: () => raw, setItem: (_key: string, value: string) => { raw = value; } };
  return { repo: createRelationshipRepository(storage, owns), storage, raw: () => raw };
}
const event = (overrides: Partial<RelationshipEvent> = {}): RelationshipEvent => ({ eventId: "one", source: "authoritative", from: "a", to: "b", definitionVersion: "v1", value: 3, tags: ["ally"], history: "episode", ...overrides });
describe("relationship repository", () => {
  it("requires verified owned Hero references and rejects replay and import events", () => {
    const { repo, raw } = setup();
    expect(repo.applyEvent(event())).toEqual({ ok: false, reason: "hero-ownership-unverified" });
    expect(repo.applyEvent(event({ source: "replay" }))).toEqual({ ok: false, reason: "non-authoritative-event" });
    expect(repo.applyEvent(event({ source: "import" }))).toEqual({ ok: false, reason: "non-authoritative-event" });
    expect(raw()).toBeNull();
  });
  it("retains directed events, deduplicates and freezes a detached symmetric projection", () => {
    const { repo } = setup(() => true);
    expect(repo.applyEvent(event()).ok).toBe(true);
    expect(repo.applyEvent(event()).ok).toBe(true);
    expect(repo.applyEvent(event({ value: 4 })).ok).toBe(false);
    expect(repo.applyEvent(event({ eventId: "two", from: "b", to: "a", value: 7 })).ok).toBe(true);
    expect(repo.read().ok && repo.read()).toMatchObject({ value: { events: [event(), event({ eventId: "two", from: "b", to: "a", value: 7 })] } });
    expect(repo.freezePair("a", "b")).toEqual({ ok: false, reason: "decision-required" });
    const formula = { version: "approved-v1", derive: (a: number, b: number) => (a + b) / 2 };
    const frozen = repo.freezePair("a", "b", formula);
    expect(frozen).toEqual(repo.freezePair("b", "a", formula));
    repo.applyEvent(event({ eventId: "three", value: 9 }));
    expect(frozen).toMatchObject({ ok: true, value: { value: 5 } });
    expect(repo.freezePair("a", "b", { version: "v", derive: (a) => a })).toEqual({ ok: false, reason: "invalid-formula" });
  });
  it("preserves missing values, invalid archives and existing data", () => {
    const { repo, storage, raw } = setup(() => true);
    repo.applyEvent(event({ value: null }));
    repo.applyEvent(event({ eventId: "two", from: "b", to: "a" }));
    expect(repo.freezePair("a", "b", { version: "v", derive: (a, b) => a + b })).toEqual({ ok: false, reason: "decision-required" });
    const before = raw();
    expect(repo.importArchive(JSON.stringify({ schemaVersion: 1, events: [] })).ok).toBe(false);
    expect(raw()).toBe(before);
    storage.setItem(RELATIONSHIP_STORAGE_KEY, '{"schemaVersion":2}');
    expect(repo.applyEvent(event()).ok).toBe(false);
    expect(raw()).toBe('{"schemaVersion":2}');
  });
  it("recovers an archive only when ownership is verified", () => {
    const original = setup(() => true); original.repo.applyEvent(event());
    const data = original.raw()!;
    expect(setup().repo.importArchive(data).ok).toBe(false);
    const recovered = setup(() => true);
    expect(recovered.repo.importArchive(data).ok).toBe(true);
    expect(recovered.raw()).toBe(data);
  });
});
