import { describe, expect, it } from "vitest";
import { actionSourceRange, verifyRunSourceMap, sourceDigest, textareaSourceSelection } from "./tactical-context";
import type { CompileOutcome } from "../../contracts";

describe("verified Run Action source correspondence", () => {
  const source = "// 日本語\naction advance { }";
  const start = new TextEncoder().encode("// 日本語\n").length;
  async function outcome(): Promise<CompileOutcome> {
    return { program: { content_digest: "program" }, source_map: {
      schema_version: 1, source_digest: await sourceDigest(source), program_digest: "program",
      actions: [{ action_id: "advance", declaration_index: 0, start_utf8: start, end_utf8: new TextEncoder().encode(source).length }],
    } } as unknown as CompileOutcome;
  }
  it("accepts only exact source and original Program identity, retaining UTF-8 parser offsets", async () => {
    const result = await outcome();
    const proof = await verifyRunSourceMap(source, "program", result);
    expect(proof.map).toBe(result.source_map);
    expect(actionSourceRange(source, proof.map!, "advance")).toEqual({ start: 7, end: source.length });
  });
  it("rejects stale source and Program correspondence", async () => {
    const result = await outcome();
    expect((await verifyRunSourceMap(source + "\n", "program", result)).map).toBeNull();
    expect((await verifyRunSourceMap(source, "different-program", result)).map).toBeNull();
    expect((await verifyRunSourceMap(source, "program", { ...result, source_map: undefined })).map).toBeNull();
  });
  it("does not invent a location for absent or ambiguous Action IDs or broken UTF-8 boundaries", async () => {
    const map = (await outcome()).source_map!;
    expect(actionSourceRange(source, map, "missing")).toBeNull();
    expect(actionSourceRange(source, { ...map, actions: [...map.actions, ...map.actions] }, "advance")).toBeNull();
    expect(actionSourceRange(source, { ...map, actions: [{ ...map.actions[0], start_utf8: 4 }] }, "advance")).toBeNull();
  });
});


describe("native textarea source presentation", () => {
  it("adapts Unicode CRLF and lone CR prefixes without changing the raw read-only span", () => {
    const raw = "日本語🐺\r\n\raction jump {\r\n}\r";
    const range = { start: 8, end: 24 };
    const selection = textareaSourceSelection(raw, range);
    expect(selection).toEqual({ source: "日本語🐺\n\naction jump {\n}\n", start: 7, end: 22 });
    expect(raw.slice(range.start, range.end)).toBe("action jump {\r\n}");
    expect(selection.source.slice(selection.start, selection.end)).toBe("action jump {\n}");
    expect(range).toEqual({ start: 8, end: 24 });
  });
  it("keeps LF-only source and UTF-16 offsets unchanged", () => {
    expect(textareaSourceSelection("🐺\naction jump {}", { start: 3, end: 17 }))
      .toEqual({ source: "🐺\naction jump {}", start: 3, end: 17 });
  });
});
