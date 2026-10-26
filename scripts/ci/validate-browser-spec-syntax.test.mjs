import assert from "node:assert/strict";
import { test } from "node:test";
import { syntaxErrors } from "./validate-browser-spec-syntax.mjs";

test("accepts a valid Playwright TypeScript selector", () => {
  const source = 'const match = (id: string) => new RegExp("^" + id + "$");';
  assert.deepEqual(syntaxErrors("valid.spec.ts", source), []);
});

test("rejects malformed browser source before fan-out", () => {
  const source = "test('broken', () => { const value = " + String.fromCharCode(96) + "unterminated; });";
  assert.ok(syntaxErrors("corrupt.spec.ts", source).length > 0);
});
