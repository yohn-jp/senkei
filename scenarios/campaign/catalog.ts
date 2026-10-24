import { STRUCTURED_AST_VERSION } from "../../apps/web/src/contracts/core";
import type {
  DomainType,
  DomainValue,
  RulePackage,
  StructuredTacticsAst,
  TacticalSource,
  TacticalValue,
} from "../../apps/web/src/contracts/core-model";
import type { SenkeiDraft } from "../../apps/web/src/contracts/workspace";

export type ScenarioDifficulty = "beginner" | "standard" | "expert";

export interface ScenarioCriterion {
  readonly id: string;
  readonly label: string;
}

export interface CampaignScenario {
  readonly id: string;
  readonly campaign_id: string;
  readonly campaign_title: string;
  readonly order: number;
  readonly difficulty: ScenarioDifficulty;
  readonly title: string;
  readonly description: string;
  readonly objective: string;
  readonly criteria: readonly ScenarioCriterion[];
  readonly npc: SenkeiDraft;
}

interface Recipe {
  readonly id: string;
  readonly campaign_id: string;
  readonly campaign_title: string;
  readonly order: number;
  readonly difficulty: ScenarioDifficulty;
  readonly title: string;
  readonly description: string;
  readonly objective: string;
  readonly criteria: readonly ScenarioCriterion[];
  readonly source: string;
  readonly configuration?: Readonly<Record<string, DomainValue>>;
}

const firstUnit = (field: string): string =>
  `argmin unit in allies.units by unit.${field} then unit.id`;

const weakestUnitText = (): string =>
  `argmin unit in allies.units by unit.hp then unit.id`;

