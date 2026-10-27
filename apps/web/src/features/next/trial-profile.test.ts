import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { NextBehaviorInputs } from "../../contracts/next-production";
import type { VerifiedCoverageRun } from "./coverage-observed";
import { TrialProfileEditor } from "./TrialProfileEditor";
import {
  emptyTrialPreferences, parseTrialPreferences, parseTrialProfileFields, setTrialProfile,
  trialHeroBindings, trialProfileAt, trialProfileFields, trialSquadBindings,
} from "./trial-profile";

const slot = { slot_id: "slot-1", catalog_id: "F01", squad: "front" };
const field = (value: string) => ({ kind: "string" as const, value });
const source = () => ({ schema_version: 1, army: { attacker: { navigation: 0 }, defender: { objective: 4 } },
  squads: { attacker: { front: { survival: -2 } }, defender: { back: { engagement: 5 } } },
  heroes: { defender: { "other-hero": { targeting: 8 } } } });

function verifiedOwner(): Extract<VerifiedCoverageRun, { status: "available" }> {
  const fields = { slot_id: field("slot-1"), catalog_id: field("F01"), squad: field("front") };
  return { status: "available", trialPolicyDigest: null,
    run: { snapshot: { attacker: { configuration: { heroes: { kind: "list", value: [{ kind: "record", value: fields }] } } } } },
    ownerReplay: { frames: [{ tick: 0, visible_state: { entities: { "visible-1": { owner: "attacker", entity_type: "hero",
      fields: { ...fields, squad: field("attacker:front") } } } } }] },
    events: [{ tick: 0, sequence: 0, side: "attacker", action_id: null, entity_id: "raw-hero",
      record: { kind: "runtime_notice", value: { code: "enbu.next_hero_identity", details: { slot_id: "slot-1", catalog_id: "F01" } } } }],
  } as unknown as Extract<VerifiedCoverageRun, { status: "available" }>;
}

describe("Trial Behavior Profile inputs", () => {
  it("normalizes absent fields to null without turning explicit zero into inheritance", () => {
    const parsed = parseTrialPreferences(source());
    expect(parsed?.army.attacker).toEqual({ navigation: 0, engagement: null, targeting: null, pursuit: null, survival: null, objective: null });
    expect(parsed?.squads.attacker.front.survival).toBe(-2);
    expect(trialProfileFields(parsed?.army.attacker)).toMatchObject({ navigation: "0", engagement: "" });
    expect(parseTrialProfileFields({ navigation: "0", engagement: "", targeting: "-1000000", pursuit: "1000000", survival: "", objective: "" }))
      .toMatchObject({ navigation: 0, engagement: null, targeting: -1_000_000, pursuit: 1_000_000 });
  });

  it("rejects malformed shapes, unknown fields, non-integers and values outside the core's range", () => {
    for (const invalid of [null, {}, [], { ...source(), schema_version: 2 }, { ...source(), extra: true },
      { ...source(), army: { neutral: {} } }, { ...source(), heroes: { attacker: { "": {} } } },
      { ...source(), army: { attacker: { navigation: 1.5 } } }, { ...source(), army: { attacker: { navigation: 1_000_001 } } },
      { ...source(), army: { attacker: { navigation: NaN } } }, { ...source(), army: { attacker: { unknown: 0 } } }]) {
      expect(parseTrialPreferences(invalid)).toBeNull();
    }
    const empty = trialProfileFields(undefined);
    expect(parseTrialProfileFields({ ...empty, navigation: "1.5" })).toBeNull();
    expect(parseTrialProfileFields({ ...empty, navigation: "1000001" })).toBeNull();
    expect(parseTrialProfileFields({ ...empty, navigation: "-" })).toBeNull();
  });

  it("changes only the selected attacker preferences and removes cleared overrides", () => {
    const parsed = parseTrialPreferences(source())!;
    const original = JSON.stringify(parsed);
    const profile = parseTrialProfileFields({ ...trialProfileFields(undefined), navigation: "0", targeting: "-4" })!;
    const edited = setTrialProfile(parsed, "hero", "raw-hero", profile);
    expect(trialProfileAt(edited, "hero", "raw-hero")).toEqual(profile);
    expect(edited.army.defender).toEqual(parsed.army.defender);
    expect(edited.squads.defender).toEqual(parsed.squads.defender);
    expect(edited.heroes.defender).toEqual(parsed.heroes.defender);
    expect(JSON.stringify(parsed)).toBe(original);
    const cleared = setTrialProfile(edited, "hero", "raw-hero", parseTrialProfileFields(trialProfileFields(undefined))!);
    expect(cleared.heroes.attacker).toBeUndefined();
    expect(cleared.heroes.defender).toEqual(parsed.heroes.defender);
  });

  it("handles unusual input IDs as data without prototype mutation", () => {
    const raw = JSON.parse('{"schema_version":1,"army":{},"squads":{},"heroes":{"attacker":{"__proto__":{"navigation":0}}}}');
    const parsed = parseTrialPreferences(raw)!;
    expect(trialProfileAt(parsed, "hero", "__proto__")?.navigation).toBe(0);
    const next = setTrialProfile(parsed, "hero", "__proto__", parseTrialProfileFields({ ...trialProfileFields(undefined), navigation: "1" })!);
    expect(trialProfileAt(next, "hero", "__proto__")?.navigation).toBe(1);
    expect(({} as Record<string, unknown>).navigation).toBeUndefined();
  });
});

