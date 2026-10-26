import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { HeroAtelier } from "../../../apps/web/src/features/next/HeroAtelier";
import { JinreiWorkbench } from "../../../apps/web/src/features/next/JinreiWorkbench";
import { createCoreClient } from "../../../apps/web/src/worker";
import { classifyPreflightProblem } from "../../../apps/web/src/features/next/preflight-problem";
import type { RulePackage, SenkeiDraft, SenkeiSnapshot, SimulationSnapshot } from "../../../apps/web/src/contracts";
import type { HeroAtelierSlot, HeroAtelierScreen } from "../../../apps/web/src/features/next/HeroAtelier";
import type { HeroRepairFocusRequest, JinreiRepairFocusRequest } from "../../../apps/web/src/features/next/repair-focus";
import "../../../apps/web/src/styles.css";
const core = createCoreClient();
const badSource = "// 日本語 🐺\r\n\rsenkei broken { invalid }";
function Harness() {
  const [pkg, setPkg] = useState<RulePackage | null>(null), [slots, setSlots] = useState<HeroAtelierSlot[]>([]);
  const [heroScreen, setHeroScreen] = useState<HeroAtelierScreen>("collection"), [jScreen, setJScreen] = useState<"workbench" | "coverage">("workbench");
  const [index, setIndex] = useState(0), [view, setView] = useState("hero"), [active, setActive] = useState(true), [writes, setWrites] = useState(0);
  const [heroRequest, setHeroRequest] = useState<HeroRepairFocusRequest | null>(null), [jRequest, setJRequest] = useState<JinreiRepairFocusRequest | null>(null);
  const [draft, setDraft] = useState<SenkeiDraft | null>(null); const originalSlots = useRef<HeroAtelierSlot[]>([]); const sequence = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { void core.nextRuleset().then(p => {
    setPkg(p); const rules = p.next!;
    const initial = rules.heroes.slice(0, 5).map((hero, i) => ({ slot_id: i === 2 ? 'slot-"][opaque]#3' : `slot-${i}`, catalog_id: hero.id, squad: `squad-${i}`, node: rules.map.attacker_base, skill_path: Object.keys(hero.skill_paths)[0] }));
    originalSlots.current = initial; setSlots(initial);
    setDraft({ schema_version: p.model_version, id: "repair", revision: "1", ruleset: p.ruleset, configuration: {}, initial_memory: {}, program_input: { kind: "text", source: badSource } });
  }); return () => core.dispose(); }, []);
  useLayoutEffect(() => { const frame = requestAnimationFrame(() => heading.current?.focus()); return () => cancelAnimationFrame(frame); }, [view, active, heroScreen, jScreen]);
  if (!pkg?.next || !draft) return <p>Loading actual Core</p>;
  const snapshot = async (own: HeroAtelierSlot[]): Promise<SimulationSnapshot> => {
    const program = (await core.compile({ kind: "text", source: "senkei inert { state idle { false, }, }", ruleset_ref: pkg.ruleset })).program;
    const side = (values: HeroAtelierSlot[], id: string): SenkeiSnapshot => ({ ...draft, id, program, configuration: { heroes: { kind: "list", value: values.map(slot => ({ kind: "record", value: Object.fromEntries(Object.entries(slot).map(([k, value]) => [k, { kind: "string", value }])) })) } } });
    return { attacker: side(own, "own"), defender: side(originalSlots.current.map(s => ({ ...s, node: pkg.next!.map.defender_base })), "opponent"), context: await core.newMatchContext(pkg.ruleset, "repair-focus") };
  };
  const heroRepair = async (field: "catalog_id" | "skill_path" | "squad" | "node") => {
    const invalid = originalSlots.current.map((slot, i) => i === 2 ? { ...slot, [field]: field === "squad" ? "" : "invalid-value" } : slot);
    setSlots(invalid);
    try { await core.preflight(await snapshot(invalid)); throw Error("Expected real Core rejection"); }
    catch (error) { const problem = classifyPreflightProblem(error, { stage: "snapshot_preflight", input: "draft", inputKey: "fixture", scenarioId: null, slots: { attacker: invalid } });
      if (problem.repair.kind !== "own_hero") throw Error(JSON.stringify(problem));
      setHeroRequest({ requestId: String(++sequence.current), target: problem.repair }); setView("hero"); }
  };
  const sourceRepair = async () => { const source = draft.program_input.kind === "text" ? draft.program_input.source : badSource; try { await core.compile({ kind: "text", source, ruleset_ref: pkg.ruleset }); }
    catch (error) { const problem = classifyPreflightProblem(error, { stage: "own_compile", input: "draft", inputKey: "fixture", scenarioId: null });
      if (problem.repair.kind !== "own_jinrei") throw Error(JSON.stringify(problem));
      setJRequest({ requestId: String(++sequence.current), target: problem.repair, exactSource: source }); setView("jinrei"); } };
  const write = () => setWrites(n => n + 1);
  return <main><h2 ref={heading} tabIndex={-1}>Actual component repair harness</h2>
    {(["catalog_id", "skill_path", "squad", "node"] as const).map(field => <button key={field} onClick={() => void heroRepair(field)}>Repair {field}</button>)}
    <button onClick={() => void sourceRepair()}>Repair compiler</button><button onClick={() => setActive(v => !v)}>{active ? "Hide workspace" : "Show workspace"}</button>
    <button onClick={() => { setHeroRequest({ requestId: String(++sequence.current), target: { kind: "own_hero", recordIndex: 2, slotId: "unknown-slot", field: "node", screen: "squads" } }); setView("hero"); }}>Unknown slot request</button>
    <button onClick={() => { setDraft({ ...draft, revision: "changed", program_input: { kind: "text", source: badSource + "\n// current edit" } }); setJRequest({ requestId: String(++sequence.current), target: { kind: "own_jinrei", path: jRequest?.target.path ?? null }, exactSource: badSource }); setView("jinrei"); }}>Stale source request</button>
    <button onClick={() => { setJRequest({ requestId: String(++sequence.current), target: { kind: "own_jinrei", path: "/actions/0" }, exactSource: null }); setView("jinrei"); }}>Unavailable source request</button>
    <output data-testid="writes">{writes}</output><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} data-testid="hero-request">{JSON.stringify(heroRequest)}</pre><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }} data-testid="source-request">{JSON.stringify(jRequest)}</pre>
    <section hidden={!active || view !== "hero"}><HeroAtelier active={active && view === "hero"} repairFocus={heroRequest} nextRules={pkg.next} slots={slots} activeSlot={index} screen={heroScreen} onActiveSlotChange={setIndex} onScreenChange={setHeroScreen} onSlotChange={write} onMoveSquad={write} onSquadPattern={write} onReady={() => {}} onJinrei={() => setView("jinrei")} canActivate={true} activateArgumentIds={[]} /></section>
    <section hidden={!active || view !== "jinrei"}><JinreiWorkbench active={active && view === "jinrei"} repairFocus={jRequest} core={core} ruleset={{ ...pkg, domain: { ...pkg.domain, senkei_configuration: {} } }} catalog={null} catalogError={null} draft={draft} draftKey="fixture" compilation={null} slots={slots} activeSlot={index} screen={jScreen} onActiveSlotChange={setIndex} onScreenChange={setJScreen} onDraftChange={write} onSourceChange={write} onCompile={input => core.compile(input)} onCompiled={() => {}} onReady={() => {}} onFormation={() => setView("hero")} /></section>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
