import { useEffect, useMemo, useState } from "react";
import type { ReactElement } from "react";
import type { DomainCatalogDocument } from "@senkei/jinrei-editor";
import type { BehaviorDomain, NextBehaviorInputs } from "../../contracts/next-production";
import { canonicalJson } from "../../worker/input-identity";
import { verifyCoverageRun } from "./coverage-observed";
import type { CoverageRun, VerifiedCoverageRun } from "./coverage-observed";
import {
  emptyTrialPreferences, parseTrialPreferences, parseTrialProfileFields, setTrialProfile, trialHeroBindings,
  trialProfileAt, trialProfileDomains, trialProfileFields, trialProfileOffsetLimit, trialSquadBindings,
} from "./trial-profile";
import type { TrialProfileFields, TrialProfileScope, TrialProfileSlot } from "./trial-profile";
import "./trial-profile-editor.css";
export { parseTrialPreferences } from "./trial-profile";

export interface TrialProfileEditorProps {
  readonly inputs: NextBehaviorInputs | null;
  readonly onApply: (next: NextBehaviorInputs) => void;
  readonly slots: readonly TrialProfileSlot[];
  readonly ownerRun?: CoverageRun | null;
  readonly ownerRunCurrent?: boolean;
  readonly catalog?: DomainCatalogDocument | null;
  readonly programDigest?: string;
}

interface PendingEdit { readonly scope: TrialProfileScope; readonly target: string; readonly label: string; readonly fields: TrialProfileFields; }
interface Change { readonly label: string; readonly domain: BehaviorDomain; readonly before: number | null; readonly after: number | null; }
interface Preview { readonly inputKey: string; readonly slotsKey: string; readonly run: CoverageRun | null | undefined;
  readonly catalog: DomainCatalogDocument | null | undefined; readonly programDigest: string | undefined;
  readonly includesOwnerBinding: boolean; readonly next: NextBehaviorInputs; readonly changes: readonly Change[]; }
type Checked = { readonly run: CoverageRun | null | undefined; readonly catalog: DomainCatalogDocument | null | undefined;
  readonly current: boolean; readonly programDigest: string | undefined; readonly result: VerifiedCoverageRun };

function shown(value: number | null): string { return value === null ? "Inherit" : String(value); }

