import { describe, expect, it } from "vitest";
import { resolveHeroRepair, repairSourceCursor } from "./repair-focus";
const slot = { slot_id: '"][opaque]#1', catalog_id: "F01", squad: "alpha", node: "A", skill_path: "a" };
const target = { kind: "own_hero" as const, recordIndex: 0, slotId: slot.slot_id, field: "node" as const, screen: "squads" as const };
describe("explicit repair requests", () => {
  it("resolves exact opaque identity and selects the real mobile stage", () => {
    expect(resolveHeroRepair([slot], target)).toMatchObject({ index: 0, stage: "deploy" });
    expect(resolveHeroRepair([slot], { ...target, field: "squad" })).toMatchObject({ stage: "assign" });
  });
  it("preserves a Core-valid BOM-only slot ID without JavaScript whitespace normalization", () => {
    const bomSlot = { ...slot, slot_id: "\uFEFF" };
    expect(resolveHeroRepair([bomSlot], { ...target, slotId: bomSlot.slot_id })).toMatchObject({ index: 0, slot: bomSlot });
    expect(resolveHeroRepair([{ ...slot, slot_id: "" }], { ...target, slotId: "" })).toBeNull();
  });
  it("rejects unknown, duplicate, moved, inconsistent and non-editable slot targets", () => {
    expect(resolveHeroRepair([slot], { ...target, slotId: "missing" })).toBeNull();
    expect(resolveHeroRepair([slot, slot], target)).toBeNull();
    expect(resolveHeroRepair([slot], { ...target, recordIndex: 1 })).toBeNull();
    expect(resolveHeroRepair([slot], { ...target, screen: "skills" })).toBeNull();
    expect(resolveHeroRepair([slot], { ...target, field: "slot_id", screen: "collection" })).toBeNull();
  });
  it("maps a captured real text byte offset to a normalized DOM cursor", () => {
    const source = "日本語🐺\r\n\rbroken";
    const path = `source@${new TextEncoder().encode("日本語🐺\r\n\r").length}`;
    expect(repairSourceCursor(source, { requestId: "1", target: { kind: "own_jinrei", path }, exactSource: source }).cursor)
      .toEqual({ source: "日本語🐺\n\nbroken", start: 7, end: 7 });
  });
  it("does not reinterpret AST paths, stale source or invalid byte boundaries as text", () => {
    const request = { requestId: "2", target: { kind: "own_jinrei" as const, path: "/actions/0" }, exactSource: "日本語" };
    expect(repairSourceCursor("日本語", request).cursor).toBeNull();
    expect(repairSourceCursor("changed", request).stale).toBe(true);
    expect(repairSourceCursor(null, { ...request, exactSource: null }).cursor).toBeNull();
    expect(repairSourceCursor("日本語", { ...request, target: { kind: "own_jinrei", path: "source@1" } }).cursor).toBeNull();
  });
});
