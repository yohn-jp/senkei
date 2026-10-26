import { CoreClientError } from "../../worker";
import { JourneyScreens } from "./JourneyScreens";
import { NextLibrary } from "./NextLibrary";
import { HeroAtelier } from "./HeroAtelier";
import { JinreiWorkbench } from "./JinreiWorkbench";
import { BattleAnalysis } from "./BattleAnalysis";
import { actionSourceRange, verifyRunSourceMap } from "./tactical-context";
import type { BattleAnalysisContext, AnalysisSourceContext } from "./tactical-context";
import type { ActionSourceMap, DiagnosticEvent } from "../../contracts";
import { validateNextExperimentAuthorization, validateNextExperimentReplay } from "./experiment-restoration";
import { matchesPresentedEntity } from "./battle-entity-identity";
import { loadNextExperimentPayload, saveNextExperimentStore, clearNextExperimentStore, parseNextExperimentStore, assertNextExperimentImportSize, serializeNextExperimentStore } from "../persistence/repository";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Battlefield as BattlefieldRenderer, BattlefieldInformationLayers } from "@senkei/renderer";
import { Battlefield } from "@senkei/renderer";
import { presentationToGraphics, NEXT_WORLD_UNITS_PER_RENDER_UNIT, type Replay, type DisplayState, type Event as GraphicsEvent, type WorldPoint } from "@senkei/replay-contract";
import { ReplayPlayer } from "@senkei/replay-player";
import { catalogStamp, loadDomainCatalog, sameCatalog } from "@senkei/jinrei-editor";
import type { DomainCatalogDocument } from "@senkei/jinrei-editor";
import { createNextCampaignScenarios, getNextCampaignRunFeedback } from "../../../../../scenarios/next/campaign";
import {
  type CoreClient,
  type CoreVersion,
  type CoreJsonValue,
  type CompileOutcome,
  type DomainValue,
  type MatchResult,
  type NextRules,
  type PresentationReplay,
  type PresentationEvent,
  type ReplayFrame,
  type RulePackage,
  type SenkeiSnapshot,
  type SimulationOutcome,
  type SimulationResponse,
  type SimulationSnapshot,
  type TacticalInput,
  type TacticalSource,
  type RulesetRef,
  type LocalPveScenario,
  type LocalNextExperiment,
  type LocalNextExperimentStore,
} from "../../contracts";
import type { SenkeiDraft } from "../../contracts";
import { isDomainValueRecord, isStructuredTacticsAst } from "./draft-validation";
import "./next-workspace.css";
import "./battle-view-controls.css";

class PreflightProblem extends Error {
  constructor(message: string, readonly status: "invalid" | "unverified") { super(message); }
}

function preflightFailureStatus(cause: unknown): "invalid" | "unverified" | "failed" {
  if (cause instanceof PreflightProblem) return cause.status;
  if (cause instanceof CoreClientError && cause.code === "core_error" && isRecord(cause.details)
    && ["invalid_snapshot", "invalid_program", "validation_failed", "compile_failed", "invalid_ruleset", "incompatible_version", "unsupported_primitive", "budget_exceeded"].includes(String(cause.details.code))) return "invalid";
  return "failed";
}

const SLOT_IDS = ["slot-01", "slot-02", "slot-03", "slot-04", "slot-05"] as const;
const DEFAULT_HERO_IDS = ["F01", "F03", "F06", "R02", "R04"] as const;
const DEFAULT_RIVAL_IDS = ["R01", "R03", "R05", "F02", "F04"] as const;
const NEXT_STORAGE_KEY = "senkei.next-workspace.v1";
const NEXT_RECOVERY_KEY = "senkei.next-workspace-recovery.v1";
const NEXT_CAMPAIGN_PROGRESS_KEY = "senkei.next-campaign-progress.v1";
const VISIBLE_ENTITY_CLUSTER_RADIUS = 0.8;

type WorkspaceTab = "formation" | "jinrei" | "battle" | "analysis";
type AtelierScreen = "collection" | "detail" | "skills" | "squads";
type Side = "attacker" | "defender";
type FormationShape = "single" | "three-lane" | "wings" | "custom";
type BattlefieldMobileView = "battle" | "overview" | "follow" | "timeline" | "details";
type BattlefieldCameraMode = "tactical" | "overview";
type BattlefieldPresentationMode = "tactical" | "cinematic";

interface VisibleSquadTarget {
  readonly id: string;
  readonly memberIds: readonly string[];
  readonly label: string;
}

interface VisibleBattleTarget {
  readonly id: string;
  readonly label: string;
  readonly identity: string;
  readonly catalogId: string | null;
  readonly role: string;
  readonly category: string;
  readonly side: string;
  readonly healthLabel: string | null;
  readonly position: WorldPoint;
}

interface VisibleBattleCluster {
  readonly id: string;
  readonly position: WorldPoint;
  readonly coLocated: boolean;
  readonly anchorRadius: number;
  readonly entities: readonly VisibleBattleTarget[];
}

interface FocusedReplayPoint {
  readonly tick: number;
  readonly point: WorldPoint;
}

interface FormationSlot {
  readonly slot_id: string;
  readonly catalog_id: string;
  readonly squad: string;
  readonly node: string;
  readonly skill_path: string;
}

interface BattleRun {
  readonly experimentId: string;
  readonly createdAt: string;
  readonly snapshot: SimulationSnapshot;
  readonly response: SimulationResponse;
  readonly sourceReplay: PresentationReplay;
  readonly graphicsReplay: Replay;
  readonly setup: SavedNextSetup;
  readonly includeDiagnostics: boolean;
  readonly estimatedCU: number;
}

interface SavedNextSetup {
  readonly format_version: 1;
  readonly saved_at: string;
  readonly ruleset: RulesetRef;
  readonly schema_version: CoreVersion;
  readonly mechanics_version: CoreVersion;
  readonly formation_shape: FormationShape;
  readonly slots: readonly FormationSlot[];
  readonly rival_slots: readonly FormationSlot[];
  readonly draft: SenkeiDraft;
  readonly rival_source: string;
  /** Campaign selection is optional for setups saved before the Next campaign existed. */
  readonly campaign_scenario_id?: string | null;
}

interface SavedCampaignProgress {
  readonly format_version: 1;
  readonly ruleset_digest: string;
  readonly unlocked_scenario_ids: readonly string[];
}

interface WorkspaceProps {
  readonly active: boolean;
  readonly entry: { readonly screen: "home" | "workspace" | "resume"; readonly request: number };
  readonly core: CoreClient | null;
  readonly ruleset: RulePackage | null;
  readonly rulesetError: string | null;
  readonly onRetryCore: () => void;
  readonly onLegacyLibrary: () => void;
}

const TABS: readonly { readonly id: WorkspaceTab; readonly label: string; readonly number: string }[] = [
  { id: "formation", label: "Formation", number: "01" },
  { id: "jinrei", label: "Jinrei", number: "02" },
  { id: "battle", label: "Battle", number: "03" },
  { id: "analysis", label: "Analysis", number: "04" },
];

function stableKey(value: unknown): string {
  return JSON.stringify(value);
}

function canonicalKey(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize);
    if (typeof item !== "object" || item === null) return item;
    return Object.fromEntries(Object.keys(item as Record<string, unknown>).sort()
      .filter((key) => (item as Record<string, unknown>)[key] !== undefined)
      .map((key) => [key, normalize((item as Record<string, unknown>)[key])]));
  };
  return JSON.stringify(normalize(value));
}

/** Differences in persisted setup content; save timestamps are not editable content. */
export function setupRestoreDifferences(current: SavedNextSetup | null, restored: SavedNextSetup | null): readonly string[] {
  if (!current || !restored) return [];
  const differences: string[] = [];
  const changed = (left: unknown, right: unknown) => canonicalKey(left) !== canonicalKey(right);
  if (changed(current.ruleset, restored.ruleset)) differences.push("RulePackage identity changes.");
  if (changed(current.schema_version, restored.schema_version)) differences.push("Schema version changes.");
  if (changed(current.mechanics_version, restored.mechanics_version)) differences.push("Mechanics version changes.");
  if (current.format_version !== restored.format_version) differences.push("Setup format changes.");
  if ((current.campaign_scenario_id ?? null) !== (restored.campaign_scenario_id ?? null)) {
    differences.push(`Scenario: ${current.campaign_scenario_id ?? "Starter"} → ${restored.campaign_scenario_id ?? "Starter"}`);
  }
  if (current.formation_shape !== restored.formation_shape) differences.push(`Formation: ${current.formation_shape} → ${restored.formation_shape}`);
  for (const [label, before, after] of [["Own", current.slots, restored.slots], ["Opponent", current.rival_slots, restored.rival_slots]] as const) {
    if (!changed(before, after)) continue;
    const previousCount = differences.length;
    for (const id of new Set([...before, ...after].map(slot => slot.slot_id))) {
      const oldSlot = before.find(slot => slot.slot_id === id);
      const newSlot = after.find(slot => slot.slot_id === id);
      if (!oldSlot || !newSlot) { differences.push(`${label} slot ${id} is ${newSlot ? "added" : "removed"}.`); continue; }
      for (const [field, name] of [["catalog_id", "Hero"], ["skill_path", "Skill plan"], ["squad", "Squad"], ["node", "starting Node"]] as const) {
        if (oldSlot[field] !== newSlot[field]) differences.push(`${label} ${id} ${name}: ${oldSlot[field]} → ${newSlot[field]}`);
      }
    }
    if (changed(before.map(slot => slot.slot_id), after.map(slot => slot.slot_id))) differences.push(`${label} slot order changes.`);
    if (differences.length === previousCount) differences.push(`${label} slot content changes.`);
  }
  if (changed(current.draft, restored.draft)) differences.push("Jinrei / Draft content, identity or revision changes.");
  if (current.rival_source !== restored.rival_source) differences.push("Opponent Jinrei changes.");
  return differences;
}

function incrementRevision(revision: string): string {
  const numeric = Number(revision);
  return Number.isSafeInteger(numeric) && numeric >= 0 && numeric < Number.MAX_SAFE_INTEGER
    ? String(numeric + 1)
    : `${revision}.1`;
}

function reviseDraft(previous: SenkeiDraft | null, next: SenkeiDraft): SenkeiDraft {
  if (!previous || previous.id !== next.id) return next;
  const { revision: _previousRevision, ...previousContent } = previous;
  const { revision: _nextRevision, ...nextContent } = next;
  return stableKey(previousContent) === stableKey(nextContent)
    ? next
    : { ...next, revision: incrementRevision(previous.revision) };
}

function nearestPolylineTangent(points: readonly WorldPoint[], point: WorldPoint, travel: WorldPoint): WorldPoint | null {
  let nearestDistance = Number.POSITIVE_INFINITY;
  let nearest: WorldPoint | null = null;
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index], to = points[index + 1];
    const dx = to.x - from.x, dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared === 0) continue;
    const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
    const distance = Math.hypot(point.x - (from.x + t * dx), point.y - (from.y + t * dy));
    if (distance >= nearestDistance) continue;
    const length = Math.sqrt(lengthSquared);
    const orientation = dx * travel.x + dy * travel.y >= 0 ? 1 : -1;
    nearestDistance = distance;
    nearest = { x: dx / length * orientation, y: dy / length * orientation };
  }
  return nearest;
}

function sameRulesetRef(left: RulesetRef, right: RulesetRef): boolean {
  return left.id === right.id && left.digest === right.digest
    && left.version.major === right.version.major && left.version.minor === right.version.minor
    && left.version.patch === right.version.patch;
}

function editorCatalogMatchesRuleset(
  catalog: DomainCatalogDocument | null,
  packageValue: RulePackage | null,
): catalog is DomainCatalogDocument {
  return Boolean(catalog && packageValue
    && catalog.identity.rulesetId === packageValue.ruleset.id
    && catalog.identity.rulesetVersion.major === packageValue.ruleset.version.major
    && catalog.identity.rulesetVersion.minor === packageValue.ruleset.version.minor
    && catalog.identity.rulesetVersion.patch === packageValue.ruleset.version.patch
    && catalog.identity.rulesetDigest === packageValue.ruleset.digest);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseVersion(value: unknown): CoreVersion | null {
  if (!isRecord(value) || typeof value.major !== "number" || typeof value.minor !== "number" || typeof value.patch !== "number" ||
      !Number.isInteger(value.major) || !Number.isInteger(value.minor) || !Number.isInteger(value.patch)) return null;
  if (value.major < 0 || value.minor < 0 || value.patch < 0) return null;
  return { major: value.major as number, minor: value.minor as number, patch: value.patch as number };
}

function parseRulesetRef(value: unknown): RulesetRef | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.digest !== "string") return null;
  const version = parseVersion(value.version);
  return version ? { id: value.id, version, digest: value.digest } : null;
}

function parseFormationSlots(value: unknown): readonly FormationSlot[] | null {
  if (!Array.isArray(value) || value.length !== SLOT_IDS.length) return null;
  const slots: (FormationSlot | null)[] = value.map((slot, index) => {
    if (!isRecord(slot) || slot.slot_id !== SLOT_IDS[index]) return null;
    if (![slot.catalog_id, slot.squad, slot.node, slot.skill_path].every((field) => typeof field === "string" && field.length > 0)) return null;
    return {
      slot_id: SLOT_IDS[index],
      catalog_id: slot.catalog_id as string,
      squad: slot.squad as string,
      node: slot.node as string,
      skill_path: slot.skill_path as string,
    };
  });
  return slots.every((slot) => slot !== null) ? slots as FormationSlot[] : null;
}

function parseTacticalSource(value: unknown): TacticalSource | null {
  if (!isRecord(value)) return null;
  if (value.kind === "text" && typeof value.source === "string") return { kind: "text", source: value.source };
  if (value.kind === "structured_ast" && isStructuredTacticsAst(value.ast)) {
    return { kind: "structured_ast", ast: value.ast };
  }
  return null;
}

function parseDraft(value: unknown): SenkeiDraft | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.revision !== "string") return null;
  const schemaVersion = parseVersion(value.schema_version);
  const ruleset = parseRulesetRef(value.ruleset);
  const source = parseTacticalSource(value.program_input);
  if (!schemaVersion || !ruleset || !source || !isDomainValueRecord(value.configuration) || !isDomainValueRecord(value.initial_memory)) return null;
  return {
    schema_version: schemaVersion,
    id: value.id,
    revision: value.revision,
    ruleset,
    configuration: value.configuration,
    program_input: source,
    initial_memory: value.initial_memory,
  };
}

function parseSavedNextSetup(value: unknown): SavedNextSetup | null {
  if (!isRecord(value) || value.format_version !== 1 || typeof value.saved_at !== "string") return null;
  const ruleset = parseRulesetRef(value.ruleset);
  const schemaVersion = parseVersion(value.schema_version);
  const mechanicsVersion = parseVersion(value.mechanics_version);
  const slots = parseFormationSlots(value.slots);
  const rivalSlots = parseFormationSlots(value.rival_slots);
  const draft = parseDraft(value.draft);
  const shape = value.formation_shape;
  if (!ruleset || !schemaVersion || !mechanicsVersion || !slots || !rivalSlots || !draft || typeof value.rival_source !== "string" ||
      (value.campaign_scenario_id !== undefined && value.campaign_scenario_id !== null && typeof value.campaign_scenario_id !== "string")) return null;
  if (shape !== "single" && shape !== "three-lane" && shape !== "wings" && shape !== "custom") return null;
  return {
    format_version: 1,
    saved_at: value.saved_at,
    ruleset,
    schema_version: schemaVersion,
    mechanics_version: mechanicsVersion,
    formation_shape: shape,
    slots,
    rival_slots: rivalSlots,
    draft,
    rival_source: value.rival_source,
    ...(typeof value.campaign_scenario_id === "string" ? { campaign_scenario_id: value.campaign_scenario_id } : {}),
  };
}

function parseCampaignProgress(value: unknown, rulesetDigest: string): SavedCampaignProgress | null {
  if (!isRecord(value) || value.format_version !== 1 || value.ruleset_digest !== rulesetDigest ||
      !Array.isArray(value.unlocked_scenario_ids) || !value.unlocked_scenario_ids.every((id) => typeof id === "string")) return null;
  return { format_version: 1, ruleset_digest: rulesetDigest, unlocked_scenario_ids: value.unlocked_scenario_ids as string[] };
}

function savedSetupMismatch(setup: SavedNextSetup, packageValue: RulePackage | null, rules: NextRules | null): string | null {
  if (!packageValue || !rules) return "The current Next ruleset is still loading.";
  if (setup.ruleset.id !== packageValue.ruleset.id) return `Saved for ${setup.ruleset.id}; current ruleset is ${packageValue.ruleset.id}.`;
  if (setup.ruleset.digest !== packageValue.ruleset.digest) return "The saved package digest differs from the current Next ruleset.";
  if (stableKey(setup.ruleset.version) !== stableKey(packageValue.ruleset.version) ||
      stableKey(setup.schema_version) !== stableKey(packageValue.model_version) ||
      stableKey(setup.mechanics_version) !== stableKey(rules.mechanics_version)) {
    return "The saved schema or mechanics version differs from the current Next ruleset.";
  }
  if (!sameRulesetRef(setup.draft.ruleset, packageValue.ruleset) ||
      stableKey(setup.draft.schema_version) !== stableKey(packageValue.model_version)) {
    return "The saved Jinrei draft belongs to a different package or model schema.";
  }
  const validSlots = (slots: readonly FormationSlot[]) => slots.every((slot) => {
    const hero = rules.heroes.find((item) => item.id === slot.catalog_id);
    return Boolean(hero && Object.prototype.hasOwnProperty.call(rules.map.nodes, slot.node) && slot.squad && hero.skill_paths[slot.skill_path]);
  });
  if (!validSlots(setup.slots) || !validSlots(setup.rival_slots)) {
    return "The saved formation contains a hero, node or skill path that is unavailable in this package.";
  }
  return null;
}

