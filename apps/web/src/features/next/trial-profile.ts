import type { DomainValue } from "../../contracts";
import type { BehaviorDomain, NextBehaviorInputs, NextBehaviorProfile } from "../../contracts/next-production";
import type { VerifiedCoverageRun } from "./coverage-observed";

export const trialProfileDomains: readonly BehaviorDomain[] = ["navigation", "engagement", "targeting", "pursuit", "survival", "objective"];
/** The Enbu Next Behavior input validator accepts offsets in this exact range. */
export const trialProfileOffsetLimit = 1_000_000;
export interface TrialProfileSlot { readonly slot_id: string; readonly squad: string; readonly catalog_id: string; }
export interface TrialHeroBinding { readonly slotId: string; readonly catalogId: string; readonly squad: string; readonly actorId: string; }
export interface TrialSquadBinding { readonly label: string; readonly squadId: string; }
export type TrialProfileScope = "army" | "squad" | "hero";
export type TrialProfileFields = Readonly<Record<BehaviorDomain, string>>;

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const own = (value: object, key: string): boolean => Object.prototype.hasOwnProperty.call(value, key);
const stringValue = (value: DomainValue | undefined): string | null => value?.kind === "string" ? value.value : null;
const validOffset = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && Math.abs(value) <= trialProfileOffsetLimit;

function parseProfile(value: unknown): NextBehaviorProfile | null {
  if (!object(value) || Object.keys(value).some(key => !trialProfileDomains.includes(key as BehaviorDomain))) return null;
  const entries: [BehaviorDomain, number | null][] = [];
  for (const domain of trialProfileDomains) {
    const item = own(value, domain) ? value[domain] : null;
    if (item !== null && !validOffset(item)) return null;
    entries.push([domain, item]);
  }
  return Object.fromEntries(entries) as NextBehaviorProfile;
}

function parseProfiles(value: unknown): Record<string, NextBehaviorProfile> | null {
  if (!object(value)) return null;
  const entries: [string, NextBehaviorProfile][] = [];
  for (const [id, candidate] of Object.entries(value)) {
    if (!id) return null;
    const profile = parseProfile(candidate);
    if (!profile) return null;
    entries.push([id, profile]);
  }
  return Object.fromEntries(entries);
}

/** Validate saved trial input and normalize absent Option fields to explicit nulls. */
export function parseTrialPreferences(value: unknown): NextBehaviorInputs | null {
  if (!object(value) || value.schema_version !== 1
    || Object.keys(value).some(key => !["schema_version", "army", "squads", "heroes"].includes(key))) return null;
  const army = parseProfiles(value.army);
  if (!army || Object.keys(army).some(side => side !== "attacker" && side !== "defender")) return null;
  const nested = (candidate: unknown): Record<string, Record<string, NextBehaviorProfile>> | null => {
    if (!object(candidate) || Object.keys(candidate).some(side => side !== "attacker" && side !== "defender")) return null;
    const entries: [string, Record<string, NextBehaviorProfile>][] = [];
    for (const [side, profiles] of Object.entries(candidate)) {
      const parsed = parseProfiles(profiles);
      if (!parsed) return null;
      entries.push([side, parsed]);
    }
    return Object.fromEntries(entries);
  };
  const squads = nested(value.squads), heroes = nested(value.heroes);
  return squads && heroes ? { schema_version: 1, army, squads, heroes } : null;
}

export function emptyTrialPreferences(): NextBehaviorInputs {
  return { schema_version: 1, army: {}, squads: {}, heroes: {} };
}

export function trialProfileAt(inputs: NextBehaviorInputs, scope: TrialProfileScope, id: string): NextBehaviorProfile | undefined {
  if (scope === "army") return own(inputs.army, "attacker") ? inputs.army.attacker : undefined;
  const map = scope === "squad" ? inputs.squads.attacker : inputs.heroes.attacker;
  return map && own(map, id) ? map[id] : undefined;
}

export function trialProfileFields(profile: NextBehaviorProfile | undefined): TrialProfileFields {
  return Object.fromEntries(trialProfileDomains.map(domain => [domain, profile?.[domain] == null ? "" : String(profile[domain])])) as TrialProfileFields;
}

export function parseTrialProfileFields(fields: TrialProfileFields): NextBehaviorProfile | null {
  const values: [BehaviorDomain, number | null][] = [];
  for (const domain of trialProfileDomains) {
    const text = fields[domain].trim();
    if (!text) { values.push([domain, null]); continue; }
    if (!/^-?\d+$/.test(text)) return null;
    const value = Number(text);
    if (!validOffset(value)) return null;
    values.push([domain, value]);
  }
  return Object.fromEntries(values) as NextBehaviorProfile;
}

