import { useState } from "react";
import type { WorkspaceView } from "./contracts";

const navigation: readonly { id: WorkspaceView; label: string; number: string }[] = [
  { id: "editor", label: "Tactics", number: "01" },
  { id: "battle", label: "Battle lab", number: "02" },
  { id: "persistence", label: "Library", number: "03" },
];

export default function App() {
  const [view, setView] = useState<WorkspaceView>("editor");

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <a className="wordmark" href="#workspace" aria-label="Senkei home">
          <span className="wordmark-mark">S</span>
          <span>
            <strong>SENKEI</strong>
            <small>STRATEGY WORKSHOP</small>
          </span>
        </a>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="primary-nav" aria-label="Workspace">
          {navigation.map((item) => (
            <button
              aria-current={view === item.id ? "page" : undefined}
              className={`nav-item${view === item.id ? " is-active" : ""}`}
              key={item.id}
              onClick={() => setView(item.id)}
              type="button"
            >
              <span className="nav-number">{item.number}</span>
              <span>{item.label}</span>
              <span className="nav-arrow" aria-hidden="true">↗</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-bottom">
          <div className="local-status"><span /> RUNNING LOCALLY</div>
          <p>Build a strategy.<br />Watch it play.</p>
          <small>NO ACCOUNT · NO SERVER</small>
        </div>
      </aside>

      <section className="workspace" id="workspace">
        <header className="topbar">
          <div className="breadcrumb">SENKEI <span>/</span> {view.toUpperCase()}</div>
          <div className="local-badge"><span /> LOCAL MODE</div>
        </header>

        <div className="page-content">
          <div className="page-heading">
            <div>
              <div className="feature-eyebrow">DESIGN · TEST · REFINE</div>
              <h1>Your strategy, <em>in motion.</em></h1>
              <p>Shape a formation, run a battle, and learn from every result.</p>
            </div>
            <div className="heading-mark" aria-hidden="true">戦</div>
          </div>

          <div className="feature-grid">
            <div className="feature-primary">
              <section className="feature-card" aria-live="polite">
                <div className="feature-eyebrow">{view.toUpperCase()} · LOCAL WORKSPACE</div>
                <h2>{navigation.find((item) => item.id === view)?.label}</h2>
                <p>
                  This application shell owns navigation and layout. The feature
                  modules plug into their typed contracts in the next delivery step.
                </p>
                <div className="contract-chip">No server connection required</div>
              </section>
            </div>
            <aside className="principle-card">
              <div className="principle-icon" aria-hidden="true">◎</div>
              <div className="feature-eyebrow">THE SENKEI LOOP</div>
              <ol>
                <li><span>01</span> Design your formation</li>
                <li><span>02</span> Let your strategy fight</li>
                <li><span>03</span> Study the replay</li>
                <li><span>04</span> Improve and go again</li>
              </ol>
              <div className="principle-note">Every battle is deterministic and runs on your device.</div>
            </aside>
          </div>

          <footer className="page-footer">
            <span>LOCAL FIRST BY DESIGN</span>
            <span>EDIT → SIMULATE → LEARN</span>
          </footer>
        </div>
      </section>
    </main>
  );
}
