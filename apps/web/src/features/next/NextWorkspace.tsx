import { loadRetainedOriginal, compileRetainedSource } from "./retained-program-editor";
import { RetainedProgramEditor } from "./RetainedProgramEditor";
import { NextDecisionInspector } from "./NextDecisionInspector";
import { TrialProfileEditor, parseTrialPreferences } from "./TrialProfileEditor";
import type { NextBehaviorInputs } from "../../contracts/next-production";
import { RoutePlanEditor } from "./RoutePlanEditor";
import { parseRouteDraft } from "./route-plan";
import type { NextRouteMatch } from "../../contracts/next-route-minion";
import { localTrialMinionBehavior } from "../../contracts/next-route-minion";
import { AutonomousDecisions } from "./AutonomousDecisions";
import { PostMatchProgression } from "../progression/PostMatchProgression";
import { previewOwnedEquipment } from "./owned-equipment-preview";
import { heroSelectionsForDraft, parseOwnedHeroSelection, type OwnedHeroSelection } from "../heroes/draft";
import { equipmentForDraft, parseOwnedEquipmentDraft, type OwnedEquipmentDraft } from "../equipment/draft";
import { CoreClientError } from "../../worker";
import { OwnedAssetsPanel, readOwnedAssets, approvedEquipmentDefinitions, type OwnedAssetsState } from "../heroes/OwnedAssetsPanel";
import { HeroRepository } from "../heroes/repository";
import { buildMatchProjection } from "../progression/match-projection";
import { localTrialBehavior } from "../../contracts/next-production";
import { initialOwnedState, initialOwnedInspection } from "../progression/initial-preview";
import { FrozenAssetsPreview } from "../progression/FrozenAssetsPreview";
import { LocalAssets } from "../progression/LocalAssets";
import { JourneyScreens } from "./JourneyScreens";
import { CampaignRunActions } from "./CampaignProgressViews";
import { campaignConditionMismatch, type CampaignAssociation } from "./campaign-run-eligibility";
import { CAMPAIGN_PROGRESS_PREFIX, LEGACY_CAMPAIGN_PROGRESS_PREFIX, createCampaignProgress, parseCampaignProgress, migrateLegacyCampaignProgress, serializeCampaignProgress, mergeCampaignProgress, reduceCampaignProgress, campaignCompletionSummary, type CampaignProgress } from "./campaign-progress";
import { NextLibrary } from "./NextLibrary";
import { HeroAtelier } from "./HeroAtelier";
import { JinreiWorkbench } from "./JinreiWorkbench";
import { BattleAnalysis } from "./BattleAnalysis";
import { buildImprovedRematch } from "./improved-rematch";
import { actionSourceRange, verifyRunSourceMap } from "./tactical-context";
import type { BattleAnalysisContext, AnalysisSourceContext } from "./tactical-context";
import type { ActionSourceMap, DiagnosticEvent } from "../../contracts";
import { reproductionSnapshotDigest, validateNextExperimentAuthorization, validateNextExperimentDiagnostics, validateNextExperimentReplay, validateNextExperimentReproduction } from "./experiment-restoration";
import { matchesPresentedEntity } from "./battle-entity-identity";
import { loadNextExperimentPayload, saveNextExperimentStore, clearNextExperimentStore, parseNextExperimentStore, assertNextExperimentImportSize, serializeNextExperimentStore, PersistenceError } from "../persistence/repository";
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
  type ReproductionAssets,
  type LocalPveScenario,
  type LocalNextExperiment,
  type LocalNextExperimentStore,
} from "../../contracts";
import type { SenkeiDraft } from "../../contracts";
import { isDomainValueRecord, isStructuredTacticsAst } from "./draft-validation";
import { classifyPreflightProblem, PreflightLocalFailure } from "./preflight-problem";
import type { PreflightProblem as ClassifiedPreflightProblem, PreflightStage, PreflightRepairTarget } from "./preflight-problem";
import type { HeroRepairFocusRequest, JinreiRepairFocusRequest } from "./repair-focus";
import "./next-workspace.css";
import "./battle-view-controls.css";

class PreflightProblem extends Error {
  constructor(message: string, readonly status: "invalid" | "unverified", readonly classificationCause?: unknown) { super(message); }
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
const TRIAL_STORAGE_KEY = "senkei.next-owned-workspace.v1";
const TRIAL_RECOVERY_KEY = "senkei.next-owned-workspace-recovery.v1";
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
  readonly ownedAssetKey?: string;
  readonly experimentId: string;
  readonly createdAt: string;
  readonly snapshot: SimulationSnapshot;
  readonly reproductionAssets: ReproductionAssets;
  readonly snapshotDigest: string;
  readonly response: SimulationResponse;
  readonly sourceReplay: PresentationReplay;
  readonly graphicsReplay: Replay;
  readonly setup: SavedNextSetup;
  readonly includeDiagnostics: boolean;
  readonly estimatedCU: number;
  readonly campaignAssociation: CampaignAssociation | null;
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
  readonly owned_equipment_draft?: OwnedEquipmentDraft;
  readonly owned_hero_selection?: OwnedHeroSelection;
  readonly trial_behavior_inputs?: NextBehaviorInputs;
  readonly route_draft?: NextRouteMatch;
  readonly trial_options?: { readonly schemaVersion: 1; readonly maxTicks: number; readonly minionMidObservations: boolean };
}



