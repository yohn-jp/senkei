import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createServer } from "vite";
import type { CoreJsonValue, ReproductionAssets, SimulationSnapshot } from "../../../apps/web/src/contracts/core";
import type { ContentDigest, DomainValue, MatchResult, PresentationReplay, RulePackage, SenkeiSnapshot, TacticalProgram } from "../../../apps/web/src/contracts/core-model";
import type { LocalPveScenario } from "../../../apps/web/src/contracts/workspace";
import type { LocalNextExperimentStore } from "../../../apps/web/src/contracts/workspace-data";
import { campaignRepositoryRoot } from "./campaign-core";

export type NativeCampaignScenarioId = "protect-the-core" | "first-march";

interface NativeCampaignSimulation {
  readonly result: MatchResult;
  readonly replay: PresentationReplay;
}

export interface NativeCampaignFixture {
  readonly sourceSha: string;
  readonly scenarioId: NativeCampaignScenarioId;
  readonly rules: RulePackage;
  readonly reproductionAssets: ReproductionAssets;
  readonly scenario: LocalPveScenario;
  readonly source: string;
  readonly npcSource: string;
  readonly snapshot: SimulationSnapshot;
  readonly snapshotDigest: ContentDigest;
  readonly actual: NativeCampaignSimulation;
  readonly current: string;
  readonly legacy: string;
}

interface NativeCampaignFixtureManifestEntry {
  readonly filename: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly snapshotDigest: ContentDigest;
}

interface NativeCampaignFixtureManifest {
  readonly schema: "senkei-native-campaign-fixtures/v1";
  readonly sourceSha: string;
  readonly sourceTreeSha: string;
  readonly generatedAt: string;
  readonly dispatcher: { readonly bytes: number; readonly sha256: string };
  readonly fixtures: Readonly<Record<NativeCampaignScenarioId, NativeCampaignFixtureManifestEntry>>;
}

interface NativeCampaignFixtureArtifact {
  readonly schema: "senkei-native-campaign-fixture/v1";
  readonly sourceSha: string;
  readonly scenarioId: NativeCampaignScenarioId;
  readonly fixture: NativeCampaignFixture;
}

const scenarioIds: readonly NativeCampaignScenarioId[] = ["protect-the-core", "first-march"];
const fixtureManifestSchema = "senkei-native-campaign-fixtures/v1" as const;
const fixtureArtifactSchema = "senkei-native-campaign-fixture/v1" as const;
const pending = new Map<NativeCampaignScenarioId, Promise<NativeCampaignFixture>>();
let verifiedFixtures: ReadonlyMap<NativeCampaignScenarioId, NativeCampaignFixture> | null = null;

function currentSourceSha(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: campaignRepositoryRoot, encoding: "utf8" }).trim();
}

