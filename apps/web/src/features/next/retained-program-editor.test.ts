import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { catalogStamp, loadDomainCatalog } from "@senkei/jinrei-editor";
import type { CompileOutcome, EditorCompilerEnvelope, MatchResult, SimulationSnapshot, TacticalSource } from "../../contracts";
import { reproductionSnapshotDigest } from "../../worker/input-identity";
import type { CoverageRun } from "./coverage-observed";
import { RetainedProgramEditor } from "./RetainedProgramEditor";
import { compileRetainedSource, loadRetainedOriginal, verifyRetainedProgramRun } from "./retained-program-editor";
import type { RetainedEditorCore } from "./retained-program-editor";

const catalogJson = readFileSync(new URL("../../../../../packages/jinrei-editor/fixtures/next-domain-catalog.json", import.meta.url), "utf8");
const fixture = JSON.parse(readFileSync(new URL("../../../../../packages/jinrei-editor/fixtures/next-compile-reply.json", import.meta.url), "utf8"));
const outcome = { ...fixture.reply.result, source_map: undefined } as CompileOutcome;
const ruleset = outcome.program.ruleset;
const version = { major: 1, minor: 0, patch: 0 };
const world = { world_id: "world", schema_version: version, compiler_version: version, minimum_compiler: version,
  maximum_compiler_exclusive: null, validation_profile_id: null, validation_profile_version: null,
  logic_digest: "b".repeat(64), presentation_digest: "c".repeat(64) };
const result: MatchResult = { match_id: "match-a", outcome: "attacker_victory", termination_reason: "base_destroyed", final_tick: 7,
  statistics: {}, cu_spent: { attacker: 1, defender: 2 }, final_state_digest: "state-digest" };
const resultDigest = "5bd522f68e9cc8ff06a012155945442ec94eb42042661765ab0cf3255ed58e0b";

async function setup() {
  const catalog = await loadDomainCatalog(catalogJson);
  const stamp = catalogStamp(catalog);
  const snapshot = { attacker: { ruleset, program: outcome.program }, defender: { ruleset },
    context: { match_id: "match-a", ruleset, world_identity: world } } as unknown as SimulationSnapshot;
  const replay = { schema_version: version, match_id: "match-a", result_digest: resultDigest, ruleset, world_identity: world, frames: [] };
  const run = { snapshot, sourceReplay: replay, includeDiagnostics: true,
    reproductionAssets: { format_version: 1, rule_package: { ruleset, next: { world_identity: world } }, world_definition: {} },
    response: { authorized_side: "attacker", outcome: { result, presentation_replay: replay },
      owner_replays: { attacker: { ...replay, perspective: "attacker" } }, restricted_diagnostics: {
        identity: { schema_version: 1, side: "attacker", match_id: "match-a", result_digest: resultDigest,
          snapshot_digest: await reproductionSnapshotDigest(snapshot), program_digest: outcome.program.content_digest },
        events: [], cu_by_side: { attacker: 1 }, final_memory_by_side: { attacker: {} } } } } as unknown as CoverageRun;
  const editorCompileRetained = vi.fn(async (request: { revision: number }): Promise<EditorCompilerEnvelope> => ({ revision: request.revision,
    reply: { status: "compiled", stamp, result: outcome } }));
  const core = { preflightReproduction: vi.fn().mockResolvedValue(undefined), editorCatalogRetained: vi.fn().mockResolvedValue(catalogJson),
    editorCompileRetained, formatRetainedAst: vi.fn().mockResolvedValue("original source") } as unknown as RetainedEditorCore;
  return { run, core, stamp, editorCompileRetained };
}

