import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Battlefield as BattlefieldRenderer } from "@senkei/renderer";
import { Battlefield } from "@senkei/renderer";
import { presentationToGraphics, NEXT_WORLD_UNITS_PER_RENDER_UNIT, type Replay, type DisplayState, type Event as GraphicsEvent, type WorldPoint } from "@senkei/replay-contract";
import { ReplayPlayer } from "@senkei/replay-player";
import {
  type CoreClient,
  type CoreVersion,
  type DomainValue,
  type HeroDefinition,
  type MatchResult,
  type NextRules,
  type PresentationEvent,
  type PresentationReplay,
  type ReplayFrame,
  type RestrictedDiagnostics,
  type RulePackage,
  type SenkeiSnapshot,
  type SimulationOutcome,
  type SimulationResponse,
  type SimulationSnapshot,
  type TacticalInput,
  type TacticalSource,
  type RulesetRef,
} from "../../contracts";
import type { SenkeiDraft } from "../../contracts";
import { EditorFeature } from "../editor";
import { isDomainValueRecord, isStructuredTacticsAst } from "./draft-validation";
import "./next-workspace.css";

const SLOT_IDS = ["slot-01", "slot-02", "slot-03", "slot-04", "slot-05"] as const;
const DEFAULT_HERO_IDS = ["F01", "F03", "F06", "R02", "R04"] as const;
const DEFAULT_RIVAL_IDS = ["R01", "R03", "R05", "F02", "F04"] as const;
const NEXT_STORAGE_KEY = "senkei.next-workspace.v1";
const NEXT_RECOVERY_KEY = "senkei.next-workspace-recovery.v1";
const VISIBLE_ENTITY_CLUSTER_RADIUS = 0.8;

type WorkspaceTab = "formation" | "jinrei" | "battle" | "analysis";
type AtelierScreen = "collection" | "detail" | "skills" | "squads";
type Side = "attacker" | "defender";
type HeroFilter = "placement" | "role" | "trait_id";
type FormationShape = "single" | "three-lane" | "wings" | "custom";
type BattlefieldMobileView = "battle" | "overview" | "follow" | "timeline" | "details";
type BattlefieldCameraMode = "tactical" | "overview";

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
  readonly snapshot: SimulationSnapshot;
  readonly response: SimulationResponse;
  readonly sourceReplay: PresentationReplay;
  readonly graphicsReplay: Replay;
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
}

interface WorkspaceProps {
  readonly active: boolean;
  readonly core: CoreClient | null;
  readonly ruleset: RulePackage | null;
  readonly rulesetError: string | null;
}

const TABS: readonly { readonly id: WorkspaceTab; readonly label: string; readonly number: string }[] = [
  { id: "formation", label: "Formation", number: "01" },
  { id: "jinrei", label: "Jinrei", number: "02" },
  { id: "battle", label: "Battle", number: "03" },
  { id: "analysis", label: "Analysis", number: "04" },
];

const ATELIER_SCREENS: readonly { readonly id: AtelierScreen; readonly label: string; readonly hint: string }[] = [
  { id: "collection", label: "Hero Collection", hint: "01 / CHOOSE FIVE" },
  { id: "detail", label: "Hero Detail", hint: "02 / CATALOG DATA" },
  { id: "skills", label: "Skill Tree", hint: "03 / PLAN LEVEL UPS" },
  { id: "squads", label: "Squad Assembly", hint: "04 / FORM SQUADS" },
];

const SQUAD_PATTERNS: readonly { readonly id: string; readonly sizes: readonly number[] }[] = [
  { id: "1+1+1+1+1", sizes: [1, 1, 1, 1, 1] },
  { id: "2+1+1+1", sizes: [2, 1, 1, 1] },
  { id: "2+2+1", sizes: [2, 2, 1] },
  { id: "3+1+1", sizes: [3, 1, 1] },
  { id: "3+2", sizes: [3, 2] },
  { id: "4+1", sizes: [4, 1] },
  { id: "5", sizes: [5] },
];