function currentSourceTreeSha(sourceSha: string): string {
  return execFileSync("git", ["rev-parse", `${sourceSha}^{tree}`], { cwd: campaignRepositoryRoot, encoding: "utf8" }).trim();
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Verify the whole artifact set against the checked-out source before reusing any native result. */
export function verifyNativeCampaignFixtureDirectory(
  directory: string,
  expectedSourceSha: string,
): ReadonlyMap<NativeCampaignScenarioId, NativeCampaignFixture> {
  const root = resolve(directory);
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as NativeCampaignFixtureManifest;
  if (manifest.schema !== fixtureManifestSchema || manifest.sourceSha !== expectedSourceSha || manifest.sourceSha !== currentSourceSha()) {
    throw new Error("Native Campaign fixture manifest does not match this checked-out source SHA.");
  }
  if (manifest.sourceTreeSha !== currentSourceTreeSha(expectedSourceSha)) {
    throw new Error("Native Campaign fixture source tree does not match the checked-out commit.");
  }
  if (!Number.isSafeInteger(manifest.dispatcher?.bytes) || manifest.dispatcher.bytes <= 0 || !/^[0-9a-f]{64}$/.test(manifest.dispatcher.sha256)) {
    throw new Error("Native Campaign fixture manifest has no valid native dispatcher fingerprint.");
  }
  const fixtureKeys = Object.keys(manifest.fixtures ?? {}).sort();
  if (!isRecord(manifest.fixtures) || fixtureKeys.join(",") !== [...scenarioIds].sort().join(",")) {
    throw new Error("Native Campaign fixture manifest must contain exactly the supported Campaign scenarios.");
  }

  const fixtures = new Map<NativeCampaignScenarioId, NativeCampaignFixture>();
  for (const scenarioId of scenarioIds) {
    const entry = manifest.fixtures[scenarioId];
    if (entry.filename !== `${scenarioId}.json` || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || !/^[0-9a-f]{64}$/.test(entry.sha256) || !/^[0-9a-f]{64}$/.test(entry.snapshotDigest)) {
      throw new Error(`Native Campaign fixture manifest entry is malformed for ${scenarioId}.`);
    }
    const bytes = readFileSync(join(root, entry.filename));
    if (bytes.byteLength !== entry.bytes || sha256(bytes) !== entry.sha256) {
      throw new Error(`Native Campaign fixture artifact failed its SHA-256 check: ${entry.filename}.`);
    }
    const artifact = JSON.parse(bytes.toString("utf8")) as NativeCampaignFixtureArtifact;
    if (artifact.schema !== fixtureArtifactSchema || artifact.sourceSha !== expectedSourceSha || artifact.scenarioId !== scenarioId ||
        artifact.fixture.sourceSha !== expectedSourceSha || artifact.fixture.scenarioId !== scenarioId ||
        artifact.fixture.scenario.id !== scenarioId || artifact.fixture.snapshotDigest !== entry.snapshotDigest) {
      throw new Error(`Native Campaign fixture artifact identity does not match its manifest: ${entry.filename}.`);
    }
    fixtures.set(scenarioId, artifact.fixture);
  }
  return fixtures;
}

/** Uses only a provenance-checked build artifact in CI; local runs may generate a fresh Native fixture. */
export function nativeCampaignFixture(scenarioId: NativeCampaignScenarioId = "protect-the-core"): Promise<NativeCampaignFixture> {
  if (!pending.has(scenarioId)) {
    const fixtureDirectory = process.env.SENKEI_CAMPAIGN_NATIVE_FIXTURE_DIR;
    if (fixtureDirectory) {
      pending.set(scenarioId, Promise.resolve().then(() => {
        verifiedFixtures ??= verifyNativeCampaignFixtureDirectory(fixtureDirectory, currentSourceSha());
        const fixture = verifiedFixtures.get(scenarioId);
        if (!fixture) throw new Error(`Verified Native Campaign fixture is missing for ${scenarioId}.`);
        return fixture;
      }));
    } else if (process.env.CI) {
      pending.set(scenarioId, Promise.reject(new Error("CI requires the provenance-checked browser-build Campaign fixtures.")));
    } else {
      pending.set(scenarioId, buildNativeCampaignFixture(scenarioId));
    }
  }
  return pending.get(scenarioId)!;
}

/** Called only by the browser-build fixture preparer, never by a CI browser shard. */
export async function buildNativeCampaignFixture(scenarioId: NativeCampaignScenarioId): Promise<NativeCampaignFixture> {
  const first = scenarioId === "first-march";
  const server = await createServer({ configFile: false, root: campaignRepositoryRoot, logLevel: "silent", server: { middlewareMode: true }, appType: "custom" });
  try {
    const { createNextCampaignScenarios } = await server.ssrLoadModule("/scenarios/next/campaign.ts");
    const progressApi = await server.ssrLoadModule("/apps/web/src/features/next/campaign-progress.ts");
    const restorationApi = await server.ssrLoadModule("/apps/web/src/features/next/experiment-restoration.ts");
    const dispatch = <T>(operation: string, payload: unknown): T => {
      const command = process.env.SENKEI_NATIVE_DISPATCHER ?? "cargo";
      const args = process.env.SENKEI_NATIVE_DISPATCHER ? [] : ["run", "--quiet", "--locked", "--release", "-p", "senkei-wasm", "--bin", "senkei-wasm-dispatch"];
      const request = { api_version: { major: 1, minor: 0, patch: 0 }, request_id: `campaign-native-${scenarioId}-${operation}`, operation, payload };
      const bytes = execFileSync(command, args, { cwd: campaignRepositoryRoot, input: JSON.stringify(request) + "\n", maxBuffer: 256 * 1024 * 1024, timeout: 240_000 });
      const reply = JSON.parse(bytes.toString());
      if (!reply.ok) throw new Error(JSON.stringify(reply.error));
      return reply.result as T;
    };

    const rules = dispatch<RulePackage>("next_ruleset", {});
    const reproductionAssets = dispatch<ReproductionAssets>("next_reproduction_assets", {});
    if (!isDeepStrictEqual(rules, reproductionAssets.rule_package)) throw new Error("Native RulePackage and reproduction assets do not match.");
    const scenarios = createNextCampaignScenarios(rules);
    const scenario = scenarios.find((item: LocalPveScenario) => item.id === scenarioId);
    if (!scenario) throw new Error(`Current Core does not publish Campaign scenario ${scenarioId}.`);
    const compile = (source: string) => dispatch<{ readonly program: TacticalProgram }>("compile_text", { ruleset_ref: rules.ruleset, source }).program;
    const { program_input, ...definition } = scenario.npc;
    const defender: SenkeiSnapshot = { ...definition, program: compile(program_input.source) };
    const ownHeroes = scenarios[0].npc.configuration.heroes.value.map((hero: any, index: number) => first
      ? { ...hero, value: { ...hero.value, catalog_id: { kind: "string", value: ["F02", "F04", "R01", "R03", "R05"][index] } } } : hero);
    const source = (first ? "senkei w9_persistent_movement { " : "senkei probe {") + ownHeroes.map((hero: any, index: number) => {
      const slot = hero.value.slot_id.value;
      return `action ${first ? `advance_slot_${index + 1}` : `move_${index}`} { when any hero in allies.heroes { hero.slot_id == "${slot}", hero.goal == "", hero.hp > 0, }, do move(argmin hero in filter hero in allies.heroes { hero.slot_id == "${slot}", } by hero.hp then hero.id, "B.BASE"), }`;
    }).join(first ? ", " : ",") + (first ? " }" : "}");
    const attacker: SenkeiSnapshot = {
      ...defender,
      id: first ? "campaign-player" : "probe-player",
      program: compile(source),
      configuration: { heroes: { kind: "list", value: ownHeroes.map((hero: any) => ({
        ...hero,
        value: { ...hero.value, squad: { kind: "string", value: first ? "squad-0" : "squad-1" }, node: { kind: "string", value: first ? "A.BASE" : "B.BASE" } },
      })) } },
    };
    const context = dispatch<SimulationSnapshot["context"]>("new_match_context", {
      ruleset_ref: rules.ruleset,
      match_id: first ? "campaign-first-march-clear" : "campaign-probe-protect-the-core",
    });
    const snapshot: SimulationSnapshot = { attacker, defender, context };
    const snapshotDigest = await restorationApi.reproductionSnapshotDigest(snapshot) as ContentDigest;
    dispatch("preflight_reproduction", { assets: reproductionAssets, snapshot, snapshot_digest: snapshotDigest });
    const actual = dispatch<NativeCampaignSimulation>("simulate", { ...snapshot, include_diagnostics: false });
    await restorationApi.validateNextExperimentReplay(actual.replay, actual.result, context.match_id);
    if (actual.result.outcome !== "attacker_victory" || actual.result.termination_reason !== "base_destroyed") {
      throw new Error("The actual native fixture did not win.");
    }
    const ids = scenarios.map((item: LocalPveScenario) => item.id);
    const legacy = JSON.stringify({ format_version: 1, ruleset_digest: rules.ruleset.digest, unlocked_scenario_ids: ids });
    const after = progressApi.reduceCampaignProgress(progressApi.migrateLegacyCampaignProgress(legacy, rules.ruleset.digest, ids), ids, {
      scenario_id: scenario.id, context, result: actual.result,
    });
    const current = progressApi.serializeCampaignProgress(after, ids);
    return { sourceSha: currentSourceSha(), scenarioId, rules, reproductionAssets, scenario, source, npcSource: program_input.source, snapshot, snapshotDigest, actual, current, legacy };
  } finally {
    await server.close();
  }
}

/** Wraps actual source/snapshots/result in the current typed Experiment format; no ID rewriting. */
export function nativeCampaignStore(fixture: NativeCampaignFixture, estimatedCU: number): LocalNextExperimentStore {
  const unwrap = (value: DomainValue): CoreJsonValue => {
    switch (value.kind) {
      case "null": return null;
      case "bool":
      case "integer":
      case "string":
      case "enum":
      case "entity": return value.value;
      case "fixed": return value.value;
      case "list": return value.value.map(unwrap);
      case "record": return Object.fromEntries(Object.entries(value.value).map(([key, entry]) => [key, unwrap(entry)]));
    }
  };
  const slots = (snapshot: SenkeiSnapshot) => {
    const heroes = snapshot.configuration.heroes;
    if (heroes.kind !== "list") throw new Error("Native Campaign snapshot has no hero list.");
    return heroes.value.map((hero) => {
      if (hero.kind !== "record") throw new Error("Native Campaign snapshot has an invalid hero record.");
      return Object.fromEntries(Object.entries(hero.value).map(([key, value]) => [key, unwrap(value)]));
    });
  };
  const { program: _program, ...definition } = fixture.snapshot.attacker;
  const time = new Date().toISOString();
  const packageValue = fixture.reproductionAssets.rule_package;
  const next = packageValue.next;
  if (!next) throw new Error("Native Campaign reproduction assets do not include a Next package.");
  const setup = JSON.parse(JSON.stringify({
    format_version: 1,
    saved_at: time,
    ruleset: definition.ruleset,
    schema_version: definition.schema_version,
    mechanics_version: next.mechanics_version,
    formation_shape: "single",
    slots: slots(fixture.snapshot.attacker),
    rival_slots: slots(fixture.snapshot.defender),
    draft: { ...definition, program_input: { kind: "text", source: fixture.source } },
    rival_source: fixture.npcSource,
    campaign_scenario_id: fixture.scenario.id,
  })) as CoreJsonValue;
  return {
    format_version: 2,
    experiments: [{
      id: `genuine-native-campaign-${fixture.scenario.id}`,
      match_id: fixture.snapshot.context.match_id,
      created_at: time,
      snapshot: fixture.snapshot,
      reproduction_assets: fixture.reproductionAssets,
      snapshot_digest: fixture.snapshotDigest,
      response: { outcome: { result: fixture.actual.result, presentation_replay: fixture.actual.replay } },
      setup,
      include_diagnostics: false,
      estimated_cu: estimatedCU,
    }],
  } satisfies LocalNextExperimentStore;
}
