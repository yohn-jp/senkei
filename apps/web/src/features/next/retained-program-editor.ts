import { catalogStamp, loadDomainCatalog, sameCatalog } from "@senkei/jinrei-editor";
import type { CatalogStamp, DomainCatalogDocument } from "@senkei/jinrei-editor";
import type { CompileOutcome, CoreClient, EditorCompilerEnvelope, ReproductionAssets, StructuredTacticsAst, TacticalSource } from "../../contracts";
import { canonicalJson, reproductionSnapshotDigest, sha256Hex } from "../../worker/input-identity";
import type { CoverageRun } from "./coverage-observed";
import { verifyRunSourceMap } from "./tactical-context";
import { validateNextExperimentAuthorization, validateNextExperimentDiagnostics, validateNextExperimentReplay } from "./experiment-restoration";

export interface RetainedCompileRequest {
  readonly assets: ReproductionAssets;
  readonly source: string;
  readonly stamp: CatalogStamp;
  readonly revision: number;
}
export type RetainedEditorCore = CoreClient & {
  editorCatalogRetained?: (assets: ReproductionAssets) => Promise<string>;
  editorCompileRetained?: (request: RetainedCompileRequest) => Promise<EditorCompilerEnvelope>;
  formatRetainedAst?: (assets: ReproductionAssets, ast: StructuredTacticsAst) => Promise<string>;
};
export interface VerifiedRetainedRun {
  readonly run: CoverageRun;
  readonly snapshotDigest: string;
  readonly assetsDigest: string;
  readonly resultDigest: string;
}
export interface RetainedOriginal {
  readonly verified: VerifiedRetainedRun;
  readonly catalog: DomainCatalogDocument;
  readonly stamp: CatalogStamp;
  readonly source: string;
}

/** Verify owner authorization and the retained Run without consulting the current Draft. */
export async function verifyRetainedProgramRun(run: CoverageRun | null): Promise<VerifiedRetainedRun> {
  if (!run?.includeDiagnostics || !run.response.restricted_diagnostics) throw new Error("An owner-authorized completed Run is required.");
  validateNextExperimentAuthorization(run.response, true);
  await validateNextExperimentDiagnostics(run.response, run.snapshot);
  const result = run.response.outcome.result;
  const publicReplay = run.response.outcome.presentation_replay;
  const ownerReplay = run.response.owner_replays?.attacker;
  if (!ownerReplay || ownerReplay.perspective !== "attacker") throw new Error("The attacker owner Replay is unavailable.");
  await Promise.all([validateNextExperimentReplay(publicReplay, result, run.snapshot.context.match_id),
    validateNextExperimentReplay(ownerReplay, result, run.snapshot.context.match_id)]);
  const ruleset = run.snapshot.context.ruleset, world = run.snapshot.context.world_identity;
  if ([run.snapshot.attacker.ruleset, run.snapshot.defender.ruleset, run.snapshot.attacker.program.ruleset,
    run.reproductionAssets.rule_package.ruleset, publicReplay.ruleset, ownerReplay.ruleset]
    .some(value => !value || canonicalJson(value) !== canonicalJson(ruleset))
    || !world || [publicReplay.world_identity, ownerReplay.world_identity, run.reproductionAssets.rule_package.next?.world_identity]
      .some(value => !value || canonicalJson(value) !== canonicalJson(world))) {
    throw new Error("The retained Run, Replays, Program, RulePackage and World identities do not match.");
  }
  return { run, snapshotDigest: await reproductionSnapshotDigest(run.snapshot), assetsDigest: await sha256Hex(canonicalJson(run.reproductionAssets)),
    resultDigest: publicReplay.result_digest };
}

