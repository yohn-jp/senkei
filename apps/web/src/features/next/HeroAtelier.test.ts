import { describe, expect, it } from "vitest";
import type { HeroDefinition, SkillDefinition } from "../../contracts";
import { skillPathIssues } from "./HeroAtelier";

function skill(id: string, unlock_level: number, prerequisites: string[] = []): SkillDefinition {
  return {
    id, name: id, passive: true, unlock_level, prerequisites, cooldown: 0, cost: 0,
    range: 0, target: "self", effect: "defense", power: 0, duration: 0,
  };
}

function hero(path: readonly string[], skills: readonly SkillDefinition[]): HeroDefinition {
  return { skill_paths: { path_a: path }, skills } as unknown as HeroDefinition;
}

describe("Hero Atelier Skill Tree path validation", () => {
  it("accepts a branch whose prerequisites are earlier and unlock no later", () => {
    const definition = hero(["root", "follow-up"], [
      skill("root", 1),
      skill("follow-up", 3, ["root"]),
    ]);
    expect(skillPathIssues(definition, "path_a")).toEqual([]);
  });

  it("blocks missing, outside-branch, later and out-of-order prerequisites", () => {
    const definition = hero(["root", "late", "future", "outside", "unknown"], [
      skill("root", 1),
      skill("late", 2, ["future"]),
      skill("future", 5),
      skill("outside", 3, ["branch-only"]),
      skill("branch-only", 1),
      skill("unknown", 3, ["not-authored"]),
    ]);
    const problems = skillPathIssues(definition, "path_a");
    expect(problems).toContain("future must appear before late.");
    expect(problems).toContain("outside requires branch-only, which is not in this path.");
    expect(problems).toContain("unknown requires unknown skill not-authored.");
  });

  it("blocks a prerequisite that unlocks after its dependent skill", () => {
    const definition = hero(["root", "future", "late"], [
      skill("root", 1),
      skill("future", 5),
      skill("late", 2, ["future"]),
    ]);
    expect(skillPathIssues(definition, "path_a")).toContain("future unlocks after late and cannot satisfy its prerequisite.");
  });

  it("does not accept an empty or missing branch as a valid selectable path", () => {
    const definition = hero([], [skill("root", 1)]);
    expect(skillPathIssues(definition, "path_a")).toEqual(["This branch has no selectable skills."]);
    expect(skillPathIssues(definition, "missing")).toEqual(["This branch has no selectable skills."]);
  });
});

describe("Hero candidate adoption", () => {
  it("previews the same patch used for adoption without changing the source slot", async () => {
    const { heroAdoption } = await import("./HeroAtelier");
    const slot = { slot_id: "slot-02", catalog_id: "old", skill_path: "missing", squad: "squad-2", node: "home" };
    const candidate = { ...hero(["root"], [skill("root", 1)]), id: "candidate", name: "Candidate" };
    const before = { ...slot };
    const result = heroAdoption(candidate, slot, 1, "Original");
    expect(slot).toEqual(before);
    expect(result.changes).toEqual({ catalog_id: "candidate", skill_path: "path_a" });
    expect(result.details.join(" ")).toContain("Slot 2: Original → Candidate");
    expect(result.details.join(" ")).toContain("Skill plan changed");
    expect(result.details.join(" ")).toContain("Squad Squad 2 and starting node Home stay assigned");
    expect(result.details.join(" ")).toContain("Jinrei compile must be checked again");
  });

  it("retains a branch provided by the candidate", async () => {
    const { heroAdoption } = await import("./HeroAtelier");
    const slot = { slot_id: "slot-01", catalog_id: "old", skill_path: "path_a", squad: "solo", node: "home" };
    const candidate = { ...hero(["root"], [skill("root", 1)]), id: "candidate", name: "Candidate" };
    expect(heroAdoption(candidate, slot, 0, "Original").details.join(" ")).toContain("skill plan was retained");
  });

  it("describes preview effects prospectively", async () => {
    const { heroAdoption } = await import("./HeroAtelier");
    const slot = { slot_id: "slot-01", catalog_id: "old", skill_path: "missing", squad: "solo", node: "home" };
    const candidate = { ...hero(["root"], [skill("root", 1)]), id: "candidate", name: "Candidate" };
    expect(heroAdoption(candidate, slot, 0, "Original", true).details.join(" ")).toContain("Skill plan will change");
  });
});