const recipes: readonly Recipe[] = [
  {
    id: "first-march",
    campaign_id: "first-orders",
    campaign_title: "First orders",
    order: 1,
    difficulty: "beginner",
    title: "Marching line",
    description: "A measured opponent advances one available unit at a time.",
    objective: "Learn how a simple action changes the line over several ticks.",
    criteria: [
      { id: "inspect-movement", label: "Find a move event in the public replay." },
      { id: "repeat-result", label: "Run the same input again and compare the result." },
    ],
    source: `senkei marching_line {
    action advance_one {
        when true,
        do move_forward(${firstUnit("position")}),
    },
}`,
  },
  {
    id: "core-pressure",
    campaign_id: "first-orders",
    campaign_title: "First orders",
    order: 2,
    difficulty: "beginner",
    title: "Core pressure",
    description: "A cavalry-led formation keeps its focus on the opposing core.",
    objective: "Compare a direct objective with gradual lane movement.",
    criteria: [
      { id: "inspect-objective", label: "Trace an attack aimed at the core." },
      { id: "compare-lines", label: "Compare this tactic with Marching line." },
    ],
    source: `senkei core_pressure {
    action strike_core {
        when true,
        do attack_core(
            ${firstUnit("position")},
            argmin core in enemies.visible_cores by core.position then core.id,
        ),
    },
}`,
    configuration: {
      starting_credits: integer(24),
      initial_deployments: list([
        deployment("core-cavalry-top", "cavalry", "top", 2),
        deployment("core-infantry-mid", "infantry", "mid", 4),
        deployment("core-archer-bot", "archer", "bot", 6),
      ]),
    },
  },
  {
    id: "intercept-visible",
    campaign_id: "read-the-line",
    campaign_title: "Read the line",
    order: 1,
    difficulty: "standard",
    title: "Intercept a visible unit",
    description: "The opponent selects the weakest currently visible unit as its target.",
    objective: "Follow target selection from observed units to the resolved action.",
    criteria: [
      { id: "observe-target", label: "Check which visible unit was selected." },
      { id: "respect-visibility", label: "Confirm no hidden target appears in the replay." },
    ],
    source: `senkei intercept_visible {
    action intercept {
        when true,
        do attack_unit(${firstUnit("position")}, argmin target in enemies.visible_units by target.hp then target.id),
    },
}`,
  },
  {
    id: "tower-pressure",
    campaign_id: "read-the-line",
    campaign_title: "Read the line",
    order: 2,
    difficulty: "standard",
    title: "Break a tower",
    description: "The opponent attacks the most damaged visible tower.",
    objective: "Compare structure pressure with attacks on the core or mobile units.",
    criteria: [
      { id: "inspect-tower", label: "Find the tower target and damage event." },
      { id: "compare-cases", label: "Run the previous challenge and compare replay frames." },
    ],
    source: `senkei tower_pressure {
    action attack_tower {
        when true,
        do attack_tower(${firstUnit("position")}, argmin tower in enemies.visible_towers by tower.hp then tower.id),
    },
}`,
    configuration: {
      starting_credits: integer(24),
      initial_deployments: list([
        deployment("tower-infantry-top", "infantry", "top", 3),
        deployment("tower-archer-mid", "archer", "mid", 5),
        deployment("tower-cavalry-bot", "cavalry", "bot", 7),
      ]),
    },
  },
  {
    id: "hold-under-pressure",
    campaign_id: "command-the-formation",
    campaign_title: "Command the formation",
    order: 1,
    difficulty: "expert",
    title: "Hold under pressure",
    description: "The opponent withdraws a unit while its core is damaged and advances otherwise.",
    objective: "Inspect both branches of a tactic based on the core's observed HP.",
    criteria: [
      { id: "trace-threat", label: "Find the core threat observation in diagnostics." },
      { id: "compare-branches", label: "Check which movement action fired in each state." },
    ],
    source: `senkei hold_under_pressure {
    state wounded {
        self.core.hp < 300,
    },
    action withdraw {
        when wounded,
        do move_backward(${firstUnit("position")}),
    },
    action advance {
        when not { wounded, },
        do move_forward(${firstUnit("position")}),
    },
}`,
    configuration: {
      starting_credits: integer(24),
      initial_deployments: list([
        deployment("hold-infantry-top", "infantry", "top", 7),
        deployment("hold-archer-mid", "archer", "mid", 5),
        deployment("hold-medic-bot", "medic", "bot", 3),
      ]),
    },
  },
  {
    id: "medic-support",
    campaign_id: "command-the-formation",
    campaign_title: "Command the formation",
    order: 2,
    difficulty: "expert",
    title: "Support the weakest ally",
    description: "A medic uses its ability on the lowest-health friendly unit.",
    objective: "Inspect ally selection and the support effect in diagnostics and replay.",
    criteria: [
      { id: "select-medic", label: "Confirm the ability actor is a medic." },
      { id: "heal-ally", label: "Find a support effect on a friendly unit." },
    ],
    source: `senkei medic_support {
    state ally_injured {
        any ally in allies.units {
            ally.hp < ally.max_hp,
        },
    },
    action support_weakest {
        when ally_injured,
        do use_ability(
            argmin medic in filter unit in allies.units { unit.unit_class == medic }
                by medic.hp then medic.id,
            ${weakestUnitText()},
        ),
    },
}`,
    configuration: {
      starting_credits: integer(24),
      initial_deployments: list([
        deployment("support-medic-top", "medic", "top", 4),
        deployment("support-infantry-mid", "infantry", "mid", 4),
        deployment("support-archer-bot", "archer", "bot", 4),
      ]),
    },
  },
  {
    id: "deploy-reserve",
    campaign_id: "command-the-formation",
    campaign_title: "Command the formation",
    order: 3,
    difficulty: "expert",
    title: "Deploy the next reserve",
    description: "The opponent spends one credit to deploy the next available reinforcement at MID.",
    objective: "Inspect a scheduled reserve, its deployment order, and the resource cost.",
    criteria: [
      { id: "wait-for-reserve", label: "Find the first deployment after its available tick." },
      { id: "check-credit-cost", label: "Compare the starting and remaining resources." },
    ],
    source: `senkei deploy_reserve {
    action deploy_next {
        when match.tick >= 4,
        do deploy(
            argmin barracks in allies.barracks by barracks.resources then barracks.id,
            argmin reserve in allies.reserves by reserve.available_tick then reserve.id,
            mid,
        ),
    },
}`,
  },
];

export function createCampaignScenarios(ruleset: RulePackage): readonly CampaignScenario[] {
  assertInitialRuleset(ruleset);
  return recipes.map(({ configuration, source, ...metadata }) => ({
    ...metadata,
    npc: createDraft(ruleset, `npc-${metadata.id}`, sourceTactic(source), configuration),
  }));
}

/** A working, structured starter tactic. It needs no hand-written source code. */
export function createBeginnerPreset(ruleset: RulePackage): SenkeiDraft {
  assertInitialRuleset(ruleset);
  const ast: StructuredTacticsAst = {
    schema_version: STRUCTURED_AST_VERSION,
    program_name: "first_march",
    declarations: [
      {
        kind: "action",
        name: "advance_one",
        when: { kind: "literal_truth", value: true },
        do_call: {
          capability: ["move_forward"],
          arguments: [minEntity("unit", ["allies", "units"], ["position"])],
        },
      },
    ],
  };
  return createDraft(ruleset, "preset-beginner-march", { kind: "structured_ast", ast });
}

