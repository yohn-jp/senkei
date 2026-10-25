import { expect, it } from "vitest";
import { compilerTextOffset } from "./compiler-location";

it("moves the DOM caret to the compiler's UTF-8 location after Japanese and surrogate pairs", () => {
  const source = "日本😀 invalid";
  expect(compilerTextOffset(source, "source@11")).toBe(5);
  expect(compilerTextOffset(source, "source@0")).toBe(0);
});
it("does not invent a caret location for absent, out-of-range or split-codepoint paths", () => {
  expect(compilerTextOffset("日本", "source@1")).toBeNull();
  expect(compilerTextOffset("日本", "source@100")).toBeNull();
  expect(compilerTextOffset("日本", "/program")).toBeNull();
  expect(compilerTextOffset("日本", null)).toBeNull();
});