function stableMatchId(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const mask = (1n << 64n) - 1n;
  let first = 0xcbf29ce484222325n;
  let second = 0x84222325cbf29ce4n;
  for (const byte of bytes) {
    first = ((first ^ BigInt(byte)) * 0x100000001b3n) & mask;
    second = ((second ^ BigInt(byte ^ 0xa5)) * 0x100000001b3n) & mask;
  }
  return `next-${first.toString(16).padStart(16, "0")}${second.toString(16).padStart(16, "0")}`;
}

function newExperimentId(matchId: string): string {
  const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${matchId}-${nonce}`;
}

function experimentStoreDigestMatches(store: LocalNextExperimentStore, packageValue: RulePackage): boolean {
  return store.ruleset_digest === packageValue.ruleset.digest;
}

function textValue(value: string): DomainValue {
  return { kind: "string", value };
}

function recordValue(fields: Readonly<Record<string, DomainValue>>): DomainValue {
  return { kind: "record", value: fields };
}

function heroConfiguration(slots: readonly FormationSlot[]): DomainValue {
  return {
    kind: "list",
    value: slots.map((slot) => recordValue({
      slot_id: textValue(slot.slot_id),
      catalog_id: textValue(slot.catalog_id),
      squad: textValue(slot.squad),
      node: textValue(slot.node),
      skill_path: textValue(slot.skill_path),
    })),
  };
}

function defaultSlots(rules: NextRules, side: Side, catalogIds: readonly string[]): FormationSlot[] {
  if (rules.heroes.length === 0) throw new Error("The Next ruleset has no selectable Hero definitions.");
  const base = side === "attacker" ? rules.map.attacker_base : rules.map.defender_base;
  return SLOT_IDS.map((slot_id, index) => {
    const hero = rules.heroes.find((item) => item.id === (catalogIds[index] ?? DEFAULT_HERO_IDS[index])) ?? rules.heroes[index % rules.heroes.length];
    const path = hero?.skill_paths.path_a ? "path_a" : Object.keys(hero?.skill_paths ?? {})[0] ?? "";
    return {
      slot_id,
      catalog_id: hero?.id ?? "",
      squad: "alpha",
      node: base,
      skill_path: path,
    };
  });
}

function formatId(value: string): string {
  return value.replaceAll("_", " ").replaceAll("-", " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function pluralizeEntityCategory(category: string, count: number): string {
  if (count === 1) return category;
  if (category === "Hero") return "Heroes";
  if (category.endsWith("facility")) return `${category.slice(0, -8)}facilities`;
  return `${category}s`;
}

function formatExperience(value: number, rules: NextRules | null): string {
  const scale = rules?.parameters.xp_scale;
  if (!Number.isSafeInteger(value)) return "—";
  if (!Number.isFinite(scale) || !scale || scale <= 0) return String(value);
  const experience = value / scale;
  return Number.isInteger(experience) ? String(experience) : experience.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function createTacticDraft(packageValue: RulePackage, rules: NextRules, side: Side): SenkeiDraft {
  const heroes = defaultSlots(rules, side, side === "attacker" ? DEFAULT_HERO_IDS : DEFAULT_RIVAL_IDS);
  const source = createStarterJinrei(packageValue, side, heroes);
  return {
    schema_version: packageValue.model_version,
    id: `next-${side}-${packageValue.ruleset.digest.slice(0, 12)}`,
    revision: "1",
    ruleset: packageValue.ruleset,
    configuration: Object.freeze({}),
    program_input: { kind: "text", source },
    initial_memory: Object.freeze({}),
  };
}

function createStarterJinrei(packageValue: RulePackage, side: Side, slots: readonly FormationSlot[]): string {
  const rules = packageValue.next;
  if (!rules) throw new Error("The selected ruleset does not contain versioned Next battle data.");
  const heroCollection = Object.entries(packageValue.domain.collections).find(([, collection]) =>
    collection.source.kind === "world_entities" &&
    collection.source.value.entity_types.includes("hero") &&
    collection.source.value.owner === "own_side");
  const movement = packageValue.domain.capabilities.move;
  const node = side === "attacker" ? rules.map.defender_base : rules.map.attacker_base;
  if (!heroCollection || !movement) throw new Error("The Next package is missing its own-Hero observation or move capability.");

  const [, schema] = heroCollection;
  const keyField = schema.unique_keys.find((key) => key.kind === "fields")?.value[0]
    ?? ("slot_id" in schema.visible_fields ? "slot_id" : Object.keys(schema.visible_fields)[0] ?? "slot_id");
  const rankField = ["level", "xp", "hp"].find((field) => field in schema.visible_fields) ?? keyField;
  const stringParameter = movement.arguments.find((parameter) => parameter.value_type.kind === "string");
  const nodeArgument = stringParameter ? 1 : movement.arguments.length - 1;
  const firstArgument = movement.arguments[0];
  const actorType = firstArgument?.value_type.kind === "entity"
    ? firstArgument.value_type.value.entity_type
    : "hero";
  const actors = heroCollection[1].source.kind === "world_entities" && actorType !== "hero"
    ? Object.entries(packageValue.domain.collections).find(([, collection]) =>
        collection.source.kind === "world_entities" && collection.source.value.entity_types.includes(actorType ?? "") && collection.source.value.owner === "own_side") ?? heroCollection
    : heroCollection;
  const actions = slots.map((slot, index) => {
    const actorCollection = actors[0];
    const actorSchema = actors[1];
    const actorKey = actorSchema.unique_keys.find((key) => key.kind === "fields")?.value[0]
      ?? ("slot_id" in actorSchema.visible_fields ? "slot_id" : keyField);
    const rank = ["level", "xp", "hp"].find((field) => field in actorSchema.visible_fields) ?? rankField;
    const selector = `argmin hero in filter hero in ${actorCollection} { hero.${actorKey} == "${slot.slot_id}", } by hero.${rank} then hero.${actorKey}`;
    const args = Array.from({ length: movement.arguments.length }, (_, argumentIndex) => {
      if (argumentIndex === 0) return selector;
      if (argumentIndex === nodeArgument || movement.arguments[argumentIndex]?.value_type.kind === "string") {
        return `"${node}"`;
      }
      return `"${node}"`;
    });
    const needsGoal = "goal" in actorSchema.visible_fields
      ? `any hero in ${actorCollection} { hero.${actorKey} == "${slot.slot_id}", hero.goal == "", hero.hp > 0, }`
      : "match.tick == 1";
    return `    action advance_${String(index + 1).padStart(2, "0")} {\n        when ${needsGoal},\n        do move(${args.join(", ")}),\n    }`;
  });
  const activate = packageValue.domain.capabilities.activate;
  const ownHeroes = Object.entries(packageValue.domain.collections).find(([, collection]) =>
    collection.source.kind === "world_entities" && collection.source.value.entity_types.includes("hero") &&
    collection.source.value.owner === "own_side");
  const enemyHeroes = Object.entries(packageValue.domain.collections).find(([, collection]) =>
    collection.source.kind === "world_entities" && collection.source.value.entity_types.includes("hero") &&
    collection.source.value.owner === "other_side");
  const abilityActions = activate && ownHeroes ? slots.flatMap((slot, index) => {
    const definition = packageValue.next?.heroes.find((hero) => hero.id === slot.catalog_id);
    const path = definition?.skill_paths[slot.skill_path] ?? [];
    const skill = path.map((id) => definition?.skills.find((item) => item.id === id))
      .find((item) => item && !item.passive);
    if (!skill) return [];
    const actorSchema = ownHeroes[1];
    const actorKey = actorSchema.unique_keys.find((key) => key.kind === "fields")?.value[0] ?? "slot_id";
    const actorRank = ["level", "xp", "hp"].find((field) => field in actorSchema.visible_fields) ?? "hp";
    const actor = `argmin hero in filter hero in ${ownHeroes[0]} { hero.${actorKey} == "${slot.slot_id}", } by hero.${actorRank} then hero.${actorKey}`;
    const ready = `any hero in ${ownHeroes[0]} { hero.slot_id == "${slot.slot_id}", hero.level >= ${skill.unlock_level}, hero.energy >= ${skill.cost}, hero.cooldowns.${skill.id} <= match.tick, }`;
    let target = actor;
    let when = ready;
    if (skill.target === "ally") {
      const allyRank = ["hp", "level", "xp"].find((field) => field in actorSchema.visible_fields) ?? "hp";
      target = `argmin ally in filter ally in ${ownHeroes[0]} { ally.hp > 0, } by ally.${allyRank} then ally.${actorKey}`;
    } else if (skill.target === "enemy" && enemyHeroes) {
      const enemyRank = ["hp", "level"].find((field) => field in enemyHeroes[1].visible_fields) ?? "hp";
      target = `argmin target in ${enemyHeroes[0]} by target.${enemyRank} then target.id`;
      when = `and { ${ready}, any target in ${enemyHeroes[0]} { target.hp > 0, }, }`;
    }
    return [`    action activate_slot_${String(index + 1).padStart(2, "0")} {\n        when ${when},\n        do activate(${actor}, "${skill.id}", ${target}),\n    }`];
  }) : [];
  return `senkei next_orders {\n${[...actions, ...abilityActions].join(",\n")}\n}`;
}

function makeSideSnapshot(
  draft: SenkeiDraft,
  program: SenkeiSnapshot["program"],
  slots: readonly FormationSlot[],
): SenkeiSnapshot {
  return {
    schema_version: draft.schema_version,
    id: draft.id,
    revision: draft.revision,
    ruleset: draft.ruleset,
    configuration: { ...draft.configuration, heroes: heroConfiguration(slots) },
    program,
    initial_memory: draft.initial_memory,
  };
}

function fieldString(value: DomainValue | undefined): string | null {
  if (!value) return null;
  if (value.kind === "string" || value.kind === "enum" || value.kind === "entity") return value.value;
  if (value.kind === "integer" || value.kind === "bool") return String(value.value);
  return null;
}

function fieldInteger(value: DomainValue | undefined): number | null {
  return value?.kind === "integer" ? value.value : null;
}

function scenarioFormation(scenario: LocalPveScenario, rules: NextRules): FormationSlot[] {
  const heroes = scenario.npc.configuration.heroes;
  if (heroes?.kind !== "list" || heroes.value.length !== SLOT_IDS.length) {
    throw new Error(`Challenge ${scenario.title} does not contain a valid five-Hero NPC formation.`);
  }
  return heroes.value.map((item, index) => {
    if (item.kind !== "record") throw new Error(`Challenge ${scenario.title} has an invalid NPC Hero at slot ${index + 1}.`);
    const values = item.value;
    const slotId = fieldString(values.slot_id);
    const catalogId = fieldString(values.catalog_id);
    const squad = fieldString(values.squad);
    const node = fieldString(values.node);
    const skillPath = fieldString(values.skill_path);
    const hero = catalogId ? rules.heroes.find((candidate) => candidate.id === catalogId) : null;
    if (!slotId || !catalogId || !squad || !node || !skillPath || !hero || !rules.map.nodes[node] || !hero.skill_paths[skillPath]) {
      throw new Error(`Challenge ${scenario.title} has an unavailable NPC Hero, skill path, Squad or Node.`);
    }
    return { slot_id: slotId, catalog_id: catalogId, squad, node, skill_path: skillPath };
  });
}

function domainLabel(value: DomainValue): string {
  if (value.kind === "null") return "—";
  if (value.kind === "string" || value.kind === "enum" || value.kind === "entity") return value.value;
  if (value.kind === "integer" || value.kind === "bool") return String(value.value);
  if (value.kind === "fixed") return String(value.value.coefficient / (10 ** value.value.scale));
  if (value.kind === "list") return value.value.map(domainLabel).join(", ");
  return Object.entries(value.value).map(([key, item]) => `${key}: ${domainLabel(item)}`).join(" · ");
}

function latestFrame(frames: readonly ReplayFrame[], tick: number): ReplayFrame | null {
  for (let index = frames.length - 1; index >= 0; index -= 1) {
    if (frames[index].tick <= tick) return frames[index];
  }
  return frames[0] ?? null;
}

function eventTitle(event: PresentationEvent): string {
  return formatId(event.event);
}

function eventDetails(event: PresentationEvent): string {
  return Object.entries(event.payload).map(([key, value]) => `${formatId(key)} ${domainLabel(value)}`).join(" · ");
}

/** Validates stored/imported artifacts before they can replace completed Runs. No simulation is executed. */
export async function prepareNextExperimentStore(
  stored: LocalNextExperimentStore, packageValue: RulePackage, core: CoreClient,
): Promise<BattleRun[]> {
  const next = packageValue.next;
  if (!next) throw new Error("The current Next RulePackage is unavailable; existing experiments were preserved.");
  if (!experimentStoreDigestMatches(stored, packageValue)) {
    throw new Error(`Stored package digest ${stored.ruleset_digest} differs from ${packageValue.ruleset.digest}.`);
  }
  const probe = await core.newMatchContext(packageValue.ruleset, "next-experiment-identity-probe");
  const expectedWorld = next.world_identity;
  const expectedMapWorld = next.map.world_identity;
  const restored: BattleRun[] = [];
  for (const item of stored.experiments) {
    validateNextExperimentAuthorization(item.response, item.include_diagnostics);
    const setup = parseSavedNextSetup(item.setup);
    const result = item.response.outcome?.result;
    const sourceReplay = item.response.owner_replays?.attacker ?? item.response.outcome?.presentation_replay;
    if (!setup || !result || !sourceReplay || item.snapshot.context.match_id !== item.match_id || result.match_id !== item.match_id) {
      throw new Error(`Experiment ${item.id} has incomplete match, setup, result or replay data.`);
    }
    const mismatch = savedSetupMismatch(setup, packageValue, next);
    if (mismatch) throw new Error(`Experiment ${item.id} cannot be restored: ${mismatch}`);
    const replays = [item.response.outcome.presentation_replay, item.response.owner_replays?.attacker,
      item.response.owner_replay].filter((replay): replay is PresentationReplay => Boolean(replay));
    for (const replay of replays) {
      if (!item.snapshot.context.world_identity || !expectedWorld || !expectedMapWorld ||
          canonicalKey(item.snapshot.context.world_identity) !== canonicalKey(expectedWorld) ||
          canonicalKey(expectedMapWorld) !== canonicalKey(expectedWorld) ||
          canonicalKey(replay.world_identity) !== canonicalKey(expectedWorld)) {
        throw new Error(`Experiment ${item.id} World identity or paired World projection does not match the current package.`);
      }
      if (!item.snapshot.context.ruleset || !sameRulesetRef(item.snapshot.context.ruleset, packageValue.ruleset) ||
          !sameRulesetRef(item.snapshot.attacker.ruleset, packageValue.ruleset) ||
          !sameRulesetRef(item.snapshot.defender.ruleset, packageValue.ruleset) ||
          !replay.ruleset || !sameRulesetRef(replay.ruleset, packageValue.ruleset)) {
        throw new Error(`Experiment ${item.id} Ruleset identity does not match the current package.`);
      }
      try { await validateNextExperimentReplay(replay, result, item.match_id); }
      catch (cause) {
        throw new Error(`Experiment ${item.id} replay does not match its immutable result or attacker perspective: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    if (stableKey(item.snapshot.context.versions) !== stableKey(probe.versions)) {
      throw new Error(`Experiment ${item.id} compiler, engine or mechanics versions differ from this runtime.`);
    }
    if (item.include_diagnostics && item.response.authorized_side !== "attacker") {
      throw new Error(`Experiment ${item.id} does not carry attacker-authorized diagnostics.`);
    }
    // Validate the frozen input itself, including its compiled programs, without replaying the battle.
    await core.preflight(item.snapshot);
    const graphicsReplay = presentationToGraphics(sourceReplay, packageValue, result, item.snapshot.context.versions.engine);
    restored.push({
      experimentId: item.id,
      createdAt: item.created_at,
      snapshot: item.snapshot,
      response: item.response,
      sourceReplay,
      graphicsReplay,
      setup,
      includeDiagnostics: item.include_diagnostics,
      estimatedCU: item.estimated_cu,
    });
  }
  return restored;
}

