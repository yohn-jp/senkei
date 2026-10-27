import { describe, expect, it } from "vitest";
import { parseFormationSlots, parseSavedNextSetup } from "./NextWorkspace";
const ids = ["slot-1", 'quote"\\', "狼🐺", " leading ", "control\b\f\u0001"];
const slots = ids.map((slot_id, index) => ({ slot_id, catalog_id: `F0${index + 1}`, squad: "alpha", node: "A.BASE", skill_path: "path_a" }));
describe("Core-defined opaque Hero slot identities", () => {
  it("preserves exact IDs and order instead of rewriting them to UI defaults", () => {
    expect(parseFormationSlots(slots)).toEqual(slots);
    expect(parseFormationSlots([...slots].reverse())).toEqual([...slots].reverse());
  });
  it("preserves exact identities through the existing Setup JSON save/parse format", () => {
    const version = { major: 1, minor: 0, patch: 0 };
    const ruleset = { id: "senkei.next", digest: "digest", version };
    const setup = { format_version: 1, saved_at: "saved", ruleset, schema_version: version, mechanics_version: version,
      formation_shape: "single", slots, rival_slots: slots,
      draft: { id: "real-id", revision: "1", schema_version: version, ruleset, configuration: {}, initial_memory: {}, program_input: { kind: "text", source: "senkei observe {}" } }, rival_source: "senkei observe {}" };
    expect(parseSavedNextSetup(JSON.parse(JSON.stringify(setup)))).toEqual(setup);
    const owned = { ...setup,
      trial_options: {schemaVersion:1,maxTicks:3,minionMidObservations:true},
      owned_hero_selection: { schemaVersion: 1, playerId: 'player', slots: { [ids[1]]: 'instance' } },
      owned_equipment_draft: { schemaVersion: 1, playerId: 'player', assignments: { equipment: 'instance' } },
    };
    expect(parseSavedNextSetup(JSON.parse(JSON.stringify(owned)))).toEqual(owned);
    expect(parseSavedNextSetup({ ...owned, owned_equipment_draft: { ...owned.owned_equipment_draft, schemaVersion: 99 } })).toBeNull();
    expect(parseSavedNextSetup({ ...owned, owned_hero_selection: { ...owned.owned_hero_selection, slots: { one: null } } })).toBeNull();
    expect(parseSavedNextSetup({ ...owned, trial_options: {...owned.trial_options,maxTicks:0.5} })?.trial_options?.maxTicks).toBe(0.5);
    expect(parseSavedNextSetup({ ...owned, trial_options: {...owned.trial_options,minionMidObservations:'yes'} })).toBeNull();
  });
  it("enforces five unique nonempty UTF8 IDs and the exact48-byte Core bound", () => {
    const withFirst = (slot_id: string) => [{ ...slots[0], slot_id }, ...slots.slice(1)];
    expect(parseFormationSlots(withFirst("狼".repeat(16)))).not.toBeNull();
    expect(parseFormationSlots(withFirst("狼".repeat(17)))).toBeNull();
    for (const invalid of ["", " \t\n", "\u0085", "x".repeat(49), "\ud800", ids[1]]) expect(parseFormationSlots(withFirst(invalid))).toBeNull();
    expect(parseFormationSlots(slots.slice(1))).toBeNull();
    expect(parseFormationSlots([...slots, slots[0]])).toBeNull();
    // Rust Unicode White_Space excludes BOM; the exact nonempty ID is retained.
    expect(parseFormationSlots(withFirst("\ufeff"))).not.toBeNull();
  });
});
