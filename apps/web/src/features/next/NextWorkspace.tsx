import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { Battlefield as BattlefieldRenderer } from "@senkei/renderer";
import { Battlefield } from "@senkei/renderer";
import { presentationToGraphics, NEXT_WORLD_UNITS_PER_RENDER_UNIT, type Replay, type DisplayState } from "@senkei/replay-contract";
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
  type StructuredTacticsAst,
  type TacticalInput,
  type TacticalSource,
  type RulesetRef,
} from "../../contracts";
import type { SenkeiDraft } from "../../contracts";
import { EditorFeature } from "../editor";
import "./next-workspace.css";

const SLOT_IDS = ["slot-01", "slot-02", "slot-03", "slot-04", "slot-05"] as const;
const DEFAULT_HERO_IDS = ["F01", "F03", "F06", "R02", "R04"] as const;
const DEFAULT_RIVAL_IDS = ["R01", "R03", "R05", "F02", "F04"] as const;
const NEXT_STORAGE_KEY = "senkei.next-workspace.v1";

type WorkspaceTab = "formation" | "jinrei" | "battle" | "analysis";
type Side = "attacker" | "defender";
type HeroFilter = "placement" | "role" | "trait_id";
type FormationShape = "single" | "three-lane" | "wings" | "custom";

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
  if (value.kind === "structured_ast" && isRecord(value.ast)) {
    return { kind: "structured_ast", ast: value.ast as unknown as StructuredTacticsAst };
  }
  return null;
}