function stableKey(value: unknown): string {
  return JSON.stringify(value);
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
  if (!ruleset || !schemaVersion || !mechanicsVersion || !slots || !rivalSlots || !draft || typeof value.rival_source !== "string") return null;
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
  if (setup.draft.ruleset.digest !== packageValue.ruleset.digest ||
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

function firstLaneNode(rules: NextRules, lane: string, side: Side): string {
  const nodes = rules.map.lanes[lane];
  if (!nodes?.length) return side === "attacker" ? rules.map.attacker_base : rules.map.defender_base;
  const laneNodes = nodes.filter((node) => node !== rules.map.attacker_base && node !== rules.map.defender_base);
  if (laneNodes.length === 0) return side === "attacker" ? rules.map.attacker_base : rules.map.defender_base;
  return side === "attacker" ? laneNodes[0] : laneNodes[laneNodes.length - 1];
}

function makeFormation(
  rules: NextRules,
  current: readonly FormationSlot[],
  side: Side,
  shape: "single" | "three-lane" | "wings",
): FormationSlot[] {
  const base = side === "attacker" ? rules.map.attacker_base : rules.map.defender_base;
  return current.map((slot, index) => {
    if (shape === "single") return { ...slot, squad: "alpha", node: base };
    if (shape === "three-lane") {
      const lane = (["top", "mid", "bot", "top", "bot"] as const)[index] ?? "mid";
      return { ...slot, squad: lane, node: firstLaneNode(rules, lane, side) };
    }
    const lane = index === 2 ? "mid" : index < 2 ? "top" : "bot";
    return { ...slot, squad: index < 2 ? "north" : index === 2 ? "center" : "south", node: firstLaneNode(rules, lane, side) };
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

function findHero(rules: NextRules, catalogId: string): HeroDefinition | null {
  return rules.heroes.find((hero) => hero.id === catalogId) ?? null;
}

function skillNames(hero: HeroDefinition | null, pathName: string): string[] {
  if (!hero) return [];
  const path = hero.skill_paths[pathName] ?? [];
  return path.map((id) => hero.skills.find((skill) => skill.id === id)?.name ?? id);
}

function formationGroupsPattern(slots: readonly FormationSlot[]): string {
  const counts = new Map<string, number>();
  for (const slot of slots) counts.set(slot.squad, (counts.get(slot.squad) ?? 0) + 1);
  return [...counts.values()].sort((left, right) => right - left).join("+");
}

function skillPathPrerequisiteIssues(hero: HeroDefinition, path: string): readonly string[] {
  const ids = hero.skill_paths[path] ?? [];
  return ids.flatMap((id, index) => {
    const skill = hero.skills.find((item) => item.id === id);
    if (!skill) return [`The selected path references missing skill ${id}.`];
    return skill.prerequisites.flatMap((prerequisiteId) => {
      const prerequisite = hero.skills.find((item) => item.id === prerequisiteId);
      const prerequisiteIndex = ids.indexOf(prerequisiteId);
      if (!prerequisite) return [`${skill.name} requires unknown skill ${prerequisiteId}.`];
      if (prerequisiteIndex < 0) return [`${skill.name} requires ${prerequisite.name}, which is not in this path.`];
      if (prerequisiteIndex >= index) return [`${prerequisite.name} must appear before ${skill.name}.`];
      return [];
    });
  });
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

function domainLabel(value: DomainValue): string {
  if (value.kind === "null") return "—";
  if (value.kind === "string" || value.kind === "enum" || value.kind === "entity") return value.value;
  if (value.kind === "integer" || value.kind === "bool") return String(value.value);
  if (value.kind === "fixed") return String(value.value.coefficient / (10 ** value.value.scale));
  if (value.kind === "list") return value.value.map(domainLabel).join(", ");
  return Object.entries(value.value).map(([key, item]) => `${key}: ${domainLabel(item)}`).join(" · ");
}

function signed(value: number): string {
  if (value === 0) return "0";
  return value > 0 ? `+${value}` : `−${Math.abs(value)}`;
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

function diagnosticDetails(diagnostics: RestrictedDiagnostics): readonly { tick: number; side: Side; text: string }[] {
  return diagnostics.events.map((event) => {
    const record = event.record;
    if (record.kind === "intent_proposed" || record.kind === "intent_accepted" || record.kind === "intent_rejected") {
      return { tick: event.tick, side: event.side, text: `${record.kind.replaceAll("_", " ")}: ${record.value.intent.capability}${record.value.intent.actor ? ` · ${record.value.intent.actor}` : ""}${"reason" in record.value ? ` · ${record.value.reason}` : ""}` };
    }
    if (record.kind === "cost_charged") return { tick: event.tick, side: event.side, text: `CU ${record.value.operation}: ${record.value.amount}` };
    if (record.kind === "state_evaluated") return { tick: event.tick, side: event.side, text: `State ${record.value.state}: ${record.value.result}` };
    if (record.kind === "runtime_notice") return { tick: event.tick, side: event.side, text: `${record.value.code}${Object.keys(record.value.details).length ? ` · ${Object.values(record.value.details).join(" · ")}` : ""}` };
    return { tick: event.tick, side: event.side, text: record.kind.replaceAll("_", " ") };
  });
}

export function NextWorkspace({ active, core, ruleset: packageValue, rulesetError }: WorkspaceProps): ReactElement {
  const nextRules = packageValue?.next ?? null;
  const [tab, setTab] = useState<WorkspaceTab>("formation");
  const [atelierScreen, setAtelierScreen] = useState<AtelierScreen>("collection");
  const [saveDetailsOpen, setSaveDetailsOpen] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 761px)").matches);
  const [slots, setSlots] = useState<FormationSlot[]>([]);
  const [rivalSlots, setRivalSlots] = useState<FormationSlot[]>([]);
  const [formationShape, setFormationShape] = useState<FormationShape>("single");
  const [activeSlot, setActiveSlot] = useState(0);
  const [filters, setFilters] = useState<Record<HeroFilter, string>>({ placement: "all", role: "all", trait_id: "all" });
  const [minHp, setMinHp] = useState(0);
  const [draft, setDraft] = useState<SenkeiDraft | null>(null);
  const draftRef = useRef<SenkeiDraft | null>(null);
  const [compilation, setCompilation] = useState<{ readonly key: string; readonly result: import("../../contracts").CompileOutcome } | null>(null);
  const [run, setRun] = useState<BattleRun | null>(null);
  const [baselineRun, setBaselineRun] = useState<BattleRun | null>(null);
  const [busy, setBusy] = useState(false);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [battleMobileView, setBattleMobileView] = useState<BattlefieldMobileView>("battle");
  const [battleInspectorOpen, setBattleInspectorOpen] = useState(false);
  const [battleRosterOpen, setBattleRosterOpen] = useState(false);
  const [expandedVisibleClusterId, setExpandedVisibleClusterId] = useState<string | null>(null);
  const [battleMapContextOpen, setBattleMapContextOpen] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 761px)").matches);
  const [cameraMode, setCameraMode] = useState<BattlefieldCameraMode>("tactical");
  const [followedEntityId, setFollowedEntityId] = useState<string | null>(null);
  const [followedSquadId, setFollowedSquadId] = useState<string | null>(null);
  const [focusedReplayPoint, setFocusedReplayPoint] = useState<FocusedReplayPoint | null>(null);
  const [player, setPlayer] = useState<ReplayPlayer | null>(null);
  const [displayState, setDisplayState] = useState<DisplayState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [pixel, setPixel] = useState(true);
  const [rendererError, setRendererError] = useState<string | null>(null);
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
    try {
      const serialized = window.localStorage.getItem(NEXT_STORAGE_KEY);
      if (serialized !== null) {
        const parsed = parseSavedNextSetup(JSON.parse(serialized) as unknown);
        if (parsed) setSavedSetup(parsed);
        else setSavedSetupError("A saved Next setup is present, but its format cannot be read. Import a valid JSON setup or clear this copy explicitly.");
      }
    } catch (cause) {
      setSavedSetupError(cause instanceof Error
        ? `The saved Next setup could not be read: ${cause.message}`
        : "The saved Next setup could not be read from this browser.");
    } finally {
      setSavedSetupLoaded(true);
    }
  }, []);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)");
    const syncDisclosure = () => setSaveDetailsOpen(desktop.matches);
    desktop.addEventListener("change", syncDisclosure);
    return () => desktop.removeEventListener("change", syncDisclosure);
  }, []);

  useEffect(() => {
    try {
      const serialized = window.localStorage.getItem(NEXT_RECOVERY_KEY);
      if (serialized !== null) {
        const parsed = parseSavedNextSetup(JSON.parse(serialized) as unknown);
        if (parsed) {
          recoverySetupRef.current = parsed;
          setRecoverySetup(parsed);
          setRecoveryAvailable(true);
        } else {
          setRecoveryLoadError("An unsaved Next recovery copy is present, but its format cannot be read. It has been preserved; clear it explicitly to start a new recovery copy.");
        }
      }
    } catch (cause) {
      setRecoveryLoadError(cause instanceof Error
        ? `The unsaved Next recovery copy could not be read: ${cause.message}. It has been preserved.`
        : "The unsaved Next recovery copy could not be read. It has been preserved.");
    } finally {
      setRecoverySetupLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!packageValue || !nextRules || !recoverySetupLoaded) return;
    try {
      const recovered = recoverySetupRef.current;
      if (recovered && savedSetupMismatch(recovered, packageValue, nextRules) === null) {
        setSlots([...recovered.slots]);
        setRivalSlots([...recovered.rival_slots]);
        setFormationShape(recovered.formation_shape);
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

  const draftKey = draft ? stableKey(draft) : null;
  const activeCompilation = draftKey !== null && compilation?.key === draftKey ? compilation.result : null;
  const savedSetupMismatchReason = savedSetup ? savedSetupMismatch(savedSetup, packageValue, nextRules) : null;
  const recoveryMismatchReason = recoverySetup ? savedSetupMismatch(recoverySetup, packageValue, nextRules) : null;
  const canRestoreSavedSetup = savedSetupLoaded && savedSetup !== null && savedSetupMismatchReason === null;
  const runIsCurrent = Boolean(run && activeCompilation &&
    run.snapshot.attacker.program.content_digest === activeCompilation.program.content_digest &&
    stableKey(run.snapshot.attacker.configuration.heroes) === stableKey(heroConfiguration(slots)));
  const activeSlotValue = slots[activeSlot] ?? null;
  const currentHero = activeSlotValue && nextRules ? findHero(nextRules, activeSlotValue.catalog_id) : null;
  const heroes = nextRules?.heroes ?? [];
  const visibleCameraTargets = useMemo<VisibleBattleTarget[]>(() => Object.values(displayState?.entities ?? {})
    .filter((entity) => !entity.destroyed && entity.hp > 0)
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
  const visibleHeroes = useMemo(() => heroes.filter((hero) =>
    (filters.placement === "all" || hero.placement === filters.placement) &&
    (filters.role === "all" || hero.role === filters.role) &&
    (filters.trait_id === "all" || hero.trait_id === filters.trait_id) &&
    hero.stats.hp >= minHp), [filters.placement, filters.role, filters.trait_id, heroes, minHp]);
  const pathNames = currentHero ? Object.keys(currentHero.skill_paths) : [];
  const formationGroups = useMemo(() => {
    const groups = new Map<string, FormationSlot[]>();
    for (const slot of slots) groups.set(slot.squad, [...(groups.get(slot.squad) ?? []), slot]);
    return [...groups.entries()].map(([id, members]) => ({ id, members: members.sort((a,b) => {
      const rank = (slot: FormationSlot) => nextRules?.heroes.find(h => h.id === slot.catalog_id)?.placement === "backline" ? 1 : 0;
      return rank(a)-rank(b) || a.slot_id.localeCompare(b.slot_id);
    }) }));
  }, [slots,nextRules]);
  const currentSquadPattern = formationGroupsPattern(slots);
  const selectedFrame = run && displayState ? latestFrame(run.sourceReplay.frames, displayState.tick) : null;
  const publicEntities = selectedFrame?.visible_state?.entities ?? {};
  const ownerReplay = run?.response.owner_replay?.perspective === "attacker" ? run.response.owner_replay : null;
  const ownerFrame = ownerReplay && displayState
    ? ownerReplay.frames.find((frame) => frame.tick === displayState.tick) ?? null
    : null;
  const visibleSquadTargets = useMemo<VisibleSquadTarget[]>(() => {
    if (!ownerReplay || !ownerFrame?.visible_state || !displayState) return [];
    const groups = new Map<string, Set<string>>();
    for (const entity of Object.values(ownerFrame.visible_state.entities)) {
      if (entity.owner !== "attacker" || entity.entity_type !== "hero") continue;
      const squad = fieldString(entity.fields.squad);
      const x = fieldInteger(entity.fields.x);
      const y = fieldInteger(entity.fields.y);
      const catalogId = fieldString(entity.fields.catalog_id);
      if (!squad || x === null || y === null) continue;
      const location = { x: x / NEXT_WORLD_UNITS_PER_RENDER_UNIT, y: y / NEXT_WORLD_UNITS_PER_RENDER_UNIT };
      const matches = Object.values(displayState.entities)
        .filter((candidate) => !candidate.destroyed && candidate.hp > 0 && candidate.side === "azure" &&
          candidate.archetype === entity.entity_type && (!catalogId || candidate.catalogId === catalogId) &&
          candidate.position.x === location.x && candidate.position.y === location.y);
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
  }, [displayState, ownerFrame, ownerReplay]);
  const followedSquadMembers = visibleSquadTargets.find((target) => target.id === followedSquadId)?.memberIds ?? [];
  const followedSquadMemberKey = followedSquadMembers.join("|");
  const selectedDisplayEntity = selectedEntityId ? displayState?.entities[selectedEntityId] ?? null : null;
  const selectedEntity = useMemo(() => {
    if (!selectedDisplayEntity) return null;
    const owner = selectedDisplayEntity.side === "azure" ? "attacker" : selectedDisplayEntity.side === "vermilion" ? "defender" : null;
    const catalogId = selectedDisplayEntity.catalogId;
    const position = selectedDisplayEntity.position;
    const matches = Object.values(publicEntities)
      .filter((entity) => entity.entity_type === selectedDisplayEntity.archetype && entity.owner === owner &&
        (!catalogId || fieldString(entity.fields.catalog_id) === catalogId) &&
        fieldInteger(entity.fields.x) !== null && fieldInteger(entity.fields.y) !== null &&
        fieldInteger(entity.fields.x)! / NEXT_WORLD_UNITS_PER_RENDER_UNIT === position.x &&
        fieldInteger(entity.fields.y)! / NEXT_WORLD_UNITS_PER_RENDER_UNIT === position.y);
    return matches.length === 1 ? matches[0] : null;
  }, [publicEntities, selectedDisplayEntity]);
  const diagnostics = run?.response.restricted_diagnostics ?? null;
  const abilityEvents = useMemo(() => {
    const frames = run?.sourceReplay.frames ?? [];
    return frames.flatMap((frame) => frame.events
      .filter((event) => /ability|skill|activate|level|xp/i.test(event.event))
      .map((event, index) => ({ tick: frame.tick, event, key: `${frame.tick}-${index}-${event.event}` })));
  }, [run]);
  const diagnosticRows = useMemo(() => diagnostics
    ? diagnosticDetails(diagnostics).filter((row) => row.side === "attacker")
    : [], [diagnostics]);
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
    };
  }, [formationShape, nextRules, packageValue, rivalSlots, slots]);

  useEffect(() => {
    if (!recoverySetupLoaded || !savedSetupLoaded || slots.length !== 5 || !draft || recoveryLoadError || recoveryMismatchReason) return;
    const setup = buildSavedSetup();
    if (!setup) return;
    try {
      window.localStorage.setItem(NEXT_RECOVERY_KEY, JSON.stringify(setup));
      recoverySetupRef.current = setup;
      setRecoveryAvailable(true);
    } catch (cause) {
      setRecoveryLoadError(cause instanceof Error
        ? `Unsaved draft recovery could not be written: ${cause.message}. Use Save setup or export JSON to keep another copy.`
        : "Unsaved draft recovery could not be written. Use Save setup or export JSON to keep another copy.");
    }
  }, [buildSavedSetup, draft, recoveryLoadError, recoveryMismatchReason, recoverySetupLoaded, savedSetupLoaded, slots.length]);

  const saveSetup = useCallback((): void => {
    const setup = buildSavedSetup();
    if (!setup || !savedSetupLoaded) {
      setSaveMessage("Wait for the current local draft to finish loading before saving.");
      return;
    }
    try {
      window.localStorage.setItem(NEXT_STORAGE_KEY, JSON.stringify(setup));
      setSavedSetup(setup);
      setSavedSetupError(null);
      setSaveMessage("Saved this Next setup in this browser. Legacy Senkei strategies remain separate.");
    } catch (cause) {
      setSavedSetupError(cause instanceof Error ? `The Next setup could not be saved: ${cause.message}` : "The Next setup could not be saved in this browser.");
    }
  }, [buildSavedSetup, savedSetupLoaded]);

  const restoreSetup = useCallback((): void => {
    if (!savedSetup || savedSetupMismatchReason) return;
    draftRef.current = savedSetup.draft;
    setDraft(savedSetup.draft);
    setSlots([...savedSetup.slots]);
    setRivalSlots([...savedSetup.rival_slots]);
    setFormationShape(savedSetup.formation_shape);
    setActiveSlot(0);
    setCompilation(null);
    setSelectedEntityId(null);
    setTab("formation");
    setError(null);
    setSaveMessage("Restored the saved Next setup. Compile its Jinrei source before launching a new battle.");
  }, [savedSetup, savedSetupMismatchReason]);

  const clearSavedSetup = useCallback((): void => {
    try {
      window.localStorage.removeItem(NEXT_STORAGE_KEY);
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

  const importSetupFile = useCallback(async (file: File): Promise<void> => {
    try {
      const parsed = parseSavedNextSetup(JSON.parse(await file.text()) as unknown);
      if (!parsed) throw new Error("This file is not a supported Next setup.");
      setSavedSetup(parsed);
      setSavedSetupError(null);
      setSaveMessage("Imported a Next setup. Check its ruleset status, then restore it when compatible.");
      try {
        window.localStorage.setItem(NEXT_STORAGE_KEY, JSON.stringify(parsed));
      } catch (cause) {
        setSavedSetupError(cause instanceof Error
          ? `The setup is imported for this session, but browser storage failed: ${cause.message}`
          : "The setup is imported for this session, but browser storage is unavailable.");
      }
    } catch (cause) {
      setSavedSetupError(cause instanceof Error ? `The setup file could not be imported: ${cause.message}` : "The setup file could not be imported.");
    }
  }, []);

  const refreshStarterTactics = useCallback((before: readonly FormationSlot[], after: readonly FormationSlot[]): void => {
    const currentDraft = draftRef.current;
    if (!packageValue || !currentDraft || currentDraft.program_input.kind !== "text") return;
    if (currentDraft.program_input.source !== createStarterJinrei(packageValue, "attacker", before)) return;
    const nextDraft = {
      ...currentDraft,
      program_input: { kind: "text" as const, source: createStarterJinrei(packageValue, "attacker", after) },
    };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setCompilation(null);
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
    if (!active || tab !== "battle") player?.pause();
  }, [active, player, tab]);

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
    draftRef.current = next;
    setDraft(next);
    setCompilation(null);
    setError(null);
  }, []);

  const compileTactics = useCallback(async (input: TacticalInput): Promise<void> => {
    if (!core) throw new Error("The local Rust core is still loading.");
    const current = draftRef.current;
    if (!current) throw new Error("Create a formation before compiling Jinrei.");
    const key = stableKey(current);
    const result = await core.compile(input);
    if (stableKey(draftRef.current) !== key) {
      throw new Error("Jinrei changed while the local compiler was running. Compile the current version again.");
    }
    setCompilation({ key, result });
    setError(null);
  }, [core]);

  const launchBattle = useCallback(async (): Promise<void> => {
    if (!core || !packageValue || !nextRules || !draft || !activeCompilation) {
      setError("Compile the current Jinrei draft before launching a local battle.");
      return;
    }
    if (slots.length !== 5 || rivalSlots.length !== 5 || slots.some((slot) => !slot.catalog_id || !slot.node || !slot.skill_path)) {
      setError("Choose a catalog hero, starting node and skill path for all five slots.");
      setTab("formation");
      return;
    }
    setBusy(true);
    setError(null);
    setRendererError(null);
    try {
      const rivalDraft = createTacticDraft(packageValue, nextRules, "defender");
      const rivalSource = rivalDraft.program_input.kind === "text" ? rivalDraft.program_input.source : "";
      const rivalInput: TacticalInput = { kind: "text", ruleset_ref: rivalDraft.ruleset, source: rivalSource };
      const rivalCompilation = await core.compile(rivalInput);
      const attacker = makeSideSnapshot(draft, activeCompilation.program, slots);
      const defender = makeSideSnapshot(rivalDraft, rivalCompilation.program, rivalSlots);
      const matchId = stableMatchId({ ruleset: packageValue.ruleset, attacker, defender });
      const context = await core.newMatchContext(packageValue.ruleset, matchId);
      const snapshot: SimulationSnapshot = { attacker, defender, context };
      const response = await core.simulate(snapshot, { include_diagnostics: includeDiagnostics });
      const sourceReplay = response.owner_replay ?? response.outcome.presentation_replay;
      const graphicsReplay = presentationToGraphics(
        sourceReplay,
        packageValue,
        response.outcome.result,
        context.versions.engine,
      );
      setBaselineRun(run);
      setRun({ snapshot, response, sourceReplay, graphicsReplay });
      setSelectedEntityId(null);
      setCameraMode("tactical");
      setFollowedEntityId(null);
      setFollowedSquadId(null);
      setFocusedReplayPoint(null);
      setBattleMobileView("battle");
      setTab("battle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The local Next battle could not be launched.");
    } finally {
      setBusy(false);
    }
  }, [activeCompilation, core, draft, includeDiagnostics, nextRules, packageValue, rivalSlots, slots]);

  const rematch = useCallback((): void => {
    if (!run) return;
    setTab("battle");
    void launchBattle();
  }, [launchBattle, run]);

  const chooseFormation = (shape: "single" | "three-lane" | "wings") => {
    if (!nextRules) return;
    setFormationShape(shape);
    const nextSlots = makeFormation(nextRules, slots, "attacker", shape);
    refreshStarterTactics(slots, nextSlots);
    setSlots(nextSlots);
    setError(null);
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
    const edge = (run?.graphicsReplay.scene.routes ?? []).find(route =>
      ((route.points[0].x === from?.x && route.points[0].y === from?.y && route.points[1].x === to?.x && route.points[1].y === to?.y) ||
       (route.points[1].x === from?.x && route.points[1].y === from?.y && route.points[0].x === to?.x && route.points[0].y === to?.y)),
    );
    if (!from || !to || edge?.region !== "lane" || edge.bridgeSite || logical.crossing === "bridge") return miniMapPoint(point);
    const dx = to.x - from.x, dy = to.y - from.y, length = Math.hypot(dx, dy) || 1;
    const direction = logical.track === "LEFT" ? -1 : 1;
    const offset = (run?.graphicsReplay.scene.trackOffset ?? 0.8) * direction;
    return miniMapPoint({ x: point.x + dy / length * offset, y: point.y - dx / length * offset });
  };
  const miniMapBases = nextRules ? [
    { id: "attacker", label: "A", node: nextRules.map.nodes[nextRules.map.attacker_base] },
    { id: "defender", label: "D", node: nextRules.map.nodes[nextRules.map.defender_base] },
  ].filter((base) => Boolean(base.node)) : [];
  const setBattleView = (view: BattlefieldMobileView): void => {
    setBattleMobileView(view);
    if (view === "timeline") player?.pause();
    if (view === "battle" || view === "overview") {
      setBattleRosterOpen(false);
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
    const mobile = window.matchMedia("(max-width: 760px)").matches;
    setBattleMobileView(mobile ? "follow" : "battle");
    setBattleRosterOpen(!mobile);
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
  const inspectReplayEvent = (event: GraphicsEvent): void => {
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

  if (!packageValue || !nextRules) {
    return (
      <section className="next-workspace" aria-label="Next local battle workshop">
        <header className="next-heading">
          <div><span className="next-eyebrow">NEXT · LOCAL RULESET</span><h2>Battle <em>workbench</em></h2><p>Five heroes, authored Jinrei and a deterministic local replay.</p></div>
          <span className="next-heading-mark" aria-hidden="true">兵</span>
        </header>
        <div className={`next-load-state${rulesetError ? " is-error" : ""}`} role={rulesetError ? "alert" : "status"}>
          <span className="next-load-mark">{rulesetError ? "!" : "◌"}</span>
          <div><strong>{rulesetError ? "Next ruleset unavailable" : "Loading the local battle rules"}</strong><p>{rulesetError ?? "The app is requesting the bundled Next ruleset from the local Rust core."}</p></div>
        </div>
      </section>
    );
  }

  return (
    <section className={`next-workspace${tab === "battle" ? " is-battle-workspace" : ""}`} aria-label="Next local battle workshop">
      <header className="next-heading">
        <div><span className="next-eyebrow">NEXT · SENRITSU 1.0 · LOCAL ENBU</span><h2>Battle <em>workbench</em></h2><p>Build five heroes, write Jinrei, run the local core and study the synchronized replay.</p></div>
        <div className="next-heading-status"><span className="next-live-dot" />REAL LOCAL SIMULATION<span className="next-heading-mark" aria-hidden="true">兵</span></div>
      </header>

      {error && <div className="next-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
      {rendererError && <div className="next-error next-renderer-error" role="alert"><span>{rendererError} Playback is paused at the current tick.</span><button type="button" onClick={retryRenderer}>Retry battlefield renderer</button></div>}

      <details className="next-save-disclosure" open={saveDetailsOpen} onToggle={(event) => setSaveDetailsOpen(event.currentTarget.open)}>
      <summary><strong>Save and recovery</strong><small>{recoveryLoadError ? "Recovery needs attention" : savedSetup ? "Pinned setup available" : "No pinned setup"} · opens local setup controls</small></summary>
      <section aria-label="Next setup save and restore" className="next-save-bar">
        <div className="next-save-summary"><span className="next-eyebrow">LOCAL NEXT DRAFT</span><strong>Saved setup and recovery copy</strong><small>Save setup pins a restore point; current edits are recovered separately after reload.</small></div>
        <div className="next-save-actions">
          <button disabled={!draft || !packageValue || !savedSetupLoaded} onClick={saveSetup} type="button">Save setup</button>
          <button disabled={!canRestoreSavedSetup} onClick={restoreSetup} type="button">Restore saved</button>
          <button disabled={!draft || !packageValue} onClick={exportCurrentSetup} type="button">Export JSON</button>
          <button onClick={() => importFileInput.current?.click()} type="button">Import JSON</button>
          {savedSetup && <button onClick={exportSavedSetup} type="button">Export saved</button>}
          {(savedSetup || savedSetupError) && <button onClick={clearSavedSetup} type="button">Clear saved</button>}
          <input accept="application/json,.json" aria-label="Import a Next setup JSON file" hidden onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (file) void importSetupFile(file);
          }} ref={importFileInput} type="file" />
        </div>
        {savedSetupError && <p className="next-save-message is-error" role="alert">{savedSetupError}</p>}
        {recoveryLoadError && <div className="next-save-message is-error" role="alert">{recoveryLoadError} <button className="next-inline-action" onClick={clearRecoveryCopy} type="button">Clear recovery copy</button></div>}
        {recoverySetupLoaded && recoveryMismatchReason && !recoveryLoadError && <div className="next-save-message is-error" role="alert">Unsaved recovery from {recoverySetup ? new Date(recoverySetup.saved_at).toLocaleString() : "a prior session"} belongs to a different ruleset or schema. It is preserved and not loaded. {recoveryMismatchReason} <button className="next-inline-action" onClick={clearRecoveryCopy} type="button">Discard incompatible recovery</button></div>}
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
              onClick={() => setTab(item.id)}
              role="tab"
              type="button"
            ><span>{item.number}</span><strong>{item.label}</strong><small>{item.id === "formation" ? "5 HEROES" : item.id === "jinrei" ? "TACTICS" : item.id === "battle" ? "REPLAY" : "TRACE"}</small></button>
          ))}
          <div className="next-ruleset-stamp"><span>RULESET</span><strong>{packageValue.ruleset.id}</strong><small>{packageValue.ruleset.version.major}.{packageValue.ruleset.version.minor}.{packageValue.ruleset.version.patch} · {nextRules.mechanics_version.major}.{nextRules.mechanics_version.minor}.{nextRules.mechanics_version.patch}</small></div>
        </nav>

        <div className="next-panel-wrap">
          <section aria-labelledby="next-tab-formation" className="next-panel" hidden={tab !== "formation"} id="next-panel-formation" role="tabpanel">
            <div className="next-panel-header">
              <div><span className="next-eyebrow">HERO ATELIER · {ATELIER_SCREENS.find((screen) => screen.id === atelierScreen)?.hint}</span><h3>{atelierScreen === "collection" ? <>Choose your <em>heroes</em></> : atelierScreen === "detail" ? <>Hero <em>detail</em></> : atelierScreen === "skills" ? <>Plan a skill <em>tree</em></> : <>Assemble your <em>squads</em></>}</h3><p>{atelierScreen === "collection" ? "Select exactly five entries from the bundled Senritsu Catalog." : atelierScreen === "detail" ? "Inspect the selected Catalog identity, attributes, real stats and growth." : atelierScreen === "skills" ? "Choose a real branch and review its level, prerequisite and effect before battle." : "Divide the same five Heroes into legal Squads and set one shared starting node per unit."}</p></div>
              <span className="next-slot-counter">{String(slots.length).padStart(2, "0")} <small>/ 05</small></span>
            </div>

            <nav className="next-atelier-nav" aria-label="Hero Atelier" role="tablist">
              {ATELIER_SCREENS.map((screen) => <button aria-selected={atelierScreen === screen.id} className={atelierScreen === screen.id ? "is-active" : ""} id={`next-atelier-${screen.id}`} key={screen.id} onClick={() => setAtelierScreen(screen.id)} role="tab" type="button">{screen.label}<small>{screen.hint}</small></button>)}
            </nav>

            {atelierScreen === "collection" && <>
            <div className="next-collection-summary" aria-label="Five selected Hero slots" role="group">
              {slots.map((slot, index) => { const hero = findHero(nextRules, slot.catalog_id); return <button aria-label={`Choose hero for slot ${index + 1}`} aria-pressed={activeSlot === index} className={activeSlot === index ? "is-active" : ""} key={slot.slot_id} onClick={() => setActiveSlot(index)} type="button"><span>{String(index + 1).padStart(2, "0")}</span><strong>{hero?.name ?? "Choose a hero"}</strong><small>{hero?.id ?? slot.slot_id} · {hero ? formatId(hero.placement) : "EMPTY"}</small></button>; })}
            </div>
            <div className="next-formation-tools">
              <label className="next-field next-shape-field"><span>Initial formation</span><select value={formationShape} onChange={(event) => {
                const shape = event.target.value as "single" | "three-lane" | "wings" | "custom";
                if (shape !== "custom") chooseFormation(shape);
              }}>
                {formationShape === "custom" && <option value="custom">Custom arrangement</option>}<option value="single">Single squad · own base</option><option value="three-lane">Three-lane spread</option><option value="wings">Twin wings</option>
              </select></label>
              <div className="next-filter-block"><span className="next-filter-label">FILTER CATALOG</span>
                <label className="next-field"><span>Placement</span><select aria-label="Filter heroes by placement" value={filters.placement} onChange={(event) => setFilters((previous) => ({ ...previous, placement: event.target.value }))}><option value="all">All</option>{[...new Set(heroes.map((hero) => hero.placement))].map((value) => <option key={value} value={value}>{formatId(value)}</option>)}</select></label>
                <label className="next-field"><span>Role</span><select aria-label="Filter heroes by role" value={filters.role} onChange={(event) => setFilters((previous) => ({ ...previous, role: event.target.value }))}><option value="all">All</option>{[...new Set(heroes.map((hero) => hero.role))].map((value) => <option key={value} value={value}>{formatId(value)}</option>)}</select></label>
                <label className="next-field"><span>Trait</span><select aria-label="Filter heroes by trait" value={filters.trait_id} onChange={(event) => setFilters((previous) => ({ ...previous, trait_id: event.target.value }))}><option value="all">All</option>{[...new Set(heroes.map((hero) => hero.trait_id))].map((value) => <option key={value} value={value}>{formatId(value)}</option>)}</select></label>
                <label className="next-field next-min-hp"><span>Minimum HP · {minHp}</span><input aria-label="Minimum hero HP" max={Math.max(...heroes.map((hero) => hero.stats.hp), 0)} min="0" onChange={(event) => setMinHp(Number(event.target.value))} step="10" type="range" value={minHp} /></label>
              </div>
            </div>

            <section className="next-catalog" aria-label="Filtered hero catalog">
              <div className="next-catalog-heading"><div><span className="next-eyebrow">CATALOG · {visibleHeroes.length} AVAILABLE</span><h4>Choose a Hero for slot {String(activeSlot + 1).padStart(2, "0")}</h4></div><small>12 Senritsu identities · filter by the three Catalog axes</small></div>
              <div className="next-catalog-grid">
                {visibleHeroes.map((hero) => <button aria-pressed={activeSlotValue?.catalog_id === hero.id} className={`next-catalog-card${activeSlotValue?.catalog_id === hero.id ? " is-selected" : ""}`} key={hero.id} onClick={() => {
                  const path = hero.skill_paths[activeSlotValue?.skill_path ?? "path_a"] ? (activeSlotValue?.skill_path ?? "path_a") : Object.keys(hero.skill_paths)[0] ?? "";
                  changeSlot(activeSlot, { catalog_id: hero.id, skill_path: path });
                }} type="button">
                  <div className="next-catalog-card-top"><span className="next-catalog-id">{hero.id}</span><span className="next-hero-sigil">{hero.placement === "backline" ? "⌁" : "◆"}</span></div>
                  <strong>{hero.name}</strong><small>{formatId(hero.placement)} · {formatId(hero.role)} · {formatId(hero.trait_id)}</small>
                  <div className="next-catalog-stats"><span>HP <b>{hero.stats.hp}</b></span><span>ATK <b>{hero.stats.attack}</b></span><span>DEF <b>{hero.stats.defense}</b></span></div>
                </button>)}
                {visibleHeroes.length === 0 && <div className="next-catalog-empty">No heroes match these attribute filters. Clear one filter to continue.</div>}
              </div>
            </section>
            <div className="next-panel-footer"><span>Selected {slots.length} of 5 catalog slots. Hero selection is shared with Detail, Skill Tree, Squads and the battle draft.</span><button className="next-secondary-button" onClick={() => setAtelierScreen("detail")} type="button">Inspect selected Hero <b>→</b></button></div>
            </>}

            {atelierScreen === "detail" && <div className="next-atelier-detail">
              <div className="next-atelier-roster" aria-label="Choose a Hero for detail" role="group">{slots.map((slot, index) => { const hero = findHero(nextRules, slot.catalog_id); return <button aria-current={activeSlot === index ? "true" : undefined} aria-label={`Slot ${index + 1}: ${hero?.name ?? "Choose a hero"}, ${hero?.id ?? slot.slot_id}`} className={activeSlot === index ? "is-active" : ""} key={slot.slot_id} onClick={() => setActiveSlot(index)} type="button"><span>{String(index + 1).padStart(2, "0")}</span><strong>{hero?.name ?? "Choose a hero"}</strong><small>{hero?.id}</small></button>; })}</div>
              {currentHero && activeSlotValue ? <article className="next-hero-dossier">
                <header className={`next-hero-dossier-head ${currentHero.placement}`}><div><span className="next-eyebrow">{currentHero.appearance_key} · SLOT {String(activeSlot + 1).padStart(2, "0")}</span><h4>{currentHero.name}</h4><p>{currentHero.id} · {formatId(currentHero.placement)} · {formatId(currentHero.role)} · {formatId(currentHero.trait_id)}</p><small>Catalog identity: {currentHero.appearance_key}. No approved character model is bundled for this Hero.</small></div><span className="next-hero-dossier-mark" aria-hidden="true">{currentHero.placement === "backline" ? "⌁" : "◆"}</span></header>
                <section className="next-hero-stat-block"><div className="next-card-heading"><div><span className="next-eyebrow">REAL SENRITSU VALUES</span><h4>Base stats and growth</h4></div></div><div className="next-stat-matrix"><span>STAT</span><span>BASE</span><span>PER LEVEL</span>{(["hp", "attack", "defense", "speed", "range", "attack_interval", "vision"] as const).map((stat) => <Fragment key={stat}><strong>{formatId(stat)}</strong><span>{currentHero.stats[stat]}</span><span>+{currentHero.growth[stat]}</span></Fragment>)}</div></section>
                <aside className="next-capability-map"><strong>Jinrei capability mapping</strong>{packageValue.domain.capabilities.activate ? <p>Active skills are issued through <code>activate</code> with the ruleset’s typed arguments: {packageValue.domain.capabilities.activate.arguments.map((argument) => `${formatId(argument.id)} (${argument.value_type.kind})`).join(" · ")}. Passive skills are granted automatically at their unlock level.</p> : <p role="alert">This ruleset has no <code>activate</code> capability, so its active skills cannot be ordered from Jinrei.</p>}</aside>
                <section className="next-hero-stat-block"><div className="next-card-heading"><div><span className="next-eyebrow">CAPABILITY AND BRANCH CATALOG</span><h4>{currentHero.skills.length} authored skills</h4></div><span className="next-owner-tag">PLANNED · {formatId(activeSlotValue.skill_path)}</span></div><div className="next-skill-catalog">{currentHero.skills.map((skill) => <article className={currentHero.skill_paths[activeSlotValue.skill_path]?.includes(skill.id) ? "is-planned" : ""} key={skill.id}><div><strong>{skill.name}</strong><small>{skill.id} · {skill.passive ? "Passive" : "Active"} · unlock level {skill.unlock_level}</small></div><span>{formatId(skill.effect)}</span><p>{skill.passive ? "Granted automatically when its level requirement is met." : `${formatId(skill.target)} target · range ${skill.range} · cost ${skill.cost} energy · cooldown ${skill.cooldown} ticks · Jinrei activate capability`} · power {skill.power}{skill.duration > 0 ? ` · duration ${skill.duration} ticks` : ""}</p></article>)}</div></section>
                <div className="next-panel-footer"><span>Numbers and skill identity come from the bundled ruleset. Appearance identity is recorded; its 3D character asset is not available.</span><button className="next-secondary-button" onClick={() => setAtelierScreen("skills")} type="button">Plan this Hero’s skills <b>→</b></button></div>
              </article> : <div className="next-catalog-empty">Select a populated Hero slot to inspect its Senritsu data.</div>}
            </div>}

            {atelierScreen === "skills" && <div className="next-skill-tree-screen">
              <div className="next-atelier-roster" aria-label="Choose a Hero skill tree" role="group">{slots.map((slot, index) => { const hero = findHero(nextRules, slot.catalog_id); return <button aria-current={activeSlot === index ? "true" : undefined} aria-label={`Slot ${index + 1}: ${hero?.name ?? "Choose a hero"}, ${hero?.id ?? slot.slot_id}; ${formatId(slot.skill_path)}`} className={activeSlot === index ? "is-active" : ""} key={slot.slot_id} onClick={() => setActiveSlot(index)} type="button"><span>{String(index + 1).padStart(2, "0")}</span><strong>{hero?.name ?? "Choose a hero"}</strong><small>{hero?.id ?? formatId(slot.skill_path)}</small></button>; })}</div>
              {currentHero && activeSlotValue ? <div className="next-skill-tree-content"><div className="next-skill-tree-title"><div><span className="next-eyebrow">{currentHero.id} · {currentHero.name} · {currentHero.skills.length} CATALOG NODES</span><h4>Choose one branch for the match</h4><p>Acquisition is planned here. Enbu awards skills only when the Hero reaches each unlock level.</p></div><span className="next-owner-tag">CURRENT · {formatId(activeSlotValue.skill_path)}</span></div><div className="next-capability-map"><strong>Active skill command</strong><p>{packageValue.domain.capabilities.activate ? <>An active skill uses Jinrei <code>activate</code> ({packageValue.domain.capabilities.activate.arguments.map((argument) => formatId(argument.id)).join(", ")}). A prerequisite must be acquired before the dependent node becomes available.</> : <>No <code>activate</code> capability is defined by this ruleset; active skill plans are unavailable.</>}</p></div><div className="next-skill-branches">{pathNames.map((path) => { const selected = activeSlotValue.skill_path === path; const pathSkills = (currentHero.skill_paths[path] ?? []).map((id) => currentHero.skills.find((skill) => skill.id === id)).filter((skill) => skill !== undefined); const prerequisiteIssues = skillPathPrerequisiteIssues(currentHero, path); const hasActiveSkill = pathSkills.some((skill) => !skill.passive); const canChoose = prerequisiteIssues.length === 0 && (!hasActiveSkill || Boolean(packageValue.domain.capabilities.activate)); return <article className={`next-skill-branch${selected ? " is-selected" : ""}${canChoose ? "" : " is-unavailable"}`} key={path}><header><div><span className="next-eyebrow">{formatId(path)} · {pathSkills.length} PLANNED NODES</span><h5>{pathSkills[0]?.name ?? formatId(path)} <span>→</span> {pathSkills[pathSkills.length - 1]?.name ?? ""}</h5></div><button aria-pressed={selected} aria-label={`Choose ${formatId(path)} for ${activeSlotValue.slot_id}`} className="next-secondary-button" disabled={!canChoose} onClick={() => changeSlot(activeSlot, { skill_path: path })} type="button">{selected ? "Selected" : "Choose path"}</button></header>{prerequisiteIssues.length > 0 && <p className="next-skill-path-error" role="alert">Unavailable: {prerequisiteIssues.join(" ")}</p>}{!packageValue.domain.capabilities.activate && hasActiveSkill && <p className="next-skill-path-error" role="alert">Unavailable: this ruleset has no activate capability for active skills.</p>}<ol>{pathSkills.map((skill, index) => { const prerequisites = skill.prerequisites.map((id) => currentHero.skills.find((item) => item.id === id)).filter((item) => item !== undefined); return <li key={skill.id}><span className="next-skill-level">LV {skill.unlock_level}</span><div className="next-skill-node"><span className="next-skill-node-mark">{skill.passive ? "◇" : "✦"}</span><div><strong>{skill.name}</strong><small>{skill.passive ? "Passive · acquired at unlock level" : `Active · ${formatId(skill.effect)} · ${formatId(skill.target)} target · activate capability`}</small><p>{skill.passive ? "Granted automatically when its level requirement is met." : `Power ${skill.power} · range ${skill.range} · energy ${skill.cost} · cooldown ${skill.cooldown}${skill.duration > 0 ? ` · duration ${skill.duration}` : ""}`}</p>{prerequisites.length > 0 && <small>Requires {prerequisites.map((item) => `${item.name} (LV ${item.unlock_level})`).join(", ")} · locked until prerequisites are acquired</small>}</div><span className="next-skill-plan-state">{selected ? `PLANNED · UNLOCKS LV ${skill.unlock_level}` : "NOT SELECTED"}</span></div>{index < pathSkills.length - 1 && <span className="next-skill-connector" aria-hidden="true" />}</li>; })}</ol></article>; })}</div><p className="next-skill-tree-note">The chosen branch is saved in the same five-slot setup and passed into the real Enbu Hero configuration. This screen does not mark future skills as already acquired.</p><div className="next-panel-footer"><span>Selected path: {skillNames(currentHero, activeSlotValue.skill_path).join(" → ")}</span><button className="next-secondary-button" onClick={() => setAtelierScreen("squads")} type="button">Arrange Squads <b>→</b></button></div></div> : <div className="next-catalog-empty">Select a populated Hero slot to plan its skill tree.</div>}
            </div>}

            {atelierScreen === "squads" && <div className="next-assembly-screen">
              <div className="next-assembly-intro"><div><span className="next-eyebrow">SENRITSU · FIVE HEROES · SEVEN PARTITIONS</span><h4>Set the initial chain of command</h4><p>Choose a five-Hero partition, then select one shared starting node for each Squad.</p></div><span className="next-slot-counter">{currentSquadPattern || "—"}</span></div>
              <div className="next-pattern-picker" aria-label="Legal five Hero Squad partitions">{SQUAD_PATTERNS.map((pattern) => <button aria-label={`Use squad split ${pattern.id}`} aria-pressed={currentSquadPattern === pattern.id} className={currentSquadPattern === pattern.id ? "is-active" : ""} key={pattern.id} onClick={() => applySquadPattern(pattern.sizes)} type="button"><strong>{pattern.id}</strong><small>{pattern.sizes.length} Squads</small></button>)}</div>
              <section aria-label="Squad formation preview" className="next-assembly-groups"><div className="next-assembly-preview-label"><span className="next-eyebrow">FORMATION PREVIEW · {currentSquadPattern}</span><small>All five Hero identities remain assigned exactly once</small></div>{formationGroups.map(({ id, members }) => { const movement = nextRules.parameters[`squad_${members.length}_speed_milli`]; const starts = [...new Set(members.map((member) => member.node))]; return <article className="next-assembly-group" key={id}><header><div><span className="next-eyebrow">{formatId(id)} · {members.length} {members.length === 1 ? "HERO" : "HEROES"}</span><h5>{["Solo", "Duo", "Trio", "Quartet", "Quintet"][members.length - 1]} <small>· {members.length}-member Squad</small></h5></div><span className="next-speed-badge">MOVE ×{Number.isFinite(movement) ? (movement / 1000).toFixed(2) : "—"}</span></header><label className="next-field next-squad-node"><span>Shared starting node</span><select aria-label={`Starting node for ${formatId(id)}`} value={starts.length === 1 ? starts[0] : ""} onChange={(event) => moveSquad(id, event.target.value)}><option disabled value="">Resolve member node mismatch</option>{Object.keys(nextRules.map.nodes).map((node) => <option key={node} value={node}>{formatId(node)}{Object.entries(nextRules.map.lanes).find(([, nodes]) => nodes.includes(node))?.[0] ? ` · ${formatId(Object.entries(nextRules.map.lanes).find(([, nodes]) => nodes.includes(node))?.[0] ?? "")}` : ""}</option>)}</select></label><ol>{members.map((member) => { const index = slots.findIndex((slot) => slot.slot_id === member.slot_id); const hero = findHero(nextRules, member.catalog_id); return <li key={member.slot_id}><span className="next-hero-sigil">{hero?.placement === "backline" ? "⌁" : "◆"}</span><div><strong>{hero?.name ?? "Unknown Hero"}</strong><small>{hero?.id} · {formatId(hero?.placement ?? "unknown")}</small></div><label className="next-field"><span>Squad</span><select aria-label={`Squad for ${hero?.name ?? member.slot_id}`} value={member.squad} onChange={(event) => changeSlot(index, { squad: event.target.value })}>{[...new Set([...formationGroups.map((group) => group.id), `squad-${formationGroups.length + 1}`])].map((squad) => <option key={squad} value={squad}>{formatId(squad)}</option>)}</select></label></li>; })}</ol>{starts.length > 1 && <p className="next-assembly-error" role="alert">This Squad has multiple starting nodes. Choose a shared node to make its starting formation valid.</p>}<small className="next-assembly-rule">Movement ×{Number.isFinite(movement) ? (movement / 1000).toFixed(2) : "—"} · maturation {nextRules.parameters.squad_maturation_ticks} ticks</small></article>; })}</section>
              <div className="next-assembly-note"><strong>One membership per Hero</strong><p>Each slot has one Squad ID. The seven presets cover every partition of five; changing a member’s Squad can create a custom grouping. A battle cannot start while members of one Squad have different initial nodes.</p></div>
              <div className="next-panel-footer"><span>These membership and node values are the same values stored in the current Senkei draft.</span><button className="next-secondary-button" onClick={() => { setTab("jinrei"); }} type="button">Continue to Jinrei <b>→</b></button></div>
            </div>}
          </section>

          <section aria-labelledby="next-tab-jinrei" className="next-panel next-jinrei-panel" hidden={tab !== "jinrei"} id="next-panel-jinrei" role="tabpanel">
            <div className="next-panel-header"><div><span className="next-eyebrow">02 · JINREI TACTICS</span><h3>Edit the <em>orders</em></h3><p>This draft compiles through the local Jinrei core against the selected Next ruleset.</p></div><span className={`next-compile-state${activeCompilation ? " is-ready" : ""}`}>{activeCompilation ? "COMPILED" : "COMPILE REQUIRED"}</span></div>
            {draft && <EditorFeature
              ruleset={tacticsRuleset}
              draft={draft}
              compilation={activeCompilation}
              onDraftChange={updateDraft}
              onParse={(source, rulesetRef) => core ? core.parseText(source, rulesetRef) : Promise.reject(new Error("The local Rust core is still loading."))}
              onFormat={(ast, rulesetRef) => core ? core.formatAst(ast, rulesetRef) : Promise.reject(new Error("The local Rust core is still loading."))}
              onCompile={compileTactics}
            />}
            <div className="next-jinrei-note"><span>LOCAL DRAFT</span><p>Starter orders move each slot and target path-selected skills only when their unlock level, energy, cooldown and target conditions are met. This draft stays separate from saved initial Senkei strategies.</p></div>
          </section>

          <section aria-labelledby="next-tab-battle" className="next-panel next-battle-panel" hidden={tab !== "battle"} id="next-panel-battle" role="tabpanel">
            <div className="next-panel-header next-battle-header"><div><span className="next-eyebrow">03 · LOCAL ENBU REPLAY</span><h3>Battlefield <em>console</em></h3><p>{run ? `${run.graphicsReplay.header.view === "attacker" ? "Local owner view" : "Public replay"} · Tick ${displayState?.tick ?? 0} / ${run.graphicsReplay.result.tick}` : "Launch a compiled local battle, then observe the confirmed replay."}</p></div><div className="next-battle-actions"><button aria-label="Battle situation details" aria-expanded={battleInspectorOpen} className="next-secondary-button next-desktop-inspector-toggle" disabled={!run} onClick={() => setBattleInspectorOpen(value => !value)} type="button">{battleInspectorOpen ? "Close details" : "Situation details"}</button><button className="next-secondary-button" disabled={!run || busy || !activeCompilation} onClick={rematch} type="button">{runIsCurrent ? "Rematch" : "Run revised battle"} <b>↻</b></button><button className="next-launch-button" disabled={busy || !activeCompilation} onClick={() => void launchBattle()} type="button"><span>{busy ? "◌" : "▶"}</span>{busy ? "Running local core…" : run ? "New local battle" : "Launch local battle"}</button></div></div>
            <div className="next-battle-setup"><details className="next-battle-options"><summary>Replay access · {includeDiagnostics ? "owner diagnostics on" : "public replay only"}</summary><label className="next-diagnostic-toggle"><input checked={includeDiagnostics} onChange={(event) => setIncludeDiagnostics(event.target.checked)} type="checkbox" /><span className="next-checkbox" /><span><strong>Include my local replay and diagnostics</strong><small>Owner replay, visible Hero state, ability trace, intents and CU only</small></span></label></details><span className="next-match-badge">{runResult ? `MATCH ${runResult.match_id.slice(0, 16)}` : "READY WHEN JINREI IS COMPILED"}</span></div>
            {runResult && run ? <>
              <div className="next-battle-stage">
                <div aria-label="Interactive three-dimensional replay" className="next-renderer-host" ref={rendererHost} />
                <aside className={`next-battle-minimap${battleMapContextOpen ? " is-open" : ""}`} aria-label="Current battlefield map context">
                  <button aria-expanded={battleMapContextOpen} aria-label="Toggle battlefield map context" className="next-minimap-toggle" onClick={() => setBattleMapContextOpen((open) => !open)} type="button"><span>MAP · T{displayState?.tick ?? 0}</span><small>{battleMapContextOpen ? "HIDE" : "OPEN"}</small></button>
                  {battleMapContextOpen && <div className="next-battle-minimap-content">
                  <svg aria-label="Replay lanes, routes, camps, bases and currently visible entities" role="img" viewBox="0 0 120 80">
                    <rect className="next-minimap-ground" height="80" rx="4" width="120" x="0" y="0" />
                    {(run.graphicsReplay.scene.river ?? []).length > 1 && <polyline className="next-minimap-river" data-testid="battle-map-river" points={run.graphicsReplay.scene.river!.map(miniMapPoint).map((point) => `${point.x},${point.y}`).join(" ")} />}
                    {(run.graphicsReplay.scene.routes ?? []).map((route) => {
                      const points = route.points.map(miniMapPoint).map((point) => `${point.x},${point.y}`).join(" ");
                      const facility = route.bridgeSite ? Object.values(displayState?.entities ?? {}).find((entity) => entity.battlefield?.bridgeSite === route.bridgeSite) : undefined;
                      return <polyline className={`next-minimap-route region-${route.region}${route.bridgeSite ? " is-bridge-route" : ""}${route.ford ? " is-ford-route" : ""}`} data-testid="battle-map-route" data-edge-id={route.id} data-bridge-site={route.bridgeSite} data-bridge-state={route.bridgeSite ? facility?.battlefield?.bridgeState ?? "unknown" : undefined} data-ford={route.ford ? "true" : undefined} key={route.id} points={points} />;
                    })}
                    {run.graphicsReplay.scene.lanes.map((lane) => {
                      const points = lane.points.map(miniMapPoint).map((point) => `${point.x},${point.y}`).join(" ");
                      return <g key={lane.id}><polyline className="next-minimap-lane" points={points} /><text className="next-minimap-lane-label" x={miniMapPoint(lane.points[Math.floor(lane.points.length / 2)]).x} y={miniMapPoint(lane.points[Math.floor(lane.points.length / 2)]).y - 2}>{lane.label}</text></g>;
                    })}
                    {(run.graphicsReplay.scene.nodes ?? []).map((node) => { const point = miniMapPoint(node.position); return <circle data-testid="battle-map-node" data-node-id={node.id} data-allegiance={node.allegiance} cx={point.x} cy={point.y} key={node.id} r={node.id === "N.MID.OBS" ? 1.45 : 0.65} />; })}
                    {(run.graphicsReplay.scene.camps ?? []).map((camp) => { const point = miniMapPoint(camp.position); return <path className="next-minimap-camp" d={`M ${point.x} ${point.y - 1.9} l 1.9 1.9 -1.9 1.9 -1.9 -1.9 z`} key={camp.id} />; })}
                    {miniMapBases.map(({ id, label, node }) => {
                      if (!node) return null;
                      const point = miniMapPoint({ x: node.x / NEXT_WORLD_UNITS_PER_RENDER_UNIT, y: node.y / NEXT_WORLD_UNITS_PER_RENDER_UNIT });
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
                <button aria-expanded={battleRosterOpen} aria-label={`Visible entity roster, ${visibleCameraTargets.length} living visible entities`} className="next-visible-roster-trigger" data-testid="battle-visible-roster-toggle" onClick={() => setBattleRosterOpen((open) => !open)} type="button"><span>VISIBLE ROSTER</span><b>{visibleCameraTargets.length}</b></button>
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
                  </section>
                  <section className="next-detail-card next-event-card"><div className="next-card-heading"><div><span className="next-eyebrow">BATTLE EVENTS</span><h4>Current tick</h4></div><button onClick={() => setTab("analysis")} type="button">Full analysis ↗</button></div>
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
              <details className="next-result-disclosure"><summary><span>Confirmed result · {formatId(runResult.outcome)}</span><small>{formatId(runResult.termination_reason)} · {runResult.final_tick} ticks · {run.graphicsReplay.timeline.length} public presentation events</small></summary><div className="next-result-detail"><span>YOUR CU <strong>{runResult.cu_spent.attacker}</strong></span><span>REPLAY VIEW <strong>{run.graphicsReplay.header.view === "attacker" ? "Owner" : "Public"}</strong></span><button className="next-result-analysis" onClick={() => setTab("analysis")} type="button">Analyze <b>↗</b></button></div></details>
              <nav className="next-battle-mobile-tabs" aria-label="Battlefield console" data-testid="battle-mobile-console">
                {([ ["battle", "Battle"], ["overview", "Overview"], ["follow", "Follow"], ["timeline", "Timeline"], ["details", "Details"] ] as const).map(([view, label]) => <button aria-label={`${label} view`} aria-pressed={battleMobileView === view} className={battleMobileView === view ? "is-active" : ""} key={view} onClick={() => setBattleView(view)} type="button"><span>{view === "battle" ? "⌖" : view === "overview" ? "◇" : view === "follow" ? "◎" : view === "timeline" ? "≋" : "◉"}</span>{label}</button>)}
              </nav>
            </> : <div className="next-empty-battle"><span className="next-empty-glyph">⌁</span><strong>Battlefield is waiting</strong><p>Compile the current Jinrei draft, then launch five heroes against the local rival.</p><button className="next-secondary-button" onClick={() => setTab(activeCompilation ? "formation" : "jinrei")} type="button">{activeCompilation ? "Review formation" : "Open Jinrei editor"} <b>→</b></button></div>}
          </section>

          <section aria-labelledby="next-tab-analysis" className="next-panel next-analysis-panel" hidden={tab !== "analysis"} id="next-panel-analysis" role="tabpanel">
            <div className="next-panel-header"><div><span className="next-eyebrow">04 · REPLAY AND ABILITY TRACE</span><h3>Read the <em>result</em></h3><p>Select a public event to return the battlefield to that exact replay tick.</p></div>{run && <button className="next-secondary-button" onClick={() => setTab("battle")} type="button">Back to battle <b>↗</b></button>}</div>
            {!run ? <div className="next-empty-battle"><span className="next-empty-glyph">⌁</span><strong>No local battle yet</strong><p>Run a Next battle to populate its public event timeline and optional local diagnostics.</p><button className="next-secondary-button" onClick={() => setTab("jinrei")} type="button">Edit Jinrei <b>→</b></button></div> : <div className="next-analysis-grid">
              <div className="next-analysis-column"><section className="next-detail-card"><div className="next-card-heading"><div><span className="next-eyebrow">{run.graphicsReplay.header.view === "attacker" ? "LOCAL OWNER REPLAY" : "PUBLIC PRESENTATION REPLAY"}</span><h4>Visible battle events <small>{contextualTimelineEvents.length} shown · {timelineEvents.length} total</small></h4></div><span className={run.graphicsReplay.header.view === "attacker" ? "next-local-tag" : "next-public-tag"}>{run.graphicsReplay.header.view === "attacker" ? "YOUR VIEW" : "PUBLIC"}</span></div>
                {contextualTimelineEvents.length ? <ol className="next-timeline">{contextualTimelineEvents.map((event, index) => <li key={`${event.tick}-${event.order}-${index}`}><button className={displayState?.tick === event.tick ? "is-current" : ""} onClick={() => inspectReplayEvent(event)} type="button"><span className="next-timeline-tick">T{String(event.tick).padStart(2, "0")}</span><span className={`next-timeline-mark mark-${event.type}`}>{event.type === "match-end" ? "◆" : event.type === "damage" ? "×" : event.type === "move" ? "→" : "•"}</span><span className="next-timeline-copy"><strong>{formatId(event.type)}</strong><small>{"entityId" in event ? event.entityId : event.type === "spawn" ? event.entity.id : event.type === "match-end" ? event.result.reason : "System event"}{event.type === "match-end" ? ` · ${formatId(event.result.winner)}` : ""}</small></span><span className="next-timeline-open">↗</span></button></li>)}</ol> : <p className="next-empty-detail">This replay has no public timeline events.</p>}
              </section></div>
              <div className="next-analysis-column"><section className="next-detail-card"><div className="next-card-heading"><div><span className="next-eyebrow">XP AND ABILITY EVENTS</span><h4>Hero progression</h4></div><span className="next-event-count">{abilityEvents.length}</span></div>
                {abilityEvents.length ? <ol className="next-diagnostic-list">{abilityEvents.map(({ tick, event, key }) => <li key={key}><span>T{String(tick).padStart(2, "0")}</span><div><strong>{eventTitle(event)}</strong><small>{eventDetails(event) || event.entity || "Visible ability or progression event"}</small></div><button onClick={() => { player?.pause(); player?.seek(tick); setTab("battle"); }} type="button">View ↗</button></li>)}</ol> : <p className="next-empty-detail">No XP or ability event has been emitted in this replay yet. Choose a skill path and add an `activate` order in Jinrei to inspect its effect.</p>}
              </section>
              <section className="next-detail-card"><div className="next-card-heading"><div><span className="next-eyebrow">RESTRICTED LOCAL CHANNEL</span><h4>Jinrei diagnostics</h4></div><span className="next-local-tag">LOCAL ONLY</span></div>
                {diagnostics ? <><div className="next-cu-strip"><span><small>YOUR CU</small><strong>{diagnostics.cu_by_side.attacker}</strong></span><span><small>YOUR TRACE EVENTS</small><strong>{diagnosticRows.length}</strong></span></div>{diagnosticRows.length ? <ol className="next-diagnostic-list next-trace-list">{diagnosticRows.slice(-90).map((row, index) => <li key={`${row.tick}-${index}`}><span>T{String(row.tick).padStart(2, "0")}</span><div><strong>YOUR STRATEGY</strong><small>{row.text}</small></div></li>)}</ol> : <p className="next-empty-detail">Diagnostics were requested, but no local Jinrei trace events were emitted.</p>}</> : <p className="next-empty-detail">Local owner replay and diagnostics were not included. Enable the local option before launch to inspect your heroes, intents, abilities and CU charges.</p>}
              </section></div>
            </div>}
            {runResult && <div className="next-analysis-result"><span className="next-result-mark">{runResult.outcome === "attacker_victory" ? "勝" : runResult.outcome === "defender_victory" ? "敗" : "―"}</span><div><span className="next-eyebrow">FINAL RESULT</span><strong>{formatId(runResult.outcome)}</strong><small>{formatId(runResult.termination_reason)} · tick {runResult.final_tick}</small></div><div className="next-result-digest"><span>FINAL STATE DIGEST</span><code>{runResult.final_state_digest}</code></div><button className="next-secondary-button" disabled={busy || !activeCompilation} onClick={rematch} type="button">{runIsCurrent ? "Rematch this setup" : "Run revised setup"} <b>↻</b></button></div>}
            {baselineRun && runResult && run && <div className="next-run-comparison"><div className="next-comparison-heading"><div><span className="next-eyebrow">LAST RUN · CURRENT RUN</span><strong>{stableKey(baselineRun.snapshot) === stableKey(run.snapshot) ? "Exact deterministic rematch" : "Result after revision"}</strong></div><span>BEFORE / CURRENT</span></div><div className="next-comparison-values"><div><small>BEFORE</small><strong>{formatId(baselineRun.response.outcome.result.outcome)}</strong><span>{baselineRun.response.outcome.result.final_tick} ticks · {baselineRun.response.outcome.result.cu_spent.attacker} CU</span></div><span className="next-comparison-arrow">→</span><div><small>CURRENT</small><strong>{formatId(runResult.outcome)}</strong><span>{runResult.final_tick} ticks · {runResult.cu_spent.attacker} CU</span></div><div className="next-comparison-delta"><small>CHANGE</small><strong>{signed(runResult.final_tick - baselineRun.response.outcome.result.final_tick)} ticks</strong><span>{signed(runResult.cu_spent.attacker - baselineRun.response.outcome.result.cu_spent.attacker)} attacker CU</span></div></div></div>}
          </section>
        </div>
      </div>
    </section>
  );
}