/** Reject stale compiler replies before exposing a Program or source mapping. */
export async function compileRetainedSource(core: RetainedEditorCore, verified: VerifiedRetainedRun, stamp: CatalogStamp,
  source: string, revision: number): Promise<CompileOutcome> {
  if (!core.editorCompileRetained) throw new Error("Retained RulePackage compilation is unavailable in this Core.");
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Invalid compiler revision.");
  if (await reproductionSnapshotDigest(verified.run.snapshot) !== verified.snapshotDigest
    || await sha256Hex(canonicalJson(verified.run.reproductionAssets)) !== verified.assetsDigest) throw new Error("The retained Run or its assets changed.");
  const envelope = await core.editorCompileRetained({ assets: verified.run.reproductionAssets, source, stamp, revision });
  if (!envelope || envelope.revision !== revision || !envelope.reply?.stamp || !sameCatalog(envelope.reply.stamp, stamp)) {
    throw new Error("The compiler response does not match the retained Catalog and revision.");
  }
  if (envelope.reply.status === "rejected") {
    const error = envelope.reply.error;
    throw new Error(`${error.code}${error.path ? ` at ${error.path}` : ""}: ${error.message}`);
  }
  if (envelope.reply.status !== "compiled") throw new Error("Unrecognized compiler response.");
  const result = envelope.reply.result;
  if (!result?.program || canonicalJson(result.program.ruleset) !== canonicalJson(verified.run.snapshot.context.ruleset)
    || typeof result.program.content_digest !== "string" || !Number.isSafeInteger(result.estimated_cu) || result.estimated_cu < 0
    || (result.source_map && (result.source_map.program_digest !== result.program.content_digest
      || result.source_map.source_digest !== await sha256Hex(source)))) {
    throw new Error("The compiled Program or source map does not match the retained input.");
  }
  return result;
}

/** Recreate the exact original owner source and prove it produced the frozen Program. */
export async function loadRetainedOriginal(core: RetainedEditorCore, run: CoverageRun | null, input: TacticalSource | null,
  revision: number): Promise<RetainedOriginal> {
  if (!core.editorCatalogRetained || !core.editorCompileRetained) throw new Error("Retained Catalog and compilation are unavailable in this Core.");
  if (!input) throw new Error("The original owner source was not retained.");
  const verified = await verifyRetainedProgramRun(run);
  await core.preflightReproduction(verified.run.snapshot, verified.run.reproductionAssets, verified.snapshotDigest);
  const ruleset = verified.run.snapshot.context.ruleset;
  const catalog = await loadDomainCatalog(await core.editorCatalogRetained(verified.run.reproductionAssets),
    { rulesetId: ruleset.id, rulesetVersion: ruleset.version, rulesetDigest: ruleset.digest });
  const stamp = catalogStamp(catalog);
  let source: string;
  if (input.kind === "text") source = input.source;
  else if (input.kind === "structured_ast" && core.formatRetainedAst) source = await core.formatRetainedAst(verified.run.reproductionAssets, input.ast);
  else throw new Error("The retained structured source cannot be formatted by this Core.");
  if (typeof source !== "string") throw new Error("The retained formatter did not return source text.");
  const compiled = await compileRetainedSource(core, verified, stamp, source, revision);
  if (canonicalJson(compiled.program) !== canonicalJson(verified.run.snapshot.attacker.program)) {
    throw new Error("The retained source does not reproduce the original owner Program.");
  }
  return { verified, catalog, stamp, source };
}

/** Source links only use the frozen Run and a proven, retained compiler mapping. */
export async function verifyRetainedRunSourceProof(core: RetainedEditorCore, run: CoverageRun, input: TacticalSource): Promise<{ map: import("../../contracts").ActionSourceMap | null; reason: string }> {
  if (input.kind !== "text") throw new Error("Original Run has no text source locations.");
  const retained = await loadRetainedOriginal(core, run, input, 1);
  const compiled = await compileRetainedSource(core, retained.verified, retained.stamp, retained.source, 2);
  return verifyRunSourceMap(retained.source, run.snapshot.attacker.program.content_digest, compiled);
}