/** Serialize the current completed Run, which may be newer than the last disk write. */
function completedExperimentStore(run: BattleRun, baselineRun: BattleRun | null): LocalNextExperimentStore {
  const experiments: LocalNextExperiment[] = [run, ...(baselineRun ? [baselineRun] : [])].map((item) => ({
    id: item.experimentId,
    match_id: item.snapshot.context.match_id,
    created_at: item.createdAt,
    snapshot: item.snapshot,
    reproduction_assets: item.reproductionAssets,
    snapshot_digest: item.snapshotDigest,
    response: item.response,
    setup: JSON.parse(JSON.stringify(item.setup)) as CoreJsonValue,
    include_diagnostics: item.includeDiagnostics,
    estimated_cu: item.estimatedCU,
  }));
  return { format_version: 2, experiments };
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
  if (changed(current.trial_behavior_inputs ?? null, restored.trial_behavior_inputs ?? null)) differences.push("Trial Behavior preferences change.");
  if (changed(current.route_draft ?? null, restored.route_draft ?? null)) differences.push("Route policy and waypoints change.");
  if (changed(current.trial_options ?? null, restored.trial_options ?? null)) differences.push("Local trial execution options change.");
  if (changed(current.owned_hero_selection ?? null, restored.owned_hero_selection ?? null)) differences.push("Owned Hero instance selections change.");
  if (changed(current.owned_equipment_draft ?? null, restored.owned_equipment_draft ?? null)) differences.push("Draft equipment assignments change.");
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

export function parseFormationSlots(value: unknown): readonly FormationSlot[] | null {
  if (!Array.isArray(value) || value.length !== SLOT_IDS.length) return null;
  const seen = new Set<string>();
  const slots: (FormationSlot | null)[] = value.map((slot) => {
    if (!isRecord(slot) || typeof slot.slot_id !== "string" || !slot.slot_id.replace(/\p{White_Space}/gu, "")
      || /[\uD800-\uDFFF]/u.test(slot.slot_id) || new TextEncoder().encode(slot.slot_id).byteLength > 48 || seen.has(slot.slot_id)) return null;
    seen.add(slot.slot_id);
    if (![slot.catalog_id, slot.squad, slot.node, slot.skill_path].every((field) => typeof field === "string" && field.length > 0)) return null;
    return {
      slot_id: slot.slot_id,
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

export function parseSavedNextSetup(value: unknown): SavedNextSetup | null {
  if (!isRecord(value) || value.format_version !== 1 || typeof value.saved_at !== "string") return null;
  const ruleset = parseRulesetRef(value.ruleset);
  const schemaVersion = parseVersion(value.schema_version);
  const mechanicsVersion = parseVersion(value.mechanics_version);
  const slots = parseFormationSlots(value.slots);
  const rivalSlots = parseFormationSlots(value.rival_slots);
  const draft = parseDraft(value.draft);
  const equipmentDraft = value.owned_equipment_draft === undefined ? undefined : parseOwnedEquipmentDraft(value.owned_equipment_draft);
  const heroSelection = value.owned_hero_selection === undefined ? undefined : parseOwnedHeroSelection(value.owned_hero_selection);
  if (equipmentDraft === null || heroSelection === null) return null;
  const behaviorInputs = value.trial_behavior_inputs === undefined ? undefined : parseTrialPreferences(value.trial_behavior_inputs);
  if (behaviorInputs === null) return null;
  const routeDraft = value.route_draft === undefined ? undefined : parseRouteDraft(value.route_draft);
  if (routeDraft === null) return null;
  const trialOptions = value.trial_options;
  if (trialOptions !== undefined && (!isRecord(trialOptions) || trialOptions.schemaVersion !== 1 || typeof trialOptions.maxTicks !== 'number' || !Number.isFinite(trialOptions.maxTicks) || typeof trialOptions.minionMidObservations !== 'boolean')) return null;
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
    ...(equipmentDraft ? { owned_equipment_draft: equipmentDraft } : {}),
    ...(heroSelection ? { owned_hero_selection: heroSelection } : {}),
    ...(behaviorInputs ? {trial_behavior_inputs:behaviorInputs} : {}),
    ...(routeDraft ? {route_draft:routeDraft} : {}),
    ...(trialOptions ? { trial_options: trialOptions as SavedNextSetup["trial_options"] } : {}),
    ...(typeof value.campaign_scenario_id === "string" ? { campaign_scenario_id: value.campaign_scenario_id } : {}),
  };
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

/** Mirrors Jinrei's canonical Rust formatter; JSON-only escapes are not DSL escapes. */
export function jinreiStringLiteral(value: string): string {
  return '"' + value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')
    .replaceAll("\n", "\\n").replaceAll("\r", "\\r").replaceAll("\t", "\\t") + '"';
}

export function createStarterJinrei(packageValue: RulePackage, side: Side, slots: readonly FormationSlot[]): string {
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
    const selector = `argmin hero in filter hero in ${actorCollection} { hero.${actorKey} == ${jinreiStringLiteral(slot.slot_id)}, } by hero.${rank} then hero.${actorKey}`;
    const args = Array.from({ length: movement.arguments.length }, (_, argumentIndex) => {
      if (argumentIndex === 0) return selector;
      if (argumentIndex === nodeArgument || movement.arguments[argumentIndex]?.value_type.kind === "string") {
        return `"${node}"`;
      }
      return `"${node}"`;
    });
    const needsGoal = "goal" in actorSchema.visible_fields
      ? `any hero in ${actorCollection} { hero.${actorKey} == ${jinreiStringLiteral(slot.slot_id)}, hero.goal == "", hero.hp > 0, }`
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
    const actor = `argmin hero in filter hero in ${ownHeroes[0]} { hero.${actorKey} == ${jinreiStringLiteral(slot.slot_id)}, } by hero.${actorRank} then hero.${actorKey}`;
    const ready = `any hero in ${ownHeroes[0]} { hero.slot_id == ${jinreiStringLiteral(slot.slot_id)}, hero.level >= ${skill.unlock_level}, hero.energy >= ${skill.cost}, hero.cooldowns.${skill.id} <= match.tick, }`;
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

export async function verifyCampaignAssociation(core: Pick<CoreClient, "compile" | "newMatchContext">, ruleset: RulePackage, scenarios: readonly LocalPveScenario[], setup: Pick<SavedNextSetup, "campaign_scenario_id">, snapshot: SimulationSnapshot): Promise<CampaignAssociation | null> {
  const scenarioId = setup.campaign_scenario_id;
  if (!scenarioId) return null;
  const scenario = scenarios.find(candidate => candidate.id === scenarioId);
  if (!scenario || !ruleset.next) return { scenarioId, eligible: false, reason: "The saved scenario is not in the current Campaign catalog." };
  try {
    const npc = scenario.npc;
    const program = (await core.compile(npc.program_input.kind === "text"
      ? { kind: "text", ruleset_ref: npc.ruleset, source: npc.program_input.source }
      : { kind: "structured_ast", ruleset_ref: npc.ruleset, ast: npc.program_input.ast })).program;
    const expectedNpc = makeSideSnapshot(npc, program, scenarioFormation(scenario, ruleset.next));
    const expectedContext = await core.newMatchContext(ruleset.ruleset, snapshot.context.match_id);
    const reason = campaignConditionMismatch(snapshot, expectedNpc, expectedContext);
    return { scenarioId, eligible: reason === null, reason: reason ?? "Authored NPC and complete default context verified." };
  } catch (cause) { return { scenarioId, eligible: false, reason: `Campaign conditions could not be verified: ${cause instanceof Error ? cause.message : String(cause)}` }; }
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

/** Reproduces stored/imported artifacts before they can replace completed Runs. */
export async function prepareNextExperimentStore(
  stored: LocalNextExperimentStore, packageValue: RulePackage, core: CoreClient, campaignScenarios: readonly LocalPveScenario[] = [],
): Promise<BattleRun[]> {
  const restored: BattleRun[] = [];
  for (const item of stored.experiments) {
    const reproductionAssets = item.reproduction_assets;
    const retainedPackage = reproductionAssets?.rule_package;
    const next = retainedPackage?.next;
    if (!reproductionAssets || reproductionAssets.format_version !== 1 || !retainedPackage || !next) {
      throw new Error(`Experiment ${item.id} does not retain a supported Next RulePackage and authored World.`);
    }
    const actualSnapshotDigest = await reproductionSnapshotDigest(item.snapshot);
    if (item.snapshot_digest !== actualSnapshotDigest) {
      throw new Error(`Experiment ${item.id} snapshot digest does not match its complete immutable input.`);
    }
    validateNextExperimentAuthorization(item.response, item.include_diagnostics);
    if (item.include_diagnostics) await validateNextExperimentDiagnostics(item.response, item.snapshot);
    const setup = parseSavedNextSetup(item.setup);
    const result = item.response.outcome?.result;
    const sourceReplay = item.response.owner_replays?.attacker ?? item.response.outcome?.presentation_replay;
    if (!setup || !result || !sourceReplay || item.snapshot.context.match_id !== item.match_id || result.match_id !== item.match_id) {
      throw new Error(`Experiment ${item.id} has incomplete match, setup, result or replay data.`);
    }
    const mismatch = savedSetupMismatch(setup, retainedPackage, next);
    if (mismatch) throw new Error(`Experiment ${item.id} cannot be reproduced: ${mismatch}`);
    const replays = [item.response.outcome.presentation_replay, item.response.owner_replays?.attacker,
      item.response.owner_replay].filter((replay): replay is PresentationReplay => Boolean(replay));
    for (const replay of replays) {
      if (!item.snapshot.context.world_identity || !next.world_identity || !next.map.world_identity ||
          canonicalKey(item.snapshot.context.world_identity) !== canonicalKey(next.world_identity) ||
          canonicalKey(next.map.world_identity) !== canonicalKey(next.world_identity) ||
          canonicalKey(replay.world_identity) !== canonicalKey(next.world_identity)) {
        throw new Error(`Experiment ${item.id} World identity or paired World projection does not match its retained RulePackage.`);
      }
      if (!item.snapshot.context.ruleset || !sameRulesetRef(item.snapshot.context.ruleset, retainedPackage.ruleset) ||
          !sameRulesetRef(item.snapshot.attacker.ruleset, retainedPackage.ruleset) ||
          !sameRulesetRef(item.snapshot.defender.ruleset, retainedPackage.ruleset) ||
          !replay.ruleset || !sameRulesetRef(replay.ruleset, retainedPackage.ruleset)) {
        throw new Error(`Experiment ${item.id} Ruleset identity does not match its retained RulePackage.`);
      }
      try { await validateNextExperimentReplay(replay, result, item.match_id); }
      catch (cause) {
        throw new Error(`Experiment ${item.id} replay does not match its immutable result or attacker perspective: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    }
    if (item.include_diagnostics && item.response.authorized_side !== "attacker") {
      throw new Error(`Experiment ${item.id} does not carry attacker-authorized diagnostics.`);
    }
    const reproduced = await core.reproduce(item.snapshot, reproductionAssets, item.snapshot_digest,
      item.include_diagnostics ? { include_diagnostics: true, diagnostics_side: "attacker" } : { include_diagnostics: false });
    await validateNextExperimentReproduction(reproduced, item.response, item.snapshot, item.include_diagnostics);
    const graphicsReplay = presentationToGraphics(sourceReplay, retainedPackage, result, item.snapshot.context.versions.engine);
    const campaignAssociation = sameRulesetRef(packageValue.ruleset, retainedPackage.ruleset)
      ? await verifyCampaignAssociation(core, retainedPackage, campaignScenarios, setup, item.snapshot)
      : null;
    restored.push({
      campaignAssociation,
      experimentId: item.id,
      createdAt: item.created_at,
      snapshot: item.snapshot,
      reproductionAssets,
      snapshotDigest: item.snapshot_digest,
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

export function NextWorkspace({ active, entry, core, ruleset: suppliedPackage, rulesetError, onRetryCore }: WorkspaceProps): ReactElement {
  const [trialPackage, setTrialPackage] = useState<RulePackage | null>(null);
  const [trialPending, setTrialPending] = useState(() => { try { return localStorage.getItem('senkei.local-trial-enabled.v1') === 'true'; } catch { return false; } });
  const packageValue = trialPending ? null : trialPackage ?? suppliedPackage;
  const [ownedAssets, setOwnedAssets] = useState<OwnedAssetsState | null>(null);
  const [heroSelection, setHeroSelection] = useState<OwnedHeroSelection | null>(null);
  const [equipmentDraft, setEquipmentDraft] = useState<OwnedEquipmentDraft | null>(null);
  const [behaviorInputs, setBehaviorInputs] = useState<NextBehaviorInputs | null>(null);
  const [routeDraft, setRouteDraft] = useState<NextRouteMatch | null>(null);
  const [trialMinionObservations, setTrialMinionObservations] = useState(false);
  const [trialTickLimit, setTrialTickLimit] = useState(20);
  const isTrial = packageValue?.next?.projection_policy?.test_only === true;
  const setupStorageKey = isTrial ? TRIAL_STORAGE_KEY : NEXT_STORAGE_KEY;
  const setupRecoveryKey = isTrial ? TRIAL_RECOVERY_KEY : NEXT_RECOVERY_KEY;
  const setupIdentity = `${setupRecoveryKey}:${packageValue?.ruleset.digest ?? ''}`;
  const [initializedSetupIdentity, setInitializedSetupIdentity] = useState<string | null>(null);
  const enableTrial = async () => {
    if (!core) return;
    try { const trial = await core.nextRuleset(true); localStorage.setItem('senkei.local-trial-enabled.v1', 'true'); setTrialPackage(trial); setTrialPending(false); }
    catch (cause) { setError(String(cause)); }
  };
  useEffect(() => { if (!core) return; try { if (localStorage.getItem('senkei.local-trial-enabled.v1') === 'true') { setTrialPending(true); void core.nextRuleset(true).then(trial => { setTrialPackage(trial); setTrialPending(false); }).catch(cause => setError(`Trial ruleset unavailable; saved draft retained: ${String(cause)}`)); } } catch { setTrialPending(false); } }, [core]);
  const nextRules = packageValue?.next ?? null;
  const campaignScenarios = useMemo(() => packageValue?.next ? createNextCampaignScenarios(packageValue) : [], [packageValue]);
  const [selectedScenarioId, setSelectedScenarioId] = useState("first-march");
  const campaignScenarioIds = useMemo(() => campaignScenarios.map(scenario => scenario.id), [campaignScenarios]);
  const [campaignProgress, setCampaignProgress] = useState<CampaignProgress | null>(null);
  const activeCampaignProgress = campaignProgress?.ruleset_digest === packageValue?.ruleset.digest ? campaignProgress : null;
  const unlockedScenarioIds = activeCampaignProgress?.unlocked_scenario_ids ?? [];
  const [campaignProgressRaw, setCampaignProgressRaw] = useState<{ current: string | null; legacy: string | null }>({ current: null, legacy: null });
  const [campaignProgressAttempt, setCampaignProgressAttempt] = useState(0);
  const [campaignProgressReadBlocked, setCampaignProgressReadBlocked] = useState(false);
  const campaignProgressReadGeneration = useRef(0);
  const campaignProgressAcknowledged = useRef<{ digest: string; serialized: string } | null>(null);
  const [campaignProgressLoadedGeneration, setCampaignProgressLoadedGeneration] = useState(0);
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
  const [experimentReloadAttempt, setExperimentReloadAttempt] = useState(0);
  const [savedRaw, setSavedRaw] = useState<string | null>(null);
  const [recoveryRaw, setRecoveryRaw] = useState<string | null>(null);
  const [frozenRematch, setFrozenRematch] = useState<{ kind: "exact" | "improved"; run: BattleRun } | null>(null);
  const exactRun = frozenRematch?.run ?? null;
  const setExactRun = useCallback((value: BattleRun | null) => setFrozenRematch(value ? { kind: "exact", run: value } : null), []);
  const [entryMode, setEntryMode] = useState<"quick" | "custom" | "campaign">("quick");
  const [checking, setChecking] = useState(false);
  const [prepared, setPrepared] = useState<{
    initialEvidence?: import("./coverage-observed").CoverageRun;
    key: string; snapshot: SimulationSnapshot; reproductionAssets: ReproductionAssets; snapshotDigest: string; initialState?: import("../../contracts").WorldStateView;
  } | null>(null);
  const [preflightFailure, setPreflightFailure] = useState<{ key: string; problem: ClassifiedPreflightProblem; exactSource: string | null } | null>(null);
  const [heroRepairFocus, setHeroRepairFocus] = useState<HeroRepairFocusRequest | null>(null);
  const [jinreiRepairFocus, setJinreiRepairFocus] = useState<JinreiRepairFocusRequest | null>(null);
  const [scenarioRepairFocus, setScenarioRepairFocus] = useState<{ requestId: string; scenarioId: string | null } | null>(null);
  const preflightStage = useRef<PreflightStage>("availability");
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
  const [compilation, setCompilation] = useState<{ readonly key: string; readonly result: import("../../contracts").CompileOutcome; readonly stamp?: import("@senkei/jinrei-editor").CatalogStamp } | null>(null);
  const [run, setRun] = useState<BattleRun | null>(null);
  const runRef = useRef(run);
  runRef.current = run;
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
    const retainedEditor = Boolean(core?.editorCatalogRetained && core?.editorCompileRetained);
    if (!core || (!retainedEditor && (!packageValue || !sameRulesetRef(original.ruleset, packageValue.ruleset)
      || !sameRulesetRef(run.snapshot.attacker.ruleset, packageValue.ruleset)))) {
      unavailable("Original Run RulePackage is unavailable. No source correspondence was inferred."); return;
    }
    if (original.program_input.kind !== "text") { unavailable("Original Run has no text source locations. Structured AST was not converted into guessed spans."); return; }
    const source = original.program_input.source;
    unavailable("Checking original Run source and Program identity…");
    const compiled = retainedEditor
      ? loadRetainedOriginal(core,run,original.program_input,0).then(retained => compileRetainedSource(core,retained.verified,retained.stamp,source,1))
      : core.compile({ kind: "text", source, ruleset_ref: original.ruleset });
    void compiled.then(result => verifyRunSourceMap(source, run.snapshot.attacker.program.content_digest, result))
      .then(proof => { if (!obsolete) setRunSourceProof({ experimentId: run.experimentId, ...proof }); })
      .catch(cause => { if (!obsolete) unavailable(`Original source verification failed: ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { obsolete = true; };
  }, [run, core, packageValue]);
  const experimentRestoreGeneration = useRef(0);
  const experimentRuntime = useRef({ core, packageValue });
  experimentRuntime.current = { core, packageValue };
  const experimentPersistGeneration = useRef(0);
  // Do not discard a completed Run until its IndexedDB write commits.
  const experimentPendingStore = useRef<LocalNextExperimentStore | null>(null);
  const experimentImportGeneration = useRef(0);
  const experimentWriteQueue = useRef<Promise<void>>(Promise.resolve());
  const enqueueExperimentWrite = useCallback((write: () => Promise<void>): Promise<void> => {
    const next = experimentWriteQueue.current.then(write);
    experimentWriteQueue.current = next.catch(() => undefined);
    return next;
  }, []);
  const [busy, setBusy] = useState(false);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const setRematchDiagnostics = useCallback((value: boolean): void => {
    setIncludeDiagnostics(value);
    setFrozenRematch(current => current ? { ...current, run: { ...current.run, includeDiagnostics: value } } : current);
  }, []);
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
    // A Core reload must not replace a not-yet-persisted Run with older disk data.
    if (experimentPendingStore.current) return;
    const digest = packageValue?.ruleset.digest;
    const generation = ++experimentRestoreGeneration.current;
    let storageRead = false;
    setExperimentLoadedDigest(null);
    setExperimentMismatch(null);
    setExperimentError(null);
    setExperimentStorageLoaded(false);
    setExperimentStore(null);
    setExperimentPreservedRaw(null);
    void (async () => {
      try {
        // Reading/exporting completed records does not require the simulation runtime.
        const payload = await loadNextExperimentPayload();
        if (generation !== experimentRestoreGeneration.current || experimentPendingStore.current) return;
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
        const restored = stored ? await prepareNextExperimentStore(stored, packageValue, core, campaignScenarios) : [];
        if (generation !== experimentRestoreGeneration.current || experimentPendingStore.current) return;
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
  }, [core, packageValue, experimentReloadAttempt]);

  useEffect(() => {
    const digest = packageValue?.ruleset.digest;
    if (!digest || experimentLoadedDigest !== digest || experimentMismatch || !run) return;
    const store = completedExperimentStore(run, baselineRun);
    const generation = ++experimentPersistGeneration.current;
    experimentPendingStore.current = store;
    void enqueueExperimentWrite(async () => {
      if (generation !== experimentPersistGeneration.current) return;
      await saveNextExperimentStore(store, () => {
        if (generation !== experimentPersistGeneration.current) {
          throw new PersistenceError("conflict", "The completed Run changed before storage could commit.");
        }
      });
    }).then(() => {
      if (generation !== experimentPersistGeneration.current) return;
      experimentPendingStore.current = null;
      setExperimentStore(store);
      setExperimentError(null);
    }).catch((cause: unknown) => {
      if (generation === experimentPersistGeneration.current) {
        setExperimentError(cause instanceof Error ? `Experiment could not be saved: ${cause.message}` : "Experiment could not be saved.");
      }
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
    if (!digest || campaignScenarioIds.length === 0) return;
    const sessionProgress = campaignProgress?.ruleset_digest === digest ? campaignProgress : null;
    const generation = ++campaignProgressReadGeneration.current;
    setCampaignProgressLoadedDigest(null);
    setCampaignProgressError(null);
    setCampaignProgressReadBlocked(false);
    setCampaignProgressRaw({ current: null, legacy: null });
    try {
      const current = window.localStorage.getItem(`${CAMPAIGN_PROGRESS_PREFIX}:${digest}`);
      setCampaignProgressRaw({ current, legacy: null });
      const legacy = window.localStorage.getItem(`${LEGACY_CAMPAIGN_PROGRESS_PREFIX}:${digest}`);
      setCampaignProgressRaw({ current, legacy });
      const storedProgress = current !== null ? parseCampaignProgress(current, digest, campaignScenarioIds)
        : legacy !== null ? migrateLegacyCampaignProgress(legacy, digest, campaignScenarioIds)
        : createCampaignProgress(digest, campaignScenarioIds);
      const sessionSerialized = sessionProgress ? serializeCampaignProgress(sessionProgress, campaignScenarioIds) : null;
      const acknowledged = campaignProgressAcknowledged.current;
      const hasUnacknowledgedSessionProgress = sessionProgress !== null &&
        (acknowledged?.digest !== digest || sessionSerialized !== acknowledged.serialized);
      const storedSerialized = serializeCampaignProgress(storedProgress, campaignScenarioIds);
      const progress = sessionProgress && (hasUnacknowledgedSessionProgress || sessionSerialized !== storedSerialized)
        ? mergeCampaignProgress(storedProgress, sessionProgress, campaignScenarioIds)
        : storedProgress;
      campaignProgressAcknowledged.current = { digest, serialized: storedSerialized };
      setCampaignProgress(progress);
      setSelectedScenarioId(id => campaignScenarioIds.includes(id) ? id : campaignScenarioIds[0]);
    } catch (cause) {
      setCampaignProgressError(`Campaign progress could not be read. Original bytes are preserved and automatic writes are blocked: ${cause instanceof Error ? cause.message : String(cause)}`);
      setCampaignProgressReadBlocked(true);
      setCampaignProgress(sessionProgress ?? { ...createCampaignProgress(digest, campaignScenarioIds), history_incomplete: true });
      setSelectedScenarioId(id => campaignScenarioIds.includes(id) ? id : campaignScenarioIds[0]);
    } finally { setCampaignProgressLoadedDigest(digest); setCampaignProgressLoadedGeneration(generation); }
  }, [campaignScenarioIds, packageValue?.ruleset.digest, campaignProgressAttempt]);

  useEffect(() => {
    const digest = packageValue?.ruleset.digest;
    if (!digest || campaignProgressLoadedDigest !== digest || campaignProgressLoadedGeneration !== campaignProgressReadGeneration.current
      || campaignProgressError || !campaignProgress || campaignProgress.ruleset_digest !== digest) return;
    try {
      const current = serializeCampaignProgress(campaignProgress, campaignScenarioIds);
      window.localStorage.setItem(`${CAMPAIGN_PROGRESS_PREFIX}:${digest}`, current);
      campaignProgressAcknowledged.current = { digest, serialized: current };
      setCampaignProgressRaw(previous => ({ ...previous, current }));
    } catch (cause) {
      setCampaignProgressError(`Campaign progress could not be saved. Progress in this session remains available; stored originals are unchanged: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  }, [campaignProgress, campaignProgressError, campaignProgressLoadedDigest, campaignProgressLoadedGeneration, campaignScenarioIds, packageValue?.ruleset.digest]);

  const exportCampaignProgress = (kind: "current" | "legacy"): void => {
    const raw = campaignProgressRaw[kind];
    if (raw === null) return;
    const url = URL.createObjectURL(new Blob([raw], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url; link.download = `senkei-campaign-${kind}-preserved.json`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };

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
    void core.editorCatalogJson(isTrial)
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
    if (trialPending || !packageValue) return;
    setSavedSetupLoaded(false);
    try {
      const serialized = window.localStorage.getItem(setupStorageKey);
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
  }, [storageAttempt, setupStorageKey, trialPending, packageValue?.ruleset.digest]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const syncDisclosure = () => setSaveDetailsOpen(desktop.matches);
    desktop.addEventListener("change", syncDisclosure);
    return () => desktop.removeEventListener("change", syncDisclosure);
  }, []);

  useEffect(() => {
    if (trialPending || !packageValue) return;
    setRecoverySetupLoaded(false);
    try {
      const serialized = window.localStorage.getItem(setupRecoveryKey);
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
  }, [storageAttempt, setupRecoveryKey, trialPending, packageValue?.ruleset.digest]);

  useEffect(() => {
    if (!packageValue || !nextRules || !recoverySetupLoaded || trialPending) return;
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
        setEquipmentDraft(recovered.owned_equipment_draft ?? null);
        setHeroSelection(recovered.owned_hero_selection ?? null);
        setRouteDraft(recovered.route_draft ?? null);
        setBehaviorInputs(recovered.trial_behavior_inputs ?? null);
        setTrialTickLimit(recovered.trial_options?.maxTicks ?? 20); setTrialMinionObservations(recovered.trial_options?.minionMidObservations ?? false);
        setCompilation(null);
        setRun(null);
        setBaselineRun(null);
        setError(null);
        setRendererError(null);
        setSelectedEntityId(null);
        setRecoveryRestored(true);
        setInitializedSetupIdentity(setupIdentity);
        setSaveMessage("Recovered this unsaved Next draft after reload. Your explicit saved setup remains separate.");
        return;
      }
      const playerSlots = defaultSlots(nextRules, "attacker", DEFAULT_HERO_IDS);
      const enemySlots = defaultSlots(nextRules, "defender", DEFAULT_RIVAL_IDS);
      const initialDraft = { ...createTacticDraft(packageValue, nextRules, "attacker"), ...(isTrial ? {program_input:{kind:"text" as const,source:"senkei local_trial { action inactive_order { when false, do retreat(argmin hero in allies.heroes by hero.level then hero.id), }, }"}} : {}) };
      setSlots(playerSlots);
      setRivalSlots(enemySlots);
      setFormationShape("single");
      setActiveSlot(0);
      draftRef.current = initialDraft;
      setDraft(initialDraft);
      setEquipmentDraft(null);
      setHeroSelection(null);
      setRouteDraft(null);
      setBehaviorInputs(null);
      setTrialTickLimit(20); setTrialMinionObservations(false);
      setCompilation(null);
      setRun(null);
      setBaselineRun(null);
      setError(null);
      setRendererError(null);
      setSelectedEntityId(null);
      setInitializedSetupIdentity(setupIdentity);
    } catch (cause) {
      setInitializedSetupIdentity(null);
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
  const campaignFeedback = run?.campaignAssociation?.eligible && run?.setup.campaign_scenario_id
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
  // Preserve an explicitly restored Campaign selection even when its
  // challenge is currently locked. Preflight rejects locked challenges and
  // shows the reason instead of silently substituting another opponent.
  const savedSetupMismatchReason = savedSetup ? savedSetupMismatch(savedSetup, packageValue, nextRules) : null;
  const recoveryMismatchReason = recoverySetup ? savedSetupMismatch(recoverySetup, packageValue, nextRules) : null;
  const canRestoreSavedSetup = savedSetupLoaded && savedSetup !== null && savedSetupMismatchReason === null;
  const runIsCurrent = Boolean(run && draft && (!isTrial || (run.ownedAssetKey === stableKey({ownedAssets,equipmentDraft,heroSelection,trialMinionObservations,behaviorInputs}) && run.snapshot.context.max_ticks === trialTickLimit && run.snapshot.attacker.ruleset.digest === packageValue?.ruleset.digest)) &&
    stableKey({ draft, slots, rivalSlots, formationShape, includeDiagnostics, routeDraft }) === stableKey({
      draft: run.setup.draft, slots: run.setup.slots, rivalSlots: run.setup.rival_slots,
      formationShape: run.setup.formation_shape, includeDiagnostics: run.includeDiagnostics, routeDraft:run.setup.route_draft ?? null,
    }) && (entryMode === "campaign" ? selectedScenarioId : null) === (run.setup.campaign_scenario_id ?? null));
  const launchKey = stableKey({ compilerContextKey, slots, rivalSlots, includeDiagnostics, package: packageValue?.ruleset, exact: exactRun?.snapshot,
    entryMode, behaviorInputs: isTrial && !exactRun ? behaviorInputs : null, routeDraft: !exactRun ? routeDraft : null, trialMinionObservations: isTrial && !exactRun ? trialMinionObservations : null, heroSelection: isTrial && !exactRun ? heroSelection : null, equipmentDraft: isTrial && !exactRun ? equipmentDraft : null, ownedAssets: isTrial && !exactRun ? ownedAssets : null, trialTickLimit: isTrial && !exactRun ? trialTickLimit : null, campaignScenario: entryMode === "campaign" ? selectedScenarioId : null });
  const launchKeyRef = useRef(launchKey);
  launchKeyRef.current = launchKey;
  const readySnapshot = prepared?.key === launchKey && (exactRun || activeCompilation) ? prepared.snapshot : null;
  useEffect(() => {
    if (!isTrial || screen !== 'ready' || exactRun || !ownedAssets || !packageValue) return;
    let stopped = false; let checkingAssets = false;
    const check = async () => {
      if (checkingAssets || operationInFlight.current) return;
      checkingAssets = true;
      try {
        const fresh = await readOwnedAssets(ownedAssets.playerId, await approvedEquipmentDefinitions(packageValue));
        if (!stopped && !operationInFlight.current && stableKey(fresh) !== stableKey(ownedAssets)) { setOwnedAssets(fresh); setPrepared(null); }
      } catch { if (!stopped && !operationInFlight.current) setPrepared(null); }
      finally { checkingAssets = false; }
    };
    const timer = window.setInterval(() => void check(), 1500);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [isTrial, screen, exactRun, ownedAssets, packageValue]);

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
    if (!packageValue || !nextRules || !currentDraft || initializedSetupIdentity !== setupIdentity) return null;
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
      ...(isTrial && behaviorInputs ? {trial_behavior_inputs:behaviorInputs} : {}),
      ...(routeDraft ? {route_draft:routeDraft} : {}),
      ...(isTrial && equipmentDraft ? { owned_equipment_draft: equipmentDraft } : {}),
      ...(isTrial && heroSelection ? { owned_hero_selection: heroSelection } : {}),
      ...(isTrial ? {trial_options:{schemaVersion:1 as const,maxTicks:trialTickLimit,minionMidObservations:trialMinionObservations}} : {}),
      rival_source: createStarterJinrei(packageValue, "defender", rivalSlots),
      ...(entryMode === "campaign" && selectedScenario ? { campaign_scenario_id: selectedScenario.id } : {}),
    };
  }, [entryMode, formationShape, nextRules, packageValue, rivalSlots, selectedScenario, slots, initializedSetupIdentity, setupIdentity, equipmentDraft, heroSelection, isTrial, trialTickLimit, trialMinionObservations, routeDraft, behaviorInputs]);

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
      window.localStorage.setItem(setupRecoveryKey, serialized);
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
      window.localStorage.setItem(setupStorageKey, serialized);
      setSavedRaw(serialized);
      setSavedSetup(setup);
      setSavedSetupError(null);
      setSaveMessage("Saved this Next setup in this browser. Legacy Senkei strategies remain separate.");
    } catch (cause) {
      setSavedSetupError(cause instanceof Error ? `The Next setup could not be saved: ${cause.message}` : "The Next setup could not be saved in this browser.");
    }
  }, [buildSavedSetup, savedSetupLoaded, savedRaw, savedSetup, savedSetupMismatchReason, setupStorageKey]);

  const restoreSetup = useCallback((): void => {
    if (!savedSetup || savedSetupMismatchReason) return;
    draftRef.current = savedSetup.draft;
    setDraft(savedSetup.draft);
    setEquipmentDraft(savedSetup.owned_equipment_draft ?? null);
    setHeroSelection(savedSetup.owned_hero_selection ?? null);
    setRouteDraft(savedSetup.route_draft ?? null);
    setBehaviorInputs(savedSetup.trial_behavior_inputs ?? null);
    setTrialTickLimit(savedSetup.trial_options?.maxTicks ?? 20); setTrialMinionObservations(savedSetup.trial_options?.minionMidObservations ?? false);
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
      window.localStorage.removeItem(setupStorageKey);
      setSavedRaw(null);
      setSavedSetup(null);
      setSavedSetupError(null);
      setSaveMessage("Cleared the local Next setup copy.");
    } catch (cause) {
      setSavedSetupError(cause instanceof Error ? `The saved setup could not be cleared: ${cause.message}` : "The saved setup could not be cleared.");
    }
  }, [setupStorageKey]);

  const clearRecoveryCopy = useCallback((): void => {
    try {
      window.localStorage.removeItem(setupRecoveryKey);
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
  }, [setupRecoveryKey]);

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
    setEquipmentDraft(recoverySetup.owned_equipment_draft ?? null);
    setHeroSelection(recoverySetup.owned_hero_selection ?? null);
    setRouteDraft(recoverySetup.route_draft ?? null);
    setBehaviorInputs(recoverySetup.trial_behavior_inputs ?? null);
    setTrialTickLimit(recoverySetup.trial_options?.maxTicks ?? 20); setTrialMinionObservations(recoverySetup.trial_options?.minionMidObservations ?? false);
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
        window.localStorage.setItem(setupStorageKey, serialized);
        setSavedRaw(serialized);
      } catch (cause) {
        setSavedSetupError(cause instanceof Error
          ? `The setup is imported for this session, but browser storage failed: ${cause.message}`
          : "The setup is imported for this session, but browser storage is unavailable.");
      }
    } catch (cause) {
      setSavedSetupError(cause instanceof Error ? `The setup file could not be imported: ${cause.message}` : "The setup file could not be imported.");
    }
  }, [savedRaw, setupStorageKey]);

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

  const selectOwnedHero = useCallback((slotId: string, instanceId: string, definitionId: string) => {
    if (!ownedAssets) return;
    const selections = {...(heroSelection?.playerId === ownedAssets.playerId ? heroSelection.slots : ownedAssets.slotSelections)};
    if (instanceId) selections[slotId] = instanceId; else delete selections[slotId];
    setHeroSelection({schemaVersion:1,playerId:ownedAssets.playerId,slots:selections});
    setPrepared(null); setExactRun(null);
    const index = slots.findIndex(slot => slot.slot_id === slotId);
    const definition = nextRules?.heroes.find(hero => hero.id === definitionId);
    if (index >= 0 && definition) changeSlot(index, {catalog_id:definitionId, skill_path:Object.keys(definition.skill_paths)[0]});
  }, [slots, nextRules, changeSlot, ownedAssets, heroSelection]);

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
    let verifiedStamp: import("@senkei/jinrei-editor").CatalogStamp | undefined;
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
        throw new PreflightProblem(`${code}${path ? ` at ${path}` : ""}: ${message}`, "invalid", {
          code: "compile_failed", message, path: path ?? null, details: {},
        });
      }
      result = envelope.reply.result;
      verifiedStamp = envelope.reply.stamp;
    } else {
      result = await core.compile(input);
    }
    if (!draftRef.current || stableKey(draftRef.current) !== stableKey(current)) {
      throw new Error("Jinrei changed while the local compiler was running. Compile the current version again.");
    }
    setCompilation({ key, result, ...(verifiedStamp ? {stamp:verifiedStamp} : {}) });
    setError(null);
    return result;
  }, [core, editorCatalog, editorCatalogError, packageValue, slots]);

  const onCatalogCompile = useCallback((result: CompileOutcome, key: string, stamp?: import("@senkei/jinrei-editor").CatalogStamp): void => {
    if (draftRef.current && editorCatalogMatchesRuleset(editorCatalog, packageValue)
      && stableKey({ draft: draftRef.current, slots, catalog: catalogStamp(editorCatalog) }) === key) {
      if (stamp && !sameCatalog(stamp,catalogStamp(editorCatalog))) return;
      setCompilation(previous => ({key,result,...(stamp ? {stamp} : {}),...(previous?.key === key && previous.result.program.content_digest === result.program.content_digest && previous.stamp ? {stamp:previous.stamp} : {})}));
      setError(null);
    }
  }, [editorCatalog, packageValue, slots]);

  const prepareBattle = async (): Promise<SimulationSnapshot> => {
    preflightStage.current = "availability";
    if (!core) {
      throw new PreflightProblem("Core が未準備です。読込後に再試行してください。", "unverified");
    }
    const key = launchKey;
    if (exactRun) {
      const snapshotDigest = await reproductionSnapshotDigest(exactRun.snapshot);
      if (frozenRematch?.kind !== "improved" && snapshotDigest !== exactRun.snapshotDigest) {
        throw new PreflightProblem("The original Run snapshot no longer matches its saved identity.", "invalid");
      }
      preflightStage.current = "snapshot_preflight";
      await core.preflightReproduction(exactRun.snapshot, exactRun.reproductionAssets, snapshotDigest);
      if (launchKeyRef.current !== key) {
        const message = "再戦対象が変更されました。再検証してください。";
        preflightStage.current = "stale_inputs";
        throw new PreflightProblem(message, "unverified", new PreflightLocalFailure(message, "unverified"));
      }
      setPrepared({ key, snapshot: exactRun.snapshot, reproductionAssets: exactRun.reproductionAssets, snapshotDigest, initialState: exactRun.response.owner_replays?.attacker?.frames[0]?.visible_state ?? undefined });
      return exactRun.snapshot;
    }
    if (!packageValue || !nextRules || !draft || !editorCatalogMatchesRuleset(editorCatalog, packageValue)) {
      throw new PreflightProblem(editorCatalogError ?? "Core / RulePackage / Catalog が未準備です。読込後に再試行してください。", "unverified");
    }
    const campaignScenario = entryMode === "campaign" ? selectedScenario : null;
    if (entryMode === "campaign" && (!campaignScenario || !unlockedScenarioSet.has(campaignScenario.id))) {
      const message = "選択したCampaign Challengeは未解除か、現在のRulesetでは利用できません。";
      preflightStage.current = "scenario_selection";
      throw new PreflightProblem(message, "invalid", new PreflightLocalFailure(message, "invalid"));
    }
    preflightStage.current = "own_compile";
    const playerCompilation = activeCompilation ?? await compileTactics(draft.program_input.kind === "text"
      ? { kind: "text", source: draft.program_input.source, ruleset_ref: draft.ruleset }
      : { kind: "structured_ast", ast: draft.program_input.ast, ruleset_ref: draft.ruleset });
    const rivalDraft = campaignScenario?.npc ?? createTacticDraft(packageValue, nextRules, "defender");
    if (!sameRulesetRef(rivalDraft.ruleset, packageValue.ruleset) || stableKey(rivalDraft.schema_version) !== stableKey(packageValue.model_version)) {
      const message = "The selected opponent draft belongs to a different RulePackage or schema.";
      preflightStage.current = campaignScenario ? "scenario_selection" : "opponent_compile";
      throw new PreflightProblem(message, "invalid", campaignScenario ? new PreflightLocalFailure(message, "invalid") : undefined);
    }
    let rivalProgram: SenkeiSnapshot["program"];
    if (campaignScenario) {
      preflightStage.current = "opponent_compile";
      const input: TacticalInput = rivalDraft.program_input.kind === "text"
        ? { kind: "text", source: rivalDraft.program_input.source, ruleset_ref: rivalDraft.ruleset }
        : { kind: "structured_ast", ast: rivalDraft.program_input.ast, ruleset_ref: rivalDraft.ruleset };
      rivalProgram = (await core.compile(input)).program;
    } else {
      preflightStage.current = "opponent_compile";
      const rivalSource = createStarterJinrei(packageValue, "defender", rivalSlots);
      const revision = ++editorCompileRevision.current;
      const stamp = catalogStamp(editorCatalog);
      const envelope = await core.editorCompile({ source: rivalSource, stamp, revision });
      if (envelope.revision !== revision || !sameCatalog(stamp, envelope.reply.stamp)) throw new Error("NPC compiler identity mismatch.");
      if (envelope.reply.status === "rejected") {
        const { code, message, path } = envelope.reply.error;
        throw new PreflightProblem(`${code}${path ? ` at ${path}` : ""}: ${message}`, "invalid", {
          code: "compile_failed", message, path: path ?? null, details: {},
        });
      }
      rivalProgram = envelope.reply.result.program;
    }
    const attacker = makeSideSnapshot(draft, playerCompilation.program, slots);
    const opponentSlots = campaignScenario && nextRules ? scenarioFormation(campaignScenario, nextRules) : rivalSlots;
    const defender = makeSideSnapshot(rivalDraft, rivalProgram, opponentSlots);
    preflightStage.current = "context_creation";
    let context = await core.newMatchContext(packageValue.ruleset, stableMatchId({ ruleset: packageValue.ruleset, scenario_id: campaignScenario?.id ?? null, attacker, defender }));
    if (isTrial) {
      const policy = nextRules.projection_policy;
      if (!policy || !ownedAssets) throw new Error('Obtain and select owned Heroes before trial preflight.');
      if (!Number.isSafeInteger(trialTickLimit) || trialTickLimit < 1 || trialTickLimit > context.max_ticks) throw new Error('Invalid trial tick limit.');
      const approved = await approvedEquipmentDefinitions(packageValue);
      const owned = await readOwnedAssets(ownedAssets.playerId, approved);
      if (stableKey(owned) !== stableKey(ownedAssets)) throw new Error('Owned assets changed; refresh the owned assets panel and validate again.');
      const repository = new HeroRepository();
      const npcPlayer = `${owned.playerId}:local-npc`;
      const npcHeroes = await repository.obtainTrialRoster({requestId:`npc:${npcPlayer}:${policy.hero_catalog_digest}`,playerId:npcPlayer,catalog:{id:policy.hero_catalog_id,version:`${policy.hero_catalog_version.major}.${policy.hero_catalog_version.minor}.${policy.hero_catalog_version.patch}`,digest:policy.hero_catalog_digest,heroes:nextRules.heroes}});
      const npcSnapshot = await repository.snapshot(npcPlayer);
      const projection = await buildMatchProjection({policy,rulesetDigest:packageValue.ruleset.digest,approvedRulesetDigest:packageValue.ruleset.digest,
        attacker:{playerId:owned.playerId,heroSnapshot:owned.heroes,equipment:equipmentForDraft(owned.equipment, owned.playerId, equipmentDraft),relations:owned.relationships.events,slots:slots.map(slot => ({slotId:slot.slot_id,heroInstanceId:heroSelectionsForDraft(owned.playerId, owned.slotSelections, heroSelection)[slot.slot_id] ?? ''}))},
        defender:{playerId:npcPlayer,heroSnapshot:npcSnapshot,equipment:[],relations:[],slots:opponentSlots.map(slot => ({slotId:slot.slot_id,heroInstanceId:npcHeroes.find(hero => hero.definition.id === slot.catalog_id)?.instanceId ?? ''}))}});
      for (const slot of slots) if (projection.sides.attacker.heroes.find(hero => hero.slot_id === slot.slot_id)?.catalog_id !== slot.catalog_id) throw new PreflightProblem('Owned Hero does not match the current formation definition. Reselect the owned Hero for this slot.', 'invalid');
      if (stableKey(await readOwnedAssets(owned.playerId, approved)) !== stableKey(owned)) throw new Error('Assets changed during projection; validate again.');
      const baseBehavior = localTrialBehavior(packageValue.ruleset.digest, nextRules.heroes.map(hero => hero.id));
      const behavior = {...baseBehavior,inputs:behaviorInputs ?? baseBehavior.inputs};
      const minionBehavior = trialMinionObservations ? localTrialMinionBehavior(packageValue.ruleset.digest) : null;
      context = {...context,match_id:stableMatchId({ruleset:packageValue.ruleset,attacker,defender,projection,behavior,minionBehavior,trialTickLimit}),max_ticks:trialTickLimit,match_projection:projection,next_behavior:behavior,...(minionBehavior ? {next_minion_behavior:minionBehavior} : {})};
    }
    if (routeDraft) context = {...context,next_route:structuredClone(routeDraft),match_id:stableMatchId({match_id:context.match_id,routeDraft})};
    const snapshot = { attacker, defender, context };
    preflightStage.current = "snapshot_preflight";
    const reproductionAssets = await core.reproductionAssets(isTrial);
    if (canonicalKey(reproductionAssets.rule_package.ruleset) !== canonicalKey(packageValue.ruleset)) {
      const message = "Core reproduction assets do not match the currently loaded Next RulePackage.";
      throw new PreflightProblem(message, "invalid", new PreflightLocalFailure(message, "invalid"));
    }
    const snapshotDigest = await reproductionSnapshotDigest(snapshot);
    await core.preflightReproduction(snapshot, reproductionAssets, snapshotDigest);
    const inspection = isTrial ? await initialOwnedInspection(core, snapshot, reproductionAssets) : undefined;
    const initialState = inspection?.state;
    const initialEvidence = inspection ? {snapshot:inspection.snapshot,response:inspection.response,sourceReplay:inspection.replay,reproductionAssets,includeDiagnostics:true} : undefined;
    if (launchKeyRef.current !== key) {
      const message = "設定が変更されました。現在の設定を再検証してください。";
      preflightStage.current = "stale_inputs";
      throw new PreflightProblem(message, "unverified", new PreflightLocalFailure(message, "unverified"));
    }
    setPrepared({ key, snapshot, reproductionAssets, snapshotDigest, initialState,initialEvidence });
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
    catch (cause) {
      const classifiedCause = cause instanceof PreflightProblem ? cause.classificationCause ?? cause : cause;
      const problem = classifyPreflightProblem(classifiedCause, {
        stage: preflightStage.current,
        input: frozenRematch?.kind === "exact" ? "original_run" : "draft",
        inputKey: key,
        scenarioId: entryMode === "campaign" ? selectedScenario?.id ?? null : null,
        slots: {
          attacker: exactRun?.setup.slots ?? slots,
          defender: exactRun?.setup.rival_slots ?? rivalSlots,
        },
      });
      const source = (exactRun?.setup.draft ?? draft)?.program_input;
      setPreflightFailure({ key, problem: { ...problem, status: preflightFailureStatus(cause) },
        exactSource: source?.kind === "text" ? source.source : null });
    }
    finally { operationInFlight.current = false; setChecking(false); }
  };

  const launchBattle = async (): Promise<void> => {
    if (operationInFlight.current || !core || !readySnapshot || (!exactRun && !packageValue)) return;
    operationInFlight.current = true;
    setBusy(true);
    setScreen("running");
    setError(null);
    setRendererError(null);
    try {
      const ready = prepared?.key === launchKey ? prepared : null;
      if (!ready) throw new Error("Run readiness changed. Validate the current snapshot again.");
      const snapshot = ready.snapshot;
      if (isTrial && !exactRun) {
        if (!ownedAssets || !packageValue) throw new Error('Owned assets unavailable. Validate again.');
        const fresh = await readOwnedAssets(ownedAssets.playerId, await approvedEquipmentDefinitions(packageValue));
        if (stableKey(fresh) !== stableKey(ownedAssets)) { setOwnedAssets(fresh); throw new Error('Owned assets changed after preflight. Validate the current assets again.'); }
      }
      const setup = exactRun?.setup ?? buildSavedSetup();
      if (!setup) throw new Error("The launch draft is unavailable. Return to Ready and validate again.");
      const diagnosticsRequested = exactRun?.includeDiagnostics ?? includeDiagnostics;
      const estimatedCU = exactRun?.estimatedCU ?? activeCompilation?.estimated_cu;
      if (estimatedCU === undefined) throw new Error("The original compile estimate is unavailable. Validate the current Draft before launch.");
      const reproductionAssets = exactRun?.reproductionAssets ?? ready.reproductionAssets;
      if (!exactRun && (!packageValue || canonicalKey(reproductionAssets.rule_package.ruleset) !== canonicalKey(packageValue.ruleset))) {
        throw new Error("Core reproduction assets do not match the currently loaded Next RulePackage. No Run was started.");
      }
      const snapshotDigest = await reproductionSnapshotDigest(snapshot);
      if (snapshotDigest !== ready.snapshotDigest) {
        throw new Error("The snapshot changed after readiness validation. Validate it again before starting a Run.");
      }
      if (exactRun && frozenRematch?.kind !== "improved" && snapshotDigest !== exactRun.snapshotDigest) {
        throw new Error("The original Run snapshot no longer matches its saved identity. No Run was started.");
      }
      const response = await core.reproduce(snapshot, reproductionAssets, snapshotDigest, diagnosticsRequested
        ? { include_diagnostics: true, diagnostics_side: "attacker" }
        : { include_diagnostics: false });
      if (diagnosticsRequested && response.authorized_side !== "attacker") {
        throw new Error("The local Enbu did not confirm attacker authorization for the requested diagnostics.");
      }
      const sourceReplay = response.owner_replays?.attacker ?? response.outcome.presentation_replay;
      const graphicsReplay = presentationToGraphics(sourceReplay, reproductionAssets.rule_package, response.outcome.result, snapshot.context.versions.engine);
      const campaignAssociation = packageValue && sameRulesetRef(reproductionAssets.rule_package.ruleset, packageValue.ruleset)
        ? await verifyCampaignAssociation(core, reproductionAssets.rule_package, campaignScenarios, setup, snapshot)
        : null;
      if (campaignAssociation?.eligible && setup.campaign_scenario_id) {
        setCampaignProgress(previous => previous ? reduceCampaignProgress(previous, campaignScenarioIds, {
          scenario_id: setup.campaign_scenario_id ?? null, context: snapshot.context, result: response.outcome.result,
        }) : previous);
      }
      setBaselineRun(run);
      setRun({ ownedAssetKey: exactRun?.ownedAssetKey ?? (isTrial && !exactRun ? stableKey({ownedAssets,equipmentDraft,heroSelection,trialMinionObservations,behaviorInputs}) : undefined), campaignAssociation, experimentId: newExperimentId(snapshot.context.match_id), createdAt: new Date().toISOString(), snapshot,
        reproductionAssets, snapshotDigest, response, sourceReplay, graphicsReplay, setup, includeDiagnostics: diagnosticsRequested, estimatedCU });
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

  const exactCampaignRematch = (): void => {
    if (!run) return;
    // The frozen Snapshot drives the exact challenge's Ready display.
    // Keep the player's independent current Quick/Custom/Campaign selection
    // untouched so exiting exact replay returns to those same conditions.
    setExactRun(run);
    setPrepared(null); setScreen("ready");
  };

  const rematch = (): void => { setExactRun(null); if (run) setScreen("ready"); };

  const improveRematch = async (): Promise<void> => {
    if (operationInFlight.current || !run) return;
    const base = run;
    const key = launchKey;
    operationInFlight.current = true;
    setChecking(true);
    setError(null);
    try {
      const current = draftRef.current;
      if (!core || !packageValue || !current) throw new Error("Coreと現在Draftの読込後に、改良比較を再試行してください。");
      const ownCompilation = activeCompilation ?? await compileTactics(current.program_input.kind === "text"
        ? { kind: "text", source: current.program_input.source, ruleset_ref: current.ruleset }
        : { kind: "structured_ast", ast: current.program_input.ast, ruleset_ref: current.ruleset });
      if (launchKeyRef.current !== key || runRef.current !== base) throw new Error("比較元または現在条件が変更されました。改良比較を再試行してください。");
      const derived = buildImprovedRematch(base.snapshot, makeSideSnapshot(current, ownCompilation.program, slots));
      if (derived.status === "rejected") {
        throw new Error(`元Runの固定条件を保持できません（${derived.reason}: ${derived.paths.join(", ")}）。「新しい条件で対戦」で現在条件を検証してください。`);
      }
      if (derived.comparison.category !== "improved") throw new Error("自軍の変更対象が元Runと同じです。「同条件で再戦」を使うか、Hero・Skill・Squad・Jinreiを変更してください。");
      const currentSetup = buildSavedSetup();
      if (!currentSetup) throw new Error("現在Draftの保存対象を取得できません。Draftを保持して再試行してください。");
      setFrozenRematch({ kind: "improved", run: { ...base, snapshot: derived.snapshot,
        setup: { ...base.setup, saved_at: currentSetup.saved_at, draft: currentSetup.draft,
          slots: currentSetup.slots, formation_shape: currentSetup.formation_shape },
        estimatedCU: ownCompilation.estimated_cu } });
      setPrepared(null);
      setPreflightFailure(null);
      setScreen("ready");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "改良比較の入力を準備できませんでした。現在Draftは保持されています。");
    } finally { operationInFlight.current = false; setChecking(false); }
  };

  const prepareRetainedProgram = (compiled: CompileOutcome, source: string): void => {
    const base = runRef.current;
    if (!base || !base.includeDiagnostics || !sameRulesetRef(compiled.program.ruleset, base.snapshot.attacker.ruleset)) throw new Error('The retained owner Run changed. Select it again before preparing a rematch.');
    if (compiled.program.content_digest === base.snapshot.attacker.program.content_digest) throw new Error('The Program is unchanged. Use the original Run Snapshot rematch, or change its Jinrei.');
    const revised = {...base.setup.draft,revision:incrementRevision(base.setup.draft.revision),program_input:{kind:'text' as const,source}};
    const attacker = {...base.snapshot.attacker,revision:revised.revision,program:compiled.program};
    const derived = buildImprovedRematch(base.snapshot,attacker);
    if (derived.status === 'rejected' || derived.comparison.category !== 'improved') throw new Error('The original non-target inputs could not be retained for this Program.');
    setFrozenRematch({kind:'improved',run:{...base,snapshot:derived.snapshot,setup:{...base.setup,draft:revised},estimatedCU:compiled.estimated_cu}});
    setPrepared(null);setPreflightFailure(null);setError(null);setScreen('ready');
  };

  const editScreen = (target: AtelierScreen | "jinrei"): void => {
    setHeroRepairFocus(null); setJinreiRepairFocus(null); setScenarioRepairFocus(null);
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

  const repairPreflight = (target: PreflightRepairTarget): void => {
    const failure = currentPreflightError;
    if (!failure || failure.problem.inputKey !== launchKeyRef.current
      || stableKey(failure.problem.repair) !== stableKey(target)) return;
    const requestId = newExperimentId("preflight-repair");
    switch (target.kind) {
      case "own_hero":
        setJinreiRepairFocus(null); setScenarioRepairFocus(null);
        setHeroRepairFocus({ requestId, target });
        setExactRun(null); setScreen("workspace"); setTab("formation"); setAtelierScreen(target.screen);
        break;
      case "own_jinrei":
        setHeroRepairFocus(null); setScenarioRepairFocus(null);
        setJinreiRepairFocus({ requestId, target, exactSource: currentPreflightError?.exactSource ?? null });
        setExactRun(null); setScreen("workspace"); setTab("jinrei"); setJinreiScreen("workbench");
        break;
      case "scenario":
        setHeroRepairFocus(null); setJinreiRepairFocus(null);
        setScenarioRepairFocus({ requestId, scenarioId: target.scenarioId });
        setExactRun(null); setScreen("conditions");
        break;
      case "ready":
        setHeroRepairFocus(null); setJinreiRepairFocus(null); setScenarioRepairFocus(null);
        setScreen("ready"); void checkReadiness();
        break;
      case "recovery":
        setHeroRepairFocus(null); setJinreiRepairFocus(null); setScenarioRepairFocus(null);
        openLibrary("recovery");
        break;
    }
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

  const campaignSummary = activeCampaignProgress && campaignScenarioIds.length ? campaignCompletionSummary(activeCampaignProgress, campaignScenarioIds) : null;
  const completedScenarioIndex = campaignFeedback ? campaignScenarios.findIndex(scenario => scenario.id === campaignFeedback.scenarioId) : -1;
  const followingScenario = completedScenarioIndex >= 0 ? campaignScenarios[completedScenarioIndex + 1] ?? null : null;
  const nextCampaignScenario = followingScenario && unlockedScenarioSet.has(followingScenario.id) ? followingScenario : null;
  const campaignRunActions = campaignFeedback && run ? {
    title: campaignFeedback.scenario.title, status: campaignFeedback.status,
    finalScenario: completedScenarioIndex === campaignScenarios.length - 1,
    allRecordedComplete: campaignSummary?.allRecordedComplete ?? false,
    nextTitle: nextCampaignScenario?.title ?? null, busy,
    onNext: () => { if (!nextCampaignScenario || campaignFeedback.status !== "victory") return; setExactRun(null); setPrepared(null); setEntryMode("campaign"); setSelectedScenarioId(nextCampaignScenario.id); setScreen("preset"); },
    onRetry: exactCampaignRematch,
    onImprove: () => { setEntryMode("campaign"); setSelectedScenarioId(campaignFeedback.scenarioId); editScreen("jinrei"); },
    onResult: openAnalysis, onHome: () => setScreen("home"),
  } : null;

  const library = <NextLibrary view={libraryView} onViewChange={setLibraryView}
    saved={savedSetup} recovery={recoverySetup} savedRaw={savedRaw} recoveryRaw={recoveryRaw} restoreDifferences={restoreDifferences}
    savedError={savedSetupError} recoveryError={recoveryLoadError}
    runtimeError={rulesetError ?? editorCatalogError ?? rendererError ?? error ?? runtimeFailure ?? currentPreflightError?.problem.message}
    savedMismatch={savedSetupMismatchReason} recoveryMismatch={recoveryMismatchReason}
    message={saveMessage} loaded={savedSetupLoaded && recoverySetupLoaded} canSave={Boolean(draft && packageValue)}
    onSave={() => saveSetup(true)} onRestoreSaved={() => { restoreSetup(); setScreen("ready"); }} onRestoreRecovery={restoreRecovery}
    onExportCurrent={exportCurrentSetup} onExportSaved={exportSavedSetup}
    onExportRecovery={() => { if (recoverySetup) exportSetup(recoverySetup, "senkei-next-recovery.json"); }}
    onExportRawSaved={() => exportRawSetup("saved")} onExportRawRecovery={() => exportRawSetup("recovery")}
    onImport={file => importSetupFile(file, true)} onClearSaved={clearSavedSetup} onClearRecovery={clearRecoveryCopy}
    onRetryStorage={async () => {
      const pending = experimentPendingStore.current;
      if (pending) {
        const generation = ++experimentPersistGeneration.current;
        try {
          await enqueueExperimentWrite(async () => {
            if (generation !== experimentPersistGeneration.current) {
              throw new PersistenceError("conflict", "The completed Run changed during storage retry.");
            }
            await saveNextExperimentStore(pending, () => {
              if (generation !== experimentPersistGeneration.current) {
                throw new PersistenceError("conflict", "The completed Run changed during storage retry.");
              }
            });
          });
          if (generation === experimentPersistGeneration.current) {
            experimentPendingStore.current = null;
            setExperimentStore(pending);
            setExperimentError(null);
          }
        } catch (cause) {
          if (generation === experimentPersistGeneration.current) {
            setExperimentError(cause instanceof Error ? `Experiment could not be saved: ${cause.message}` : "Experiment could not be saved.");
          }
          throw cause;
        }
      } else {
        setExperimentReloadAttempt(attempt => attempt + 1);
      }
      setStorageAttempt(attempt => attempt + 1);
    }}
    onRetryCore={() => { setRuntimeFailure(null); setError(null); onRetryCore(); setCatalogAttempt(attempt => attempt + 1); }}
    onReady={() => { setExactRun(null); setScreen("ready"); }} onBack={() => setScreen(libraryReturn)}
    experiments={((experimentPendingStore.current ?? experimentStore)?.experiments ?? []).map((item) => {
      const associated = [run, baselineRun].find(candidate => candidate?.experimentId === item.id && candidate.snapshot === item.snapshot && candidate.campaignAssociation?.eligible);
      const scenario = associated ? campaignScenarios.find(candidate => candidate.id === associated.campaignAssociation?.scenarioId) : null;
      const result = item.response?.outcome?.result;
      return { id: item.id, created_at: item.created_at, ruleset: item.reproduction_assets.rule_package.ruleset, scenario_title: scenario?.title ?? null,
        outcome: typeof result?.outcome === "string" ? result.outcome : "unverified",
        final_tick: Number.isSafeInteger(result?.final_tick) ? result.final_tick : null };
    })}
    experimentsLoaded={experimentStorageLoaded}
    canExportExperiments={experimentPreservedRaw !== null || Boolean((experimentPendingStore.current ?? experimentStore)?.experiments.length)}
    hasPreservedExperiments={experimentPreservedRaw !== null}
    experimentsCompatible={Boolean(core && packageValue && experimentLoadedDigest === packageValue.ruleset.digest && !experimentMismatch)}
    experimentError={experimentError} experimentMismatch={experimentMismatch}
    onOpenExperiments={() => {
      if (!core || experimentLoadedDigest !== packageValue?.ruleset.digest || experimentMismatch || !run) throw new Error(experimentMismatch ?? "No verified Next experiment is available.");
      setTab("analysis"); setScreen("workspace");
    }}
    onExportExperiments={() => {
      const available = experimentPendingStore.current ?? experimentStore;
      if (!experimentPreservedRaw && !available) throw new Error("There are no Next experiments to export.");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([experimentPreservedRaw ?? serializeNextExperimentStore(available!)], { type: "application/json" }));
      link.download = `senkei-next-experiments${experimentPreservedRaw ? "-preserved" : ""}.json`;
      link.click(); window.setTimeout(() => URL.revokeObjectURL(link.href), 0);
    }}
    onImportExperiments={async (file) => {
      const request = ++experimentImportGeneration.current;
      const generation = experimentPersistGeneration.current;
      const runtime = experimentRuntime.current;
      if (!runtime.core || !runtime.packageValue?.next) throw new Error("Core and a loaded Next runtime are required to reproduce imported Runs. Existing experiments were preserved.");
      const current = () => request === experimentImportGeneration.current && generation === experimentPersistGeneration.current
        && experimentRuntime.current.core === runtime.core && experimentRuntime.current.packageValue === runtime.packageValue;
      assertNextExperimentImportSize(file.size);
      const imported = parseNextExperimentStore(JSON.parse(await file.text()) as unknown);
      const restored = await prepareNextExperimentStore(imported, runtime.packageValue, runtime.core, campaignScenarios);
      await enqueueExperimentWrite(async () => {
        if (!current()) throw new Error("The runtime or completed Runs changed during import. Existing experiments were preserved; review the file again.");
        await saveNextExperimentStore(imported, () => {
          if (!current()) throw new PersistenceError("conflict", "The runtime or completed Runs changed during import. Existing experiments were preserved; review the file again.");
        });
      });
      if (!current()) return;
      experimentPersistGeneration.current += 1;
      experimentPendingStore.current = null;
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
      experimentPendingStore.current = null;
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
          <div><strong>{rulesetError || error ? "Next ruleset unavailable" : "Loading the local battle rules"}</strong><p>{rulesetError ?? error ?? "The app is requesting the bundled Next ruleset from the local Rust core."}</p><button type="button" onClick={trialPending ? () => void enableTrial() : onRetryCore}>読込を再試行</button><button type="button" onClick={() => openLibrary("recovery")}>保存・復旧へ</button></div>
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

      {prepared?.key === launchKey && prepared.reproductionAssets && <FrozenAssetsPreview snapshot={prepared.snapshot} assets={prepared.reproductionAssets} initialState={prepared.initialState}/>}
      {error && <div className="next-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
      {campaignProgressError && <div className="next-error" role="alert" data-testid="campaign-storage-error"><div><p>{campaignProgressError}</p><p>Local PvE remains free to run. Existing completion history is not reset; the displayed session state is not a successful storage save.</p><button type="button" onClick={() => campaignProgressReadBlocked ? setCampaignProgressAttempt(attempt => attempt + 1) : setCampaignProgressError(null)}>{campaignProgressReadBlocked ? "Retry campaign storage" : "Retry progress save"}</button>{campaignProgressRaw.current !== null && <button type="button" onClick={() => exportCampaignProgress("current")}>Export preserved v2 progress</button>}{campaignProgressRaw.legacy !== null && <button type="button" onClick={() => exportCampaignProgress("legacy")}>Export preserved legacy progress</button>}</div></div>}
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

      {exactRun && screen === "ready" && <div className="next-exact-rematch" role="status"><strong>{frozenRematch?.kind === "improved" ? "改良比較 · 自軍以外は元Runに固定" : "同条件再戦 · 元Runの確定Snapshot"}</strong><p>{frozenRematch?.kind === "improved" ? "自軍のHero・Skill・Squad・Jinreiの変更対象だけを差し替えます。相手・World・初期状態・上限・実行版・Match IDは元Runの値です。" : "表示中の編成と戦術は元の試合のものです。"} 編集中Draftと現在の対戦選択は保持されています。</p><button type="button" onClick={() => setExactRun(null)}>現在のDraftで準備する</button></div>}
      <p className="journey-draft-status" hidden={screen === "workspace" && tab === "battle"}>{draft?.id} · {draftIsSaved ? "保存済み" : savedSetup ? "未保存の変更あり" : "未保存Draft"} · {activeCompilation ? "Compiled" : compilation ? "Compile失効" : "未コンパイル"}</p>
      <JourneyScreens screen={screen === "resume" ? "workspace" : screen} setScreen={next => next === "resume" ? openLibrary() : setScreen(next)} entryMode={exactRun ? exactRun.campaignAssociation?.eligible ? "campaign" : "quick" : entryMode} setEntryMode={mode => { setExactRun(null); setEntryMode(mode); }}
        slots={exactRun?.setup.slots ?? slots} rivalSlots={exactRun?.setup.rival_slots ?? rivalSlots} nextRules={nextRules} packageValue={packageValue} draft={exactRun?.setup.draft ?? draft}
        ready={Boolean(readySnapshot)} checking={checking} failure={currentPreflightError?.problem ?? null} onRepair={repairPreflight} scenarioRepairFocus={scenarioRepairFocus}
        compiled={Boolean(exactRun || activeCompilation)} compilationCU={exactRun?.estimatedCU ?? activeCompilation?.estimated_cu ?? null} stale={Boolean(compilation && !activeCompilation)}
        coreReady={Boolean(core && editorCatalogMatchesRuleset(editorCatalog, packageValue))}
        includeDiagnostics={exactRun?.includeDiagnostics ?? includeDiagnostics} setIncludeDiagnostics={setRematchDiagnostics}
        check={() => void checkReadiness()} launch={() => void launchBattle()}
        edit={editScreen}
        recoveryRestored={recoveryRestored} saved={canRestoreSavedSetup}
        newPreset={() => {
          if (!nextRules || !packageValue) return;
          const playerSlots = defaultSlots(nextRules, "attacker", DEFAULT_HERO_IDS);
          setSlots(playerSlots); setRivalSlots(defaultSlots(nextRules, "defender", DEFAULT_RIVAL_IDS));
          setFormationShape("single"); updateDraft(createTacticDraft(packageValue, nextRules, "attacker"));
          setPrepared(null); setPreflightFailure(null); setScreen("preset");
        }} scenarios={campaignScenarios} selectedScenarioId={exactRun ? exactRun.campaignAssociation?.eligible ? exactRun.campaignAssociation.scenarioId : "" : selectedScenario?.id ?? ""}
        onScenarioChange={selectCampaignScenario} unlockedScenarioIds={unlockedScenarioIds} campaignProgress={activeCampaignProgress}
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
            <details><summary>Local ownership and runtime</summary>
              <p>Test policies are unapproved for production. Enabling trial mode creates a separate ruleset digest and trial Draft. Official ownership is not configured.</p>
              {!isTrial ? <button type="button" onClick={() => void enableTrial()}>Enable test-only owned runtime</button> : <>
                <p role="status">Test-only six-domain runtime enabled</p>
                <button type="button" onClick={() => { try { localStorage.removeItem('senkei.local-trial-enabled.v1'); setTrialPackage(null); setTrialPending(false); setOwnedAssets(null); } catch (cause) { setError(String(cause)); } }}>Return to ordinary local draft</button>
                <label><input type="checkbox" checked={trialMinionObservations} onChange={event => { setTrialMinionObservations(event.target.checked); if (event.target.checked) setIncludeDiagnostics(true); setPrepared(null); setExactRun(null); }} /> Collect local trial MID Minion observations</label><p>Optional owner diagnostics for the existing automatic march; this does not issue Minion orders. Long runs can exceed the diagnostic budget.</p>
                <label>Trial tick limit <input type="number" min={1} max={packageValue.termination.max_ticks} value={trialTickLimit} onChange={event => setTrialTickLimit(Number(event.target.value))}/></label>
                <OwnedAssetsPanel onSquadDraftChange={change => {
                  const index = slots.findIndex(slot => slot.slot_id === change.slotId);
                  if (index < 0) throw new Error('The selected Hero is no longer in this Draft.');
                  changeSlot(index, {squad:change.squadId,node:change.nodeId}); setPrepared(null); setExactRun(null);
                }} previewSquadChange={async change => {
                  if (!core || !prepared || prepared.key !== launchKey || exactRun || !draft || !ownedAssets || !packageValue) throw new Error('Validate the current formation in Ready before comparing Squads.');
                  const key = launchKey;
                  const fresh = await readOwnedAssets(ownedAssets.playerId, await approvedEquipmentDefinitions(packageValue));
                  if (stableKey(fresh) !== stableKey(ownedAssets)) throw new Error('Owned assets changed. Refresh and validate again.');
                  if (!slots.some(slot => slot.slot_id === change.slotId)) throw new Error('Selected Hero is unavailable.');
                  const hypothetical = slots.map(slot => slot.slot_id === change.slotId ? {...slot,squad:change.squadId,node:change.nodeId} : slot);
                  const snapshot = {...prepared.snapshot,attacker:makeSideSnapshot(draft,prepared.snapshot.attacker.program,hypothetical)};
                  await core.preflightReproduction(snapshot,prepared.reproductionAssets,await reproductionSnapshotDigest(snapshot));
                  const state = await initialOwnedState(core,snapshot,prepared.reproductionAssets);
                  if (launchKeyRef.current !== key) throw new Error('The Draft changed during comparison. Review the pair again.');
                  return state;
                }} equipmentBaseline={prepared?.key === launchKey ? prepared.initialState : null} previewEquipment={async candidate => {
                  if (!core || !prepared || prepared.key !== launchKey || exactRun || !ownedAssets || !packageValue) throw new Error('Validate the current formation in Ready, then return here to compare equipment.');
                  const key = launchKey;
                  const fresh = await readOwnedAssets(ownedAssets.playerId, await approvedEquipmentDefinitions(packageValue));
                  if (stableKey(fresh) !== stableKey(ownedAssets)) throw new Error('Owned assets changed. Refresh and validate again.');
                  const state = await previewOwnedEquipment(core, prepared.snapshot, prepared.reproductionAssets, fresh, heroSelection, candidate);
                  if (launchKeyRef.current !== key) throw new Error('The Draft changed during comparison. Review equipment again.');
                  return state;
                }} heroSelections={heroSelection} equipmentDraft={equipmentDraft} onEquipmentDraftChange={next => { setEquipmentDraft(structuredClone(next)); setPrepared(null); setExactRun(null); }} ruleset={packageValue} slots={slots.map(slot => ({...slot,squad_id:slot.squad,node_id:slot.node}))} onSelectOwnedHero={selectOwnedHero} onAssetsChanged={setOwnedAssets}/>
              </>}
            </details>
            {!isTrial && <LocalAssets />}
            <HeroAtelier active={active && screen === "workspace" && tab === "formation"} repairFocus={heroRepairFocus} nextRules={nextRules} slots={slots} activeSlot={activeSlot} screen={atelierScreen}
              skillRunContext={run && sameRulesetRef(run.snapshot.attacker.ruleset, packageValue.ruleset) ? {
                experimentId: run.experimentId,
                matchId: run.snapshot.context.match_id,
                ruleset: run.snapshot.attacker.ruleset,
                authorizedSide: run.response.authorized_side,
                ownerReplay: run.response.owner_replays?.attacker ?? null,
                submittedHeroes: run.snapshot.attacker.configuration.heroes,
                tick: displayState?.tick ?? -1,
              } : null}
              onActiveSlotChange={setActiveSlot} onScreenChange={setAtelierScreen} onSlotChange={changeSlot}
              onSquadPattern={applySquadPattern} onMoveSquad={moveSquad}
              onReady={() => { setExactRun(null); setScreen("ready"); }} onJinrei={() => editScreen("jinrei")}
              canActivate={Boolean(packageValue.domain.capabilities.activate)}
              activateArgumentIds={packageValue.domain.capabilities.activate?.arguments.map(argument => argument.id) ?? []} />
          </section>

          <section aria-labelledby="next-tab-jinrei" className="next-panel next-jinrei-panel" hidden={tab !== "jinrei"} id="next-panel-jinrei" role="tabpanel">
            {isTrial && <TrialProfileEditor inputs={behaviorInputs} onApply={next => {setBehaviorInputs(structuredClone(next));setPrepared(null);setExactRun(null);}} slots={slots} ownerRun={runIsCurrent ? run : prepared?.key === launchKey ? prepared.initialEvidence : null} ownerRunCurrent={runIsCurrent || Boolean(prepared?.key === launchKey && prepared.initialEvidence)} catalog={editorCatalogMatchesRuleset(editorCatalog,packageValue) ? editorCatalog : null} programDigest={activeCompilation?.program.content_digest} />}
            <RoutePlanEditor rulePackage={packageValue} run={run} runCurrent={Boolean(run && draft && activeCompilation && sameRulesetRef(run.snapshot.attacker.ruleset,packageValue.ruleset) && canonicalKey(makeSideSnapshot(draft,activeCompilation.program,slots)) === canonicalKey(run.snapshot.attacker))} routeDraft={routeDraft} onApply={next => {setRouteDraft(next ? structuredClone(next) : null);setPrepared(null);setExactRun(null);}} />
            <JinreiWorkbench coverageRulePackage={packageValue} coverageRun={run} coverageRunCurrent={runIsCurrent} coverageTick={displayState?.tick ?? null} onCoverageReplayTick={tick => { player?.pause(); player?.seek(tick); setTab("battle"); }} analysisSource={analysisSource?.context.experimentId === run?.experimentId ? analysisSource : null} repairFocus={jinreiRepairFocus} onReturnToAnalysis={() => { if (analysisSource && analysisSource.context.experimentId === run?.experimentId) setAnalysisContext(analysisSource.context); setTab("analysis"); setScreen("workspace"); }} active={active && screen === "workspace" && tab === "jinrei"} core={core} ruleset={tacticsRuleset}
              catalog={editorCatalogMatchesRuleset(editorCatalog, packageValue) ? editorCatalog : null}
              catalogError={editorCatalogError} draft={draft} draftKey={compilerContextKey}
              compilation={activeCompilation} compilationStamp={activeCompilation && compilation?.stamp ? compilation.stamp : null} slots={slots} activeSlot={activeSlot}
              screen={jinreiScreen} onScreenChange={setJinreiScreen} onActiveSlotChange={setActiveSlot}
              onDraftChange={updateDraft} onSourceChange={updateFoundationSource}
              onCompile={async input => {
                try { const result = await compileTactics(input); setRuntimeFailure(null); return result; }
                catch (cause) { setRuntimeFailure(cause instanceof Error ? cause.message : String(cause)); throw cause; }
              }} onCompiled={onCatalogCompile}
              onReady={() => { setExactRun(null); setScreen("ready"); }} onFormation={() => editScreen("squads")} />
          </section>

          <section aria-labelledby="next-tab-battle" className={`next-panel next-battle-panel${campaignRunActions ? " has-campaign-result" : ""}`} hidden={tab !== "battle" || screen !== "workspace"} id="next-panel-battle" role="tabpanel">
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
              {run.campaignAssociation && !run.campaignAssociation.eligible && <p className="next-save-message" role="status">Reference Run · {run.campaignAssociation.reason} This result does not record Campaign completion.</p>}
              <PostMatchProgression matchId={runResult.match_id} winner={formatId(runResult.outcome)} />
              {campaignRunActions && <CampaignRunActions {...campaignRunActions} />}
              <nav className="next-battle-mobile-tabs" aria-label="Battlefield console" data-testid="battle-mobile-console">
                {([ ["battle", "Battle"], ["overview", "Overview"], ["follow", "Follow"], ["timeline", "Timeline"], ["details", "Details"] ] as const).map(([view, label]) => <button aria-label={`${label} view`} aria-pressed={battleMobileView === view} className={battleMobileView === view ? "is-active" : ""} key={view} onClick={() => setBattleView(view)} type="button"><span>{view === "battle" ? "⌖" : view === "overview" ? "◇" : view === "follow" ? "◎" : view === "timeline" ? "≋" : "◉"}</span>{label}</button>)}
              </nav>
            </> : <div className="next-empty-battle"><span className="next-empty-glyph">⌁</span><strong>Battlefield is waiting</strong><p>Compile the current Jinrei draft, then launch five heroes against the local rival.</p><button className="next-secondary-button" onClick={() => setTab(activeCompilation ? "formation" : "jinrei")} type="button">{activeCompilation ? "Review formation" : "Open Jinrei editor"} <b>→</b></button></div>}
          </section>

          <section aria-labelledby="next-tab-analysis" className="next-panel next-analysis-panel" hidden={tab !== "analysis"} id="next-panel-analysis" role="tabpanel">
            <RetainedProgramEditor core={core} run={run} source={run?.setup.draft.program_input ?? null} onPrepared={prepareRetainedProgram} />
            <NextDecisionInspector core={core} run={run} selectedTick={displayState?.tick ?? null} onReplayTick={tick => {player?.pause();player?.seek(tick);setTab("battle");}} />
            <AutonomousDecisions core={core} run={run} onReplayTick={tick => { player?.pause(); player?.seek(tick); setTab("battle"); }} />
            <BattleAnalysis context={analysisContext} traceSourceStatus={traceSourceStatus} onTraceSource={inspectTraceSource} run={run} baselineRun={baselineRun} draftChanged={!runIsCurrent} busy={busy || checking}
              onReplayEvent={inspectReplayEvent}
              onReplayTick={tick => { player?.pause(); player?.seek(tick); setTab("battle"); }}
              onBattle={() => setTab("battle")} onEdit={editScreen}
              campaignScenario={campaignFeedback?.scenario ?? null} campaignFeedback={campaignFeedback} campaignActions={campaignRunActions} campaignReferenceReason={run?.campaignAssociation && !run.campaignAssociation.eligible ? run.campaignAssociation.reason : null}
              onExactRematch={exactCampaignRematch}
              onImprovedRematch={() => void improveRematch()}
              onRevisedRematch={rematch} />
          </section>
        </div>
      </div>
      </div>
    </section>
  );
}
