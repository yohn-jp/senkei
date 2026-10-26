import type { DomainValue, HeroDefinition, PresentationReplay, RulesetRef } from "../../contracts";

export interface SkillRunSlot {
  readonly slot_id: string;
  readonly catalog_id: string;
  readonly skill_path: string;
  readonly squad: string;
  readonly node: string;
}
export interface SkillRunProgressInput {
  readonly experimentId: string;
  readonly matchId: string;
  readonly ruleset: RulesetRef;
  readonly authorizedSide?: string;
  readonly ownerReplay: PresentationReplay | null;
  readonly submittedHeroes: DomainValue | undefined;
  readonly tick: number;
  readonly slot: SkillRunSlot;
  readonly hero: Pick<HeroDefinition, "id" | "skill_paths" | "skills">;
}
export interface SkillRunNodeProgress {
  readonly id: string;
  readonly name: string;
  readonly planned: boolean;
  readonly acquisition: "acquired" | "not_acquired" | "unknown";
  readonly missingPrerequisiteIds: readonly string[] | null;
}
export interface SkillRunProgress {
  readonly status: "known" | "unavailable";
  readonly reason: string | null;
  readonly experimentId: string;
  readonly matchId: string;
  readonly tick: number;
  readonly slotId: string;
  readonly catalogId: string;
  readonly level: number | null;
  readonly skills: readonly SkillRunNodeProgress[];
}
const stringValue = (value: DomainValue | undefined): string | null => value?.kind === "string" ? value.value : null;
function sameRuleset(left: RulesetRef | undefined, right: RulesetRef): boolean {
  return Boolean(left && left.id === right.id && left.digest === right.digest && left.version.major === right.version.major && left.version.minor === right.version.minor && left.version.patch === right.version.patch);
}

/** Consume an already validated immutable Run. Never derive acquisition from levels or events. */
export function deriveSkillRunProgress(input: SkillRunProgressInput): SkillRunProgress {
  const { slot, hero, ownerReplay: replay } = input;
  const planned = new Set(hero.skill_paths[slot.skill_path] ?? []);
  const base = { experimentId: input.experimentId, matchId: input.matchId, tick: input.tick, slotId: slot.slot_id, catalogId: slot.catalog_id };
  const unavailable = (reason: string): SkillRunProgress => ({ ...base, status: "unavailable", reason, level: null,
    skills: hero.skills.map(skill => ({ id: skill.id, name: skill.name, planned: planned.has(skill.id), acquisition: "unknown", missingPrerequisiteIds: null })) });
  if (input.authorizedSide !== "attacker" || replay?.perspective !== "attacker") return unavailable("An authorized attacker owner replay is unavailable; public observations do not identify private slots.");
  if (replay.match_id !== input.matchId || !sameRuleset(replay.ruleset, input.ruleset)) return unavailable("The owner replay does not match this Run identity and ruleset.");
  if (hero.id !== slot.catalog_id || !hero.skill_paths[slot.skill_path]) return unavailable("This Draft Hero or plan does not match its Catalog.");
  const submitted = input.submittedHeroes?.kind === "list" ? input.submittedHeroes.value.filter(value => value.kind === "record" && stringValue(value.value.slot_id) === slot.slot_id) : [];
  const submittedSlot = submitted.length === 1 && submitted[0]?.kind === "record" ? submitted[0].value : null;
  if (!submittedSlot || Object.entries(slot).some(([key, value]) => stringValue(submittedSlot[key]) !== value)) return unavailable("This Draft slot differs from the submitted Run slot; its plan remains separate from Run acquisitions.");
  const frames = replay.frames.filter(frame => frame.tick === input.tick);
  if (frames.length !== 1 || !frames[0]?.visible_state) return unavailable("No exact owner observation exists at this Tick; no future or previous frame was substituted.");
  const entities = Object.values(frames[0].visible_state.entities).filter(entity => entity.entity_type === "hero" && entity.owner === "attacker" && stringValue(entity.fields.slot_id) === slot.slot_id);
  if (entities.length !== 1) return unavailable("The submitted Hero slot is not uniquely observed at this Tick.");
  const fields = entities[0]!.fields;
  if (stringValue(fields.catalog_id) !== slot.catalog_id || stringValue(fields.skill_path) !== slot.skill_path) return unavailable("The observed Hero or branch differs from the submitted slot.");
  const skills = fields.skills, level = fields.level;
  if (skills?.kind !== "list" || !skills.value.every(value => value.kind === "string") || level?.kind !== "integer" || !Number.isSafeInteger(level.value) || level.value < 1) return unavailable("The owner observation does not contain valid acquired skills and level.");
  const acquired = new Set(skills.value.map(value => stringValue(value)!));
  return { ...base, status: "known", reason: null, level: level.value, skills: hero.skills.map(skill => ({
    id: skill.id, name: skill.name, planned: planned.has(skill.id), acquisition: acquired.has(skill.id) ? "acquired" : "not_acquired",
    missingPrerequisiteIds: skill.prerequisites.filter(id => !acquired.has(id)),
  })) };
}
