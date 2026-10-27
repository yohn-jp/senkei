import { describe, expect, it } from "vitest";
import { setupRestoreDifferences } from "./NextWorkspace";

type Setup = NonNullable<Parameters<typeof setupRestoreDifferences>[0]>;
const version = { major: 1, minor: 0, patch: 0 };
const slot = { slot_id: "hero-1", catalog_id: "F01", squad: "alpha", node: "A", skill_path: "path_a" };
const setup = {
  format_version: 1, saved_at: "first-save", ruleset: { id: "next", digest: "rules", version },
  schema_version: version, mechanics_version: version, formation_shape: "single", slots: [slot], rival_slots: [slot],
  draft: { id: "draft", revision: "1", schema_version: version,
    ruleset: { id: "next", digest: "rules", version }, configuration: {}, initial_memory: {},
    program_input: { kind: "text", source: "source" } }, rival_source: "opponent",
} satisfies Setup;

describe("persisted setup restore differences", () => {
  it("ignores save timestamps, object property order and absent/null legacy scenarios", () => {
    const copy = { ...setup, saved_at: "later-save", campaign_scenario_id: null,
      ruleset: { digest: "rules", version, id: "next" } };
    expect(setupRestoreDifferences(setup, copy)).toEqual([]);
  });

  it("includes scenario-only differences in the same comparison used for saved state", () => {
    expect(setupRestoreDifferences(setup, { ...setup, campaign_scenario_id: "march" })).toEqual(["Scenario: Starter → march"]);
  });

  it("identifies actual own and opponent Hero, Skill, Squad and Node replacements", () => {
    const changes = setupRestoreDifferences(setup, { ...setup,
      slots: [{ ...slot, catalog_id: "F02", skill_path: "path_b" }],
      rival_slots: [{ ...slot, squad: "beta", node: "B" }],
    });
    expect(changes).toEqual([
      "Own hero-1 Hero: F01 → F02", "Own hero-1 Skill plan: path_a → path_b",
      "Opponent hero-1 Squad: alpha → beta", "Opponent hero-1 starting Node: A → B",
    ]);
  });

  it("covers persisted identity, formation, Draft and opponent source fields", () => {
    const changes = setupRestoreDifferences(setup, { ...setup,
      ruleset: { ...setup.ruleset, digest: "new-rules" }, schema_version: { ...version, patch: 1 },
      mechanics_version: { ...version, minor: 1 }, formation_shape: "wings",
      draft: { ...setup.draft, revision: "2" }, rival_source: "new opponent",
    });
    expect(changes).toEqual([
      "RulePackage identity changes.", "Schema version changes.", "Mechanics version changes.",
      "Formation: single → wings", "Jinrei / Draft content, identity or revision changes.", "Opponent Jinrei changes.",
    ]);
  });

  it("reports slot membership and order changes", () => {
    expect(setupRestoreDifferences(setup, { ...setup, slots: [] })).toContain("Own slot hero-1 is removed.");
    const second = { ...slot, slot_id: "hero-2" };
    expect(setupRestoreDifferences({ ...setup, slots: [slot, second] }, { ...setup, slots: [second, slot] }))
      .toEqual(["Own slot order changes."]);
  });

  it("includes instance selections and equipment assignments in restore review", () => {
    expect(setupRestoreDifferences(setup, { ...setup,
      owned_hero_selection: { schemaVersion: 1, playerId: 'player', slots: { one: 'hero' } },
      owned_equipment_draft: { schemaVersion: 1, playerId: 'player', assignments: { item: 'hero' } },
    })).toEqual(['Owned Hero instance selections change.', 'Draft equipment assignments change.']);
  });

  it('reviews saved trial limits and optional lane observations separately from the Program', () => {
    expect(setupRestoreDifferences(setup, { ...setup,
      trial_options: {schemaVersion:1,maxTicks:3,minionMidObservations:true},
    })).toEqual(['Local trial execution options change.']);
  });
});
