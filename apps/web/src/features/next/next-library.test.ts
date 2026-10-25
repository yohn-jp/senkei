import { describe, expect, it } from "vitest";
import { isNextLibraryItemRestorable } from "./NextLibrary";
import type { NextLibraryItem } from "./NextLibrary";

const readableSetup = {
  saved_at: "2026-10-25T00:00:00.000Z",
  ruleset: { id: "next", version: { major: 1, minor: 0, patch: 0 }, digest: "digest" },
  slots: [],
  draft: { id: "draft", revision: "revision" },
} as unknown as NextLibraryItem;

describe("Next Library restore gate", () => {
  it("allows a loaded, readable setup after compatibility validation", () => {
    expect(isNextLibraryItemRestorable(readableSetup, true, null, null)).toBe(true);
  });

  it("keeps restore disabled while storage is loading or unreadable", () => {
    expect(isNextLibraryItemRestorable(readableSetup, false, null, null)).toBe(false);
    expect(isNextLibraryItemRestorable(readableSetup, true, null, "parse failed")).toBe(false);
  });

  it("keeps an incompatible setup available without allowing restore", () => {
    expect(isNextLibraryItemRestorable(readableSetup, true, "Ruleset digest differs", null)).toBe(false);
  });

  it("does not offer restore when no setup exists", () => {
    expect(isNextLibraryItemRestorable(null, true, null, null)).toBe(false);
  });
});
