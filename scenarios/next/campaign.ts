import type {
  DomainValue,
  MatchResult,
  RulePackage,
} from "../../apps/web/src/contracts/core-model";
import type { LocalPveScenario, SenkeiDraft } from "../../apps/web/src/contracts/workspace";
import sourceFixtures from "./source-fixtures.json";

const sourceByScenario = new Map(sourceFixtures.map(({ id, source }) => [id, source]));

/**
 * Authored local opponents for the finite `senkei.next` package.
 *
 * Each opponent is an ordinary Senkei draft: the browser compiles its Jinrei
 * source and sends it through the same Enbu path as a player-authored draft.
 * Challenge objectives describe what to inspect; match victory remains the
 * package's base-destruction condition.
 */
export function createNextCampaignScenarios(ruleset: RulePackage): readonly LocalPveScenario[] {
  const next = ruleset.next;
  if (ruleset.ruleset.id !== "senkei.next" || !next) {
    throw new Error("The Next campaign requires the active senkei.next RulePackage.");
  }
  if (next.heroes.length < 5) {
    throw new Error("The Next campaign requires at least five catalog Heroes.");
  }

  const campaigns: readonly ScenarioRecipe[] = [
    {
      id: "first-march",
      campaign_id: "first-orders",
      campaign_title: "First orders",
      order: 1,
      difficulty: "beginner",
      title: "March to the lane",
      description: "Five Solo Heroes take a direct route toward the opposing base.",
      objective: "Follow the accepted move orders and compare how Solo routes converge on the same objective.",
      criteria: [
        { id: "find-move", label: "Find the accepted move orders and the route each Hero takes." },
        { id: "follow-line", label: "Compare Solo movement with a grouped patrol before editing your tactic." },
      ],
      roster: ["F01", "F03", "F06", "R02", "R04"],
      squads: [1, 1, 1, 1, 1],
      destinations: ["A.BASE", "A.BASE", "A.BASE", "A.BASE", "A.BASE"],
    },
    {
      id: "read-the-map",
      campaign_id: "read-the-map",
      campaign_title: "Read the map",
      order: 1,
      difficulty: "beginner",
      title: "Scout the center",
      description: "A scout takes the jungle route to the central observation point while the other Heroes spread across lanes.",
      objective: "Inspect the route and current visibility around the center before choosing where to reinforce.",
      criteria: [
        { id: "scout-route", label: "Trace the scout's route through a jungle node." },
        { id: "center-vision", label: "Inspect the public replay for the central observation point and visible units." },
      ],
      roster: ["R03", "F01", "R01", "F02", "R02"],
      squads: [1, 1, 1, 1, 1],
      destinations: ["N.MID.OBS", "A.TOP.T1", "A.MID.T1", "A.BOT.T1", "A.MID.T1"],
    },
    {
      id: "share-the-pressure",
      campaign_id: "split-the-force",
      campaign_title: "Split the force",
      order: 1,
      difficulty: "standard",
      title: "Pressure two lanes",
      description: "Two coordinated patrols advance on TOP and BOT, leaving the center open to a response.",
      objective: "Compare the travel and combat trade-offs of two groups against a concentrated defense.",
      criteria: [
        { id: "follow-groups", label: "Compare the two patrols' movement and squad size." },
        { id: "inspect-defense", label: "Find whether the defender can cover both threatened lanes." },
      ],
      roster: ["F01", "F02", "R01", "R02", "F03"],
      squads: [2, 2, 1],
      destinations: ["A.TOP.T2", "A.TOP.T2", "A.BOT.T2", "A.BOT.T2", "N.MID.OBS"],
    },
    {
      id: "jungle-objective",
      campaign_id: "split-the-force",
      campaign_title: "Split the force",
      order: 2,
      difficulty: "standard",
      title: "Contest a jungle camp",
      description: "A durable frontline group contests a neutral camp while a pair protects the lane entrance.",
      objective: "Observe how committing Heroes to a neutral objective changes lane coverage and experience.",
      criteria: [
        { id: "camp-combat", label: "Find the camp engagement and its end state in the replay." },
        { id: "lane-cost", label: "Compare lane presence while the objective group is away." },
      ],
      roster: ["F04", "F05", "R03", "R04", "F06"],
      squads: [3, 2],
      destinations: ["N.A.UC", "N.A.UC", "N.A.UC", "A.TOP.T1", "A.TOP.T1"],
    },
    {
      id: "bridge-approach",
      campaign_id: "hold-the-crossing",
      campaign_title: "Hold the crossing",
      order: 1,
      difficulty: "expert",
      title: "Approach the bridge together",
      description: "A trained quintet crosses the BOT bridge together into the opposing bank.",
      objective: "Read bridge occupancy and squad movement together, then compare crossing with a faster split patrol.",
      criteria: [
        { id: "bridge-state", label: "Check the bridge state and the Heroes' crossing progress." },
        { id: "formation-cost", label: "Compare quintet movement with a faster split patrol." },
      ],
      roster: ["F01", "F02", "F03", "R01", "R03"],
      squads: [5],
      destinations: ["A.BOT.BANK", "A.BOT.BANK", "A.BOT.BANK", "A.BOT.BANK", "A.BOT.BANK"],
    },
    {
      id: "protect-the-core",
      campaign_id: "hold-the-crossing",
      campaign_title: "Hold the crossing",
      order: 2,
      difficulty: "expert",
      title: "Regroup for a base defense",
      description: "A mixed role group falls back to protect its base as the other side approaches through multiple lanes.",
      objective: "Inspect how role coverage, regrouping, and the base objective affect the final defense.",
      criteria: [
        { id: "roles", label: "Identify the frontline and support roles in the formation." },
        { id: "base-condition", label: "Confirm the match still ends only when a base is destroyed." },
      ],
      roster: ["F04", "F06", "R01", "R03", "R06"],
      squads: [3, 2],
      destinations: ["B.BASE", "B.BASE", "B.BASE", "B.BASE", "B.BASE"],
      startNodes: ["B.TOP.T2", "B.MID.T2", "B.BOT.T2", "B.MID.T1", "B.TOP.T1"],
    },
  ];

  return campaigns.map((recipe) => {
    const { roster: _roster, squads: _squads, destinations: _destinations, startNodes: _startNodes, ...scenario } = recipe;
    return { ...scenario, npc: createNpcDraft(ruleset, recipe) };
  });
}

