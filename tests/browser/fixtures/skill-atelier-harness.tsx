import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { HeroAtelier } from "../../../apps/web/src/features/next/HeroAtelier";
import type { HeroAtelierRunContext, HeroAtelierScreen, HeroAtelierSlot } from "../../../apps/web/src/features/next/HeroAtelier";
import { createCoreClient } from "../../../apps/web/src/worker";
import type { RulePackage } from "../../../apps/web/src/contracts";
import actual from "../../fixtures/s06-actual-owner-frames.json";
import "../../../apps/web/src/styles.css";

const core = createCoreClient();
const submittedSlots = actual.submittedHeroes.value.map(record => Object.fromEntries(Object.entries(record.value).map(([key, value]) => [key, value.value]))) as unknown as HeroAtelierSlot[];
const originalRun = JSON.stringify(actual);
function Harness() {
  const [pkg, setPackage] = useState<RulePackage | null>(null), [slots, setSlots] = useState(submittedSlots);
  const [selected, setSelected] = useState(submittedSlots.findIndex(slot => slot.slot_id === actual.slot.slot_id));
  const [screen, setScreen] = useState<HeroAtelierScreen>("skills"), [mode, setMode] = useState("85"), [writes, setWrites] = useState(0);
  useEffect(() => { void core.nextRuleset().then(setPackage); return () => core.dispose(); }, []);
  if (!pkg?.next) return <p>Loading actual Core Catalog</p>;
  const context = mode === "absent" ? null : { ...actual, tick: mode === "0" ? 0 : 85, ...(mode === "public" ? { ownerReplay: null } : {}) } as unknown as HeroAtelierRunContext;
  return <><nav aria-label="Test owner observations"><button onClick={() => setMode("0")}>Observe T0</button><button onClick={() => setMode("85")}>Observe T85</button><button onClick={() => setMode("public")}>Use public-only Run</button><button onClick={() => setMode("absent")}>Clear Run context</button></nav>
    <output aria-label="Draft writes">{writes}</output><output aria-label="Run unchanged">{String(JSON.stringify(actual) === originalRun)}</output>
    <HeroAtelier active nextRules={pkg.next} slots={slots} activeSlot={selected} screen={screen} skillRunContext={context}
      onActiveSlotChange={setSelected} onScreenChange={setScreen} onSlotChange={(index, patch) => { setWrites(value => value + 1); setSlots(previous => previous.map((slot, i) => i === index ? { ...slot, ...patch } : slot)); }}
      onSquadPattern={() => {}} onMoveSquad={() => {}} onReady={() => {}} onJinrei={() => {}} canActivate={Boolean(pkg.domain.capabilities.activate)} activateArgumentIds={pkg.domain.capabilities.activate?.arguments.map(argument => argument.id) ?? []} />
  </>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