export function NextWorkspace({ active, entry, core, ruleset: packageValue, rulesetError, onRetryCore }: WorkspaceProps): ReactElement {
  const nextRules = packageValue?.next ?? null;
  const campaignScenarios = useMemo(() => packageValue?.next ? createNextCampaignScenarios(packageValue) : [], [packageValue]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("first-march");
  const [unlockedScenarioIds, setUnlockedScenarioIds] = useState<readonly string[]>([]);
  const [campaignProgressLoadedDigest, setCampaignProgressLoadedDigest] = useState<string | null>(null);
  const [campaignProgressError, setCampaignProgressError] = useState<string | null>(null);
  const [experimentStore, setExperimentStore] = useState<LocalNextExperimentStore | null>(null);
  const [experimentLoadedDigest, setExperimentLoadedDigest] = useState<string | null>(null);
  const [experimentError, setExperimentError] = useState<string | null>(null);
  const [experimentMismatch, setExperimentMismatch] = useState<string | null>(null);
  const [experimentStorageLoaded, setExperimentStorageLoaded] = useState(false);
  const [experimentPreservedRaw, setExperimentPreservedRaw] = useState<string | null>(null);
  const [screen, setScreen] = useState<"home" | "conditions" | "preset" | "ready" | "workspace" | "resume" | "running">("home");
  const [libraryView, setLibraryView] = useState<"library" | "recovery">("library");
  const [libraryReturn, setLibraryReturn] = useState<typeof screen>("home");
  const [jinreiScreen, setJinreiScreen] = useState<"workbench" | "coverage">("workbench");
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const [storageAttempt, setStorageAttempt] = useState(0);
  const [savedRaw, setSavedRaw] = useState<string | null>(null);
  const [recoveryRaw, setRecoveryRaw] = useState<string | null>(null);
  const [exactRun, setExactRun] = useState<BattleRun | null>(null);
  const [entryMode, setEntryMode] = useState<"quick" | "custom" | "campaign">("quick");
  const [checking, setChecking] = useState(false);
  const [prepared, setPrepared] = useState<{ key: string; snapshot: SimulationSnapshot } | null>(null);
  const [preflightFailure, setPreflightFailure] = useState<{ key: string; message: string; status: "invalid" | "unverified" | "failed" } | null>(null);
  const operationInFlight = useRef(false);
  useEffect(() => {
    if (operationInFlight.current) return;
    setScreen(entry.screen);
    if (entry.screen === "resume") {
      setLibraryView("library");
      if (screen !== "resume") setLibraryReturn(screen);
    }
  }, [entry]);
  const [tab, setTab] = useState<WorkspaceTab>("formation");
  const [atelierScreen, setAtelierScreen] = useState<AtelierScreen>("collection");
  const [saveDetailsOpen, setSaveDetailsOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 761px)").matches);
  const [slots, setSlots] = useState<FormationSlot[]>([]);
  const [rivalSlots, setRivalSlots] = useState<FormationSlot[]>([]);
  const [formationShape, setFormationShape] = useState<FormationShape>("single");
  const [activeSlot, setActiveSlot] = useState(0);
  const [draft, setDraft] = useState<SenkeiDraft | null>(null);
  const draftRef = useRef<SenkeiDraft | null>(null);
  const [editorCatalog, setEditorCatalog] = useState<DomainCatalogDocument | null>(null);
  const [editorCatalogError, setEditorCatalogError] = useState<string | null>(null);
  const [, setEditorCatalogLoading] = useState(false);
  const editorCompileRevision = useRef(0);
  const [compilation, setCompilation] = useState<{ readonly key: string; readonly result: import("../../contracts").CompileOutcome } | null>(null);
  const [run, setRun] = useState<BattleRun | null>(null);
  const [baselineRun, setBaselineRun] = useState<BattleRun | null>(null);
  const [analysisContext, setAnalysisContext] = useState<BattleAnalysisContext | null>(null);
  const [analysisSource, setAnalysisSource] = useState<AnalysisSourceContext | null>(null);
  const sourceRequestSequence = useRef(0);
  const [replayEventSelection, setReplayEventSelection] = useState<{ experimentId: string; tick: number; order: number } | null>(null);
  const [runSourceProof, setRunSourceProof] = useState<{ experimentId: string; map: ActionSourceMap | null; reason: string } | null>(null);
  useEffect(() => {
    if (!run) return;
    let obsolete = false;
    const original = run.setup.draft;
    const unavailable = (reason: string) => setRunSourceProof({ experimentId: run.experimentId, map: null, reason });
    if (!core || !packageValue || !sameRulesetRef(original.ruleset, packageValue.ruleset)
      || !sameRulesetRef(run.snapshot.attacker.ruleset, packageValue.ruleset)) {
      unavailable("Original Run RulePackage is unavailable. No source correspondence was inferred."); return;
    }
    if (original.program_input.kind !== "text") { unavailable("Original Run has no text source locations. Structured AST was not converted into guessed spans."); return; }
    const source = original.program_input.source;
    unavailable("Checking original Run source and Program identity…");
    void core.compile({ kind: "text", source, ruleset_ref: original.ruleset })
      .then(result => verifyRunSourceMap(source, run.snapshot.attacker.program.content_digest, result))
      .then(proof => { if (!obsolete) setRunSourceProof({ experimentId: run.experimentId, ...proof }); })
      .catch(cause => { if (!obsolete) unavailable(`Original source verification failed: ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { obsolete = true; };
  }, [run, core, packageValue]);
  const experimentRestoreGeneration = useRef(0);
  const experimentRuntime = useRef({ core, packageValue });
  experimentRuntime.current = { core, packageValue };
  const experimentPersistGeneration = useRef(0);
  const experimentImportGeneration = useRef(0);
  const experimentWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueExperimentWrite = useCallback((write: () => Promise<void>): Promise<void> => {
    const next = experimentWriteQueue.current.then(write);
    experimentWriteQueue.current = next.catch(() => undefined);
    return next;
  }, []);
  const [busy, setBusy] = useState(false);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [runtimeFailure, setRuntimeFailure] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [battleMobileView, setBattleMobileView] = useState<BattlefieldMobileView>("battle");
  const [battleInspectorOpen, setBattleInspectorOpen] = useState(false);
  const [battleRosterOpen, setBattleRosterOpen] = useState(false);
  const [expandedVisibleClusterId, setExpandedVisibleClusterId] = useState<string | null>(null);
  const [battleMapContextOpen, setBattleMapContextOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 761px)").matches);
  const [cameraMode, setCameraMode] = useState<BattlefieldCameraMode>("tactical");
  const [presentationMode, setPresentationMode] = useState<BattlefieldPresentationMode>("tactical");
  const [informationLayers, setInformationLayers] = useState<BattlefieldInformationLayers>({ vision: true, lanes: true, engagements: true });
  const [followedEntityId, setFollowedEntityId] = useState<string | null>(null);
  const [followedSquadId, setFollowedSquadId] = useState<string | null>(null);
  const [focusedReplayPoint, setFocusedReplayPoint] = useState<FocusedReplayPoint | null>(null);
  const [player, setPlayer] = useState<ReplayPlayer | null>(null);
  const [displayState, setDisplayState] = useState<DisplayState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pixel, setPixel] = useState(true);
  const [rendererError, setRendererError] = useState<string | null>(null);

  useEffect(() => {
    const digest = packageValue?.ruleset.digest;
    const generation = ++experimentRestoreGeneration.current;
    let storageRead = false;
    setExperimentLoadedDigest(null);
    setExperimentMismatch(null);
    setExperimentError(null);
    setExperimentStorageLoaded(false);
    void (async () => {
      try {
        // Reading/exporting completed records does not require the simulation runtime.
        const payload = await loadNextExperimentPayload();
        if (generation !== experimentRestoreGeneration.current) return;
        storageRead = true;
        setExperimentStorageLoaded(true);
        let stored: LocalNextExperimentStore | null;
        try { stored = payload === null ? null : parseNextExperimentStore(payload); }
        catch (cause) {
          setExperimentPreservedRaw(JSON.stringify(payload));
          setExperimentStore(null);
          throw cause;
        }
        setExperimentPreservedRaw(null);
        setExperimentStore(stored);
        if (!core || !packageValue?.next || !digest) return;
        const restored = stored ? await prepareNextExperimentStore(stored, packageValue, core) : [];
        if (generation !== experimentRestoreGeneration.current) return;
        setRun(restored[0] ?? null);
        setBaselineRun(restored[1] ?? null);
        setExperimentLoadedDigest(digest);
      } catch (cause) {
        if (generation !== experimentRestoreGeneration.current) return;
        const message = cause instanceof Error ? cause.message : String(cause);
        if (storageRead) {
          setExperimentMismatch(message);
          setExperimentLoadedDigest(digest ?? null);
        } else {
          setExperimentError(message);
          setExperimentStorageLoaded(true);
        }
      }
    })();
    return () => { experimentRestoreGeneration.current += 1; };
  }, [core, packageValue, storageAttempt]);

  useEffect(() => {
    const digest = packageValue?.ruleset.digest;
    if (!digest || experimentLoadedDigest !== digest || experimentMismatch || !run) return;
    const experiments: LocalNextExperiment[] = [run, ...(baselineRun ? [baselineRun] : [])].map((item) => ({
      id: item.experimentId,
      match_id: item.snapshot.context.match_id,
      created_at: item.createdAt,
      snapshot: item.snapshot,
      response: item.response,
      setup: JSON.parse(JSON.stringify(item.setup)) as CoreJsonValue,
      include_diagnostics: item.includeDiagnostics,
      estimated_cu: item.estimatedCU,
    }));
    const store: LocalNextExperimentStore = { format_version: 1, ruleset_digest: digest, experiments };
    const generation = ++experimentPersistGeneration.current;
    void enqueueExperimentWrite(() => saveNextExperimentStore(store)).then(() => {
      if (generation === experimentPersistGeneration.current) setExperimentStore(store);
    }).catch((cause: unknown) => {
      setExperimentError(cause instanceof Error ? `Experiment could not be saved: ${cause.message}` : "Experiment could not be saved.");
    });
  }, [baselineRun, enqueueExperimentWrite, experimentLoadedDigest, experimentMismatch, packageValue?.ruleset.digest, run]);
  const [rendererAttempt, setRendererAttempt] = useState(0);
  const [savedSetup, setSavedSetup] = useState<SavedNextSetup | null>(null);
  const [savedSetupLoaded, setSavedSetupLoaded] = useState(false);
  const [savedSetupError, setSavedSetupError] = useState<string | null>(null);
  const [recoverySetup, setRecoverySetup] = useState<SavedNextSetup | null>(null);
  const recoverySetupRef = useRef<SavedNextSetup | null>(null);
  const [recoverySetupLoaded, setRecoverySetupLoaded] = useState(false);
  const [recoveryLoadError, setRecoveryLoadError] = useState<string | null>(null);
  const [recoveryRestored, setRecoveryRestored] = useState(false);
  const [recoveryAvailable, setRecoveryAvailable] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const rendererHost = useRef<HTMLDivElement>(null);
  const renderer = useRef<BattlefieldRenderer | null>(null);
  const mobileTimelineRef = useRef<HTMLOListElement>(null);
  const mobileVisibleClustersRef = useRef<HTMLDivElement>(null);
  const desktopVisibleClustersRef = useRef<HTMLDivElement>(null);
  const importFileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const digest = packageValue?.ruleset.digest;
    if (!digest || campaignScenarios.length === 0) return;
    setCampaignProgressLoadedDigest(null);
    setCampaignProgressError(null);
    const firstId = campaignScenarios[0].id;
    try {
      const serialized = window.localStorage.getItem(`${NEXT_CAMPAIGN_PROGRESS_KEY}:${digest}`);
      const stored = serialized === null ? null : parseCampaignProgress(JSON.parse(serialized) as unknown, digest);
      const validIds = stored?.unlocked_scenario_ids.filter((id) => campaignScenarios.some((scenario) => scenario.id === id)) ?? [];
      setUnlockedScenarioIds([...new Set([firstId, ...validIds])]);
      setSelectedScenarioId((current) => campaignScenarios.some((scenario) => scenario.id === current) ? current : firstId);
    } catch (cause) {
      setCampaignProgressError(cause instanceof Error
        ? `Campaign progress could not be read and was preserved: ${cause.message}`
        : "Campaign progress could not be read and was preserved.");
      setUnlockedScenarioIds([firstId]);
      setSelectedScenarioId(firstId);
    } finally {
      setCampaignProgressLoadedDigest(digest);
    }
  }, [campaignScenarios, packageValue?.ruleset.digest]);

  useEffect(() => {
    const digest = packageValue?.ruleset.digest;
    if (!digest || campaignProgressLoadedDigest !== digest || campaignProgressError) return;
    const progress: SavedCampaignProgress = { format_version: 1, ruleset_digest: digest, unlocked_scenario_ids: unlockedScenarioIds };
    try {
      window.localStorage.setItem(`${NEXT_CAMPAIGN_PROGRESS_KEY}:${digest}`, JSON.stringify(progress));
    } catch (cause) {
      setCampaignProgressError(cause instanceof Error
        ? `Campaign progress could not be saved: ${cause.message}`
        : "Campaign progress could not be saved in this browser.");
    }
  }, [campaignProgressError, campaignProgressLoadedDigest, packageValue?.ruleset.digest, unlockedScenarioIds]);

  const workspaceHost = useRef<HTMLElement>(null);
  const scrollPositions = useRef(new Map<string, number>());
  // Library owns focus between its tabs; only entering its outer screen needs heading focus.
  const viewKey = screen === "resume" ? "resume" : `${screen}:${tab}:${tab === "formation" ? atelierScreen : tab === "jinrei" ? jinreiScreen : ""}`;
  useLayoutEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => {
      const heading = [...(workspaceHost.current?.querySelectorAll<HTMLElement>("h2,h3,h4") ?? [])]
        .find(element => element.getClientRects().length > 0);
      // A keyboard interaction may have moved focus before this entry frame runs.
      const selectedTabHasFocus = document.activeElement instanceof HTMLElement
        && workspaceHost.current?.contains(document.activeElement)
        && document.activeElement.matches('[role="tab"][aria-selected="true"]')
        && document.activeElement.getClientRects().length > 0;
      if (heading && !selectedTabHasFocus) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
      window.scrollTo(0, scrollPositions.current.get(viewKey) ?? 0);
    });
    return () => { cancelAnimationFrame(frame); scrollPositions.current.set(viewKey, window.scrollY); };
  }, [active, viewKey]);

  const tabKeys = (event: import("react").KeyboardEvent<HTMLElement>): void => {
    const target = event.target as HTMLElement;
    if (event.defaultPrevented || target.getAttribute("role") !== "tab" || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    const list = target.closest('[role="tablist"]');
    if (!list) return;
    const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const index = tabs.indexOf(target as HTMLButtonElement);
    const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next]?.focus(); tabs[next]?.click();
  };

  useEffect(() => {
    setPrepared(null);
    setPreflightFailure(null);
    setCompilation(null);
  }, [core]);

  useEffect(() => {
    if (!active || !core || !packageValue?.next) {
      setEditorCatalog(null);
      setEditorCatalogError(null);
      setEditorCatalogLoading(false);
      return;
    }
    let cancelled = false;
    setEditorCatalog(null);
    setEditorCatalogError(null);
    setEditorCatalogLoading(true);
    void core.editorCatalogJson()
      .then((canonicalJson) => loadDomainCatalog(canonicalJson, {
        rulesetId: packageValue.ruleset.id,
        rulesetVersion: packageValue.ruleset.version,
        rulesetDigest: packageValue.ruleset.digest,
      }))
      .then((catalog) => {
        if (!cancelled) setEditorCatalog(catalog);
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setEditorCatalogError(cause instanceof Error
            ? cause.message
            : "The Senritsu Domain Catalog could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setEditorCatalogLoading(false);
      });
    return () => { cancelled = true; };
  }, [
    active,
    core,
    catalogAttempt,
    packageValue?.ruleset.id,
    packageValue?.ruleset.version.major,
    packageValue?.ruleset.version.minor,
    packageValue?.ruleset.version.patch,
    packageValue?.ruleset.digest,
  ]);

  useEffect(() => {
    try {
      const serialized = window.localStorage.getItem(NEXT_STORAGE_KEY);
      setSavedRaw(serialized);
      setSavedSetup(null);
      setSavedSetupError(null);
      if (serialized !== null) {
        const parsed = parseSavedNextSetup(JSON.parse(serialized) as unknown);
        if (parsed) setSavedSetup(parsed);
        else setSavedSetupError("A saved Next setup is present, but its format cannot be read. Import a valid JSON setup or clear this copy explicitly.");
      } else setSavedSetup(null);
    } catch (cause) {
      setSavedSetupError(cause instanceof Error
        ? `The saved Next setup could not be read: ${cause.message}`
        : "The saved Next setup could not be read from this browser.");
    } finally {
      setSavedSetupLoaded(true);
    }
  }, [storageAttempt]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const syncDisclosure = () => setSaveDetailsOpen(desktop.matches);
    desktop.addEventListener("change", syncDisclosure);
    return () => desktop.removeEventListener("change", syncDisclosure);
  }, []);

  useEffect(() => {
    try {
      const serialized = window.localStorage.getItem(NEXT_RECOVERY_KEY);
      setRecoveryRaw(serialized);
      setRecoveryLoadError(null);
      if (serialized !== null) {
        const parsed = parseSavedNextSetup(JSON.parse(serialized) as unknown);
        if (parsed) {
          recoverySetupRef.current = parsed;
          setRecoverySetup(parsed);
          setRecoveryAvailable(true);
        } else {
          setRecoveryLoadError("An unsaved Next recovery copy is present, but its format cannot be read. It has been preserved; clear it explicitly to start a new recovery copy.");
        }
      } else { setRecoverySetup(null); recoverySetupRef.current = null; }
    } catch (cause) {
      setRecoveryLoadError(cause instanceof Error
        ? `The unsaved Next recovery copy could not be read: ${cause.message}. It has been preserved.`
        : "The unsaved Next recovery copy could not be read. It has been preserved.");
    } finally {
      setRecoverySetupLoaded(true);
    }
  }, [storageAttempt]);

  useEffect(() => {
    if (!packageValue || !nextRules || !recoverySetupLoaded) return;
    try {
      const recovered = recoverySetupRef.current;
      if (recovered && savedSetupMismatch(recovered, packageValue, nextRules) === null) {
        setSlots([...recovered.slots]);
        setRivalSlots([...recovered.rival_slots]);
        setFormationShape(recovered.formation_shape);
        if (recovered.campaign_scenario_id) {
          setEntryMode("campaign");
          setSelectedScenarioId(recovered.campaign_scenario_id);
        }
        setActiveSlot(0);
        draftRef.current = recovered.draft;
        setDraft(recovered.draft);
        setCompilation(null);
        setRun(null);
        setBaselineRun(null);
        setError(null);
        setRendererError(null);
        setSelectedEntityId(null);
        setRecoveryRestored(true);
        setSaveMessage("Recovered this unsaved Next draft after reload. Your explicit saved setup remains separate.");
        return;
      }
      const playerSlots = defaultSlots(nextRules, "attacker", DEFAULT_HERO_IDS);
      const enemySlots = defaultSlots(nextRules, "defender", DEFAULT_RIVAL_IDS);
      const initialDraft = createTacticDraft(packageValue, nextRules, "attacker");
      setSlots(playerSlots);
      setRivalSlots(enemySlots);
      setFormationShape("single");
      setActiveSlot(0);
      draftRef.current = initialDraft;
      setDraft(initialDraft);
      setCompilation(null);
      setRun(null);
      setBaselineRun(null);
      setError(null);
      setRendererError(null);
      setSelectedEntityId(null);
    } catch (cause) {
      setSlots([]);
      setRivalSlots([]);
      draftRef.current = null;
      setDraft(null);
      setCompilation(null);
      setRun(null);
      setBaselineRun(null);
      setError(cause instanceof Error ? cause.message : "The Next formation could not be initialized from the ruleset.");
    }
  }, [packageValue?.ruleset.digest, recoverySetupLoaded]);

  const compilerContextKey = draft && editorCatalogMatchesRuleset(editorCatalog, packageValue)
    ? stableKey({ draft, slots, catalog: catalogStamp(editorCatalog) })
    : null;
  const activeCompilation = compilerContextKey !== null && compilation?.key === compilerContextKey
    ? compilation.result
    : null;
  const selectedScenario = campaignScenarios.find((scenario) => scenario.id === selectedScenarioId) ?? campaignScenarios[0] ?? null;
  const campaignFeedback = run?.setup.campaign_scenario_id
    ? (() => {
        const scenario = campaignScenarios.find((candidate) => candidate.id === run.setup.campaign_scenario_id);
        return scenario ? { scenarioId: scenario.id, scenario, ...getNextCampaignRunFeedback(run.response.outcome.result) } : null;
      })()
    : null;
  const unlockedScenarioSet = useMemo(() => new Set(unlockedScenarioIds), [unlockedScenarioIds]);
  const selectCampaignScenario = (scenarioId: string): void => {
    if (!unlockedScenarioSet.has(scenarioId) || !campaignScenarios.some((scenario) => scenario.id === scenarioId)) return;
    setSelectedScenarioId(scenarioId);
    setPrepared(null);
    setPreflightFailure(null);
    setExactRun(null);
  };
  useEffect(() => {
    if (entryMode !== "campaign" || !selectedScenarioId || unlockedScenarioSet.has(selectedScenarioId)) return;
    const firstUnlocked = campaignScenarios.find((scenario) => unlockedScenarioSet.has(scenario.id));
    if (firstUnlocked) setSelectedScenarioId(firstUnlocked.id);
  }, [campaignScenarios, entryMode, selectedScenarioId, unlockedScenarioSet]);
  const savedSetupMismatchReason = savedSetup ? savedSetupMismatch(savedSetup, packageValue, nextRules) : null;
  const recoveryMismatchReason = recoverySetup ? savedSetupMismatch(recoverySetup, packageValue, nextRules) : null;
  const canRestoreSavedSetup = savedSetupLoaded && savedSetup !== null && savedSetupMismatchReason === null;
  const runIsCurrent = Boolean(run && draft &&
    stableKey({ draft, slots, rivalSlots, formationShape, includeDiagnostics }) === stableKey({
      draft: run.setup.draft, slots: run.setup.slots, rivalSlots: run.setup.rival_slots,
      formationShape: run.setup.formation_shape, includeDiagnostics: run.includeDiagnostics,
    }) && (entryMode === "campaign" ? selectedScenarioId : null) === (run.setup.campaign_scenario_id ?? null));
  const launchKey = stableKey({ compilerContextKey, slots, rivalSlots, includeDiagnostics, package: packageValue?.ruleset, exact: exactRun?.snapshot,
    entryMode, campaignScenario: entryMode === "campaign" ? selectedScenarioId : null });
  const launchKeyRef = useRef(launchKey);
  launchKeyRef.current = launchKey;
  const readySnapshot = prepared?.key === launchKey && (exactRun || activeCompilation) ? prepared.snapshot : null;
  const currentPreflightError = preflightFailure?.key === launchKey ? preflightFailure : null;
  const visibleCameraTargets = useMemo<VisibleBattleTarget[]>(() => Object.values(displayState?.entities ?? {})
    .filter((entity) => !entity.destroyed && (entity.hp > 0 || entity.kind === "bridge" || entity.kind === "observation"))
    .sort((left, right) => {
      const priority = (entity: DisplayState["entities"][string]) => entity.archetype === "hero" ? 0 : entity.kind === "unit" ? 1 : entity.kind === "tower" ? 2 : 3;
      return priority(left) - priority(right) || left.side.localeCompare(right.side) || left.id.localeCompare(right.id);
    })
    .map((entity) => {
      const hero = entity.archetype === "hero" && entity.catalogId
        ? nextRules?.heroes.find((candidate) => candidate.id === entity.catalogId) ?? null
        : null;
      const identity = hero
        ? `${hero.id} · ${hero.name}`
        : entity.kind === "bridge"
          ? `${entity.battlefield?.bridgeSite ?? "Bridge"} bridge · ${formatId(entity.battlefield?.bridgeState ?? "unknown")}`
        : entity.kind === "observation" ? "MID Observatory"
        : entity.kind === "tower" && entity.battlefield?.node ? `${entity.battlefield.node} tower`
        : entity.kind === "base" ? `${formatId(entity.side)} fortress`
        : entity.catalogId ? formatId(entity.catalogId) : entity.id;
      const role = hero
        ? `${formatId(hero.placement)} · ${formatId(hero.role)}`
        : entity.kind === "unit" ? formatId(entity.archetype) : `${formatId(entity.kind)} facility`;
      const category = entity.archetype === "hero" ? "Hero" : entity.kind === "unit" ? formatId(entity.archetype) : `${formatId(entity.kind)} facility`;
      const side = formatId(entity.side);
      const healthLabel = entity.kind === "observation" ? null : `HP ${entity.hp}/${entity.maxHp}`;
      return {
        id: entity.id,
        label: `${side} · ${identity} · ${role}${healthLabel ? ` · ${healthLabel}` : ""} · ID ${entity.id}`,
        identity,
        catalogId: entity.catalogId ?? null,
        role,
        category,
        side,
        healthLabel,
        position: entity.position,
      };
    }), [displayState, nextRules]);
  const visibleEntityClusters = useMemo<VisibleBattleCluster[]>(() => {
    const groups: { readonly anchor: VisibleBattleTarget; readonly entities: VisibleBattleTarget[] }[] = [];
    for (const entity of visibleCameraTargets) {
      const nearby = groups.find((group) => Math.hypot(
        entity.position.x - group.anchor.position.x,
        entity.position.y - group.anchor.position.y,
      ) <= VISIBLE_ENTITY_CLUSTER_RADIUS);
      if (nearby) nearby.entities.push(entity);
      else groups.push({ anchor: entity, entities: [entity] });
    }
    return groups.map(({ anchor, entities }) => ({
      id: anchor.id,
      position: anchor.position,
      coLocated: entities.every((entity) => entity.position.x === anchor.position.x && entity.position.y === anchor.position.y),
      anchorRadius: entities.reduce((farthest, entity) => Math.max(farthest, Math.hypot(
        entity.position.x - anchor.position.x,
        entity.position.y - anchor.position.y,
      )), 0),
      entities,
    }));
  }, [visibleCameraTargets]);
  useEffect(() => {
    if (!battleRosterOpen && battleMobileView !== "follow") return;
    const activeId = followedEntityId ?? selectedEntityId;
    const preferredCluster = visibleEntityClusters.find((cluster) => cluster.entities.some((entity) => entity.id === activeId)) ??
      visibleEntityClusters.find((cluster) => cluster.entities.filter((entity) => entity.category === "Hero").length > 1) ??
      visibleEntityClusters.find((cluster) => cluster.entities.length > 1) ??
      visibleEntityClusters[0] ?? null;
    setExpandedVisibleClusterId(preferredCluster?.id ?? null);
  }, [battleMobileView, battleRosterOpen, followedEntityId, selectedEntityId, visibleEntityClusters]);
  useEffect(() => {
    if (!battleRosterOpen && battleMobileView !== "follow") return;
    const frame = requestAnimationFrame(() => {
      const mobile = window.matchMedia("(max-width: 760px)").matches;
      const list = mobile ? mobileVisibleClustersRef.current : desktopVisibleClustersRef.current;
      list?.querySelector<HTMLElement>(".next-visible-cluster.is-expanded .next-visible-cluster-entities > li:first-child")?.scrollIntoView({ block: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
  }, [battleMobileView, battleRosterOpen, expandedVisibleClusterId]);
  const selectedFrame = run && displayState ? latestFrame(run.sourceReplay.frames, displayState.tick) : null;
  const publicEntities = selectedFrame?.visible_state?.entities ?? {};
  const ownerReplayCandidate = run?.response.owner_replays?.attacker;
  const ownerReplay = ownerReplayCandidate?.perspective === "attacker" ? ownerReplayCandidate : null;
  const ownerFrame = ownerReplay && displayState
    ? ownerReplay.frames.find((frame) => frame.tick === displayState.tick) ?? null
    : null;
  const visibleSquadTargets = useMemo<VisibleSquadTarget[]>(() => {
    if (!ownerReplay || !ownerFrame?.visible_state || !displayState) return [];
    const groups = new Map<string, Set<string>>();
    for (const entity of Object.values(ownerFrame.visible_state.entities)) {
      if (entity.owner !== "attacker" || entity.entity_type !== "hero") continue;
      const squad = fieldString(entity.fields.squad);
      const catalogId = fieldString(entity.fields.catalog_id);
      if (!squad) continue;
      const matches = Object.values(displayState.entities)
        .filter((candidate) => !candidate.destroyed && candidate.hp > 0 && (!catalogId || candidate.catalogId === catalogId) &&
          matchesPresentedEntity(entity, candidate, nextRules?.map.edges));
      // Squad membership is private owner-replay data; camera IDs must still
      // come from one unambiguous visible graphics entity at this exact tick.
      // Matching by nearest position could assign a duplicate Hero to a
      // different Squad, so ambiguity means no follow target for that entity.
      if (matches.length !== 1) continue;
      const members = groups.get(squad) ?? new Set<string>();
      members.add(matches[0].id);
      groups.set(squad, members);
    }
    return [...groups.entries()]
      .map(([id, memberSet]) => {
        const memberIds = [...memberSet];
        return { id, memberIds, label: `${formatId(id)} · ${memberIds.length} visible ${memberIds.length === 1 ? "Hero" : "Heroes"}` };
      })
      .filter((group) => group.memberIds.length > 0)
      .sort((left, right) => left.id.localeCompare(right.id));
  }, [displayState, nextRules, ownerFrame, ownerReplay]);
  const followedSquadMembers = visibleSquadTargets.find((target) => target.id === followedSquadId)?.memberIds ?? [];
  const followedSquadMemberKey = followedSquadMembers.join("|");
  const selectedDisplayEntity = selectedEntityId ? displayState?.entities[selectedEntityId] ?? null : null;
  const selectedEntity = useMemo(() => {
    if (!selectedDisplayEntity) return null;
    const tickEntities = ownerFrame?.visible_state?.entities ?? publicEntities;
    const matches = Object.values(tickEntities)
      .filter((entity) => matchesPresentedEntity(entity, selectedDisplayEntity, nextRules?.map.edges));
    return matches.length === 1 ? matches[0] : null;
  }, [nextRules, ownerFrame, publicEntities, selectedDisplayEntity]);
  const selectBattleEntity = useCallback((id: string): void => {
    setSelectedEntityId(id);
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 760px)").matches) {
      setBattleMobileView("details");
    }
  }, []);
  const tacticsRuleset = useMemo(() => packageValue ? ({
    ...packageValue,
    domain: { ...packageValue.domain, senkei_configuration: Object.freeze({}) },
  }) : null, [packageValue]);

  const buildSavedSetup = useCallback((): SavedNextSetup | null => {
    const currentDraft = draftRef.current;
    if (!packageValue || !nextRules || !currentDraft) return null;
    return {
      format_version: 1,
      saved_at: new Date().toISOString(),
      ruleset: packageValue.ruleset,
      schema_version: packageValue.model_version,
      mechanics_version: nextRules.mechanics_version,
      formation_shape: formationShape,
      slots,
      rival_slots: rivalSlots,
      draft: currentDraft,
      rival_source: createStarterJinrei(packageValue, "defender", rivalSlots),
      ...(entryMode === "campaign" && selectedScenario ? { campaign_scenario_id: selectedScenario.id } : {}),
    };
  }, [entryMode, formationShape, nextRules, packageValue, rivalSlots, selectedScenario, slots]);

  const currentSetup = buildSavedSetup();
  const restoreDifferences = {
    saved: setupRestoreDifferences(currentSetup, savedSetup),
    recovery: setupRestoreDifferences(currentSetup, recoverySetup),
  };
  const draftIsSaved = Boolean(currentSetup && savedSetup && !savedSetupError && restoreDifferences.saved.length === 0);

  useEffect(() => {
    if (!recoverySetupLoaded || !savedSetupLoaded || slots.length !== 5 || !draft || recoveryLoadError || recoveryMismatchReason) return;
    const setup = buildSavedSetup();
    if (!setup) return;
    try {
      const serialized = JSON.stringify(setup);
      window.localStorage.setItem(NEXT_RECOVERY_KEY, serialized);
      recoverySetupRef.current = setup;
      setRecoverySetup(setup);
      setRecoveryRaw(serialized);
      setRecoveryAvailable(true);
    } catch (cause) {
      setRecoveryLoadError(cause instanceof Error
        ? `Unsaved draft recovery could not be written: ${cause.message}. Use Save setup or export JSON to keep another copy.`
        : "Unsaved draft recovery could not be written. Use Save setup or export JSON to keep another copy.");
    }
  }, [buildSavedSetup, draft, recoveryLoadError, recoveryMismatchReason, recoverySetupLoaded, savedSetupLoaded, slots.length]);

  const saveSetup = useCallback((replacePreserved = false): void => {
    const setup = buildSavedSetup();
    if (!setup || !savedSetupLoaded) {
      setSaveMessage("Wait for the current local draft to finish loading before saving.");
      return;
    }
    try {
      if (!replacePreserved && ((savedRaw && !savedSetup) || savedSetupMismatchReason)) {
        setSavedSetupError("The existing saved data is unreadable or incompatible. Export it and explicitly clear it before saving a replacement.");
        return;
      }
      const serialized = JSON.stringify(setup);
      window.localStorage.setItem(NEXT_STORAGE_KEY, serialized);
      setSavedRaw(serialized);
      setSavedSetup(setup);
      setSavedSetupError(null);
      setSaveMessage("Saved this Next setup in this browser. Legacy Senkei strategies remain separate.");
    } catch (cause) {
      setSavedSetupError(cause instanceof Error ? `The Next setup could not be saved: ${cause.message}` : "The Next setup could not be saved in this browser.");
    }
  }, [buildSavedSetup, savedSetupLoaded, savedRaw, savedSetup, savedSetupMismatchReason]);

  const restoreSetup = useCallback((): void => {
    if (!savedSetup || savedSetupMismatchReason) return;
    draftRef.current = savedSetup.draft;
    setDraft(savedSetup.draft);
    setSlots([...savedSetup.slots]);
    setRivalSlots([...savedSetup.rival_slots]);
    setFormationShape(savedSetup.formation_shape);
    setEntryMode(savedSetup.campaign_scenario_id ? "campaign" : "quick");
    if (savedSetup.campaign_scenario_id && campaignScenarios.some((scenario) => scenario.id === savedSetup.campaign_scenario_id)) {
      setSelectedScenarioId(savedSetup.campaign_scenario_id);
    }
    setActiveSlot(0);
    setCompilation(null);
    setPrepared(null);
    setExactRun(null);
    setSelectedEntityId(null);
    setTab("formation");
    setError(null);
    setSaveMessage("Restored the saved Next setup. Compile its Jinrei source before launching a new battle.");
  }, [campaignScenarios, savedSetup, savedSetupMismatchReason]);

  const clearSavedSetup = useCallback((): void => {
    try {
      window.localStorage.removeItem(NEXT_STORAGE_KEY);
      setSavedRaw(null);
      setSavedSetup(null);
      setSavedSetupError(null);
      setSaveMessage("Cleared the local Next setup copy.");
    } catch (cause) {
      setSavedSetupError(cause instanceof Error ? `The saved setup could not be cleared: ${cause.message}` : "The saved setup could not be cleared.");
    }
  }, []);

  const clearRecoveryCopy = useCallback((): void => {
    try {
      window.localStorage.removeItem(NEXT_RECOVERY_KEY);
      setRecoveryRaw(null);
      recoverySetupRef.current = null;
      setRecoverySetup(null);
      setRecoveryLoadError(null);
      setRecoveryRestored(false);
      setRecoveryAvailable(false);
      setSaveMessage("Cleared the previous recovery copy. The current draft will be captured as a new recovery copy.");
    } catch (cause) {
      setRecoveryLoadError(cause instanceof Error
        ? `The recovery copy could not be cleared: ${cause.message}`
        : "The recovery copy could not be cleared.");
    }
  }, []);

  const exportSetup = useCallback((setup: SavedNextSetup, filename: string): void => {
    const blob = new Blob([JSON.stringify(setup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }, []);

  const exportCurrentSetup = useCallback((): void => {
    const setup = buildSavedSetup();
    if (!setup) {
      setSaveMessage("The current Next setup is not ready to export.");
      return;
    }
    exportSetup(setup, `senkei-next-${setup.ruleset.digest.slice(0, 12)}.json`);
    setSaveMessage("Exported the current Next setup as JSON.");
  }, [buildSavedSetup, exportSetup]);

  const exportSavedSetup = useCallback((): void => {
    if (!savedSetup) return;
    exportSetup(savedSetup, `senkei-next-saved-${savedSetup.ruleset.digest.slice(0, 12)}.json`);
    setSaveMessage("Exported the saved Next setup as JSON.");
  }, [exportSetup, savedSetup]);

  const exportRawSetup = useCallback((kind: "saved" | "recovery"): void => {
    const raw = kind === "saved" ? savedRaw : recoveryRaw;
    if (raw === null) return;
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `senkei-next-${kind}-preserved.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setSaveMessage(`Exported the preserved ${kind} data without changing it.`);
  }, [savedRaw, recoveryRaw]);

  const restoreRecovery = useCallback((): void => {
    if (!recoverySetup || recoveryMismatchReason) return;
    draftRef.current = recoverySetup.draft;
    setDraft(recoverySetup.draft);
    setSlots([...recoverySetup.slots]);
    setRivalSlots([...recoverySetup.rival_slots]);
    setFormationShape(recoverySetup.formation_shape);
    setEntryMode(recoverySetup.campaign_scenario_id ? "campaign" : "quick");
    if (recoverySetup.campaign_scenario_id && campaignScenarios.some((scenario) => scenario.id === recoverySetup.campaign_scenario_id)) {
      setSelectedScenarioId(recoverySetup.campaign_scenario_id);
    }
    setCompilation(null);
    setPrepared(null);
    setExactRun(null);
    setRecoveryRestored(true);
    setScreen("ready");
    setError(null);
    setSaveMessage("Recovered this unsaved draft. Recompile and validate before launch.");
  }, [campaignScenarios, recoverySetup, recoveryMismatchReason]);

  const importSetupFile = useCallback(async (file: File, confirmed = false): Promise<void> => {
    try {
      const parsed = parseSavedNextSetup(JSON.parse(await file.text()) as unknown);
      if (!parsed) throw new Error("This file is not a supported Next setup.");
      if (!confirmed && savedRaw !== null && !window.confirm("Import replaces the pinned Next restore point. Export the existing copy first if needed. Continue?")) return;
      setSavedSetup(parsed);
      setSavedSetupError(null);
      setSaveMessage("Imported a Next setup. Check its ruleset status, then restore it when compatible.");
      try {
        const serialized = JSON.stringify(parsed);
        window.localStorage.setItem(NEXT_STORAGE_KEY, serialized);
        setSavedRaw(serialized);
      } catch (cause) {
        setSavedSetupError(cause instanceof Error
          ? `The setup is imported for this session, but browser storage failed: ${cause.message}`
          : "The setup is imported for this session, but browser storage is unavailable.");
      }
    } catch (cause) {
      setSavedSetupError(cause instanceof Error ? `The setup file could not be imported: ${cause.message}` : "The setup file could not be imported.");
    }
  }, [savedRaw]);

  const refreshStarterTactics = useCallback((before: readonly FormationSlot[], after: readonly FormationSlot[]): void => {
    const currentDraft = draftRef.current;
    if (!currentDraft || stableKey(before) === stableKey(after)) return;
    let nextDraft = currentDraft;
    if (packageValue && currentDraft.program_input.kind === "text" &&
        currentDraft.program_input.source === createStarterJinrei(packageValue, "attacker", before)) {
      nextDraft = {
        ...currentDraft,
        program_input: { kind: "text" as const, source: createStarterJinrei(packageValue, "attacker", after) },
      };
    }
    nextDraft = reviseDraft(currentDraft, nextDraft);
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  }, [packageValue]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    const compactViewport = window.matchMedia("(max-width: 760px)");
    const syncMapContext = () => setBattleMapContextOpen(!compactViewport.matches);
    syncMapContext();
    compactViewport.addEventListener("change", syncMapContext);
    return () => compactViewport.removeEventListener("change", syncMapContext);
  }, []);

  useEffect(() => {
    if (!run) {
      setPlayer(null);
      setDisplayState(null);
      setIsPlaying(false);
      return;
    }
    const replayPlayer = new ReplayPlayer(run.graphicsReplay);
    setPlayer(replayPlayer);
    setDisplayState(replayPlayer.state);
    setIsPlaying(false);
    const unsubscribe = replayPlayer.subscribe(() => {
      setDisplayState(replayPlayer.state);
      setIsPlaying(replayPlayer.playing);
    });
    return () => {
      unsubscribe();
      replayPlayer.pause();
    };
  }, [run]);

  useEffect(() => {
    if (!player || !isPlaying) return;
    let last = performance.now();
    let animationFrame = 0;
    const advance = (now: number) => {
      player.advance(document.hidden ? 0 : Math.max(0, Math.min(250, now - last)));
      last = now;
      animationFrame = requestAnimationFrame(advance);
    };
    animationFrame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, player]);

  useEffect(() => {
    if (!active || tab !== "battle" || screen !== "workspace") player?.pause();
  }, [active, player, tab, screen]);

  useEffect(() => {
    const host = rendererHost.current;
    if (!host || !run || !player) return;
    let current: BattlefieldRenderer | null = null;
    setRendererError(null);
    const handleRendererFailure = (message: string) => {
      player.pause();
      setRendererError(message);
    };
    try {
      current = new Battlefield(host, run.graphicsReplay, selectBattleEntity, handleRendererFailure);
      renderer.current = current;
      current.setPresentationMode(presentationMode);
      current.setInformationLayers(informationLayers);
      current.setPixel(pixel);
      current.update(player.state, player.playing);
      current.select(selectedEntityId);
      current.setCameraMode(cameraMode);
    } catch (cause) {
      handleRendererFailure(cause instanceof Error ? cause.message : "The 3D renderer could not start.");
    }
    return () => {
      current?.dispose();
      if (renderer.current === current) renderer.current = null;
    };
  }, [player, rendererAttempt, run]);

  useEffect(() => { renderer.current?.setPresentationMode(presentationMode); }, [presentationMode]);
  useEffect(() => { renderer.current?.setInformationLayers(informationLayers); }, [informationLayers]);

  const retryRenderer = useCallback(() => {
    setRendererError(null);
    setRendererAttempt((attempt) => attempt + 1);
  }, []);

  useEffect(() => {
    renderer.current?.update(displayState ?? { tick: 0, entities: {}, cues: [], result: null }, isPlaying);
    renderer.current?.select(selectedEntityId);
  }, [displayState, isPlaying, selectedEntityId]);

  useEffect(() => {
    const current = renderer.current;
    if (!current) return;
    if (focusedReplayPoint && player?.state.tick === focusedReplayPoint.tick) {
      current.focusPoint(focusedReplayPoint.point);
      return;
    }
    if (followedEntityId) {
      current.setTracking(followedEntityId);
      return;
    }
    if (followedSquadId) {
      if (followedSquadMembers.length) current.setTrackingGroup(followedSquadMembers);
      else setFollowedSquadId(null);
      return;
    }
    current.setCameraMode(cameraMode);
  }, [cameraMode, followedEntityId, followedSquadId, followedSquadMemberKey, focusedReplayPoint, player, rendererAttempt, run]);

  useEffect(() => {
    if (followedEntityId && !visibleCameraTargets.some((target) => target.id === followedEntityId)) {
      setFollowedEntityId(null);
    }
  }, [followedEntityId, visibleCameraTargets]);

  useEffect(() => {
    if (selectedEntityId && !visibleCameraTargets.some((entity) => entity.id === selectedEntityId)) {
      setSelectedEntityId(null);
    }
  }, [selectedEntityId, visibleCameraTargets]);

  useEffect(() => { renderer.current?.setPixel(pixel); }, [pixel]);

  const changeSlot = useCallback((index: number, changes: Partial<FormationSlot>) => {
    const nextSlots = slots.map((slot, slotIndex) => slotIndex === index ? { ...slot, ...changes } : slot);
    refreshStarterTactics(slots, nextSlots);
    setSlots(nextSlots);
    if ("squad" in changes || "node" in changes) setFormationShape("custom");
    setError(null);
  }, [refreshStarterTactics, slots]);

  const updateDraft = useCallback((next: SenkeiDraft | null): void => {
    const revised = next ? reviseDraft(draftRef.current, next) : null;
    draftRef.current = revised;
    setDraft(revised);
    setError(null);
    setRuntimeFailure(null);
  }, []);

  const updateFoundationSource = useCallback((source: string): void => {
    const current = draftRef.current;
    if (!current || (current.program_input.kind === "text" && current.program_input.source === source)) return;
    updateDraft({ ...current, program_input: { kind: "text", source } });
  }, [updateDraft]);

  const compileTactics = useCallback(async (input: TacticalInput): Promise<CompileOutcome> => {
    if (!core) throw new Error("The local Rust core is still loading.");
    const current = draftRef.current;
    if (!current) throw new Error("Create a formation before compiling Jinrei.");
    if (!editorCatalogMatchesRuleset(editorCatalog, packageValue)) {
      throw new Error(editorCatalogError ?? "The selected Ruleset and Senritsu Domain Catalog identities do not match.");
    }
    if (!packageValue || input.ruleset_ref.id !== packageValue.ruleset.id
      || input.ruleset_ref.version.major !== packageValue.ruleset.version.major
      || input.ruleset_ref.version.minor !== packageValue.ruleset.version.minor
      || input.ruleset_ref.version.patch !== packageValue.ruleset.version.patch
      || input.ruleset_ref.digest !== packageValue.ruleset.digest) {
      throw new Error("This Jinrei draft targets a different RulePackage than the selected Catalog.");
    }
    const key = stableKey({ draft: current, slots, catalog: catalogStamp(editorCatalog) });
    let result: CompileOutcome;
    if (input.kind === "text") {
      if (editorCompileRevision.current >= Number.MAX_SAFE_INTEGER) {
        throw new Error("The editor compile revision space is exhausted. Reload the workspace before compiling again.");
      }
      const revision = ++editorCompileRevision.current;
      const stamp = catalogStamp(editorCatalog);
      const envelope = await core.editorCompile({ source: input.source, stamp, revision });
      if (envelope.revision !== revision || !sameCatalog(stamp, envelope.reply.stamp)) {
        throw new Error("Jinrei compiler response does not match the selected Catalog revision.");
      }
      if (envelope.reply.status === "rejected") {
        const { code, message, path } = envelope.reply.error;
        throw new PreflightProblem(`${code}${path ? ` at ${path}` : ""}: ${message}`, "invalid");
      }
      result = envelope.reply.result;
    } else {
      result = await core.compile(input);
    }
    if (!draftRef.current || stableKey(draftRef.current) !== stableKey(current)) {
      throw new Error("Jinrei changed while the local compiler was running. Compile the current version again.");
    }
    setCompilation({ key, result });
    setError(null);
    return result;
  }, [core, editorCatalog, editorCatalogError, packageValue, slots]);

  const onCatalogCompile = useCallback((result: CompileOutcome, key: string): void => {
    if (draftRef.current && editorCatalogMatchesRuleset(editorCatalog, packageValue)
      && stableKey({ draft: draftRef.current, slots, catalog: catalogStamp(editorCatalog) }) === key) {
      setCompilation({ key, result });
      setError(null);
    }
  }, [editorCatalog, packageValue, slots]);

  const prepareBattle = async (): Promise<SimulationSnapshot> => {
    if (!core || !packageValue || !nextRules || !draft || !editorCatalogMatchesRuleset(editorCatalog, packageValue)) {
      throw new PreflightProblem(editorCatalogError ?? "Core / RulePackage / Catalog が未準備です。読込後に再試行してください。", "unverified");
    }
    const campaignScenario = entryMode === "campaign" ? selectedScenario : null;
    if (entryMode === "campaign" && (!campaignScenario || !unlockedScenarioSet.has(campaignScenario.id))) {
      throw new PreflightProblem("選択したCampaign Challengeは未解除か、現在のRulesetでは利用できません。", "invalid");
    }
    const key = launchKey;
    if (exactRun) {
      if (!sameRulesetRef(exactRun.snapshot.attacker.ruleset, packageValue.ruleset)) {
        throw new PreflightProblem("The original match RulePackage differs from the current package. Preserve/export the draft and use a compatible package.", "invalid");
      }
      await core.preflight(exactRun.snapshot);
      if (launchKeyRef.current !== key) throw new PreflightProblem("再戦対象が変更されました。再検証してください。", "unverified");
      setPrepared({ key, snapshot: exactRun.snapshot });
      return exactRun.snapshot;
    }
    const playerCompilation = activeCompilation ?? await compileTactics(draft.program_input.kind === "text"
      ? { kind: "text", source: draft.program_input.source, ruleset_ref: draft.ruleset }
      : { kind: "structured_ast", ast: draft.program_input.ast, ruleset_ref: draft.ruleset });
    const rivalDraft = campaignScenario?.npc ?? createTacticDraft(packageValue, nextRules, "defender");
    if (!sameRulesetRef(rivalDraft.ruleset, packageValue.ruleset) || stableKey(rivalDraft.schema_version) !== stableKey(packageValue.model_version)) {
      throw new PreflightProblem("The selected opponent draft belongs to a different RulePackage or schema.", "invalid");
    }
    let rivalProgram: SenkeiSnapshot["program"];
    if (campaignScenario) {
      const input: TacticalInput = rivalDraft.program_input.kind === "text"
        ? { kind: "text", source: rivalDraft.program_input.source, ruleset_ref: rivalDraft.ruleset }
        : { kind: "structured_ast", ast: rivalDraft.program_input.ast, ruleset_ref: rivalDraft.ruleset };
      rivalProgram = (await core.compile(input)).program;
    } else {
      const rivalSource = createStarterJinrei(packageValue, "defender", rivalSlots);
      const revision = ++editorCompileRevision.current;
      const stamp = catalogStamp(editorCatalog);
      const envelope = await core.editorCompile({ source: rivalSource, stamp, revision });
      if (envelope.revision !== revision || !sameCatalog(stamp, envelope.reply.stamp)) throw new Error("NPC compiler identity mismatch.");
      if (envelope.reply.status === "rejected") throw new PreflightProblem(`${envelope.reply.error.code}: ${envelope.reply.error.message}`, "invalid");
      rivalProgram = envelope.reply.result.program;
    }
    const attacker = makeSideSnapshot(draft, playerCompilation.program, slots);
    const opponentSlots = campaignScenario && nextRules ? scenarioFormation(campaignScenario, nextRules) : rivalSlots;
    const defender = makeSideSnapshot(rivalDraft, rivalProgram, opponentSlots);
    const context = await core.newMatchContext(packageValue.ruleset, stableMatchId({ ruleset: packageValue.ruleset, scenario_id: campaignScenario?.id ?? null, attacker, defender }));
    const snapshot = { attacker, defender, context };
    await core.preflight(snapshot);
    if (launchKeyRef.current !== key) throw new PreflightProblem("設定が変更されました。現在の設定を再検証してください。", "unverified");
    setPrepared({ key, snapshot });
    return snapshot;
  };

  const checkReadiness = async (): Promise<void> => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setChecking(true);
    setPreflightFailure(null);
    setPrepared(null);
    setError(null);
    const key = launchKey;
    try { await prepareBattle(); }
    catch (cause) { setPreflightFailure({ key, message: cause instanceof Error ? cause.message : String(cause), status: preflightFailureStatus(cause) }); }
    finally { operationInFlight.current = false; setChecking(false); }
  };

  const launchBattle = async (): Promise<void> => {
    if (operationInFlight.current || !core || !packageValue || !readySnapshot) return;
    operationInFlight.current = true;
    setBusy(true);
    setScreen("running");
    setError(null);
    setRendererError(null);
    try {
      const snapshot = readySnapshot;
      const setup = exactRun?.setup ?? buildSavedSetup();
      if (!setup) throw new Error("The launch draft is unavailable. Return to Ready and validate again.");
      const diagnosticsRequested = exactRun?.includeDiagnostics ?? includeDiagnostics;
      const estimatedCU = exactRun?.estimatedCU ?? activeCompilation?.estimated_cu;
      if (estimatedCU === undefined) throw new Error("The original compile estimate is unavailable. Validate the current Draft before launch.");
      const response = await core.simulate(snapshot, {
        include_diagnostics: diagnosticsRequested,
        ...(diagnosticsRequested ? { diagnostics_side: "attacker" as const } : {}),
      });
      if (diagnosticsRequested && response.authorized_side !== "attacker") {
        throw new Error("The local Enbu did not confirm attacker authorization for the requested diagnostics.");
      }
      const sourceReplay = response.owner_replays?.attacker ?? response.outcome.presentation_replay;
      const graphicsReplay = presentationToGraphics(sourceReplay, packageValue, response.outcome.result, snapshot.context.versions.engine);
      if (setup.campaign_scenario_id && response.outcome.result.outcome === "attacker_victory" &&
          response.outcome.result.termination_reason === "base_destroyed") {
        const completedIndex = campaignScenarios.findIndex((scenario) => scenario.id === setup.campaign_scenario_id);
        const nextScenario = completedIndex >= 0 ? campaignScenarios[completedIndex + 1] : undefined;
        const nextUnlocked = new Set(unlockedScenarioIds);
        nextUnlocked.add(setup.campaign_scenario_id);
        if (nextScenario) nextUnlocked.add(nextScenario.id);
        setUnlockedScenarioIds([...nextUnlocked]);
      }
      setBaselineRun(run);
      setRun({ experimentId: newExperimentId(snapshot.context.match_id), createdAt: new Date().toISOString(), snapshot, response, sourceReplay, graphicsReplay, setup, includeDiagnostics: diagnosticsRequested, estimatedCU });
      setExactRun(null);
      setSelectedEntityId(null);
      setCameraMode("tactical");
      setFollowedEntityId(null);
      setFollowedSquadId(null);
      setFocusedReplayPoint(null);
      setBattleMobileView("battle");
      setTab("battle");
      setScreen("workspace");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local Next battle could not be launched.");
      setPrepared(null);
      setScreen("ready");
    } finally { operationInFlight.current = false; setBusy(false); }
  };

  const rematch = (): void => { setExactRun(null); if (run) setScreen("ready"); };

  const editScreen = (target: AtelierScreen | "jinrei"): void => {
    setExactRun(null);
    setScreen("workspace");
    setTab(target === "jinrei" ? "jinrei" : "formation");
    if (target === "jinrei") setJinreiScreen("workbench");
    else setAtelierScreen(target);
  };

  const openLibrary = (view: "library" | "recovery" = "library"): void => {
    if (screen !== "resume") setLibraryReturn(screen);
    setLibraryView(view);
    setScreen("resume");
  };

  const applySquadPattern = useCallback((sizes: readonly number[]): void => {
    if (sizes.reduce((sum, size) => sum + size, 0) !== slots.length || slots.length !== 5) return;
    let offset = 0;
    const nextSlots = sizes.flatMap((size, groupIndex) => {
      const members = slots.slice(offset, offset + size);
      offset += size;
      const node = members[0]?.node;
      return members.map((slot) => ({ ...slot, squad: `squad-${groupIndex + 1}`, node: node ?? slot.node }));
    });
    refreshStarterTactics(slots, nextSlots);
    setSlots(nextSlots);
    setFormationShape("custom");
    setError(null);
  }, [refreshStarterTactics, slots]);

  const moveSquad = useCallback((squad: string, node: string): void => {
    const nextSlots = slots.map((slot) => slot.squad === squad ? { ...slot, node } : slot);
    refreshStarterTactics(slots, nextSlots);
    setSlots(nextSlots);
    setFormationShape("custom");
    setError(null);
  }, [refreshStarterTactics, slots]);

  const runOutcome: SimulationOutcome | null = run?.response.outcome ?? null;
  const runResult: MatchResult | null = runOutcome?.result ?? null;
  const frameEvents = selectedFrame?.events ?? [];
  const timelineEvents = run?.graphicsReplay.timeline ?? [];
  const contextualTimelineEvents = useMemo(() => {
    if (timelineEvents.length === 0) return [];
    const tick = displayState?.tick ?? 0;
    const pivot = timelineEvents.findIndex((event) => event.tick >= tick);
    const center = pivot < 0 ? timelineEvents.length - 1 : pivot;
    const start = Math.max(0, Math.min(timelineEvents.length - 180, center - 90));
    return timelineEvents.slice(start, start + 180);
  }, [displayState?.tick, timelineEvents]);
  useEffect(() => {
    if (battleMobileView !== "timeline") return;
    const rows = mobileTimelineRef.current?.querySelectorAll<HTMLElement>("[data-event-tick]");
    if (!rows?.length) return;
    const tick = displayState?.tick ?? 0;
    const currentRow = [...rows].reduce((nearest, row) => {
      const distance = Math.abs(Number(row.dataset.eventTick) - tick);
      const nearestDistance = Math.abs(Number(nearest.dataset.eventTick) - tick);
      return distance < nearestDistance ? row : nearest;
    });
    currentRow.scrollIntoView({ block: "nearest" });
  }, [battleMobileView, displayState?.tick, contextualTimelineEvents]);
  const sceneBounds = run?.graphicsReplay.scene.bounds ?? null;
  const miniMapPoint = (point: WorldPoint): WorldPoint => {
    if (!sceneBounds) return { x: 0, y: 0 };
    const width = Math.max(0.001, sceneBounds.max.x - sceneBounds.min.x);
    const height = Math.max(0.001, sceneBounds.max.y - sceneBounds.min.y);
    return { x: 8 + ((point.x - sceneBounds.min.x) / width) * 104, y: 8 + ((point.y - sceneBounds.min.y) / height) * 64 };
  };
  const miniMapEntityPoint = (entity: DisplayState["entities"][string]): WorldPoint => {
    const point = entity.position;
    const logical = entity.battlefield;
    if (!logical?.edgeTo || (logical.track !== "LEFT" && logical.track !== "RIGHT")) return miniMapPoint(point);
    const nodes = run?.graphicsReplay.scene.nodes ?? [];
    const from = nodes.find(node => node.id === logical.node)?.position;
    const to = nodes.find(node => node.id === logical.edgeTo)?.position;
    const edge = (run?.graphicsReplay.scene.routes ?? []).find(route => {
      if (route.points.length < 2 || !from || !to) return false;
      const first = route.points[0], last = route.points[route.points.length - 1];
      return (first.x === from.x && first.y === from.y && last.x === to.x && last.y === to.y) ||
        (last.x === from.x && last.y === from.y && first.x === to.x && first.y === to.y);
    });
    if (!from || !to || edge?.region !== "lane" || edge.bridgeSite || logical.crossing === "bridge") return miniMapPoint(point);
    const tangent = nearestPolylineTangent(edge.points, point, { x: to.x - from.x, y: to.y - from.y });
    if (!tangent) return miniMapPoint(point);
    const direction = logical.crossing === "track" ? 0 : logical.track === "LEFT" ? -1 : 1;
    const offset = (run?.graphicsReplay.scene.trackOffset ?? 0.8) * direction;
    return miniMapPoint({ x: point.x + tangent.y * offset, y: point.y - tangent.x * offset });
  };
  const miniMapBases = (run?.graphicsReplay.scene.baseSites ?? []).map((base) => ({
    id: base.side === "azure" ? "attacker" : "defender",
    label: base.side === "azure" ? "A" : "D",
    position: base.position,
  }));
  const setBattleView = (view: BattlefieldMobileView): void => {
    setBattleMobileView(view);
    if (view === "timeline") player?.pause();
    if (view === "battle" || view === "overview") {
      setBattleRosterOpen(false);
      setBattleInspectorOpen(false);
      const nextMode = view === "overview" ? "overview" : "tactical";
      setCameraMode(nextMode);
      setFollowedEntityId(null);
      setFollowedSquadId(null);
      setFocusedReplayPoint(null);
      renderer.current?.setCameraMode(nextMode);
    }
  };
  const closeBattleSheet = (): void => setBattleMobileView(cameraMode === "overview" ? "overview" : "battle");
  const followVisibleEntity = (id: string): void => {
    setSelectedEntityId(id);
    setBattleMobileView("battle");
    setBattleInspectorOpen(false);
    setBattleRosterOpen(false);
    setCameraMode("tactical");
    setFollowedEntityId(id);
    setFollowedSquadId(null);
    setFocusedReplayPoint(null);
  };
  const followVisibleSquad = (id: string): void => {
    setBattleMobileView("battle");
    setCameraMode("tactical");
    setFollowedEntityId(null);
    setFollowedSquadId(id);
    setFocusedReplayPoint(null);
  };
  const captureAnalysisContext = (): BattleAnalysisContext | null => {
    if (!run) return null;
    const state = player?.state ?? displayState;
    const tick = state?.tick ?? 0;
    const entity = selectedEntityId ? state?.entities[selectedEntityId] : null;
    return { experimentId: run.experimentId, matchId: run.response.outcome.result.match_id,
      perspective: run.graphicsReplay.header.view, tick,
      entityId: entity && !entity.destroyed && entity.hp > 0 ? selectedEntityId : null,
      event: replayEventSelection?.experimentId === run.experimentId && replayEventSelection.tick === tick
        ? { tick, order: replayEventSelection.order } : null, trace: null };
  };
  const openAnalysis = (): void => {
    player?.pause(); setAnalysisSource(null); setAnalysisContext(captureAnalysisContext()); setTab("analysis");
  };
  const traceSourceStatus = (entry: DiagnosticEvent): { available: boolean; reason: string } => {
    if (!run || entry.side !== "attacker" || !run.response.restricted_diagnostics?.events.includes(entry)) return { available: false, reason: "No authorized original Run diagnostic." };
    if (!entry.action_id) return { available: false, reason: "This diagnostic has no associated Action." };
    if (runSourceProof?.experimentId !== run.experimentId || !runSourceProof.map) return { available: false, reason: runSourceProof?.experimentId === run.experimentId ? runSourceProof.reason : "Original source correspondence has not been checked." };
    const source = run.setup.draft.program_input;
    const range = source.kind === "text" ? actionSourceRange(source.source, runSourceProof.map, entry.action_id) : null;
    if (!range) return { available: false, reason: "No unique parser source location for this Action." };
    const matches = source.kind === "text" && draft?.program_input.kind === "text" && draft.program_input.source === source.source
      && activeCompilation?.program.content_digest === run.snapshot.attacker.program.content_digest;
    return { available: true, reason: matches ? "Verified original Action source; current source and Program match." : "Original Action source is available. Current Draft differs; precise editor jump is disabled." };
  };
  const inspectTraceSource = (entry: DiagnosticEvent): void => {
    if (!run || !traceSourceStatus(entry).available || !entry.action_id || !runSourceProof?.map || run.setup.draft.program_input.kind !== "text") return;
    const range = actionSourceRange(run.setup.draft.program_input.source, runSourceProof.map, entry.action_id);
    const origin = analysisContext?.experimentId === run.experimentId ? analysisContext : captureAnalysisContext();
    if (!range || !origin) return;
    const context = { ...origin, trace: { tick: entry.tick, sequence: entry.sequence } };
    setAnalysisContext(context);
    setAnalysisSource({ identity: `${run.experimentId}:${entry.sequence}:${++sourceRequestSequence.current}`, context, actionId: entry.action_id,
      programDigest: run.snapshot.attacker.program.content_digest, source: run.setup.draft.program_input.source, range });
    editScreen("jinrei");
  };
  const inspectReplayEvent = (event: GraphicsEvent): void => {
    if (run && run.graphicsReplay.timeline.includes(event)) setReplayEventSelection({ experimentId: run.experimentId, tick: event.tick, order: event.order });
    player?.pause();
    player?.seek(event.tick);
    const entityId = event.type === "spawn" ? event.entity.id : "entityId" in event ? event.entityId : null;
    const point = event.type === "move"
      ? event.position
      : event.type === "spawn"
        ? event.entity.position
        : entityId ? player?.state.entities[entityId]?.position ?? null : null;
    setSelectedEntityId(entityId);
    setBattleView("battle");
    if (point) setFocusedReplayPoint({ tick: event.tick, point });
    setTab("battle");
  };
  const renderVisibleEntityClusters = (surface: "mobile" | "desktop"): ReactElement => (
    <div className="next-visible-clusters" ref={surface === "mobile" ? mobileVisibleClustersRef : desktopVisibleClustersRef}>
      {visibleEntityClusters.length ? visibleEntityClusters.map((cluster) => {
        const expanded = expandedVisibleClusterId === cluster.id;
        const counts = new Map<string, number>();
        for (const entity of cluster.entities) counts.set(entity.category, (counts.get(entity.category) ?? 0) + 1);
        const composition = [...counts.entries()].map(([category, count]) => `${count} ${pluralizeEntityCategory(category, count)}`).join(" · ");
        const location = `X ${Math.round(cluster.position.x * NEXT_WORLD_UNITS_PER_RENDER_UNIT)} · Y ${Math.round(cluster.position.y * NEXT_WORLD_UNITS_PER_RENDER_UNIT)}`;
        const nearbyLabel = `${cluster.entities.length} nearby visible entities`;
        const countLabel = cluster.entities.length === 1
          ? "1 visible entity"
          : cluster.coLocated ? `${cluster.entities.length} at same position` : nearbyLabel;
        const clusterDescription = cluster.coLocated
          ? `at replay location ${location}`
          : `near World ${location}`;
        const clusterAnnotation = cluster.coLocated
          ? location
          : `near ${location} · each unit keeps its own position`;
        return <section className={`next-visible-cluster${expanded ? " is-expanded" : ""}`} key={cluster.id}>
          <button aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} ${cluster.entities.length} ${cluster.entities.length === 1 ? "visible entity" : cluster.coLocated ? "entities at the same replay position" : "nearby visible entities"} ${clusterDescription}`} className="next-visible-cluster-toggle" onClick={() => setExpandedVisibleClusterId(expanded ? null : cluster.id)} type="button">
            <span><strong>{countLabel}</strong><small>{composition} · {clusterAnnotation}</small></span><b aria-hidden="true">{expanded ? "−" : "+"}</b>
          </button>
          {expanded && <ul className="next-visible-cluster-entities">{cluster.entities.map((entity) => <li className={selectedEntityId === entity.id ? "is-selected" : ""} key={entity.id}>
            <div className="next-visible-entity-copy"><strong>{entity.identity}</strong><span>{entity.category} · {entity.role} · {entity.side}</span><div>{entity.healthLabel && <b>{entity.healthLabel}</b>}<small>ID {entity.id} · X {Math.round(entity.position.x * NEXT_WORLD_UNITS_PER_RENDER_UNIT)} · Y {Math.round(entity.position.y * NEXT_WORLD_UNITS_PER_RENDER_UNIT)}</small></div></div>
            <div className="next-visible-entity-actions"><button aria-label={`Select ${entity.identity}, replay entity ${entity.id}`} aria-pressed={selectedEntityId === entity.id} onClick={() => {
              selectBattleEntity(entity.id);
              setBattleInspectorOpen(true);
              setBattleRosterOpen(false);
            }} type="button">Select</button><button aria-label={`Follow ${entity.identity}, replay entity ${entity.id}`} onClick={() => {
              followVisibleEntity(entity.id);
            }} type="button">Follow{entity.catalogId ? ` ${entity.catalogId}` : ""}</button></div>
          </li>)}</ul>}
        </section>;
      }) : <p className="next-empty-detail">No living entities are currently visible in this replay view.</p>}
    </div>
  );

  const library = <NextLibrary view={libraryView} onViewChange={setLibraryView}
    saved={savedSetup} recovery={recoverySetup} savedRaw={savedRaw} recoveryRaw={recoveryRaw} restoreDifferences={restoreDifferences}
    savedError={savedSetupError} recoveryError={recoveryLoadError}
    runtimeError={rulesetError ?? editorCatalogError ?? rendererError ?? error ?? runtimeFailure ?? currentPreflightError?.message}
    savedMismatch={savedSetupMismatchReason} recoveryMismatch={recoveryMismatchReason}
    message={saveMessage} loaded={savedSetupLoaded && recoverySetupLoaded} canSave={Boolean(draft && packageValue)}
    onSave={() => saveSetup(true)} onRestoreSaved={() => { restoreSetup(); setScreen("ready"); }} onRestoreRecovery={restoreRecovery}
    onExportCurrent={exportCurrentSetup} onExportSaved={exportSavedSetup}
    onExportRecovery={() => { if (recoverySetup) exportSetup(recoverySetup, "senkei-next-recovery.json"); }}
    onExportRawSaved={() => exportRawSetup("saved")} onExportRawRecovery={() => exportRawSetup("recovery")}
    onImport={file => importSetupFile(file, true)} onClearSaved={clearSavedSetup} onClearRecovery={clearRecoveryCopy}
    onRetryStorage={() => setStorageAttempt(attempt => attempt + 1)}
    onRetryCore={() => { setRuntimeFailure(null); setError(null); onRetryCore(); setCatalogAttempt(attempt => attempt + 1); }}
    onReady={() => { setExactRun(null); setScreen("ready"); }} onBack={() => setScreen(libraryReturn)}
    experiments={(experimentStore?.experiments ?? []).map((item) => {
      const scenario = campaignScenarios.find((candidate) => candidate.id === parseSavedNextSetup(item.setup)?.campaign_scenario_id);
      const result = item.response?.outcome?.result;
      return { id: item.id, created_at: item.created_at, scenario_title: scenario?.title ?? null,
        outcome: typeof result?.outcome === "string" ? result.outcome : "unverified",
        final_tick: Number.isSafeInteger(result?.final_tick) ? result.final_tick : null };
    })}
    experimentsLoaded={experimentStorageLoaded}
    canExportExperiments={experimentPreservedRaw !== null || Boolean(experimentStore?.experiments.length)}
    experimentsCompatible={Boolean(core && packageValue && experimentLoadedDigest === packageValue.ruleset.digest && !experimentMismatch)}
    experimentError={experimentError} experimentMismatch={experimentMismatch}
    onOpenExperiments={() => {
      if (!core || experimentLoadedDigest !== packageValue?.ruleset.digest || experimentMismatch || !run) throw new Error(experimentMismatch ?? "No compatible Next experiment is available.");
      setTab("analysis"); setScreen("workspace");
    }}
    onExportExperiments={() => {
      if (!experimentPreservedRaw && !experimentStore) throw new Error("There are no stored Next experiments to export.");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([experimentPreservedRaw ?? serializeNextExperimentStore(experimentStore!)], { type: "application/json" }));
      link.download = `senkei-next-experiments-${experimentPreservedRaw ? "preserved" : experimentStore!.ruleset_digest.slice(0, 12)}.json`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }}
    onImportExperiments={async (file) => {
      const request = ++experimentImportGeneration.current;
      const generation = experimentPersistGeneration.current;
      const runtime = experimentRuntime.current;
      if (!runtime.core || !runtime.packageValue?.next) throw new Error("Core and the current Next RulePackage are required to validate an import. Existing experiments were preserved.");
      const current = () => request === experimentImportGeneration.current && generation === experimentPersistGeneration.current
        && experimentRuntime.current.core === runtime.core && experimentRuntime.current.packageValue === runtime.packageValue;
      assertNextExperimentImportSize(file.size);
      const imported = parseNextExperimentStore(JSON.parse(await file.text()) as unknown);
      const restored = await prepareNextExperimentStore(imported, runtime.packageValue, runtime.core);
      await enqueueExperimentWrite(async () => {
        if (!current()) throw new Error("The runtime or completed Runs changed during import. Existing experiments were preserved; review the file again.");
        await saveNextExperimentStore(imported);
      });
      if (!current()) return;
      experimentPersistGeneration.current += 1;
      // A pending cold restore must not republish the records replaced by this successful import.
      experimentRestoreGeneration.current += 1;
      setExperimentStore(imported);
      setExperimentPreservedRaw(null);
      setRun(restored[0] ?? null); setBaselineRun(restored[1] ?? null); setExactRun(null);
      setExperimentMismatch(null); setExperimentError(null); setExperimentStorageLoaded(true);
      setExperimentLoadedDigest(runtime.packageValue.ruleset.digest);
    }}
    onClearExperiments={async () => {
      experimentRestoreGeneration.current += 1;
      const generation = ++experimentPersistGeneration.current;
      setExperimentLoadedDigest(null);
      await enqueueExperimentWrite(() => clearNextExperimentStore());
      if (generation !== experimentPersistGeneration.current) return;
      setExperimentStore(null); setExperimentPreservedRaw(null); setExperimentMismatch(null); setExperimentError(null);
      setRun(null); setBaselineRun(null); setExactRun(null);
      setExperimentLoadedDigest(packageValue?.ruleset.digest ?? null);
    }} />;

  if (screen === "resume" && (!packageValue || !nextRules)) return <section ref={workspaceHost} onKeyDown={tabKeys} className="next-workspace" data-screen={libraryView === "library" ? "S14" : "S15"}>{library}</section>;

  if (!packageValue || !nextRules) {
    return (
      <section ref={workspaceHost} className="next-workspace" aria-label="Next local battle workshop" data-screen="S00">
        <header className="next-heading">
          <div><span className="next-eyebrow">NEXT · LOCAL RULESET</span><h2>Battle <em>workbench</em></h2><p>Five heroes, authored Jinrei and a deterministic local replay.</p></div>
          <span className="next-heading-mark" aria-hidden="true">兵</span>
        </header>
        <div className={`next-load-state${rulesetError ? " is-error" : ""}`} role={rulesetError ? "alert" : "status"}>
          <span className="next-load-mark">{rulesetError ? "!" : "◌"}</span>
          <div><strong>{rulesetError ? "Next ruleset unavailable" : "Loading the local battle rules"}</strong><p>{rulesetError ?? "The app is requesting the bundled Next ruleset from the local Rust core."}</p><button type="button" onClick={onRetryCore}>読込を再試行</button><button type="button" onClick={() => openLibrary("recovery")}>保存・復旧へ</button></div>
        </div>
      </section>
    );
  }

  return (
    <section ref={workspaceHost} onKeyDown={tabKeys} data-screen={screen === "resume" ? libraryView === "library" ? "S14" : "S15" : screen === "home" ? "S01" : screen === "conditions" ? "S02" : screen === "preset" ? "S03" : screen === "ready" ? "S10" : screen === "running" ? "S11" : tab === "formation" ? ({ collection: "S04", detail: "S05", skills: "S06", squads: "S07" }[atelierScreen]) : tab === "jinrei" ? jinreiScreen === "coverage" ? "S09" : "S08" : tab === "battle" ? "S12" : "S13"} className={`next-workspace${tab === "battle" && screen === "workspace" ? " is-battle-workspace" : ""}`} aria-label="Next local battle workshop">
      {screen === "resume" && library}
      <header className="next-heading" hidden={screen === "resume"}>
        <div><span className="next-eyebrow">NEXT · {packageValue.ruleset.id} · LOCAL ENBU</span><h2>{screen === "workspace" ? <>Battle <em>workbench</em></> : <>Senkei <em>始める</em></>}</h2><p>5 Heroの戦型を準備し、ローカルPvEを実行する。</p></div>
        <div className="next-heading-status"><span className="next-live-dot" />REAL LOCAL SIMULATION<span className="next-heading-mark" aria-hidden="true">兵</span></div>
      </header>

      {error && <div className="next-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
      {campaignProgressError && <div className="next-error" role="alert"><span>{campaignProgressError}</span></div>}
      {editorCatalogError && <div className="next-error" role="alert"><span>Catalogを読み込めません：{editorCatalogError}</span><button type="button" onClick={() => setCatalogAttempt(attempt => attempt + 1)}>Catalogを再試行</button><button type="button" onClick={() => openLibrary("recovery")}>保存・復旧へ</button></div>}
      {rendererError && <div className="next-error next-renderer-error" role="alert"><span>{rendererError} Playback is paused at the current tick.</span><button type="button" onClick={retryRenderer}>Retry battlefield renderer</button></div>}

      <details className="next-save-disclosure" hidden={screen !== "workspace"} open={saveDetailsOpen} onToggle={(event) => setSaveDetailsOpen(event.currentTarget.open)}>
      <summary><strong>Save and recovery</strong><small>{recoveryLoadError ? "Recovery needs attention" : savedSetup ? "Pinned setup available" : "No pinned setup"} · opens local setup controls</small></summary>
      <section aria-label="Next setup save and restore" className="next-save-bar">
        <div className="next-save-summary"><span className="next-eyebrow">LOCAL NEXT DRAFT</span><strong>Saved setup and recovery copy</strong><small>Save setup pins a restore point; current edits are recovered separately after reload.</small></div>
        <div className="next-save-actions">
          <button disabled={!draft || !packageValue || !savedSetupLoaded} onClick={() => saveSetup()} type="button">Save setup</button>
          <button disabled={!canRestoreSavedSetup} onClick={() => openLibrary()} type="button">Restore saved</button>
          <button disabled={!draft || !packageValue} onClick={exportCurrentSetup} type="button">Export JSON</button>
          <button onClick={() => importFileInput.current?.click()} type="button">Import JSON</button>
          {savedSetup && <button onClick={exportSavedSetup} type="button">Export saved</button>}
          {(savedSetup || savedSetupError) && <button onClick={() => { if (window.confirm("Clear the pinned Next setup? Export it first if needed.")) clearSavedSetup(); }} type="button">Clear saved</button>}
          <input accept="application/json,.json" aria-label="Import a Next setup JSON file" hidden onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void importSetupFile(file);
          }} ref={importFileInput} type="file" />
        </div>
        {savedSetupError && <p className="next-save-message is-error" role="alert">{savedSetupError}</p>}
        {recoveryLoadError && <div className="next-save-message is-error" role="alert">{recoveryLoadError} <button className="next-inline-action" onClick={() => { if (window.confirm("Clear the preserved recovery copy? The current Draft remains open.")) clearRecoveryCopy(); }} type="button">Clear recovery copy</button></div>}
        {recoverySetupLoaded && recoveryMismatchReason && !recoveryLoadError && <div className="next-save-message is-error" role="alert">Unsaved recovery from {recoverySetup ? new Date(recoverySetup.saved_at).toLocaleString() : "a prior session"} belongs to a different ruleset or schema. It is preserved and not loaded. {recoveryMismatchReason} <button className="next-inline-action" onClick={() => { if (window.confirm("Clear the preserved recovery copy? The current Draft remains open.")) clearRecoveryCopy(); }} type="button">Discard incompatible recovery</button></div>}
        {!recoveryLoadError && !recoveryMismatchReason && recoveryAvailable && <p className="next-save-message" role="status">{recoveryRestored ? "Recovered this unsaved draft after reload; further edits continue to auto-save." : "Unsaved edits are automatically saved as a separate local recovery copy."}</p>}
        {savedSetup && <div className={`next-save-message${savedSetupMismatchReason ? " is-error" : ""}`} role={savedSetupMismatchReason ? "alert" : "status"}>
          {savedSetupMismatchReason
            ? <>Saved setup from {savedSetup.ruleset.id} · digest <code>{savedSetup.ruleset.digest}</code>. {savedSetupMismatchReason} It remains available to export or clear.</>
            : <>Saved setup from {new Date(savedSetup.saved_at).toLocaleString()} matches the current ruleset and can be restored.</>}
        </div>}
        {savedSetup && <details className="next-save-preview"><summary>Review saved setup · {savedSetup.slots.map((slot) => slot.catalog_id).join(" · ")}</summary><div><span>Rival: {savedSetup.rival_slots.map((slot) => slot.catalog_id).join(" · ")}</span><pre>{savedSetup.draft.program_input.kind === "text" ? savedSetup.draft.program_input.source : JSON.stringify(savedSetup.draft.program_input.ast, null, 2)}</pre></div></details>}
        {!savedSetup && !savedSetupError && saveMessage && <p className="next-save-message" role="status">{saveMessage}</p>}
        {!savedSetup && !savedSetupError && !saveMessage && <p className="next-save-message" role="status">{savedSetupLoaded ? "No Next setup is saved yet." : "Checking for a saved Next setup…"}</p>}
      </section>
      </details>

      {exactRun && screen === "ready" && <div className="next-exact-rematch" role="status"><strong>同条件再戦 · 元Runの確定Snapshot</strong><p>表示中の編成と戦術は元の試合のものです。編集中Draftは保持されています。</p><button type="button" onClick={() => setExactRun(null)}>現在のDraftで準備する</button></div>}
      <p className="journey-draft-status" hidden={screen === "workspace" && tab === "battle"}>{draft?.id} · {draftIsSaved ? "保存済み" : savedSetup ? "未保存の変更あり" : "未保存Draft"} · {activeCompilation ? "Compiled" : compilation ? "Compile失効" : "未コンパイル"}</p>
      <JourneyScreens screen={screen === "resume" ? "workspace" : screen} setScreen={next => next === "resume" ? openLibrary() : setScreen(next)} entryMode={entryMode} setEntryMode={setEntryMode}
        slots={exactRun?.setup.slots ?? slots} rivalSlots={exactRun?.setup.rival_slots ?? rivalSlots} nextRules={nextRules} packageValue={packageValue} draft={exactRun?.setup.draft ?? draft}
        ready={Boolean(readySnapshot)} checking={checking} failure={currentPreflightError}
        compiled={Boolean(exactRun || activeCompilation)} compilationCU={exactRun?.estimatedCU ?? activeCompilation?.estimated_cu ?? null} stale={Boolean(compilation && !activeCompilation)}
        coreReady={Boolean(core && editorCatalogMatchesRuleset(editorCatalog, packageValue))}
        includeDiagnostics={exactRun?.includeDiagnostics ?? includeDiagnostics} setIncludeDiagnostics={value => { setExactRun(null); setIncludeDiagnostics(value); }}
        check={() => void checkReadiness()} launch={() => void launchBattle()}
        edit={editScreen}
        recoveryRestored={recoveryRestored} saved={canRestoreSavedSetup}
        newPreset={() => {
          if (!nextRules || !packageValue) return;
          const playerSlots = defaultSlots(nextRules, "attacker", DEFAULT_HERO_IDS);
          setSlots(playerSlots); setRivalSlots(defaultSlots(nextRules, "defender", DEFAULT_RIVAL_IDS));
          setFormationShape("single"); updateDraft(createTacticDraft(packageValue, nextRules, "attacker"));
          setPrepared(null); setPreflightFailure(null); setScreen("preset");
        }} scenarios={campaignScenarios} selectedScenarioId={selectedScenario?.id ?? ""}
        onScenarioChange={selectCampaignScenario} unlockedScenarioIds={unlockedScenarioIds}
        latestScenarioFeedback={campaignFeedback} />
      <div className="journey-workspace" hidden={screen !== "workspace"}>
      <div className="journey-toolbar" hidden={tab === "battle"}><button type="button" onClick={() => setScreen("home")}>Homeへ戻る</button><button type="button" onClick={() => openLibrary()}>Library</button><span>Hero / Jinrei / Replay / Analysis</span><button hidden={tab === "jinrei"} type="button" onClick={() => { setExactRun(null); setScreen("ready"); }}>準備確認へ</button></div>
      <div className="next-layout">
        <nav className="next-tabs" aria-label="Next workbench" role="tablist">
          <div className="next-tabs-title"><span className="next-eyebrow">LOCAL WORKSPACE</span><strong>FIELD CONSOLE</strong></div>
          {TABS.map((item) => (
            <button
              aria-controls={`next-panel-${item.id}`}
              aria-selected={tab === item.id}
              className={`next-tab${tab === item.id ? " is-active" : ""}`}
              id={`next-tab-${item.id}`}
              key={item.id}
              onClick={() => item.id === "analysis" && tab === "battle" ? openAnalysis() : setTab(item.id)}
              role="tab"
              type="button"
            ><span>{item.number}</span><strong>{item.label}</strong><small>{item.id === "formation" ? "5 HEROES" : item.id === "jinrei" ? "TACTICS" : item.id === "battle" ? "REPLAY" : "TRACE"}</small></button>
          ))}
          <div className="next-ruleset-stamp"><span>RULESET</span><strong>{packageValue.ruleset.id}</strong><small>{packageValue.ruleset.version.major}.{packageValue.ruleset.version.minor}.{packageValue.ruleset.version.patch} · {nextRules.mechanics_version.major}.{nextRules.mechanics_version.minor}.{nextRules.mechanics_version.patch}</small></div>
        </nav>

        <div className="next-panel-wrap">
          <section aria-labelledby="next-tab-formation" className="next-panel" hidden={tab !== "formation"} id="next-panel-formation" role="tabpanel">
            <HeroAtelier nextRules={nextRules} slots={slots} activeSlot={activeSlot} screen={atelierScreen}
              onActiveSlotChange={setActiveSlot} onScreenChange={setAtelierScreen} onSlotChange={changeSlot}
              onSquadPattern={applySquadPattern} onMoveSquad={moveSquad}
              onReady={() => { setExactRun(null); setScreen("ready"); }} onJinrei={() => editScreen("jinrei")}
              canActivate={Boolean(packageValue.domain.capabilities.activate)}
              activateArgumentIds={packageValue.domain.capabilities.activate?.arguments.map(argument => argument.id) ?? []} />
          </section>

          <section aria-labelledby="next-tab-jinrei" className="next-panel next-jinrei-panel" hidden={tab !== "jinrei"} id="next-panel-jinrei" role="tabpanel">
            <JinreiWorkbench analysisSource={analysisSource?.context.experimentId === run?.experimentId ? analysisSource : null} onReturnToAnalysis={() => { if (analysisSource && analysisSource.context.experimentId === run?.experimentId) setAnalysisContext(analysisSource.context); setTab("analysis"); setScreen("workspace"); }} active={active && screen === "workspace" && tab === "jinrei"} core={core} ruleset={tacticsRuleset}
              catalog={editorCatalogMatchesRuleset(editorCatalog, packageValue) ? editorCatalog : null}
              catalogError={editorCatalogError} draft={draft} draftKey={compilerContextKey}
              compilation={activeCompilation} slots={slots} activeSlot={activeSlot}
              screen={jinreiScreen} onScreenChange={setJinreiScreen} onActiveSlotChange={setActiveSlot}
              onDraftChange={updateDraft} onSourceChange={updateFoundationSource}
              onCompile={async input => {
                try { const result = await compileTactics(input); setRuntimeFailure(null); return result; }
                catch (cause) { setRuntimeFailure(cause instanceof Error ? cause.message : String(cause)); throw cause; }
              }} onCompiled={onCatalogCompile}
              onReady={() => { setExactRun(null); setScreen("ready"); }} onFormation={() => editScreen("squads")} />
          </section>

          <section aria-labelledby="next-tab-battle" className="next-panel next-battle-panel" hidden={tab !== "battle" || screen !== "workspace"} id="next-panel-battle" role="tabpanel">
            <div className="next-panel-header next-battle-header"><div><span className="next-eyebrow">03 · LOCAL ENBU REPLAY</span><h3>Battlefield <em>console</em></h3><p>{run ? `${run.graphicsReplay.header.view === "attacker" ? "Local owner view" : "Public replay"} · Tick ${displayState?.tick ?? 0} / ${run.graphicsReplay.result.tick}` : "Launch a compiled local battle, then observe the confirmed replay."}</p></div><div className="next-battle-actions"><button aria-label="Battle situation details" aria-expanded={battleInspectorOpen} className="next-secondary-button next-desktop-inspector-toggle" disabled={!run} onClick={() => setBattleInspectorOpen(value => !value)} type="button">{battleInspectorOpen ? "Close details" : "Situation details"}</button><button className="next-secondary-button" disabled={!run || busy || !activeCompilation} onClick={rematch} type="button">{runIsCurrent ? "Rematch" : "Run revised battle"} <b>↻</b></button><button className="next-launch-button" disabled={busy || !activeCompilation} onClick={() => setScreen("ready")} type="button"><span>{busy ? "◌" : "▶"}</span>{busy ? "Running local core…" : run ? "New local battle" : "Launch local battle"}</button></div></div>
            <div className="next-battle-setup"><details className="next-battle-options"><summary>Replay access · {includeDiagnostics ? "owner diagnostics on" : "public replay only"}</summary><label className="next-diagnostic-toggle"><input checked={includeDiagnostics} onChange={(event) => setIncludeDiagnostics(event.target.checked)} type="checkbox" /><span className="next-checkbox" /><span><strong>Include my local replay and diagnostics</strong><small>Owner replay, visible Hero state, ability trace, intents and CU only</small></span></label></details>{displayState?.fog && <span className="next-fog-legend" role="note">Fog: dark unexplored · muted explored · clear visible · dashed site last observed</span>}<span className="next-match-badge">{runResult ? `MATCH ${runResult.match_id.slice(0, 16)}` : "READY WHEN JINREI IS COMPILED"}</span></div>
            <div className="next-battle-view-controls" aria-label="Replay presentation">
              <div className="next-battle-mode-control" role="group" aria-label="Presentation mode">
                <button aria-pressed={presentationMode === "tactical"} onClick={() => setPresentationMode("tactical")} type="button">Tactical</button>
                <button aria-pressed={presentationMode === "cinematic"} onClick={() => setPresentationMode("cinematic")} type="button">Cinematic</button>
              </div>
              <div className="next-battle-layer-control" role="group" aria-label="Information layers">
                <label><input checked={informationLayers.vision} onChange={(event) => { const checked = event.currentTarget.checked; setInformationLayers((layers) => ({ ...layers, vision: checked })); }} type="checkbox" /> Vision</label>
                <label><input checked={informationLayers.lanes} onChange={(event) => { const checked = event.currentTarget.checked; setInformationLayers((layers) => ({ ...layers, lanes: checked })); }} type="checkbox" /> Lanes</label>
                <label><input checked={informationLayers.engagements} onChange={(event) => { const checked = event.currentTarget.checked; setInformationLayers((layers) => ({ ...layers, engagements: checked })); }} type="checkbox" /> Engagements</label>
              </div>
              <small>All display modes use the same observed information.</small>
            </div>
            {runResult && run ? <>
              <div className="next-battle-stage">
                <div aria-label="Interactive three-dimensional replay" className="next-renderer-host" ref={rendererHost} />
                <button aria-label="Toggle Pixel 3D" aria-pressed={pixel} className="next-mobile-render-mode" onClick={() => setPixel(value => !value)} type="button">{pixel ? "Pixel 3D" : "Smooth 3D"}</button>
                <aside className={`next-battle-minimap${battleMapContextOpen ? " is-open" : ""}`} aria-label="Current battlefield map context">
                  <button aria-expanded={battleMapContextOpen} aria-label="Toggle battlefield map context" className="next-minimap-toggle" onClick={() => setBattleMapContextOpen((open) => !open)} type="button"><span>MAP · T{displayState?.tick ?? 0}</span><small>{battleMapContextOpen ? "HIDE" : "OPEN"}</small></button>
                  {battleMapContextOpen && <div className="next-battle-minimap-content">
                  <svg aria-label="Replay lanes, routes, camps, bases and currently visible entities" role="img" viewBox="0 0 120 80">
                    <rect className="next-minimap-ground" height="80" rx="4" width="120" x="0" y="0" />
                    {(run.graphicsReplay.scene.river ?? []).length > 1 && <polyline className="next-minimap-river" data-testid="battle-map-river" points={run.graphicsReplay.scene.river!.map(miniMapPoint).map((point) => `${point.x},${point.y}`).join(" ")} />}
                    {(run.graphicsReplay.scene.routes ?? []).map((route) => {
                      const points = route.points.map(miniMapPoint).map((point) => `${point.x},${point.y}`).join(" ");
                      const facility = route.bridgeSite ? Object.values(displayState?.entities ?? {}).find((entity) => entity.battlefield?.bridgeSite === route.bridgeSite) : undefined;
                      return <polyline className={`next-minimap-route region-${route.region}${route.bridgeSite ? " is-bridge-route" : ""}${route.ford ? " is-ford-route" : ""}`} data-testid="battle-map-route" data-edge-id={route.id} data-bridge-site={route.bridgeSite} data-bridge-kind={route.bridgeKind} data-bridge-state={route.bridgeSite ? facility?.battlefield?.bridgeState ?? "unknown" : undefined} data-ford={route.ford ? "true" : undefined} key={route.id} points={points} />;
                    })}
                    {run.graphicsReplay.scene.lanes.map((lane) => {
                      const points = lane.points.map(miniMapPoint).map((point) => `${point.x},${point.y}`).join(" ");
                      return <g key={lane.id}><polyline className="next-minimap-lane" points={points} /><text className="next-minimap-lane-label" x={miniMapPoint(lane.points[Math.floor(lane.points.length / 2)]).x} y={miniMapPoint(lane.points[Math.floor(lane.points.length / 2)]).y - 2}>{lane.label}</text></g>;
                    })}
                    {(run.graphicsReplay.scene.nodes ?? []).map((node) => { const point = miniMapPoint(node.position); return <circle data-testid="battle-map-node" data-node-id={node.id} data-allegiance={node.allegiance} cx={point.x} cy={point.y} key={node.id} r={node.id === "N.MID.OBS" ? 1.45 : 0.65} />; })}
                    {(run.graphicsReplay.scene.camps ?? []).map((camp) => { const point = miniMapPoint(camp.position); return <path className="next-minimap-camp" d={`M ${point.x} ${point.y - 1.9} l 1.9 1.9 -1.9 1.9 -1.9 -1.9 z`} key={camp.id} />; })}
                    {displayState?.fog?.state.facilities.map((contact) => {
                      const route = run.graphicsReplay.scene.routes?.find(route => route.bridgeSite === contact.site);
                      const site = contact.kind === "bridge"
                        ? route?.bridgePosition
                        : run.graphicsReplay.scene.nodes?.find(node => node.id === contact.site)?.position;
                      if (!site) return null;
                      const point = miniMapPoint(site);
                      return <circle key={contact.id} data-testid="battle-map-last-known" cx={point.x} cy={point.y} r="2" fill="none" stroke="#d5bc88" strokeDasharray="1 0.7"><title>Last observed {contact.kind} {contact.facility_state?.bridge_state ?? ""} · Tick {contact.last_seen_tick} · Current state unknown</title></circle>;
                    })}
                    {miniMapBases.map(({ id, label, position }) => {
                      const point = miniMapPoint(position);
                      return <g className={`next-minimap-base base-${id}`} key={id}><rect height="5" width="5" x={point.x - 2.5} y={point.y - 2.5} /><text x={point.x + 3.5} y={point.y + 2}>{label}</text></g>;
                    })}
                    {Object.values(displayState?.entities ?? {}).filter((entity) => !entity.destroyed && entity.hp > 0).map((entity) => {
                      const point = miniMapEntityPoint(entity);
                      const structure = entity.kind === "tower" || entity.kind === "base";
                      return structure
                        ? <rect className={`next-minimap-entity side-${entity.side}`} height="2.6" key={entity.id} width="2.6" x={point.x - 1.3} y={point.y - 1.3} />
                        : <circle className={`next-minimap-entity side-${entity.side}`} cx={point.x} cy={point.y} key={entity.id} r="1.45" />;
                    })}
                  </svg>
                  <div aria-label="Entity side markers: A attacker, D defender, N neutral" className="next-minimap-legend"><span aria-label="Attacker"><i className="side-azure" /><b>A</b></span><span aria-label="Defender"><i className="side-vermilion" /><b>D</b></span><span aria-label="Neutral"><i className="side-neutral" /><b>N</b></span></div>
                  </div>}
                </aside>
                <button aria-expanded={battleRosterOpen} aria-label={`Visible entity roster, ${visibleCameraTargets.length} visible entities`} className="next-visible-roster-trigger" data-testid="battle-visible-roster-toggle" onClick={() => setBattleRosterOpen((open) => !open)} type="button"><span>VISIBLE ROSTER</span><b>{visibleCameraTargets.length}</b></button>
                <section aria-label="Visible entity cluster roster" className="next-visible-roster-panel" data-testid="battle-visible-roster" hidden={!battleRosterOpen}>
                  <header><div><span className="next-eyebrow">CURRENT DISPLAY · TICK {displayState?.tick ?? 0}</span><h4>Visible entities <small>{visibleCameraTargets.length}</small></h4></div><button aria-label="Close visible entity roster" onClick={() => setBattleRosterOpen(false)} type="button">×</button></header>
                  {renderVisibleEntityClusters("desktop")}
                </section>
                <div className="next-stage-hud"><span><i /> {run.graphicsReplay.header.view === "attacker" ? "LOCAL OWNER VIEW" : "PUBLIC REPLAY"}</span><span>{displayState?.entities ? Object.values(displayState.entities).filter(entity => !entity.destroyed).length : 0} VISIBLE ENTITIES</span><strong>T{String(displayState?.tick ?? 0).padStart(2, "0")} / {run.graphicsReplay.result.tick}</strong></div>
                <div className="next-camera-controls" data-testid="battle-camera-controls" aria-label="Battlefield camera">
                  <button aria-label="Tactical view" aria-pressed={cameraMode === "tactical" && !followedEntityId && !followedSquadId} onClick={() => setBattleView("battle")} type="button">Tactical</button>
                  <button aria-label="Overview view" aria-pressed={cameraMode === "overview"} onClick={() => setBattleView("overview")} type="button">Overview</button>
                  <label className="next-camera-target"><select aria-label="Observe visible entity" disabled={visibleCameraTargets.length === 0} onChange={(event) => setSelectedEntityId(event.target.value || null)} value={selectedEntityId && visibleCameraTargets.some((entity) => entity.id === selectedEntityId) ? selectedEntityId : ""}><option value="">{visibleCameraTargets.length ? "Select visible unit" : "No living visible units"}</option>{visibleCameraTargets.map((entity) => <option key={entity.id} value={entity.id}>{entity.label}</option>)}</select></label>
                  <button aria-label="Follow selected unit" disabled={!selectedEntityId || !visibleCameraTargets.some((entity) => entity.id === selectedEntityId)} onClick={() => selectedEntityId && followVisibleEntity(selectedEntityId)} type="button">Follow</button>
                  <label className="next-camera-target next-squad-camera-target"><select aria-label="Follow own visible Squad" disabled={visibleSquadTargets.length === 0} onChange={(event) => event.target.value && followVisibleSquad(event.target.value)} value={followedSquadId ?? ""}><option value="">{visibleSquadTargets.length ? "Select own visible Squad" : ownerReplay ? "No confirmed visible Squad" : "Own Squad unavailable in public replay"}</option>{visibleSquadTargets.map((target) => <option key={target.id} value={target.id}>{target.label}</option>)}</select></label>
                  <button aria-label="Zoom in" onClick={() => renderer.current?.zoom(1.2)} type="button">＋</button><button aria-label="Zoom out" onClick={() => renderer.current?.zoom(0.83)} type="button">−</button><button aria-label="Toggle Pixel 3D" aria-pressed={pixel} onClick={() => setPixel(value => !value)} type="button">{pixel ? "Pixel 3D" : "Smooth 3D"}</button>
                </div>
                <div className="next-battle-lower" hidden={!battleInspectorOpen && battleMobileView !== "details"}>
                  <section className="next-detail-card"><div className="next-card-heading"><div><span className="next-eyebrow">VISIBLE STATE · TICK {displayState?.tick ?? 0}</span><h4>{selectedEntity ? fieldString(selectedEntity.fields.catalog_id) ?? selectedEntity.entity_type : "Select a unit"}</h4></div><span className="next-owner-tag">{selectedEntity ? selectedEntity.owner ?? "neutral" : run.graphicsReplay.header.view === "attacker" ? "LOCAL OWNER" : "PUBLIC"}</span>{battleMobileView === "details" && <button aria-label="Close details sheet" className="next-mobile-sheet-close" onClick={closeBattleSheet} type="button">×</button>}</div>
                    {selectedEntity ? <div className="next-entity-stats">{(["hp", "xp", "level", "maturity", "energy", "node", "edge_to", "edge_progress", "track", "cross_remaining", "ford_remaining", "ford_active", "site", "bridge_state", "build_remaining", "capture_progress", "capture_owner", "capture_progress_side", "squad", "skill_path", "skills"] as const).map((field) => {
                      const value = selectedEntity.fields[field];
                      const label = field === "xp" && value?.kind === "integer"
                        ? formatExperience(value.value, nextRules)
                        : value ? domainLabel(value) : "";
                      return value ? <div data-testid="logical-detail-field" data-field={field} key={field}><span>{formatId(field)}</span><strong>{label}</strong></div> : null;
                    })}</div> : <p className="next-empty-detail">{selectedDisplayEntity ? "This visible unit has no unambiguous state record in the replay at this tick." : "Tap a visible unit to inspect only the HP, XP, level and skill state present in this replay."}</p>}
                    {selectedEntity && fieldInteger(selectedEntity.fields.xp) !== null && <div className="next-xp-bar"><span>XP <b>{formatExperience(fieldInteger(selectedEntity.fields.xp) ?? 0, nextRules)}</b></span><span>Level <b>{fieldInteger(selectedEntity.fields.level) ?? 1}</b></span></div>}
                    {Boolean(displayState?.fog?.state.facilities.length) && <details className="next-facility-history" data-testid="battle-facility-history"><summary>Last observations · current state unknown</summary><ul>{displayState!.fog!.state.facilities.map(facility => <li key={facility.id}><strong>{facility.kind} · {facility.site}</strong><span>Observed Tick {facility.last_seen_tick} · Current unknown</span>{Object.entries(facility.facility_state ?? {}).map(([field, value]) => <small key={field}>{formatId(field)}: {value} (last observed)</small>)}</li>)}</ul></details>}
                  </section>
                  <section className="next-detail-card next-event-card"><div className="next-card-heading"><div><span className="next-eyebrow">BATTLE EVENTS</span><h4>Current tick</h4></div><button onClick={openAnalysis} type="button">Full analysis ↗</button></div>
                    {frameEvents.length ? <ul className="next-event-list">{frameEvents.slice(-6).map((event, index) => <li key={`${event.event}-${event.entity}-${index}`}><span>T{selectedFrame?.tick}</span><div><strong>{eventTitle(event)}</strong><small>{eventDetails(event) || event.entity || "Battle system"}</small></div></li>)}</ul> : <p className="next-empty-detail">No visible event is recorded at this tick.</p>}
                  </section>
                </div>
              <section aria-label="Choose a visible unit or confirmed owner Squad to follow" className="next-mobile-sheet next-follow-sheet" hidden={battleMobileView !== "follow"}>
                <header><div><span className="next-eyebrow">CAMERA TARGETS · TICK {displayState?.tick ?? 0}</span><h4>Follow a visible unit</h4></div><button aria-label="Close follow sheet" onClick={closeBattleSheet} type="button">×</button></header>
                <span className="next-eyebrow next-follow-subhead">VISIBLE ENTITY CLUSTERS · TICK {displayState?.tick ?? 0}</span>
                {renderVisibleEntityClusters("mobile")}
                {ownerReplay ? <><span className="next-eyebrow next-follow-subhead">CONFIRMED OWNER SQUADS</span>{visibleSquadTargets.length ? <div className="next-follow-list">{visibleSquadTargets.map((target) => <button key={target.id} onClick={() => followVisibleSquad(target.id)} type="button"><span>{target.label}</span><b>Follow Squad ↗</b></button>)}</div> : <p className="next-empty-detail">No owned Hero Squad membership is confirmed among currently visible entities at this tick.</p>}</> : <p className="next-empty-detail">Own-Squad follow is unavailable in this public replay. No private membership is inferred.</p>}
              </section>
              <section aria-label="Replay event timeline" className="next-mobile-sheet next-mobile-timeline" hidden={battleMobileView !== "timeline"}>
                <header><div><span className="next-eyebrow">PUBLIC PRESENTATION REPLAY</span><h4>Event timeline <small>{timelineEvents.length}</small></h4></div><button aria-label="Close timeline sheet" onClick={closeBattleSheet} type="button">×</button></header>
                {contextualTimelineEvents.length ? <ol className="next-timeline" ref={mobileTimelineRef}>{[...contextualTimelineEvents].reverse().map((event, index) => <li data-event-tick={event.tick} key={`${event.tick}-${event.order}-${index}`}><button className={displayState?.tick === event.tick ? "is-current" : ""} onClick={() => inspectReplayEvent(event)} type="button"><span className="next-timeline-tick">T{String(event.tick).padStart(2, "0")}</span><span className={`next-timeline-mark mark-${event.type}`}>{event.type === "match-end" ? "◆" : event.type === "damage" ? "×" : event.type === "move" ? "→" : "•"}</span><span className="next-timeline-copy"><strong>{formatId(event.type)}</strong><small>{"entityId" in event ? event.entityId : event.type === "spawn" ? event.entity.id : event.type === "match-end" ? event.result.reason : "Battle system"}{event.type === "match-end" ? ` · ${formatId(event.result.winner)}` : ""}</small></span><span className="next-timeline-open">View ↗</span></button></li>)}</ol> : <p className="next-empty-detail">This replay has no public timeline events.</p>}
              </section>
              </div>
              <div className="next-replay-controls" aria-label="Replay controls">
                <div className="next-replay-toolbar">
                  <div className="next-play-controls"><button aria-label="Return to first tick" disabled={!player} onClick={() => player?.reset()} type="button">|◀</button><button className="next-play-button" aria-label={isPlaying ? "Pause replay" : "Play replay"} disabled={!player || run.graphicsReplay.result.tick === 0} onClick={() => isPlaying ? player?.pause() : player?.play()} type="button">{isPlaying ? "Ⅱ" : "▶"}</button><button aria-label="Previous tick" disabled={!player || !displayState || displayState.tick === 0} onClick={() => player?.seek(Math.max(0, (displayState?.tick ?? 0) - 1))} type="button">←</button><button aria-label="Next tick" disabled={!player || !displayState || displayState.tick >= run.graphicsReplay.result.tick} onClick={() => player?.seek(Math.min(run.graphicsReplay.result.tick, (displayState?.tick ?? 0) + 1))} type="button">→</button></div>
                  <label className="next-speed"><span>SPEED</span><select aria-label="Replay speed" onChange={(event) => player?.setSpeed(Number(event.target.value))} defaultValue="1"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
                  <span className="next-tick-readout">TICK <strong>{displayState?.tick ?? 0}</strong><small> / {run.graphicsReplay.result.tick}</small></span>
                </div>
                <div className="next-seekbar"><input aria-label="Seek replay tick" disabled={!player || run.graphicsReplay.result.tick === 0} max={run.graphicsReplay.result.tick} min="0" onChange={(event) => player?.seek(Number(event.target.value))} type="range" value={displayState?.tick ?? 0} /><div><span>START · 00</span><span>FINAL · {String(run.graphicsReplay.result.tick).padStart(2, "0")}</span></div></div>
              </div>
              <details className="next-result-disclosure"><summary><span>Confirmed result · {formatId(runResult.outcome)}</span><small>{formatId(runResult.termination_reason)} · {runResult.final_tick} ticks · {run.graphicsReplay.timeline.length} public presentation events</small></summary><div className="next-result-detail"><span>YOUR CU <strong>{runResult.cu_spent.attacker}</strong></span><span>REPLAY VIEW <strong>{run.graphicsReplay.header.view === "attacker" ? "Owner" : "Public"}</strong></span><button className="next-result-analysis" onClick={openAnalysis} type="button">Analyze <b>↗</b></button></div></details>
              <nav className="next-battle-mobile-tabs" aria-label="Battlefield console" data-testid="battle-mobile-console">
                {([ ["battle", "Battle"], ["overview", "Overview"], ["follow", "Follow"], ["timeline", "Timeline"], ["details", "Details"] ] as const).map(([view, label]) => <button aria-label={`${label} view`} aria-pressed={battleMobileView === view} className={battleMobileView === view ? "is-active" : ""} key={view} onClick={() => setBattleView(view)} type="button"><span>{view === "battle" ? "⌖" : view === "overview" ? "◇" : view === "follow" ? "◎" : view === "timeline" ? "≋" : "◉"}</span>{label}</button>)}
              </nav>
            </> : <div className="next-empty-battle"><span className="next-empty-glyph">⌁</span><strong>Battlefield is waiting</strong><p>Compile the current Jinrei draft, then launch five heroes against the local rival.</p><button className="next-secondary-button" onClick={() => setTab(activeCompilation ? "formation" : "jinrei")} type="button">{activeCompilation ? "Review formation" : "Open Jinrei editor"} <b>→</b></button></div>}
          </section>

          <section aria-labelledby="next-tab-analysis" className="next-panel next-analysis-panel" hidden={tab !== "analysis"} id="next-panel-analysis" role="tabpanel">
            <BattleAnalysis context={analysisContext} traceSourceStatus={traceSourceStatus} onTraceSource={inspectTraceSource} run={run} baselineRun={baselineRun} draftChanged={!runIsCurrent} busy={busy}
              onReplayEvent={inspectReplayEvent}
              onReplayTick={tick => { player?.pause(); player?.seek(tick); setTab("battle"); }}
              onBattle={() => setTab("battle")} onEdit={editScreen}
              campaignScenario={campaignFeedback?.scenario ?? null} campaignFeedback={campaignFeedback}
              onExactRematch={() => { if (run) {
                setExactRun(run);
                if (run.setup.campaign_scenario_id) { setEntryMode("campaign"); setSelectedScenarioId(run.setup.campaign_scenario_id); }
                else setEntryMode("quick");
                setPrepared(null);
                setScreen("ready");
              } }}
              onRevisedRematch={rematch} />
          </section>
        </div>
      </div>
      </div>
    </section>
  );
}