function parseDraft(value: unknown): SenkeiDraft | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.revision !== "string") return null;
  const schemaVersion = parseVersion(value.schema_version);
  const ruleset = parseRulesetRef(value.ruleset);
  const source = parseTacticalSource(value.program_input);
  if (!schemaVersion || !ruleset || !source || !isRecord(value.configuration) || !isRecord(value.initial_memory)) return null;
  return {
    schema_version: schemaVersion,
    id: value.id,
    revision: value.revision,
    ruleset,
    configuration: value.configuration as SenkeiDraft["configuration"],
    program_input: source,
    initial_memory: value.initial_memory as SenkeiDraft["initial_memory"],
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
    return `    action advance_${String(index + 1).padStart(2, "0")} {\n        when true,\n        do move(${args.join(", ")}),\n    }`;
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
  const [player, setPlayer] = useState<ReplayPlayer | null>(null);
  const [displayState, setDisplayState] = useState<DisplayState | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [savedSetup, setSavedSetup] = useState<SavedNextSetup | null>(null);
  const [savedSetupLoaded, setSavedSetupLoaded] = useState(false);
  const [savedSetupError, setSavedSetupError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const rendererHost = useRef<HTMLDivElement>(null);
  const renderer = useRef<BattlefieldRenderer | null>(null);
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
    if (!packageValue || !nextRules) return;
    try {
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
  }, [packageValue?.ruleset.digest]);

  const draftKey = draft ? stableKey(draft) : null;
  const activeCompilation = draftKey !== null && compilation?.key === draftKey ? compilation.result : null;
  const savedSetupMismatchReason = savedSetup ? savedSetupMismatch(savedSetup, packageValue, nextRules) : null;
  const canRestoreSavedSetup = savedSetupLoaded && savedSetup !== null && savedSetupMismatchReason === null;
  const runIsCurrent = Boolean(run && activeCompilation &&
    run.snapshot.attacker.program.content_digest === activeCompilation.program.content_digest &&
    stableKey(run.snapshot.attacker.configuration.heroes) === stableKey(heroConfiguration(slots)));
  const activeSlotValue = slots[activeSlot] ?? null;
  const currentHero = activeSlotValue && nextRules ? findHero(nextRules, activeSlotValue.catalog_id) : null;
  const heroes = nextRules?.heroes ?? [];
  const visibleHeroes = useMemo(() => heroes.filter((hero) =>
    (filters.placement === "all" || hero.placement === filters.placement) &&
    (filters.role === "all" || hero.role === filters.role) &&
    (filters.trait_id === "all" || hero.trait_id === filters.trait_id) &&
    hero.stats.hp >= minHp), [filters.placement, filters.role, filters.trait_id, heroes, minHp]);
  const pathNames = currentHero ? Object.keys(currentHero.skill_paths) : [];
  const selectedFrame = run && displayState ? latestFrame(run.sourceReplay.frames, displayState.tick) : null;
  const publicEntities = selectedFrame?.visible_state?.entities ?? {};
  const selectedDisplayEntity = selectedEntityId ? displayState?.entities[selectedEntityId] ?? null : null;
  const selectedEntity = useMemo(() => {
    if (!selectedDisplayEntity) return null;
    const owner = selectedDisplayEntity.side === "azure" ? "attacker" : selectedDisplayEntity.side === "vermilion" ? "defender" : null;
    const catalogId = selectedDisplayEntity.catalogId;
    const position = selectedDisplayEntity.position;
    return Object.values(publicEntities)
      .filter((entity) => entity.entity_type === selectedDisplayEntity.archetype && entity.owner === owner &&
        (!catalogId || fieldString(entity.fields.catalog_id) === catalogId))
      .map((entity) => ({ entity, distance: Math.hypot(
        (fieldInteger(entity.fields.x) ?? Number.NaN) / NEXT_WORLD_UNITS_PER_RENDER_UNIT - position.x,
        (fieldInteger(entity.fields.y) ?? Number.NaN) / NEXT_WORLD_UNITS_PER_RENDER_UNIT - position.y,
      ) }))
      .sort((left, right) => left.distance - right.distance)[0]?.entity ?? null;
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
      player.advance(now - last);
      last = now;
      animationFrame = requestAnimationFrame(advance);
    };
    animationFrame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(animationFrame);
  }, [isPlaying, player]);

  useEffect(() => {
    if (!active) player?.pause();
  }, [active, player]);

  useEffect(() => {
    const host = rendererHost.current;
    if (!host || !run || !displayState) return;
    let current: BattlefieldRenderer | null = null;
    try {
      current = new Battlefield(host, run.graphicsReplay, setSelectedEntityId, setRendererError);
      renderer.current = current;
      current.update(displayState, isPlaying);
      current.select(selectedEntityId);
    } catch (cause) {
      setRendererError(cause instanceof Error ? cause.message : "The 3D renderer could not start.");
    }
    return () => {
      current?.dispose();
      if (renderer.current === current) renderer.current = null;
    };
  }, [run]);

  useEffect(() => {
    renderer.current?.update(displayState ?? { tick: 0, entities: {}, cues: [], result: null }, isPlaying);
    renderer.current?.select(selectedEntityId);
  }, [displayState, isPlaying, selectedEntityId]);

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
      );
      setBaselineRun(run);
      setRun({ snapshot, response, sourceReplay, graphicsReplay });
      setSelectedEntityId(null);
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

  const runOutcome: SimulationOutcome | null = run?.response.outcome ?? null;
  const runResult: MatchResult | null = runOutcome?.result ?? null;
  const frameEvents = selectedFrame?.events ?? [];
  const timelineEvents = run?.graphicsReplay.timeline ?? [];

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
    <section className="next-workspace" aria-label="Next local battle workshop">
      <header className="next-heading">
        <div><span className="next-eyebrow">NEXT · SENRITSU 1.0 · LOCAL ENBU</span><h2>Battle <em>workbench</em></h2><p>Build five heroes, write Jinrei, run the local core and study the synchronized replay.</p></div>
        <div className="next-heading-status"><span className="next-live-dot" />REAL LOCAL SIMULATION<span className="next-heading-mark" aria-hidden="true">兵</span></div>
      </header>

      {error && <div className="next-error" role="alert"><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error">×</button></div>}
      {rendererError && <div className="next-error next-renderer-error" role="alert"><span>{rendererError}</span><button type="button" onClick={() => setRendererError(null)} aria-label="Dismiss renderer error">×</button></div>}

      <section aria-label="Next setup save and restore" className="next-save-bar">
        <div className="next-save-summary"><span className="next-eyebrow">LOCAL NEXT DRAFT</span><strong>Keep this formation and Jinrei separate</strong><small>Stored in this browser with its exact ruleset digest.</small></div>
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
        {savedSetup && <div className={`next-save-message${savedSetupMismatchReason ? " is-error" : ""}`} role={savedSetupMismatchReason ? "alert" : "status"}>
          {savedSetupMismatchReason
            ? <>Saved setup from {savedSetup.ruleset.id} · digest <code>{savedSetup.ruleset.digest}</code>. {savedSetupMismatchReason} It remains available to export or clear.</>
            : <>Saved setup from {new Date(savedSetup.saved_at).toLocaleString()} matches the current ruleset and can be restored.</>}
        </div>}
        {savedSetup && <details className="next-save-preview"><summary>Review saved setup · {savedSetup.slots.map((slot) => slot.catalog_id).join(" · ")}</summary><div><span>Rival: {savedSetup.rival_slots.map((slot) => slot.catalog_id).join(" · ")}</span><pre>{savedSetup.draft.program_input.kind === "text" ? savedSetup.draft.program_input.source : JSON.stringify(savedSetup.draft.program_input.ast, null, 2)}</pre></div></details>}
        {!savedSetup && !savedSetupError && saveMessage && <p className="next-save-message" role="status">{saveMessage}</p>}
        {!savedSetup && !savedSetupError && !saveMessage && <p className="next-save-message" role="status">{savedSetupLoaded ? "No Next setup is saved yet." : "Checking for a saved Next setup…"}</p>}
      </section>

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
              <div><span className="next-eyebrow">01 · HERO CATALOG</span><h3>Assemble your <em>formation</em></h3><p>Every slot keeps its own catalog type, squad, starting node and skill path.</p></div>
              <span className="next-slot-counter">{String(slots.length).padStart(2, "0")} <small>/ 05</small></span>
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

            <div className="next-roster-layout">
              <div className="next-slot-list" role="list" aria-label="Five formation slots">
                {slots.map((slot, index) => {
                  const hero = findHero(nextRules, slot.catalog_id);
                  return <button className={`next-slot-card${activeSlot === index ? " is-active" : ""}`} key={slot.slot_id} onClick={() => setActiveSlot(index)} type="button">
                    <span className="next-slot-index">{String(index + 1).padStart(2, "0")}</span>
                    <span className={`next-hero-sigil ${hero?.placement ?? ""}`}>{hero?.placement === "backline" ? "⌁" : "◆"}</span>
                    <span className="next-slot-copy"><strong>{hero?.name ?? "Choose a hero"}</strong><small>{hero ? `${hero.id} · ${formatId(hero.role)}` : slot.slot_id}</small></span>
                    <span className="next-slot-arrow">↗</span>
                  </button>;
                })}
              </div>

              <div className="next-slot-editor">
                {activeSlotValue && currentHero ? <>
                  <div className="next-slot-editor-heading"><div><span className="next-eyebrow">SLOT {String(activeSlot + 1).padStart(2, "0")} · {activeSlotValue.slot_id}</span><h4>{currentHero.name}</h4><p>{formatId(currentHero.trait_id)} · {formatId(currentHero.placement)} · {formatId(currentHero.role)}</p></div><span className="next-hero-id">{currentHero.id}</span></div>
                  <div className="next-stat-row">{(["hp", "attack", "defense", "speed"] as const).map((stat) => <div key={stat}><span>{formatId(stat)}</span><strong>{currentHero.stats[stat]}</strong></div>)}</div>
                  <div className="next-slot-controls">
                    <label className="next-field"><span>Squad</span><select value={activeSlotValue.squad} onChange={(event) => changeSlot(activeSlot, { squad: event.target.value })}>{["alpha", "bravo", "charlie", "north", "center", "south", "top", "mid", "bot"].map((value) => <option key={value} value={value}>{formatId(value)}</option>)}</select></label>
                    <label className="next-field"><span>Starting node</span><select value={activeSlotValue.node} onChange={(event) => changeSlot(activeSlot, { node: event.target.value })}>{Object.keys(nextRules.map.nodes).map((node) => <option key={node} value={node}>{formatId(node)}{Object.entries(nextRules.map.lanes).find(([, nodes]) => nodes.includes(node))?.[0] ? ` · ${formatId(Object.entries(nextRules.map.lanes).find(([, nodes]) => nodes.includes(node))?.[0] ?? "")}` : ""}</option>)}</select></label>
                    <label className="next-field"><span>Skill path</span><select value={activeSlotValue.skill_path} onChange={(event) => changeSlot(activeSlot, { skill_path: event.target.value })}>{pathNames.map((path) => <option key={path} value={path}>{formatId(path)}</option>)}</select></label>
                  </div>
                  <div className="next-path-skills"><span className="next-filter-label">SKILL PATH LOADOUT</span><div>{skillNames(currentHero, activeSlotValue.skill_path).map((skill) => <span key={skill}>{skill}</span>)}</div></div>
                </> : <div className="next-slot-editor-heading"><div><span className="next-eyebrow">SELECT A SLOT</span><h4>Choose a hero</h4></div></div>}
              </div>
            </div>

            <section className="next-catalog" aria-label="Filtered hero catalog">
              <div className="next-catalog-heading"><div><span className="next-eyebrow">CATALOG · {visibleHeroes.length} AVAILABLE</span><h4>Select for slot {String(activeSlot + 1).padStart(2, "0")}</h4></div><small>Filters apply to this pick list</small></div>
              <div className="next-catalog-grid">
                {visibleHeroes.map((hero) => <button aria-pressed={activeSlotValue?.catalog_id === hero.id} className={`next-catalog-card${activeSlotValue?.catalog_id === hero.id ? " is-selected" : ""}`} key={hero.id} onClick={() => {
                  const path = hero.skill_paths[activeSlotValue?.skill_path ?? "path_a"] ? (activeSlotValue?.skill_path ?? "path_a") : Object.keys(hero.skill_paths)[0] ?? "";
                  changeSlot(activeSlot, { catalog_id: hero.id, skill_path: path });
                }} type="button">
                  <div className="next-catalog-card-top"><span className="next-catalog-id">{hero.id}</span><span className="next-hero-sigil">{hero.placement === "backline" ? "⌁" : "◆"}</span></div>
                  <strong>{hero.name}</strong><small>{formatId(hero.role)} · {formatId(hero.trait_id)}</small>
                  <div className="next-catalog-stats"><span>HP <b>{hero.stats.hp}</b></span><span>ATK <b>{hero.stats.attack}</b></span><span>DEF <b>{hero.stats.defense}</b></span></div>
                </button>)}
                {visibleHeroes.length === 0 && <div className="next-catalog-empty">No heroes match these attribute filters. Clear one filter to continue.</div>}
              </div>
            </section>

            <div className="next-panel-footer"><span>Five records are sent as typed Senkei configuration.</span><button className="next-secondary-button" onClick={() => setTab("jinrei")} type="button">Continue to Jinrei <b>→</b></button></div>
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
            <div className="next-panel-header"><div><span className="next-eyebrow">03 · LOCAL MATCH</span><h3>Observe the <em>battlefield</em></h3><p>Replay, battle cursor and visible entity state share the same tick.</p></div><div className="next-battle-actions"><button className="next-secondary-button" disabled={!run || busy || !activeCompilation} onClick={rematch} type="button">{runIsCurrent ? "Rematch" : "Run revised battle"} <b>↻</b></button><button className="next-launch-button" disabled={busy || !activeCompilation} onClick={() => void launchBattle()} type="button"><span>{busy ? "◌" : "▶"}</span>{busy ? "Running local core…" : "Launch local battle"}</button></div></div>
            <div className="next-battle-controls-row">
              <label className="next-diagnostic-toggle"><input checked={includeDiagnostics} onChange={(event) => setIncludeDiagnostics(event.target.checked)} type="checkbox" /><span className="next-checkbox" /><span><strong>Include my local replay and diagnostics</strong><small>Your hero state, ability trace, intents and CU only</small></span></label>
              <span className="next-match-badge">{runResult ? `MATCH ${runResult.match_id.slice(0, 16)}` : "READY WHEN JINREI IS COMPILED"}</span>
            </div>
            {runResult && run ? <>
              <div className="next-result-strip"><span className="next-result-mark">{runResult.outcome === "attacker_victory" ? "勝" : runResult.outcome === "defender_victory" ? "敗" : "―"}</span><div><span className="next-eyebrow">AUTHORITATIVE ENBU RESULT</span><strong>{formatId(runResult.outcome)}</strong><small>{formatId(runResult.termination_reason)} · {runResult.final_tick} ticks</small></div><div className="next-result-metrics"><span><small>YOUR CU</small><strong>{runResult.cu_spent.attacker}</strong></span><span><small>OBSERVED EVENTS</small><strong>{run.graphicsReplay.timeline.length}</strong></span></div><button className="next-result-analysis" onClick={() => setTab("analysis")} type="button">Analyze <b>↗</b></button></div>
              <div className="next-replay-toolbar">
                <div className="next-play-controls"><button aria-label="Return to first tick" disabled={!player} onClick={() => player?.reset()} type="button">|◀</button><button className="next-play-button" aria-label={isPlaying ? "Pause replay" : "Play replay"} disabled={!player || run.graphicsReplay.result.tick === 0} onClick={() => isPlaying ? player?.pause() : player?.play()} type="button">{isPlaying ? "Ⅱ" : "▶"}</button><button aria-label="Previous tick" disabled={!player || !displayState || displayState.tick === 0} onClick={() => player?.seek(Math.max(0, (displayState?.tick ?? 0) - 1))} type="button">←</button><button aria-label="Next tick" disabled={!player || !displayState || displayState.tick >= run.graphicsReplay.result.tick} onClick={() => player?.seek(Math.min(run.graphicsReplay.result.tick, (displayState?.tick ?? 0) + 1))} type="button">→</button></div>
                <label className="next-speed"><span>SPEED</span><select aria-label="Replay speed" onChange={(event) => player?.setSpeed(Number(event.target.value))} defaultValue="1"><option value="1">1×</option><option value="2">2×</option><option value="4">4×</option></select></label>
                <div className="next-camera-controls"><button onClick={() => renderer.current?.zoom(1.2)} type="button" aria-label="Zoom in">＋</button><button onClick={() => renderer.current?.zoom(0.83)} type="button" aria-label="Zoom out">−</button><button disabled={!selectedEntityId} onClick={() => selectedEntityId && renderer.current?.setTracking(selectedEntityId)} type="button">Follow</button><button onClick={() => { renderer.current?.setTracking(null); renderer.current?.resetCamera(); }} type="button">Overview</button></div>
                <span className="next-tick-readout">TICK <strong>{displayState?.tick ?? 0}</strong><small> / {run.graphicsReplay.result.tick}</small></span>
              </div>
              <div className="next-seekbar"><input aria-label="Seek replay tick" disabled={!player || run.graphicsReplay.result.tick === 0} max={run.graphicsReplay.result.tick} min="0" onChange={(event) => player?.seek(Number(event.target.value))} type="range" value={displayState?.tick ?? 0} /><div><span>START · 00</span><span>FINAL · {String(run.graphicsReplay.result.tick).padStart(2, "0")}</span></div></div>
              <div className="next-battle-stage"><div aria-label="Interactive three-dimensional replay" className="next-renderer-host" ref={rendererHost} /><div className="next-stage-hud"><span><i /> {run.graphicsReplay.header.view === "attacker" ? "LOCAL OWNER VIEW" : "PUBLIC REPLAY"}</span><span>{displayState?.entities ? Object.keys(displayState.entities).length : 0} VISIBLE ENTITIES</span></div></div>
              <div className="next-battle-lower">
                <section className="next-detail-card"><div className="next-card-heading"><div><span className="next-eyebrow">VISIBLE STATE · TICK {displayState?.tick ?? 0}</span><h4>{selectedEntity ? fieldString(selectedEntity.fields.catalog_id) ?? selectedEntity.entity_type : "Select a unit"}</h4></div><span className="next-owner-tag">{selectedEntity ? selectedEntity.owner ?? "neutral" : "PUBLIC"}</span></div>
                  {selectedEntity ? <div className="next-entity-stats">{(["hp", "xp", "level", "maturity", "energy", "node", "squad", "skill_path", "skills"] as const).map((field) => {
                    const value = selectedEntity.fields[field];
                    const label = field === "xp" && value?.kind === "integer"
                      ? formatExperience(value.value, nextRules)
                      : value ? domainLabel(value) : "";
                    return value ? <div key={field}><span>{formatId(field)}</span><strong>{label}</strong></div> : null;
                  })}</div> : <p className="next-empty-detail">Tap a hero on the battlefield to inspect the replay’s visible HP, XP, level and skill state.</p>}
                  {selectedEntity && fieldInteger(selectedEntity.fields.xp) !== null && <div className="next-xp-bar"><span>XP <b>{formatExperience(fieldInteger(selectedEntity.fields.xp) ?? 0, nextRules)}</b></span><span>Level <b>{fieldInteger(selectedEntity.fields.level) ?? 1}</b></span></div>}
                </section>
                <section className="next-detail-card next-event-card"><div className="next-card-heading"><div><span className="next-eyebrow">BATTLE EVENTS</span><h4>Current tick</h4></div><button onClick={() => setTab("analysis")} type="button">Full log ↗</button></div>
                  {frameEvents.length ? <ul className="next-event-list">{frameEvents.slice(-6).map((event, index) => <li key={`${event.event}-${event.entity}-${index}`}><span>T{selectedFrame?.tick}</span><div><strong>{eventTitle(event)}</strong><small>{eventDetails(event) || event.entity || "Battle system"}</small></div></li>)}</ul> : <p className="next-empty-detail">No visible event is recorded at this tick.</p>}
                </section>
              </div>
              <div className="next-rematch-foot"><span>The battle state, XP and outcome come from the local core’s PresentationReplay.</span><button className="next-secondary-button" onClick={() => setTab("formation")} type="button">Revise formation or Jinrei <b>↗</b></button></div>
            </> : <div className="next-empty-battle"><span className="next-empty-glyph">⌁</span><strong>Battlefield is waiting</strong><p>Compile the current Jinrei draft, then launch five heroes against the local rival.</p><button className="next-secondary-button" onClick={() => setTab(activeCompilation ? "formation" : "jinrei")} type="button">{activeCompilation ? "Review formation" : "Open Jinrei editor"} <b>→</b></button></div>}
          </section>

          <section aria-labelledby="next-tab-analysis" className="next-panel next-analysis-panel" hidden={tab !== "analysis"} id="next-panel-analysis" role="tabpanel">
            <div className="next-panel-header"><div><span className="next-eyebrow">04 · REPLAY AND ABILITY TRACE</span><h3>Read the <em>result</em></h3><p>Select a public event to return the battlefield to that exact replay tick.</p></div>{run && <button className="next-secondary-button" onClick={() => setTab("battle")} type="button">Back to battle <b>↗</b></button>}</div>
            {!run ? <div className="next-empty-battle"><span className="next-empty-glyph">⌁</span><strong>No local battle yet</strong><p>Run a Next battle to populate its public event timeline and optional local diagnostics.</p><button className="next-secondary-button" onClick={() => setTab("jinrei")} type="button">Edit Jinrei <b>→</b></button></div> : <div className="next-analysis-grid">
              <div className="next-analysis-column"><section className="next-detail-card"><div className="next-card-heading"><div><span className="next-eyebrow">{run.graphicsReplay.header.view === "attacker" ? "LOCAL OWNER REPLAY" : "PUBLIC PRESENTATION REPLAY"}</span><h4>Visible battle events <small>{timelineEvents.length}</small></h4></div><span className={run.graphicsReplay.header.view === "attacker" ? "next-local-tag" : "next-public-tag"}>{run.graphicsReplay.header.view === "attacker" ? "YOUR VIEW" : "PUBLIC"}</span></div>
                {timelineEvents.length ? <ol className="next-timeline">{timelineEvents.slice(-180).map((event, index) => <li key={`${event.tick}-${event.order}-${index}`}><button className={displayState?.tick === event.tick ? "is-current" : ""} onClick={() => { player?.pause(); player?.seek(event.tick); setTab("battle"); }} type="button"><span className="next-timeline-tick">T{String(event.tick).padStart(2, "0")}</span><span className={`next-timeline-mark mark-${event.type}`}>{event.type === "match-end" ? "◆" : event.type === "damage" ? "×" : event.type === "move" ? "→" : "•"}</span><span className="next-timeline-copy"><strong>{formatId(event.type)}</strong><small>{"entityId" in event ? event.entityId : event.type === "spawn" ? event.entity.id : event.type === "match-end" ? event.result.reason : "System event"}{event.type === "match-end" ? ` · ${formatId(event.result.winner)}` : ""}</small></span><span className="next-timeline-open">↗</span></button></li>)}</ol> : <p className="next-empty-detail">This replay has no public timeline events.</p>}
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
