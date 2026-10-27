import { expect, it } from "vitest";
import { changeOwnedHeroSelection, parseOwnedHeroSelection, selectedOwnedHero } from "./draft";

it("preserves accepted opaque slot IDs as own keys through JSON draft serialization", () => {
  let slots: Record<string, string> = {};
  for (const id of ["__proto__", "constructor", "\uFEFF"]) slots = changeOwnedHeroSelection(slots, id, "owned-hero");
  const draft = { schemaVersion: 1 as const, playerId: "p", slots };
  const parsed = parseOwnedHeroSelection(JSON.parse(JSON.stringify(draft)) as unknown);
  expect(parsed).not.toBeNull();
  for (const id of Object.keys(slots)) {
    expect(Object.hasOwn(parsed!.slots, id)).toBe(true);
    expect(selectedOwnedHero(parsed!.slots, id)).toBe("owned-hero");
  }
  expect(selectedOwnedHero({}, "constructor")).toBe("");
  expect(selectedOwnedHero({}, "__proto__")).toBe("");
  expect(Object.getPrototypeOf(slots)).toBe(Object.prototype);
  slots = changeOwnedHeroSelection(slots, "__proto__", "");
  expect(Object.hasOwn(slots, "__proto__")).toBe(false);
});
