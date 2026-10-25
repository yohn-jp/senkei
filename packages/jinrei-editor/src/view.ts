import { type DomainCatalogDocument } from "./catalog.js";
import {
  type ActorSelection,
  type ComparisonSurface,
  EditorSession,
  behaviorCoverage,
  catalogEntries,
  displayDomainValue,
  jsonCompilerGateway,
  searchCatalog,
  type CatalogEntry,
  type CompilerGateway,
} from "./editor.js";

export type EditorTab = "source" | "catalog" | "coverage" | "observed";

function html(value: unknown): string {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function selectionMarkup(actor: ActorSelection): string {
  const scopes = ["army", "squad", "hero", "lane_limited_minion"] as const;
  const scopeOptions = scopes.map((scope) => `<option value="${scope}"${actor.scope === scope ? " selected" : ""}>${scope}</option>`).join("");
  return `<fieldset class="jinrei-editor__selection"><legend>Decision scope</legend>
    <label>Scope <select data-selection="scope">${scopeOptions}</select></label>
    <label>Side <select data-selection="side"><option value="attacker"${actor.side === "attacker" ? " selected" : ""}>attacker</option><option value="defender"${actor.side === "defender" ? " selected" : ""}>defender</option></select></label>
    <label>Squad ID <input data-selection="squadId" value="${html("squadId" in actor ? actor.squadId : "")}"></label>
    <label>Hero ID <input data-selection="heroId" value="${html("heroId" in actor ? actor.heroId : "")}"></label>
    <label>Hero Catalog ID <input data-selection="heroCatalogId" value="${html(actor.scope === "hero" ? actor.heroCatalogId ?? "" : "")}"></label>
    <label>Package Entity Type <input data-selection="packageEntityType" value="${html(actor.scope === "hero" ? actor.packageEntityType ?? "" : "")}"></label>
    <label>Lane <input data-selection="lane" value="${html(actor.scope === "lane_limited_minion" ? actor.lane : "")}"></label>
  </fieldset>`;
}

function entryMarkup(entry: CatalogEntry, selectedId?: string): string {
  return `<li><button type="button" data-entry="${html(entry.id)}"${selectedId === entry.id ? ' aria-current="true"' : ""}>
    <span>${html(entry.label)}</span><small>${html(entry.kind)} · ${html(entry.detail)}</small>
    <span>${entry.permission === "available" ? "Available" : "Permission denied"}</span></button></li>`;
}

/** Stable, escaped semantic view that can be embedded in the later product shell. */
export function renderJinreiEditorMarkup(
  catalog: DomainCatalogDocument,
  actor: ActorSelection,
  tab: EditorTab = "source",
  source = "",
  query = "",
  selectedEntry?: string,
  surface: ComparisonSurface = "effective",
): string {
  const tabs: EditorTab[] = ["source", "catalog", "coverage", "observed"];
  const navigation = tabs.map((item) => `<button type="button" role="tab" data-tab="${item}" aria-selected="${item === tab}">${item}</button>`).join("");
  let panel = "";
  if (tab === "source") {
    panel = `<section role="tabpanel" aria-label="Jinrei Source"><label for="jinrei-source">Jinrei v0.1 source</label>
      <textarea id="jinrei-source" data-source>${html(source)}</textarea>
      <button type="button" data-compile>Compile with this Catalog</button><pre data-diagnostics>Compiler has not run for this draft.</pre></section>`;
  } else if (tab === "catalog") {
    const rows = searchCatalog(catalog, actor, query);
    const selected = selectedEntry ? catalogEntries(catalog, actor).find((entry) => entry.id === selectedEntry) : undefined;
    panel = `<section role="tabpanel" aria-label="Domain Catalog"><label for="catalog-search">Search Catalog</label>
      <input id="catalog-search" data-search value="${html(query)}"><ul data-entries>${rows.map((entry) => entryMarkup(entry, selectedEntry)).join("")}</ul>
      <aside data-hover aria-label="Catalog definition">${selected ? `<h2>${html(selected.label)}</h2><p>${html(selected.detail)}</p><p>${selected.permission === "available" ? "Available in this scope" : "Permission denied by Catalog metadata"}</p>` : "Select a Catalog entry to inspect its signature and access metadata."}</aside></section>`;
  } else if (tab === "coverage") {
    const matrix = behaviorCoverage(catalog, actor, surface);
    panel = `<section role="tabpanel" aria-label="Behavior Coverage"><label>Surface <select data-surface>
      ${(["default", "effective", "observed"] as const).map((item) => `<option value="${item}"${item === surface ? " selected" : ""}>${item}</option>`).join("")}</select></label>
      <p data-coverage-status>${html(matrix.status)} · proven fields ${matrix.provenFields} / ${matrix.assessedFields}</p>
      <table><thead><tr><th>Behavior field</th><th>Senritsu Default</th><th>Hero Catalog Default</th><th>Effective</th><th>Observed</th><th>Reason</th></tr></thead><tbody>
      ${matrix.cells.map((cell) => `<tr><th>${html(cell.fieldId)}</th><td>${html(cell.defaultStatus === "available" ? displayDomainValue(cell.senritsuDefaultValue) : "Not declared")}</td><td>${html(displayDomainValue(cell.heroCatalogDefaultValue))}</td><td>${html(cell.effectiveStatus)}</td><td>${html(cell.observedStatus)}</td><td>${html(cell.reason)}</td></tr>`).join("")}</tbody></table></section>`;
  } else {
    panel = `<section role="tabpanel" aria-label="Observed Decisions"><p data-observed-status>NOT_CHECKED</p><p>Observed values and decision traces require an identity-matched, authorized Enbu adapter.</p></section>`;
  }
  return `<section class="jinrei-editor" data-ruleset="${html(catalog.identity.rulesetId)}" data-catalog-digest="${html(catalog.catalogDigest)}">
    <header><h1>Jinrei Editor Foundation</h1><p>RulePackage ${html(catalog.identity.rulesetId)} @ ${catalog.identity.rulesetVersion.major}.${catalog.identity.rulesetVersion.minor}.${catalog.identity.rulesetVersion.patch}</p></header>
    ${selectionMarkup(actor)}<nav role="tablist" aria-label="Jinrei Editor views">${navigation}</nav>${panel}</section>`;
}

function selectedActor(root: HTMLElement, current: ActorSelection): ActorSelection {
  const read = (key: string, fallback: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-selection="${key}"]`)?.value ?? fallback;
  const side = read("side", current.side) === "defender" ? "defender" : "attacker";
  const scope = read("scope", current.scope);
  if (scope === "army") return { scope, side };
  if (scope === "lane_limited_minion") return { scope, side, lane: read("lane", "") };
  const squadId = read("squadId", "squad");
  if (scope === "squad") return { scope, side, squadId };
  return { scope: "hero", side, squadId, heroId: read("heroId", "hero"), heroCatalogId: read("heroCatalogId", "") || undefined, packageEntityType: read("packageEntityType", "") || undefined };
}

export interface MountedEditor { session: EditorSession; refresh(): void; dispose(): void; }

/** Mounts the small, accessible foundation view without taking over app routing. */
export function mountJinreiEditor(root: HTMLElement, catalog: DomainCatalogDocument, gateway: CompilerGateway, actor: ActorSelection): MountedEditor {
  const session = new EditorSession(catalog, actor);
  let tab: EditorTab = "source";
  let query = "";
  let selectedEntry: string | undefined;
  let surface: ComparisonSurface = "effective";
  let diagnostic = "Compiler has not run for this draft.";
  let renderedRevision = session.snapshot().revision;
  const render = () => {
    const state = session.snapshot();
    if (state.revision !== renderedRevision) {
      diagnostic = "Compiler has not run for this draft.";
      renderedRevision = state.revision;
    }
    root.innerHTML = renderJinreiEditorMarkup(state.catalog, state.selection, tab, state.source, query, selectedEntry, surface);
    const pre = root.querySelector<HTMLElement>("[data-diagnostics]");
    if (pre) pre.textContent = diagnostic;
  };
  const click = async (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const tabButton = target.closest<HTMLElement>("[data-tab]");
    if (tabButton?.dataset.tab) tab = tabButton.dataset.tab as EditorTab;
    const entry = target.closest<HTMLElement>("[data-entry]");
    if (entry?.dataset.entry) selectedEntry = entry.dataset.entry;
    if (target.closest("[data-compile]")) {
      diagnostic = "Compiling…";
      render();
      try {
        const result = await session.compile(gateway);
        diagnostic = result?.status === "compiled"
          ? [`Compiled · ${result.result.estimated_cu} logical CU`, ...result.result.diagnostics.map((item) => `${item.severity ?? "info"} ${item.code}${item.path ? ` at ${item.path}` : ""}: ${item.message}`)].join("\n")
          : result?.status === "rejected"
            ? `${result.error.code}${result.error.path ? ` at ${result.error.path}` : ""}: ${result.error.message}`
            : "Draft changed; stale result discarded.";
      } catch (error) { diagnostic = error instanceof Error ? error.message : "Compiler request failed."; }
    }
    render();
  };
  const input = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches("[data-source]")) {
      session.setDraft((target as HTMLTextAreaElement).value);
      renderedRevision = session.snapshot().revision;
      diagnostic = "Compiler has not run for this draft.";
      const status = root.querySelector<HTMLElement>("[data-diagnostics]");
      if (status) status.textContent = diagnostic;
    }
    if (target.matches("[data-search]")) {
      query = (target as HTMLInputElement).value;
      const rows = root.querySelector<HTMLElement>("[data-entries]");
      const actorNow = session.snapshot().selection;
      if (rows) rows.innerHTML = searchCatalog(catalog, actorNow, query).map((entry) => entryMarkup(entry, selectedEntry)).join("");
    }
  };
  const change = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches("[data-surface]")) { surface = (target as HTMLSelectElement).value as ComparisonSurface; render(); }
    if (target.matches("[data-selection]")) { session.setSelection(selectedActor(root, session.snapshot().selection)); render(); }
  };
  root.addEventListener("click", click);
  root.addEventListener("input", input);
  root.addEventListener("change", change);
  render();
  return {
    session,
    refresh: render,
    dispose() { root.removeEventListener("click", click); root.removeEventListener("input", input); root.removeEventListener("change", change); root.replaceChildren(); },
  };
}

export { jsonCompilerGateway };