export interface NextCampaignRunFeedback {
  readonly status: "victory" | "defeat" | "draw" | "incomplete";
  readonly headline: string;
  readonly detail: string;
  readonly final_tick: number;
  readonly termination_reason: string;
}

/** Describe the measured match result without claiming unmeasured objectives. */
export function getNextCampaignRunFeedback(result: MatchResult): NextCampaignRunFeedback {
  if (result.outcome === "attacker_victory" && result.termination_reason === "base_destroyed") {
    return {
      status: "victory",
      headline: "Victory: the opposing base was destroyed.",
      detail: `The match ended at tick ${result.final_tick} (${result.termination_reason}). Review the replay against this challenge's learning prompts.`,
      final_tick: result.final_tick,
      termination_reason: result.termination_reason,
    };
  }
  if (result.outcome === "defender_victory" && result.termination_reason === "base_destroyed") {
    return {
      status: "defeat",
      headline: "Defeat: your base was destroyed.",
      detail: `The match ended at tick ${result.final_tick} (${result.termination_reason}). Use the replay to find where the defense lost ground.`,
      final_tick: result.final_tick,
      termination_reason: result.termination_reason,
    };
  }
  if (result.outcome === "draw") {
    return {
      status: "draw",
      headline: "Draw: neither side won the match.",
      detail: `The match ended at tick ${result.final_tick} (${result.termination_reason}). Inspect lane pressure, objective control, and base health in the replay.`,
      final_tick: result.final_tick,
      termination_reason: result.termination_reason,
    };
  }
  return {
    status: "incomplete",
    headline: "Match did not complete.",
    detail: `The result was aborted at tick ${result.final_tick} (${result.termination_reason}).`,
    final_tick: result.final_tick,
    termination_reason: result.termination_reason,
  };
}

interface ScenarioRecipe extends Omit<LocalPveScenario, "npc"> {
  readonly roster: readonly string[];
  readonly squads: readonly number[];
  readonly destinations: readonly string[];
  readonly startNodes?: readonly string[];
}

function createNpcDraft(ruleset: RulePackage, recipe: ScenarioRecipe): SenkeiDraft {
  const next = ruleset.next!;
  const available = new Map(next.heroes.map((hero) => [hero.id, hero]));
  const selected = recipe.roster.map((id) => {
    const hero = available.get(id);
    if (!hero) throw new Error(`Scenario ${recipe.id} requires missing catalog Hero ${id}.`);
    const path = Object.keys(hero.skill_paths).sort()[0];
    if (!path) throw new Error(`Hero ${hero.id} has no prepared skill path.`);
    return { hero, path };
  });
  if (selected.length !== 5 || recipe.destinations.length !== 5 || recipe.squads.reduce((sum, size) => sum + size, 0) !== 5) {
    throw new Error(`Scenario ${recipe.id} must define exactly five Heroes, destinations, and squad members.`);
  }

  const squadForSlot = selected.map((_, slot) => {
    const squad = recipe.squads.findIndex((size, index) => {
      const start = recipe.squads.slice(0, index).reduce((sum, value) => sum + value, 0);
      return slot >= start && slot < start + size;
    });
    return `npc-squad-${squad + 1}`;
  });

  const heroes = selected.map(({ hero, path }, index) => domainRecord({
    slot_id: domainString(`slot-${index + 1}`),
    catalog_id: domainString(hero.id),
    squad: domainString(squadForSlot[index]),
    node: domainString(recipe.startNodes?.[index] ?? next.map.defender_base),
    skill_path: domainString(path),
  }));
  const configuration = {
    heroes: { kind: "list", value: heroes },
  } satisfies Readonly<Record<string, DomainValue>>;
  const source = sourceByScenario.get(recipe.id);
  if (!source) throw new Error(`Scenario ${recipe.id} has no compiled-source fixture.`);

  return {
    schema_version: ruleset.model_version,
    id: `npc-${recipe.id}`,
    revision: "1",
    ruleset: ruleset.ruleset,
    configuration,
    program_input: { kind: "text", source },
    initial_memory: {},
  };
}

function domainString(value: string): DomainValue {
  return { kind: "string", value };
}

function domainRecord(value: Readonly<Record<string, DomainValue>>): DomainValue {
  return { kind: "record", value };
}