describe("Trial owner Hero bindings", () => {
  it("uses the unique owner notice, frozen roster and owner frame rather than guessing the raw ID", () => {
    const verified = verifiedOwner();
    expect(trialHeroBindings(verified, [slot])).toEqual([{ slotId: "slot-1", catalogId: "F01", squad: "front", actorId: "raw-hero" }]);
    expect(trialHeroBindings(verified, [{ ...slot, catalog_id: "F02" }])).toEqual([]);
    expect(trialHeroBindings(verified, [{ ...slot, squad: "other" }])).toEqual([]);
    expect(trialHeroBindings(verified, [slot, slot])).toEqual([]);
    expect(trialSquadBindings(verified, [slot])).toEqual([{ label: "front", squadId: "attacker:front" }]);
    expect(trialSquadBindings(verified, [{ ...slot, squad: "other" }])).toEqual([]);
  });

  it("fails closed on missing, opposing, duplicate or ambiguous identities", () => {
    const verified = verifiedOwner();
    expect(trialHeroBindings({ ...verified, events: [] }, [slot])).toEqual([]);
    expect(trialHeroBindings({ ...verified, events: [{ ...verified.events[0], side: "defender" }] }, [slot])).toEqual([]);
    expect(trialHeroBindings({ ...verified, events: [...verified.events, { ...verified.events[0], sequence: 1 }] }, [slot])).toEqual([]);
    const frame = verified.ownerReplay.frames[0];
    const entity = frame.visible_state!.entities["visible-1"];
    const replay = { ...verified.ownerReplay, frames: [{ ...frame, visible_state: { ...frame.visible_state!, entities: {
      ...frame.visible_state!.entities, duplicate: entity,
    } } }] };
    expect(trialHeroBindings({ ...verified, ownerReplay: replay }, [slot])).toEqual([]);
    expect(trialSquadBindings({ ...verified, ownerReplay: replay }, [slot])).toEqual([]);
  });
});

describe("Trial Profile editor initial state", () => {
  it("shows an explicit review workflow and never applies while rendering", () => {
    const onApply = vi.fn();
    const html = renderToStaticMarkup(createElement(TrialProfileEditor, { inputs: null, slots: [slot], onApply }));
    expect(html).toContain("Blank inherits; zero is an explicit value");
    expect(html).toContain("Review preferences");
    expect(html).toContain("Cancel changes");
    expect(onApply).not.toHaveBeenCalled();
    expect(emptyTrialPreferences()).toEqual({ schema_version: 1, army: {}, squads: {}, heroes: {} } satisfies NextBehaviorInputs);
  });
});