function createDraft(
  ruleset: RulePackage,
  id: string,
  program_input: TacticalSource,
  overrides: Readonly<Record<string, DomainValue>> = {},
): SenkeiDraft {
  const configuration = Object.fromEntries(
    Object.entries(ruleset.domain.senkei_configuration).map(([field, schema]) => [
      field,
      schema.default ?? domainValueForType(schema.value_type),
    ]),
  );
  for (const [field, value] of Object.entries(overrides)) {
    if (!(field in ruleset.domain.senkei_configuration)) {
      throw new Error(`Scenario configuration ${field} is not in the active ruleset schema.`);
    }
    configuration[field] = value;
  }

  const initial_memory = Object.fromEntries(
    Object.entries(ruleset.domain.tactical_memory).map(([field, type]) => [field, domainValueForType(type)]),
  );
  return {
    schema_version: ruleset.model_version,
    id,
    revision: "1",
    ruleset: ruleset.ruleset,
    configuration,
    program_input,
    initial_memory,
  };
}

function assertInitialRuleset(ruleset: RulePackage): void {
  if (ruleset.ruleset.id !== "senkei.initial") {
    throw new Error(`NPC scenarios require senkei.initial; received ${ruleset.ruleset.id}.`);
  }
  for (const field of ["starting_credits", "initial_deployments", "reinforcements"]) {
    if (!(field in ruleset.domain.senkei_configuration)) {
      throw new Error(`senkei.initial is missing configuration field ${field}.`);
    }
  }
  for (const capability of ["move_forward", "attack_core", "attack_unit", "attack_tower", "move_backward", "use_ability", "deploy"]) {
    if (!(capability in ruleset.domain.capabilities)) {
      throw new Error(`senkei.initial is missing capability ${capability}.`);
    }
  }
  for (const collection of [
    "allies.units",
    "allies.reserves",
    "allies.barracks",
    "enemies.visible_units",
    "enemies.visible_towers",
    "enemies.visible_cores",
  ]) {
    if (!(collection in ruleset.domain.collections)) {
      throw new Error(`senkei.initial is missing observable collection ${collection}.`);
    }
  }
  for (const [domain, values] of Object.entries({
    lane: ["top", "mid", "bot"],
    unit_class: ["infantry", "archer", "cavalry", "medic"],
  })) {
    const declared = ruleset.domain.symbol_domains[domain];
    if (!declared || values.some((value) => !declared.includes(value))) {
      throw new Error(`senkei.initial does not publish the expected ${domain} values.`);
    }
  }
}

function sourceTactic(source: string): TacticalSource {
  return { kind: "text", source };
}

function domainValueForType(type: DomainType, depth = 0): DomainValue {
  if (depth > 16) throw new Error("RulePackage contains a value schema deeper than the editor limit.");
  switch (type.kind) {
    case "bool":
      return { kind: "bool", value: false };
    case "integer":
      return { kind: "integer", value: integerDefault(type.value.min, type.value.max) };
    case "fixed":
      return {
        kind: "fixed",
        value: { coefficient: integerDefault(type.value.min, type.value.max), scale: type.value.scale },
      };
    case "string":
      return { kind: "string", value: "" };
    case "enum": {
      const first = [...type.value.values].sort()[0];
      if (first === undefined) throw new Error(`Enum ${type.value.domain} has no values.`);
      return { kind: "enum", value: first };
    }
    case "entity":
      throw new Error("Entity-valued configuration requires an explicit Senritsu default.");
    case "optional":
      return { kind: "null" };
    case "list":
    case "vector":
    case "matrix":
      return { kind: "list", value: [] };
    case "record":
      return {
        kind: "record",
        value: Object.fromEntries(
          Object.entries(type.value.fields).map(([field, fieldType]) => [
            field,
            domainValueForType(fieldType, depth + 1),
          ]),
        ),
      };
  }
}

function integerDefault(min: number | null, max: number | null): number {
  let candidate = min ?? 0;
  if (max !== null && candidate > max) candidate = max;
  return candidate;
}

function integer(value: number): DomainValue {
  return { kind: "integer", value };
}

function text(value: string): DomainValue {
  return { kind: "string", value };
}

function enumValue(value: string): DomainValue {
  return { kind: "enum", value };
}

function list(value: readonly DomainValue[]): DomainValue {
  return { kind: "list", value };
}

function record(value: Readonly<Record<string, DomainValue>>): DomainValue {
  return { kind: "record", value };
}

function deployment(slot: string, unitClass: string, lane: string, position: number): DomainValue {
  return record({
    slot_id: text(slot),
    unit_class: enumValue(unitClass),
    lane: enumValue(lane),
    position: integer(position),
  });
}

function minEntity(binding: string, collectionPath: readonly string[], fields: readonly string[]): TacticalValue {
  return {
    kind: "arg_min",
    value: {
      binding,
      collection: { kind: "path", value: collectionPath },
      expression: { kind: "path", value: [binding, ...fields] },
      unique_key: [binding, "id"],
    },
  };
}