/** Return a new input; never create or modify an opposing-side preference. */
export function setTrialProfile(inputs: NextBehaviorInputs, scope: TrialProfileScope, id: string, profile: NextBehaviorProfile): NextBehaviorInputs {
  const active = trialProfileDomains.some(domain => profile[domain] !== null);
  if (scope === "army") {
    const army = { ...inputs.army };
    if (active) army.attacker = profile; else delete army.attacker;
    return { ...inputs, army };
  }
  const key = scope === "squad" ? "squads" : "heroes";
  const groups = { ...inputs[key] };
  const attacker = { ...(own(groups, "attacker") ? groups.attacker : {}) };
  if (active) Object.defineProperty(attacker, id, { value: profile, enumerable: true, configurable: true, writable: true });
  else delete attacker[id];
  if (Object.keys(attacker).length) groups.attacker = attacker; else delete groups.attacker;
  return { ...inputs, [key]: groups };
}

/** Bind raw IDs only to unique owner notices and the immutable Run roster. */
export function trialHeroBindings(
  verified: Extract<VerifiedCoverageRun, { status: "available" }>, slots: readonly TrialProfileSlot[],
): readonly TrialHeroBinding[] {
  const roster = verified.run.snapshot.attacker.configuration?.heroes;
  const frames = verified.ownerReplay.frames.filter(frame => frame.tick === 0);
  if (roster?.kind !== "list" || frames.length !== 1 || !frames[0].visible_state) return [];
  const notices = verified.events.filter(event => event.side === "attacker" && event.tick === 0 && event.action_id === null
    && event.record.kind === "runtime_notice" && event.record.value.code === "enbu.next_hero_identity");
  return slots.flatMap(slot => {
    if (slots.filter(candidate => candidate.slot_id === slot.slot_id).length !== 1) return [];
    const records = roster.value.filter(entry => entry.kind === "record" && stringValue(entry.value.slot_id) === slot.slot_id);
    if (records.length !== 1 || records[0].kind !== "record" || stringValue(records[0].value.catalog_id) !== slot.catalog_id
      || stringValue(records[0].value.squad) !== slot.squad) return [];
    const candidates = notices.filter(event => event.record.kind === "runtime_notice" && event.record.value.details.slot_id === slot.slot_id);
    if (candidates.length !== 1 || candidates[0].record.kind !== "runtime_notice" || candidates[0].record.value.details.catalog_id !== slot.catalog_id
      || !candidates[0].entity_id || notices.filter(event => event.entity_id === candidates[0].entity_id).length !== 1) return [];
    const visible = Object.values(frames[0].visible_state!.entities).filter(entity => entity.owner === "attacker" && entity.entity_type === "hero"
      && stringValue(entity.fields.slot_id) === slot.slot_id && stringValue(entity.fields.catalog_id) === slot.catalog_id);
    if (visible.length !== 1) return [];
    return [{ slotId: slot.slot_id, catalogId: slot.catalog_id, squad: slot.squad, actorId: candidates[0].entity_id }];
  });
}

/** Resolve a formation label only through the exact owner frame and whole roster group. */
export function trialSquadBindings(
  verified: Extract<VerifiedCoverageRun, { status: "available" }>, slots: readonly TrialProfileSlot[],
): readonly TrialSquadBinding[] {
  const bindings = trialHeroBindings(verified, slots);
  const frames = verified.ownerReplay.frames.filter(frame => frame.tick === 0);
  if (frames.length !== 1 || !frames[0].visible_state) return [];
  const entities = Object.values(frames[0].visible_state.entities).filter(entity => entity.owner === "attacker" && entity.entity_type === "hero");
  return [...new Set(slots.map(slot => slot.squad))].flatMap(label => {
    const members = slots.filter(slot => slot.squad === label);
    if (!members.length || members.some(slot => !bindings.some(binding => binding.slotId === slot.slot_id))) return [];
    const matched = members.map(slot => entities.filter(entity => stringValue(entity.fields.slot_id) === slot.slot_id
      && stringValue(entity.fields.catalog_id) === slot.catalog_id));
    if (matched.some(matches => matches.length !== 1)) return [];
    const ids = new Set(matched.map(matches => stringValue(matches[0].fields.squad)));
    if (ids.size !== 1) return [];
    const squadId = [...ids][0];
    if (!squadId) return [];
    const live = entities.filter(entity => stringValue(entity.fields.squad) === squadId);
    if (live.length !== members.length || live.some(entity => !members.some(slot => stringValue(entity.fields.slot_id) === slot.slot_id
      && stringValue(entity.fields.catalog_id) === slot.catalog_id))) return [];
    return [{ label, squadId }];
  });
}
