import { useEffect, useState } from "react";
import type { CoreClient } from "./contracts";
import { NextWorkspace } from "./features/next";
import { LegacyRecoveryFeature } from "./features/persistence/LegacyRecoveryFeature";
import { createCoreClient } from "./worker";

type AppView = "next" | "legacy";
type NextScreen = "home" | "workspace" | "resume";

function App() {
  const [view, setView] = useState<AppView>("next");
  const [nextEntry, setNextEntry] = useState<{ screen: NextScreen; request: number }>({ screen: "home", request: 0 });
  const [core, setCore] = useState<CoreClient | null>(null);
  const [nextRuleset, setNextRuleset] = useState<Awaited<ReturnType<CoreClient["nextRuleset"]>> | null>(null);
  const [nextRulesetError, setNextRulesetError] = useState<string | null>(null);
  const [coreAttempt, setCoreAttempt] = useState(0);

  useEffect(() => {
    const client = createCoreClient();
    let current = true;
    setCore(client);
    void client.nextRuleset().then((packageValue) => {
      if (!current) return;
      setNextRuleset(packageValue);
      setNextRulesetError(null);
    }).catch((error: unknown) => {
      if (!current) return;
      setNextRulesetError(error instanceof Error ? error.message : "The local Next ruleset could not be loaded.");
    });
    return () => {
      current = false;
      client.dispose();
    };
  }, [coreAttempt]);

  const openNext = (screen: NextScreen): void => {
    setView("next");
    setNextEntry((entry) => ({ screen, request: entry.request + 1 }));
  };

  return (
    <main className="app-shell" data-testid="app-shell">
      <aside className="sidebar">
        <a className="wordmark" href="#workspace" aria-label="Senkei home" onClick={(event) => { event.preventDefault(); openNext("home"); }}>
          <span className="wordmark-mark">S</span>
          <span><strong>SENKEI</strong><small>STRATEGY WORKSHOP</small></span>
        </a>

        <div className="workspace-label">LOCAL PLAY</div>
        <nav className="primary-nav" aria-label="Workspace" data-testid="workspace-nav">
          <button className="nav-item" data-testid="nav-home" onClick={() => openNext("home")} type="button">Home<span>開始・再開</span></button>
          <button aria-current={view === "next" ? "page" : undefined} className={`nav-item${view === "next" ? " is-active" : ""}`} data-testid="nav-next" onClick={() => openNext("workspace")} type="button"><span className="nav-number">01</span><span>Next</span><span className="nav-arrow">↗</span></button>
          <button className="nav-item" data-testid="nav-library" onClick={() => openNext("resume")} type="button"><span className="nav-number">02</span><span>Library</span><span className="nav-arrow">↗</span></button>
          <button aria-current={view === "legacy" ? "page" : undefined} className={`nav-item nav-item-secondary${view === "legacy" ? " is-active" : ""}`} data-testid="nav-legacy-library" onClick={() => setView("legacy")} type="button"><span className="nav-number">DATA</span><span>Data recovery</span><span className="nav-arrow" aria-hidden="true">↗</span></button>
        </nav>

        <div className="sidebar-bottom">
          <div className="local-status"><span /> RUNNING LOCALLY</div>
          <p>Build a strategy.<br />Watch it play.</p>
          <small>NO ACCOUNT · NO SERVER</small>
        </div>
      </aside>

      <section className="workspace" id="workspace">
        <header className="topbar">
          <div className="breadcrumb">SENKEI <span>/</span> {view === "next" ? "NEXT" : "LEGACY DOCUMENTS"}</div>
          <div className="local-badge"><span /> LOCAL MODE</div>
        </header>

        <div className="page-content" data-testid="workspace-view" data-view={view}>
          <div className="next-view-shell" hidden={view !== "next"}>
            <NextWorkspace
              active={view === "next"}
              entry={nextEntry}
              core={core}
              ruleset={nextRuleset}
              rulesetError={nextRulesetError}
              onRetryCore={() => setCoreAttempt((attempt) => attempt + 1)}
              onLegacyLibrary={() => setView("legacy")}
            />
          </div>
          {view === "legacy" && <>
            <div className="page-heading"><div><div className="feature-eyebrow">LOCAL DATA RECOVERY</div><h1>Legacy <em>documents.</em></h1><p>Review, export, or remove older saved strategies. They stay separate from Next setups.</p></div></div>
            <LegacyRecoveryFeature />
            <button className="persistence-button persistence-button-secondary" onClick={() => openNext("resume")} type="button">Return to Next Library</button>
          </>}
          <footer className="page-footer"><span>LOCAL FIRST BY DESIGN</span><span>{view === "next" ? "EDIT → SIMULATE → LEARN" : "PRESERVE → EXPORT → RECOVER"}</span></footer>
        </div>
      </section>
    </main>
  );
}

export default App;
