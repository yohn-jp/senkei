import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { HeroDefinition, NextRules, SkillDefinition } from "../../contracts";
import { HeroModelPreview } from "./HeroModelPreview";
import "./hero-atelier.css";

export interface HeroAtelierSlot {
  readonly slot_id: string;
  readonly catalog_id: string;
  readonly squad: string;
  readonly node: string;
  readonly skill_path: string;
}
export type HeroAtelierScreen = "collection" | "detail" | "skills" | "squads";
export interface HeroAtelierProps {
  readonly nextRules: NextRules;
  readonly slots: readonly HeroAtelierSlot[];
  readonly activeSlot: number;
  readonly screen: HeroAtelierScreen;
  readonly onActiveSlotChange: (index: number) => void;
  readonly onScreenChange: (screen: HeroAtelierScreen) => void;
  readonly onSlotChange: (index: number, changes: Partial<HeroAtelierSlot>) => void;
  readonly onSquadPattern: (sizes: readonly number[]) => void;
  readonly onMoveSquad: (squad: string, node: string) => void;
  readonly onReady: () => void;
  readonly onJinrei: () => void;
  readonly canActivate: boolean;
  readonly activateArgumentIds: readonly string[];
}

const SCREENS: readonly { id: HeroAtelierScreen; label: string; hint: string; title: string; description: string }[] = [
  { id: "collection", label: "Hero Collection", hint: "01 / CHOOSE FIVE", title: "Choose your heroes", description: "Select five identities from the current Senritsu Catalog. Selection changes update this same battle draft." },
  { id: "detail", label: "Hero Detail", hint: "02 / CATALOG DATA", title: "Hero detail", description: "Inspect this Hero's shared appearance, authored statistics, growth, and capabilities." },
  { id: "skills", label: "Skill Tree", hint: "03 / PLAN LEVEL UPS", title: "Plan a skill tree", description: "Choose a legal branch and review when each skill can be acquired during a battle." },
  { id: "squads", label: "Squad Assembly", hint: "04 / FORM SQUADS", title: "Assemble your squads", description: "Partition the five slots, set one Squad per Hero, and resolve a shared initial node." },
];
export const HERO_SQUAD_PATTERNS: readonly { id: string; sizes: readonly number[] }[] = [
  { id: "1+1+1+1+1", sizes: [1, 1, 1, 1, 1] },
  { id: "2+1+1+1", sizes: [2, 1, 1, 1] },
  { id: "2+2+1", sizes: [2, 2, 1] },
  { id: "3+1+1", sizes: [3, 1, 1] },
  { id: "3+2", sizes: [3, 2] },
  { id: "4+1", sizes: [4, 1] },
  { id: "5", sizes: [5] },
];
const STAT_KEYS = ["hp", "attack", "defense", "speed", "range", "attack_interval", "vision"] as const;
const SQUAD_NAMES = ["Solo", "Duo", "Trio", "Quartet", "Quintet"] as const;
function formatId(value: string): string { return value.replaceAll("_", " ").replaceAll("-", " ").replaceAll(".", " · ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function findHero(rules: NextRules, id: string): HeroDefinition | undefined { return rules.heroes.find((hero) => hero.id === id); }
export function skillPathIssues(hero: HeroDefinition, path: string): readonly string[] {
  const ids = hero.skill_paths[path] ?? [];
  if (ids.length === 0) return ["This branch has no selectable skills."];
  return ids.flatMap((id, index) => {
    const skill = hero.skills.find((item) => item.id === id);
    if (!skill) return ["The selected path references missing skill " + id + "."];
    return skill.prerequisites.flatMap((prerequisiteId) => {
      const prerequisite = hero.skills.find((item) => item.id === prerequisiteId);
      const prerequisiteIndex = ids.indexOf(prerequisiteId);
      if (!prerequisite) return [skill.name + " requires unknown skill " + prerequisiteId + "."];
      if (prerequisiteIndex < 0) return [skill.name + " requires " + prerequisite.name + ", which is not in this path."];
      if (prerequisiteIndex >= index) return [prerequisite.name + " must appear before " + skill.name + "."];
      if (prerequisite.unlock_level > skill.unlock_level) return [prerequisite.name + " unlocks after " + skill.name + " and cannot satisfy its prerequisite."];
      return [];
    });
  });
}
function pathSkills(hero: HeroDefinition, path: string): readonly SkillDefinition[] {
  return (hero.skill_paths[path] ?? []).map((id) => hero.skills.find((skill) => skill.id === id))
    .filter((skill): skill is SkillDefinition => skill !== undefined);
}
function selectedSkills(hero: HeroDefinition, path: string): string { return pathSkills(hero, path).map((skill) => skill.name).join(" → "); }
function sortedSquadIds(slots: readonly HeroAtelierSlot[]): string[] {
  return [...new Set(slots.map((slot) => slot.squad))].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}
function splitLabel(slots: readonly HeroAtelierSlot[]): string {
  const counts = new Map<string, number>();
  for (const slot of slots) counts.set(slot.squad, (counts.get(slot.squad) ?? 0) + 1);
  return [...counts.values()].sort((left, right) => right - left).join("+");
}

export function HeroAtelier({
  nextRules, slots, activeSlot, screen, onActiveSlotChange, onScreenChange, onSlotChange,
  onSquadPattern, onMoveSquad, onReady, onJinrei, canActivate, activateArgumentIds,
}: HeroAtelierProps): ReactElement {
  const [filters, setFilters] = useState({ placement: "all", role: "all", trait: "all" });
  const [minHp, setMinHp] = useState(0);
  const [impact, setImpact] = useState<string[]>([]);
  const [mobileSquadStage, setMobileSquadStage] = useState<"split" | "assign" | "deploy">("split");
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const screenRef = useRef<HTMLElement>(null);
  const keepTabFocus = useRef(false);
  const currentSlot = slots[activeSlot] ?? null;
  const currentHero = currentSlot ? findHero(nextRules, currentSlot.catalog_id) : undefined;
  const pathNames = currentHero ? Object.keys(currentHero.skill_paths) : [];
  const squads = useMemo(() => sortedSquadIds(slots), [slots]);
  const currentSplit = splitLabel(slots);
  const nodes = Object.keys(nextRules.map.nodes).sort();
  const heroes = nextRules.heroes;
  const visibleHeroes = heroes.filter((hero) => (filters.placement === "all" || hero.placement === filters.placement)
    && (filters.role === "all" || hero.role === filters.role)
    && (filters.trait === "all" || hero.trait_id === filters.trait)
    && hero.stats.hp >= minHp);
  const chosenScreen = SCREENS.find((item) => item.id === screen) ?? SCREENS[0]!;
  const chooseSlot = (index: number): void => {
    if (index !== activeSlot) setSelectedSkillId(null);
    onActiveSlotChange(index);
  };
  useEffect(() => {
    if (!keepTabFocus.current) screenRef.current?.querySelector<HTMLElement>(".ha-header h3")?.focus({ preventScroll: true });
    keepTabFocus.current = false;
    screenRef.current?.scrollIntoView({ block: "start" });
  }, [screen]);
  const changeHero = (hero: HeroDefinition): void => {
    if (!currentSlot || hero.id === currentSlot.catalog_id) return;
    const oldHero = findHero(nextRules, currentSlot.catalog_id);
    const oldPath = currentSlot.skill_path;
    const nextPath = hero.skill_paths[oldPath] ? oldPath : Object.keys(hero.skill_paths)[0] ?? "";
    const details = ["Slot " + (activeSlot + 1) + ": " + (oldHero?.name ?? "Unknown Hero") + " → " + hero.name + "."];
    if (oldPath !== nextPath) details.push("Skill plan changed from " + formatId(oldPath) + " to " + formatId(nextPath) + " because the new Hero has a different branch catalog.");
    else details.push("The " + formatId(nextPath) + " skill plan was retained.");
    details.push("Squad " + formatId(currentSlot.squad) + " and starting node " + formatId(currentSlot.node) + " stay assigned to this slot.");
    details.push("Jinrei compile must be checked again for the updated Hero lineup.");
    setImpact(details);
    setSelectedSkillId(null);
    onSlotChange(activeSlot, { catalog_id: hero.id, skill_path: nextPath });
  };
  const slotPicker = (label: string, includePath = false): ReactElement => (
    <div className="ha-roster" role="group" aria-label={label}>
      {slots.map((slot, index) => {
        const hero = findHero(nextRules, slot.catalog_id);
        return <button aria-current={activeSlot === index ? "true" : undefined}
          aria-label={"Slot " + (index + 1) + ": " + (hero?.name ?? "Choose a hero") + ", " + (hero?.id ?? slot.slot_id) + (includePath ? "; " + formatId(slot.skill_path) : "")}
          className={activeSlot === index ? "is-active" : ""} key={slot.slot_id}
          onClick={() => chooseSlot(index)} type="button">
          <span>{String(index + 1).padStart(2, "0")}</span><strong>{hero?.name ?? "Choose a hero"}</strong>
          <small>{hero?.id ?? "EMPTY"}{includePath ? " · " + formatId(slot.skill_path) : ""}</small>
        </button>;
      })}
    </div>
  );
  const skillDetail = (skill: SkillDefinition, planned: boolean): ReactElement => {
    const prerequisites = skill.prerequisites.map((id) => currentHero?.skills.find((item) => item.id === id)).filter((item): item is SkillDefinition => Boolean(item));
    return <article className="ha-skill-detail" key={skill.id}>
      <div><strong>{skill.name}</strong><small>{skill.id} · {skill.passive ? "Passive" : "Active"} · unlock level {skill.unlock_level}{planned ? " · planned" : " · other branch"}</small></div>
      <span>{formatId(skill.effect)}</span>
      <p>{skill.passive ? "Automatically acquired when this Hero reaches the unlock level." : formatId(skill.target) + " target · power " + skill.power + " · range " + skill.range + " · energy " + skill.cost + " · cooldown " + skill.cooldown + " ticks" + (skill.duration > 0 ? " · duration " + skill.duration + " ticks" : "")}</p>
      {prerequisites.length > 0 && <small>Requires {prerequisites.map((item) => item.name + " (level " + item.unlock_level + ")").join(", ")}. This skill stays locked until its prerequisite is acquired in battle.</small>}
      {!skill.passive && <small>{canActivate ? "Jinrei activate capability is available" + (activateArgumentIds.length ? " (" + activateArgumentIds.map(formatId).join(", ") + ")" : "") + "." : "This ruleset does not declare the Jinrei activate capability; active use is unavailable."}</small>}
    </article>;
  };

  return <section ref={screenRef} className="hero-atelier" aria-label="Hero Atelier">
    <header className="ha-header">
      <div><span className="next-eyebrow">HERO ATELIER · {chosenScreen.hint}</span><h3 tabIndex={-1}>{chosenScreen.title}</h3><p>{chosenScreen.description}</p></div>
      <span className="ha-count" aria-label={slots.length + " of 5 heroes selected"}>{String(slots.length).padStart(2, "0")} <small>/ 05</small></span>
    </header>
    <nav className="ha-nav" aria-label="Hero Atelier" role="tablist">
      {SCREENS.map((item, index) => <button aria-controls={"hero-atelier-panel-" + item.id} aria-selected={screen === item.id} className={screen === item.id ? "is-active" : ""}
        id={"next-atelier-" + item.id} key={item.id} onClick={() => onScreenChange(item.id)} onKeyDown={(event) => {
          const nextIndex = event.key === "ArrowRight" ? (index + 1) % SCREENS.length
            : event.key === "ArrowLeft" ? (index + SCREENS.length - 1) % SCREENS.length
              : event.key === "Home" ? 0 : event.key === "End" ? SCREENS.length - 1 : -1;
          if (nextIndex < 0) return;
          event.preventDefault();
          const target = SCREENS[nextIndex]!;
          keepTabFocus.current = true;
          onScreenChange(target.id);
          document.getElementById("next-atelier-" + target.id)?.focus();
        }} role="tab" tabIndex={screen === item.id ? 0 : -1} type="button">
        {item.label}<small>{item.hint}</small>
      </button>)}
    </nav>
    {screen === "collection" && <div className="ha-collection" id="hero-atelier-panel-collection" aria-labelledby="next-atelier-collection" role="tabpanel">
      <section className="ha-selection" aria-label="Five selected Hero slots" role="group">
        <div className="ha-section-heading"><div><span className="next-eyebrow">CURRENT BATTLE DRAFT</span><h4>Five Hero slots</h4></div><span>{slots.length} / 5 selected</span></div>
        <div className="ha-selected-slots">{slots.map((slot, index) => {
          const hero = findHero(nextRules, slot.catalog_id);
          return <button aria-label={"Choose hero for slot " + (index + 1)} aria-pressed={activeSlot === index}
            className={activeSlot === index ? "is-active" : ""} key={slot.slot_id} onClick={() => chooseSlot(index)} type="button">
            <span>{String(index + 1).padStart(2, "0")}</span><strong>{hero?.name ?? "Choose a hero"}</strong><small>{hero?.id ?? slot.slot_id} · {hero ? formatId(hero.placement) : "EMPTY"}</small>
          </button>;
        })}</div>
      </section>
      <section className="ha-catalog" aria-label="Filtered hero catalog">
        <div className="ha-section-heading"><div><span className="next-eyebrow">CATALOG · {visibleHeroes.length} AVAILABLE</span><h4>Choose a Hero for slot {String(activeSlot + 1).padStart(2, "0")}</h4></div><small>{heroes.length} bundled identities · filter by placement, role and trait</small></div>
        <div className="ha-filter-row" aria-label="Filter the Hero Catalog">
          <label><span>Placement</span><select aria-label="Filter heroes by placement" value={filters.placement} onChange={(event) => setFilters((previous) => ({ ...previous, placement: event.currentTarget.value }))}><option value="all">All</option>{[...new Set(heroes.map((hero) => hero.placement))].sort().map((value) => <option key={value} value={value}>{formatId(value)}</option>)}</select></label>
          <label><span>Role</span><select aria-label="Filter heroes by role" value={filters.role} onChange={(event) => setFilters((previous) => ({ ...previous, role: event.currentTarget.value }))}><option value="all">All</option>{[...new Set(heroes.map((hero) => hero.role))].sort().map((value) => <option key={value} value={value}>{formatId(value)}</option>)}</select></label>
          <label><span>Trait</span><select aria-label="Filter heroes by trait" value={filters.trait} onChange={(event) => setFilters((previous) => ({ ...previous, trait: event.currentTarget.value }))}><option value="all">All</option>{[...new Set(heroes.map((hero) => hero.trait_id))].sort().map((value) => <option key={value} value={value}>{formatId(value)}</option>)}</select></label>
          <label className="ha-hp-filter"><span>Minimum HP · {minHp}</span><input aria-label="Minimum hero HP" type="range" min="0" max={Math.max(...heroes.map((hero) => hero.stats.hp), 0)} step="10" value={minHp} onChange={(event) => setMinHp(Number(event.currentTarget.value))} /></label>
          {(filters.placement !== "all" || filters.role !== "all" || filters.trait !== "all" || minHp !== 0) && <button className="ha-clear-filter" type="button" onClick={() => { setFilters({ placement: "all", role: "all", trait: "all" }); setMinHp(0); }}>Clear filters</button>}
        </div>
        <div className="ha-catalog-grid">
          {visibleHeroes.map((hero) => {
            const active = currentSlot?.catalog_id === hero.id;
            const assignedSlots = slots.flatMap((slot, index) => slot.catalog_id === hero.id ? [index + 1] : []);
            return <button aria-pressed={active} className={"ha-hero-card next-catalog-card" + (active ? " is-selected" : "")} key={hero.id}
              onClick={() => changeHero(hero)} type="button">
              <span className="ha-hero-card-mark" aria-hidden="true">{hero.placement === "backline" ? "⌁" : "◆"}</span>
              <span className="ha-hero-id">{hero.id}</span><strong>{hero.name}</strong>
              <small>{formatId(hero.placement)} · {formatId(hero.role)} · {formatId(hero.trait_id)}</small>
              <span className="ha-card-stats"><span>HP <b>{hero.stats.hp}</b></span><span>ATK <b>{hero.stats.attack}</b></span><span>DEF <b>{hero.stats.defense}</b></span></span>
              {assignedSlots.length > 0 && <span className="ha-assigned">{active ? "ACTIVE SLOT" : "IN SLOT" + (assignedSlots.length > 1 ? "S " : " ") + assignedSlots.join(", ")}</span>}
            </button>;
          })}
          {visibleHeroes.length === 0 && <div className="ha-empty">No Catalog Heroes match these filters. Clear a filter to continue.</div>}
        </div>
      </section>
      {impact.length > 0 && <aside className="ha-impact" aria-live="polite" aria-label="Hero change impact"><strong>Change impact</strong><ul>{impact.map((item) => <li key={item}>{item}</li>)}</ul></aside>}
      <footer className="ha-footer"><span>Hero choice, skill path and squad values are shared with the current Ready check and battle draft.</span><div><button className="next-secondary-button" onClick={() => onScreenChange("detail")} type="button">Inspect selected Hero <b>→</b></button><button className="next-secondary-button" onClick={() => onReady()} type="button">Ready <b>↗</b></button></div></footer>
    </div>}
    {screen === "detail" && <div className="ha-detail" id="hero-atelier-panel-detail" aria-labelledby="next-atelier-detail" role="tabpanel">
      {slotPicker("Choose a Hero for detail")}
      {currentHero && currentSlot ? <article className="ha-dossier">
        <header className={"ha-dossier-heading " + currentHero.placement}><div><span className="next-eyebrow">{currentHero.appearance_key} · SLOT {String(activeSlot + 1).padStart(2, "0")}</span><h4>{currentHero.name}</h4><p>{currentHero.id} · {formatId(currentHero.placement)} · {formatId(currentHero.role)} · {formatId(currentHero.trait_id)}</p><small>Shared 3D identity used by the battlefield renderer.</small></div><span aria-hidden="true">{currentHero.placement === "backline" ? "⌁" : "◆"}</span></header>
        <HeroModelPreview catalogId={currentHero.id} appearanceKey={currentHero.appearance_key} name={currentHero.name} />
        <section className="ha-data-card"><div className="ha-section-heading"><div><span className="next-eyebrow">REAL SENRITSU VALUES</span><h4>Base stats and growth</h4></div></div>
          <div className="ha-stat-table" role="table" aria-label="Hero base stats and growth"><div role="row"><strong role="columnheader">Stat</strong><strong role="columnheader">Base</strong><strong role="columnheader">Per level</strong></div>{STAT_KEYS.map((stat) => <div role="row" key={stat}><span role="rowheader">{formatId(stat)}</span><span>{currentHero.stats[stat]}</span><span>+{currentHero.growth[stat]}</span></div>)}</div>
        </section>
        <section className="ha-data-card"><div className="ha-section-heading"><div><span className="next-eyebrow">CAPABILITY AND BRANCH CATALOG</span><h4>{currentHero.skills.length} authored skills</h4></div><span>Planned · {formatId(currentSlot.skill_path)}</span></div>
          <div className="ha-skill-catalog">{currentHero.skills.map((skill) => skillDetail(skill, currentHero.skill_paths[currentSlot.skill_path]?.includes(skill.id) ?? false))}</div>
        </section>
        <aside className="ha-capability"><strong>Jinrei active-skill command</strong><p>{canActivate ? <>The current ruleset declares <code>activate</code>{activateArgumentIds.length ? " with " + activateArgumentIds.map(formatId).join(", ") + " arguments" : ""}. Only the actual compiled Jinrei draft determines whether a skill is ordered.</> : <>This ruleset does not declare <code>activate</code>. Active skills cannot be ordered from Jinrei in this package.</>}</p><button onClick={onJinrei} type="button">Review Jinrei orders <b>→</b></button></aside>
        <footer className="ha-footer"><span>Catalog values only. No unprovided attributes or abilities are inferred.</span><div><button className="next-secondary-button" onClick={() => onScreenChange("collection")} type="button">Back to Collection</button><button className="next-secondary-button" onClick={() => onScreenChange("skills")} type="button">Plan this Hero's skills <b>→</b></button><button className="next-secondary-button" onClick={() => onReady()} type="button">Ready <b>↗</b></button></div></footer>
      </article> : <div className="ha-empty">Select a populated Hero slot to inspect its Senritsu data.</div>}
    </div>}
    {screen === "skills" && <div className="ha-skills" id="hero-atelier-panel-skills" aria-labelledby="next-atelier-skills" role="tabpanel">
      {slotPicker("Choose a Hero skill tree", true)}
      {currentHero && currentSlot ? <div className="ha-tree">
        <header className="ha-tree-heading"><div><span className="next-eyebrow">{currentHero.id} · {currentHero.name} · {currentHero.skills.length} CATALOG NODES</span><h4>Choose one branch for the match</h4><p>These are acquisition plans. Enbu awards skills only when the Hero reaches each unlock level in battle.</p></div><span className="ha-planned-path">CURRENT · {formatId(currentSlot.skill_path)}</span></header>
        <aside className="ha-capability"><strong>Active skill command</strong><p>{canActivate ? <>Active skills can be ordered through the Jinrei <code>activate</code> capability{activateArgumentIds.length ? " (" + activateArgumentIds.map(formatId).join(", ") + ")" : ""}. Prerequisites still need to be acquired in battle.</> : <>No <code>activate</code> capability is declared by this ruleset. Branches containing active skills cannot be selected.</>}</p></aside>
        <div className="ha-branches">{pathNames.map((path) => {
          const selected = currentSlot.skill_path === path;
          const skills = pathSkills(currentHero, path);
          const issues = skillPathIssues(currentHero, path);
          const hasActiveSkill = skills.some((skill) => !skill.passive);
          const canChoose = issues.length === 0 && (!hasActiveSkill || canActivate);
          return <article className={"ha-branch" + (selected ? " is-selected" : "") + (canChoose ? "" : " is-unavailable")} key={path}>
            <header><div><span className="next-eyebrow">{formatId(path)} · {skills.length} PLANNED NODES</span><h5>{skills[0]?.name ?? formatId(path)} <span>→</span> {skills[skills.length - 1]?.name ?? ""}</h5></div><button aria-pressed={selected} aria-label={"Choose " + formatId(path) + " for " + currentSlot.slot_id} className="next-secondary-button" disabled={!canChoose || selected} onClick={() => { onSlotChange(activeSlot, { skill_path: path }); setSelectedSkillId(null); }} type="button">{selected ? "Selected" : "Choose path"}</button></header>
            {issues.length > 0 && <p className="ha-branch-error" role="alert">Unavailable: {issues.join(" ")}</p>}
            {!canActivate && hasActiveSkill && <p className="ha-branch-error" role="alert">Unavailable: this ruleset has no activate capability for active skills.</p>}
            <ol className="ha-skill-nodes">{skills.map((skill, index) => {
              const planned = selected;
              const prerequisites = skill.prerequisites.map((id) => currentHero.skills.find((item) => item.id === id)).filter((item): item is SkillDefinition => Boolean(item));
              return <li className={planned ? "is-planned" : ""} key={skill.id}>
                <span className="ha-level">LV {skill.unlock_level}</span>
                <button aria-expanded={selectedSkillId === skill.id} className="ha-skill-node" onClick={() => setSelectedSkillId(selectedSkillId === skill.id ? null : skill.id)} type="button">
                  <span className="ha-node-mark" aria-hidden="true">{skill.passive ? "◇" : "✦"}</span><span><strong>{skill.name}</strong><small>{skill.passive ? "Passive · acquired at unlock level" : "Active · " + formatId(skill.effect) + " · " + formatId(skill.target) + " target" + (canActivate ? " · Jinrei command available" : " · no activate command")}</small></span><span className="ha-node-state">{planned ? "PLANNED · LV " + skill.unlock_level : "NOT SELECTED"}</span>
                </button>
                {prerequisites.length > 0 && <small className="ha-prerequisite">Requires {prerequisites.map((item) => item.name + " (LV " + item.unlock_level + ")").join(", ")} · locked until acquired</small>}
                {selectedSkillId === skill.id && <div className="ha-node-detail" role="region" aria-label={skill.name + " skill details"}>{skillDetail(skill, planned)}</div>}
                {index < skills.length - 1 && <span className="ha-connector" aria-hidden="true" />}
              </li>;
            })}</ol>
          </article>;
        })}</div>
        <p className="ha-plan-note">Planned skills are not acquired skills. The battle's Hero progression and actual level unlock each selected skill.</p>
        <footer className="ha-footer"><span>Selected path: {selectedSkills(currentHero, currentSlot.skill_path)}</span><div><button className="next-secondary-button" onClick={() => onScreenChange("collection")} type="button">Collection</button><button className="next-secondary-button" onClick={() => onScreenChange("squads")} type="button">Arrange Squads <b>→</b></button><button className="next-secondary-button" onClick={() => onReady()} type="button">Ready <b>↗</b></button></div></footer>
      </div> : <div className="ha-empty">Select a populated Hero slot to plan its skill tree.</div>}
    </div>}
    {screen === "squads" && <div className={"ha-squads ha-squad-stage-" + mobileSquadStage} id="hero-atelier-panel-squads" aria-labelledby="next-atelier-squads" role="tabpanel">
      <header className="ha-squad-heading"><div><span className="next-eyebrow">SENRITSU · FIVE HEROES · SEVEN PARTITIONS</span><h4>Set the initial chain of command</h4><p>Choose a legal partition, assign each Hero to one Squad, then set a shared starting node for each group.</p></div><span className="ha-count">{currentSplit || "—"}</span></header>
      <nav className="ha-mobile-stages" aria-label="Squad assembly steps">{([["split", "1 · Split"], ["assign", "2 · Assign"], ["deploy", "3 · Start nodes"]] as const).map(([stage, label]) => <button aria-current={mobileSquadStage === stage ? "step" : undefined} className={mobileSquadStage === stage ? "is-active" : ""} key={stage} onClick={() => setMobileSquadStage(stage)} type="button">{label}</button>)}</nav>
      <section className="ha-squad-step ha-squad-step-split" aria-label="Legal five Hero Squad partitions">
        <div className="ha-section-heading"><div><span className="next-eyebrow">STEP 1 · PARTITION</span><h4>Choose the Squad sizes</h4></div></div>
        <div className="ha-patterns">{HERO_SQUAD_PATTERNS.map((pattern) => <button aria-label={"Use squad split " + pattern.id} aria-pressed={currentSplit === pattern.id} className={currentSplit === pattern.id ? "is-active" : ""} key={pattern.id} onClick={() => { onSquadPattern(pattern.sizes); setMobileSquadStage("assign"); }} type="button"><strong>{pattern.id}</strong><small>{pattern.sizes.length} Squads</small></button>)}</div>
      </section>
      <section className="ha-squad-step ha-squad-step-assign" aria-label="Assign Heroes to Squads">
        <div className="ha-section-heading"><div><span className="next-eyebrow">STEP 2 · MEMBERSHIP</span><h4>Assign each Hero once</h4></div><span>{slots.length} unique slots</span></div>
        <div className="ha-membership-grid">{slots.map((slot, index) => {
          const hero = findHero(nextRules, slot.catalog_id);
          const options = [...new Set([...squads, ...Array.from({ length: 5 }, (_, squadIndex) => "squad-" + (squadIndex + 1))])].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
          return <article className="ha-member" key={slot.slot_id}><span className={"ha-member-sigil" + (hero?.placement === "backline" ? " backline" : "")}>{hero?.placement === "backline" ? "⌁" : "◆"}</span><div><strong>{hero?.name ?? "Unknown Hero"}</strong><small>{hero?.id ?? slot.catalog_id} · {formatId(hero?.placement ?? "unknown")} · slot {index + 1}</small></div><label><span>Squad</span><select aria-label={"Squad for " + (hero?.name ?? slot.slot_id)} value={slot.squad} onChange={(event) => onSlotChange(index, { squad: event.currentTarget.value })}>{options.map((squad) => <option key={squad} value={squad}>{formatId(squad)}</option>)}</select></label></article>;
        })}</div>
      </section>
      <section className="ha-squad-step ha-squad-step-deploy" aria-label="Squad formation preview">
        <div className="ha-section-heading"><div><span className="next-eyebrow">STEP 3 · INITIAL DEPLOYMENT</span><h4>Set each Squad's starting node</h4></div><small>Initial deployment only; in battle, movement follows Jinrei orders.</small></div>
        <div className="ha-group-grid">{squads.map((squad) => {
          const members = slots.map((slot, index) => ({ slot, index })).filter(({ slot }) => slot.squad === squad);
          const starts = [...new Set(members.map(({ slot }) => slot.node))];
          const movement = nextRules.parameters["squad_" + members.length + "_speed_milli"];
          const label = members.length ? SQUAD_NAMES[members.length - 1] : "Empty";
          return <article className="ha-group" key={squad}><header><div><span className="next-eyebrow">{formatId(squad)} · {members.length} {members.length === 1 ? "HERO" : "HEROES"}</span><h5>{label} <small>· {members.length}-member Squad</small></h5></div><span className="ha-speed">MOVE ×{Number.isFinite(movement) ? ((movement ?? 0) / 1000).toFixed(2) : "—"}</span></header>
            <label className="ha-start-node"><span>Shared starting node</span><select aria-label={"Starting node for " + formatId(squad)} value={starts.length === 1 ? starts[0] : ""} onChange={(event) => onMoveSquad(squad, event.currentTarget.value)}><option disabled value="">{starts.length > 1 ? "Resolve member node mismatch" : "Select a map node"}</option>{nodes.map((node) => { const lane = Object.entries(nextRules.map.lanes).find(([, laneNodes]) => laneNodes.includes(node))?.[0]; const allegiance = nextRules.map.nodes[node]?.allegiance; return <option key={node} value={node}>{formatId(node)}{lane ? " · " + formatId(lane) : ""}{allegiance ? " · " + formatId(allegiance) : ""}</option>; })}</select></label>
            <ol>{members.map(({ slot, index }) => { const hero = findHero(nextRules, slot.catalog_id); return <li key={slot.slot_id}><span className={"ha-member-sigil" + (hero?.placement === "backline" ? " backline" : "")}>{hero?.placement === "backline" ? "⌁" : "◆"}</span><span><strong>{hero?.name ?? "Unknown Hero"}</strong><small>{hero?.id} · {formatId(slot.node)}</small></span><button onClick={() => { chooseSlot(index); setMobileSquadStage("assign"); }} type="button">Edit slot</button></li>; })}</ol>
            {starts.length > 1 && <p className="ha-group-error" role="alert">This Squad has multiple starting nodes. Choose one shared node to make this initial formation valid.</p>}
            <small className="ha-rules-note">Movement ×{Number.isFinite(movement) ? ((movement ?? 0) / 1000).toFixed(2) : "—"} · maturation {nextRules.parameters.squad_maturation_ticks ?? "unknown"} ticks · values from current Senritsu rules</small>
          </article>;
        })}</div>
        <aside className="ha-capability"><strong>Formation rule</strong><p>Each slot has one Squad membership. Members of a Squad must share one valid map node for Enbu preflight. Squad assignment here sets initial deployment; it does not move Heroes during a battle.</p></aside>
      </section>
      <footer className="ha-footer"><span>Squad membership and start nodes update the same current battle draft.</span><div><button className="next-secondary-button" onClick={onJinrei} type="button">Continue to Jinrei <b>→</b></button><button className="next-secondary-button" onClick={() => onReady()} type="button">Ready <b>↗</b></button></div></footer>
    </div>}
  </section>;
}