describe("retained Run Jinrei editor", () => {
  it("validates owner, retained assets and Catalog then proves the original source's entire Program", async () => {
    const { run, core, editorCompileRetained } = await setup();
    const source = { kind: "text", source: "original source" } as const;
    const loaded = await loadRetainedOriginal(core, run, source, 1);
    expect(loaded.source).toBe(source.source);
    expect(core.preflightReproduction).toHaveBeenCalledWith(run.snapshot, run.reproductionAssets, loaded.verified.snapshotDigest);
    expect(editorCompileRetained).toHaveBeenCalledWith(expect.objectContaining({ source: source.source, assets: run.reproductionAssets, revision: 1 }));
    const otherProgram = { ...outcome.program, bytecode: [...outcome.program.bytecode, 0] };
    editorCompileRetained.mockResolvedValueOnce({ revision: 2, reply: { status: "compiled", stamp: loaded.stamp, result: { ...outcome, program: otherProgram } } });
    await expect(loadRetainedOriginal(core, run, source, 2)).rejects.toThrow("does not reproduce the original owner Program");
  });
  it("formats AST only through the retained core and still checks the original Program", async () => {
    const { run, core } = await setup();
    const source = { kind: "structured_ast", ast: { schema_version: version, program_name: "original", declarations: [] } } satisfies TacticalSource;
    expect((await loadRetainedOriginal(core, run, source, 1)).source).toBe("original source");
    expect(core.formatRetainedAst).toHaveBeenCalledWith(run.reproductionAssets, source.ast);
    await expect(loadRetainedOriginal({ ...core, formatRetainedAst: undefined }, run, source, 2)).rejects.toThrow("cannot be formatted");
  });
  it("blocks unauthorized, tampered, mismatched or unavailable retained inputs", async () => {
    const { run, core } = await setup();
    await expect(verifyRetainedProgramRun({ ...run, includeDiagnostics: false })).rejects.toThrow("owner-authorized");
    await expect(verifyRetainedProgramRun({ ...run, response: { ...run.response, authorized_side: "defender" } })).rejects.toThrow();
    await expect(verifyRetainedProgramRun({ ...run, snapshot: { ...run.snapshot, context: { ...run.snapshot.context, match_id: "other" } } })).rejects.toThrow();
    const source = { kind: "text", source: "original source" } as const;
    await expect(loadRetainedOriginal(core, run, null, 1)).rejects.toThrow("source was not retained");
    await expect(loadRetainedOriginal({ ...core, editorCatalogRetained: undefined }, run, source, 1)).rejects.toThrow("unavailable");
    const failure = { ...core, preflightReproduction: vi.fn().mockRejectedValue(new Error("World mismatch")) };
    await expect(loadRetainedOriginal(failure, run, source, 1)).rejects.toThrow("World mismatch");
    expect(failure.editorCatalogRetained).not.toHaveBeenCalled();
  });
  it("rejects stale compiler revisions, Catalog stamps, Program rulesets and changed assets", async () => {
    const { run, core, stamp, editorCompileRetained } = await setup();
    const verified = await verifyRetainedProgramRun(run);
    editorCompileRetained.mockResolvedValueOnce({ revision: 999, reply: { status: "compiled", stamp, result: outcome } });
    await expect(compileRetainedSource(core, verified, stamp, "edited", 1)).rejects.toThrow("revision");
    editorCompileRetained.mockResolvedValueOnce({ revision: 2, reply: { status: "compiled", stamp: { ...stamp, catalogDigest: "stale" }, result: outcome } });
    await expect(compileRetainedSource(core, verified, stamp, "edited", 2)).rejects.toThrow("Catalog");
    const other = { ...outcome, program: { ...outcome.program, ruleset: { ...ruleset, id: "other" } } };
    editorCompileRetained.mockResolvedValueOnce({ revision: 3, reply: { status: "compiled", stamp, result: other } });
    await expect(compileRetainedSource(core, verified, stamp, "edited", 3)).rejects.toThrow("Program");
    const changed = { ...verified, run: { ...run, reproductionAssets: { ...run.reproductionAssets, world_definition: { changed: true } } } };
    await expect(compileRetainedSource(core, changed, stamp, "edited", 4)).rejects.toThrow("assets changed");
  });
  it("preserves compiler errors for retry and does not invoke prepare while rendering", async () => {
    const { run, core, stamp, editorCompileRetained } = await setup();
    const verified = await verifyRetainedProgramRun(run);
    editorCompileRetained.mockResolvedValueOnce({ revision: 1, reply: { status: "rejected", stamp, error: { code: "invalid", message: "syntax error" } } });
    await expect(compileRetainedSource(core, verified, stamp, "edited", 1)).rejects.toThrow("syntax error");
    expect(await compileRetainedSource(core, verified, stamp, "edited", 2)).toEqual(outcome);
    const onPrepared = vi.fn();
    const html = renderToStaticMarkup(createElement(RetainedProgramEditor, { core: null, run: null, source: null, onPrepared }));
    expect(html).toContain("Improve the retained Run"); expect(html).not.toContain("Prepare improved retained Run</button>");
    expect(onPrepared).not.toHaveBeenCalled();
  });
});