/** Edits stay local until the explicit review and Apply action. */
export function TrialProfileEditor({ inputs, onApply, slots, ownerRun, ownerRunCurrent = false, catalog, programDigest }: TrialProfileEditorProps): ReactElement {
  const parsed = inputs === null ? emptyTrialPreferences() : parseTrialPreferences(inputs);
  const inputKey = parsed ? canonicalJson(parsed) : "invalid";
  const slotsKey = JSON.stringify(slots.map(slot => [slot.slot_id, slot.catalog_id, slot.squad]));
  const [scope, setScope] = useState<TrialProfileScope>("army");
  const [selectedSquad, setSelectedSquad] = useState("");
  const [selectedHero, setSelectedHero] = useState("");
  const [edits, setEdits] = useState<Readonly<Record<string, PendingEdit>>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [checked, setChecked] = useState<Checked | null>(null);
  useEffect(() => { setEdits({}); setPreview(null); setMessage(null); }, [inputKey, slotsKey]);
  useEffect(() => {
    let cancelled = false;
    void verifyCoverageRun(ownerRun, catalog ?? null, ownerRunCurrent, programDigest).then(result => {
      if (!cancelled) setChecked({ run: ownerRun, catalog, current: ownerRunCurrent, programDigest, result });
    });
    return () => { cancelled = true; };
  }, [ownerRun, catalog, ownerRunCurrent, programDigest]);

  const verified = ownerRunCurrent && checked && checked.run === ownerRun && checked.catalog === catalog
    && checked.current === ownerRunCurrent && checked.programDigest === programDigest && checked.result.status === "available"
    ? checked.result : null;
  const bindings = useMemo(() => verified ? trialHeroBindings(verified, slots) : [], [verified, slotsKey]);
  const squadBindings = useMemo(() => verified ? trialSquadBindings(verified, slots) : [], [verified, slotsKey]);
  const squads = [...new Set(slots.map(slot => slot.squad))];
  const squad = squads.includes(selectedSquad) ? selectedSquad : squads[0] ?? "";
  const squadBinding = squadBindings.find(item => item.label === squad) ?? null;
  const hero = slots.find(slot => slot.slot_id === selectedHero) ?? slots[0] ?? null;
  const binding = hero ? bindings.find(item => item.slotId === hero.slot_id) ?? null : null;
  const target = scope === "army" ? "attacker" : scope === "squad" ? squadBinding?.squadId ?? "" : binding?.actorId ?? "";
  const label = scope === "army" ? "Army" : scope === "squad" ? `Squad ${squad}` : hero ? `Hero ${hero.slot_id} · ${hero.catalog_id}` : "Hero";
  const editKey = JSON.stringify([scope, target]);
  const fields = edits[editKey]?.fields ?? trialProfileFields(parsed && target ? trialProfileAt(parsed, scope, target) : undefined);
  const available = parsed !== null && (scope === "army" || (scope === "squad" ? squadBinding !== null : binding !== null));
  const unbound = parsed ? Object.keys(parsed.heroes.attacker ?? {}).filter(actor => !bindings.some(item => item.actorId === actor)).length : 0;
  const unboundSquads = parsed ? Object.keys(parsed.squads.attacker ?? {}).filter(id => !squadBindings.some(item => item.squadId === id)).length : 0;

  const changeField = (domain: BehaviorDomain, value: string): void => {
    if (!available) return;
    setEdits(previous => ({ ...previous, [editKey]: { scope, target, label, fields: { ...fields, [domain]: value } } }));
    setPreview(null); setMessage(null);
  };
  const discard = (): void => { setEdits({}); setPreview(null); setMessage("Changes discarded."); };
  const review = (): void => {
    if (!parsed) { setMessage("Saved trial preferences are invalid; they were preserved."); return; }
    let next = parsed;
    const changes: Change[] = [];
    let includesOwnerBinding = false;
    for (const edit of Object.values(edits)) {
      if (edit.scope === "squad" && (!verified || !squadBindings.some(item => item.squadId === edit.target))) {
        setMessage("The owner Squad identity is no longer verified. Run the current formation with owner diagnostics."); return;
      }
      if (edit.scope === "hero" || edit.scope === "squad") {
        includesOwnerBinding = true;
        if (edit.scope === "hero" && (!verified || !bindings.some(item => item.actorId === edit.target))) {
          setMessage("The owner Hero identity is no longer verified. Run the current formation with owner diagnostics."); return;
        }
      }
      const profile = parseTrialProfileFields(edit.fields);
      if (!profile) { setMessage(`Each value must be a whole number from −${trialProfileOffsetLimit.toLocaleString()} to ${trialProfileOffsetLimit.toLocaleString()}, or blank to inherit.`); return; }
      const before = trialProfileAt(parsed, edit.scope, edit.target);
      for (const domain of trialProfileDomains) {
        const previous = before?.[domain] ?? null, after = profile[domain];
        if (previous !== after) changes.push({ label: edit.label, domain, before: previous, after });
      }
      next = setTrialProfile(next, edit.scope, edit.target, profile);
    }
    if (!changes.length) { setPreview(null); setMessage("No preference values changed."); return; }
    setMessage(null);
    setPreview({ inputKey, slotsKey, run: ownerRun, catalog, programDigest, includesOwnerBinding, next, changes });
  };
  const validPreview = preview !== null && preview.inputKey === inputKey && preview.slotsKey === slotsKey
    && (!preview.includesOwnerBinding || (verified !== null && preview.run === ownerRun && preview.catalog === catalog
      && preview.programDigest === programDigest && preview.changes.filter(change => change.label.startsWith("Hero ")).every(change =>
        bindings.some(item => change.label === `Hero ${item.slotId} · ${item.catalogId}`))
      && preview.changes.filter(change => change.label.startsWith("Squad ")).every(change =>
        squadBindings.some(item => change.label === `Squad ${item.label}`))));
  const apply = (): void => {
    if (!preview || !validPreview) return;
    onApply(preview.next); setEdits({}); setPreview(null); setMessage("Trial preferences applied.");
  };

  return <details className="trial-profile-editor">
    <summary>Trial Behavior Profile · {inputs ? "configured" : "inherit defaults"}</summary>
    <section aria-label="Trial Behavior Profile editor">
      <p>These offsets use the local test-only Behavior policy. Blank inherits; zero is an explicit value. The core accepts whole numbers from −{trialProfileOffsetLimit.toLocaleString()} to {trialProfileOffsetLimit.toLocaleString()}.</p>
      {!parsed && <p role="alert">Saved trial preferences are invalid. They are preserved and cannot be edited here.</p>}
      {unbound > 0 && <p role="status">{unbound} saved Hero preference{unbound === 1 ? " is" : "s are"} not currently bound to a verified owner Hero. They remain unchanged.</p>}
      {unboundSquads > 0 && <p role="status">{unboundSquads} saved Squad preference{unboundSquads === 1 ? " is" : "s are"} not currently bound to a verified owner Squad. They remain unchanged.</p>}
      <label>Profile scope <select value={scope} onChange={event => { setScope(event.currentTarget.value as TrialProfileScope); setPreview(null); setMessage(null); }}>
        <option value="army">Army</option><option value="squad">Squad</option><option value="hero">Hero</option>
      </select></label>
      {scope === "squad" && <><label>Squad <select value={squad} onChange={event => { setSelectedSquad(event.currentTarget.value); setPreview(null); setMessage(null); }}>
        {squads.map(id => <option key={id} value={id}>{id}</option>)}
      </select></label>{!squadBinding && <p role="status">Squad preferences require a current owner-authorized Run with a verified Squad identity. Run the current formation with owner diagnostics.</p>}</>}
      {scope === "hero" && <><label>Hero <select value={hero?.slot_id ?? ""} onChange={event => { setSelectedHero(event.currentTarget.value); setPreview(null); setMessage(null); }}>
        {slots.map(slot => <option key={slot.slot_id} value={slot.slot_id}>{slot.slot_id} · {slot.catalog_id}</option>)}
      </select></label>{!binding && <p role="status">Hero preferences require a current owner-authorized Run with a unique Hero identity. Run the current formation with owner diagnostics.</p>}</>}
      <fieldset disabled={!available}><legend>{label} preferences</legend>
        {trialProfileDomains.map(domain => <label key={domain}>{domain} <input aria-label={`${label} ${domain}`} type="text" placeholder="Inherit" value={fields[domain]} onChange={event => changeField(domain, event.currentTarget.value)} /></label>)}
      </fieldset>
      {message && <p role="status">{message}</p>}
      <button type="button" disabled={!parsed || !Object.keys(edits).length} onClick={review}>Review preferences</button>
      <button type="button" disabled={!Object.keys(edits).length && !preview} onClick={discard}>Cancel changes</button>
      {preview && <section aria-label="Review trial preferences"><strong>Review changes before applying</strong>
        <ul>{preview.changes.map(change => <li key={`${change.label}:${change.domain}`}>{change.label} · {change.domain}: {shown(change.before)} → {shown(change.after)}</li>)}</ul>
        <button type="button" disabled={!validPreview} onClick={apply}>Apply trial preferences</button>
        <button type="button" onClick={discard}>Cancel review</button>
      </section>}
    </section>
  </details>;
}
