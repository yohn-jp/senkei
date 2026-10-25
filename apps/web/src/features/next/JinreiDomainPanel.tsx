import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import {
  catalogEntries,
  completeCatalog,
  mountJinreiEditor,
  sameCatalog,
} from "@senkei/jinrei-editor";
import type {
  ActorSelection,
  CatalogCapability,
  CompletionItem,
  CompilerGateway,
  CompilerReply,
  CompilerRequest,
  DomainCatalogDocument,
} from "@senkei/jinrei-editor";
import type { CompileOutcome, CoreClient } from "../../contracts";
import "./jinrei-domain-panel.css";

type DecisionScope = "hero" | "squad" | "army";

interface JinreiDomainPanelProps {
  readonly catalog: DomainCatalogDocument;
  readonly core: CoreClient;
  readonly source: string;
  readonly draftKey: string;
  readonly slot: { readonly slotId: string; readonly squadId: string; readonly heroCatalogId: string } | null;
  readonly onSourceChange: (source: string) => void;
  readonly onCompiled: (result: CompileOutcome, draftKey: string) => void;
}

function actorSelection(
  scope: DecisionScope,
  slot: JinreiDomainPanelProps["slot"],
  catalog: DomainCatalogDocument,
): ActorSelection {
  if (scope === "army") return { scope, side: "attacker" };
  const squadId = slot?.squadId ?? "";
  if (scope === "squad") return { scope, side: "attacker", squadId };
  const heroEntityTypes = new Set(Object.values(catalog.observations)
    .filter((observation) => observation.scope.kind === "package_entity")
    .map((observation) => observation.entityType ?? observation.scope.entityType)
    .filter((entityType): entityType is string => typeof entityType === "string"));
  return {
    scope,
    side: "attacker",
    squadId,
    heroId: slot?.slotId ?? "",
    heroCatalogId: slot?.heroCatalogId,
    ...(heroEntityTypes.size === 1 ? { packageEntityType: [...heroEntityTypes][0] } : {}),
  };
}

function capabilityMatchesScope(capability: CatalogCapability, actor: ActorSelection): boolean {
  if (capability.actorScope.kind === actor.scope) return true;
  return actor.scope === "hero"
    && capability.actorScope.kind === "package_entity"
    && capability.actorScope.entityType === actor.packageEntityType;
}

function exactScopeEntries(catalog: DomainCatalogDocument, actor: ActorSelection) {
  return catalogEntries(catalog, actor).filter((entry) => entry.kind !== "capability"
    || capabilityMatchesScope(entry.definition as CatalogCapability, actor));
}

function completionPrefix(value: string, cursor: number): { prefix: string; from: number } {
  const before = value.slice(0, cursor);
  const prefix = before.match(/[A-Za-z0-9_.]*$/)?.[0] ?? "";
  return { prefix, from: cursor - prefix.length };
}

export function JinreiDomainPanel({
  catalog,
  core,
  source,
  draftKey,
  slot,
  onSourceChange,
  onCompiled,
}: JinreiDomainPanelProps): ReactElement {
  const [scope, setScope] = useState<DecisionScope>("hero");
  const [completionItems, setCompletionItems] = useState<CompletionItem[]>([]);
  const hostRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<ReturnType<typeof mountJinreiEditor> | null>(null);
  const sourceRef = useRef(source);
  const draftKeyRef = useRef(draftKey);
  const onSourceChangeRef = useRef(onSourceChange);
  const onCompiledRef = useRef(onCompiled);
  const actor = useMemo(() => actorSelection(scope, slot, catalog), [
    catalog,
    scope,
    slot?.heroCatalogId,
    slot?.slotId,
    slot?.squadId,
  ]);
  const actorRef = useRef(actor);

  sourceRef.current = source;
  draftKeyRef.current = draftKey;
  onSourceChangeRef.current = onSourceChange;
  onCompiledRef.current = onCompiled;
  actorRef.current = actor;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const gateway: CompilerGateway = {
      async compile(request: CompilerRequest): Promise<CompilerReply> {
        const requestDraftKey = draftKeyRef.current;
        const envelope = await core.editorCompile(request);
        if (envelope.revision !== request.revision) {
          throw new Error("Jinrei compiler response does not match the draft revision.");
        }
        if (!sameCatalog(request.stamp, envelope.reply.stamp)) {
          throw new Error("Jinrei compiler response does not match the selected Domain Catalog.");
        }
        if (envelope.reply.status === "compiled"
        && sourceRef.current === request.source
          && draftKeyRef.current === requestDraftKey) {
          onCompiledRef.current(envelope.reply.result, requestDraftKey);
        }
        return envelope.reply as CompilerReply;
      }
    };
    const mounted = mountJinreiEditor(host, catalog, gateway, actorRef.current);
    mountedRef.current = mounted;
    if (sourceRef.current !== "") mounted.session.setDraft(sourceRef.current);
    mounted.refresh();
    // This panel is the Workbench's dedicated Catalog route. The primary
    // No-code/Text editor and Behavior Coverage have their own full screens.
    host.querySelector<HTMLButtonElement>('[data-tab="catalog"]')?.click();

    const syncDraftAndCompletions = (event: Event): void => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement) || !target.matches("[data-source]")) return;
      const nextSource = target.value;
      sourceRef.current = nextSource;
      onSourceChangeRef.current(nextSource);
      const { prefix } = completionPrefix(nextSource, target.selectionStart);
      const actorNow = actorRef.current;
      const candidates = completeCatalog(catalog, actorNow, prefix)
        .filter((item) => item.entry.kind !== "capability"
          || capabilityMatchesScope(item.entry.definition as CatalogCapability, actorNow))
        .slice(0, 8);
      setCompletionItems(candidates);
    };
    host.addEventListener("input", syncDraftAndCompletions);

    const applyCapabilityScopes = (): void => {
      for (const button of host.querySelectorAll<HTMLElement>("[data-entry]")) {
        const capability = catalog.capabilities[button.dataset.entry ?? ""];
        if (!capability) continue;
        const row = button.closest("li");
        if (row) row.hidden = !capabilityMatchesScope(capability, actorRef.current);
      }
    };
    const observer = new MutationObserver(applyCapabilityScopes);
    observer.observe(host, { childList: true, subtree: true });
    applyCapabilityScopes();

    return () => {
      observer.disconnect();
      host.removeEventListener("input", syncDraftAndCompletions);
      mounted.dispose();
      if (mountedRef.current === mounted) mountedRef.current = null;
    };
  }, [catalog, core]);

  useEffect(() => {
    const mounted = mountedRef.current;
    if (!mounted) return;
    mounted.session.setSelection(actor);
    mounted.refresh();
  }, [actor]);

  useEffect(() => {
    const mounted = mountedRef.current;
    const textarea = hostRef.current?.querySelector<HTMLTextAreaElement>("[data-source]");
    if (mounted && textarea && textarea.value !== source) {
      mounted.session.setDraft(source);
      mounted.refresh();
      setCompletionItems([]);
    }
  }, [source]);

  const chooseCompletion = (item: CompletionItem): void => {
    const textarea = hostRef.current?.querySelector<HTMLTextAreaElement>("[data-source]");
    if (!textarea) return;
    const cursor = textarea.selectionStart;
    const { from } = completionPrefix(textarea.value, cursor);
    const nextSource = `${textarea.value.slice(0, from)}${item.insertText}${textarea.value.slice(textarea.selectionEnd)}`;
    const nextCursor = from + item.insertText.length;
    textarea.value = nextSource;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
    textarea.setSelectionRange(nextCursor, nextCursor);
    setCompletionItems([]);
  };

  const visibleCapabilities = exactScopeEntries(catalog, actor).filter((entry) => entry.kind === "capability").length;

  return (
    <section className="next-jinrei-domain-panel" aria-label="Jinrei Domain Catalog and analysis">
      <header className="next-jinrei-domain-heading">
        <div>
          <span className="next-eyebrow">SENRITSU DOMAIN CATALOG</span>
          <h4>Explore the declared <em>decision domain</em></h4>
          <p>Catalog search and completions follow the selected scope. Jinrei remains the authority for source legality.</p>
        </div>
        <label className="next-domain-scope-control">
          <span>Decision scope</span>
          <select aria-label="Decision scope" value={scope} onChange={(event) => setScope(event.currentTarget.value as DecisionScope)}>
            <option value="hero">Hero</option>
            <option value="squad">Squad</option>
            <option value="army">Army</option>
          </select>
        </label>
      </header>
      {scope === "hero" && slot && <p className="next-domain-context">Hero {slot.heroCatalogId} · {slot.slotId} · {slot.squadId}</p>}
      {scope === "squad" && slot && <p className="next-domain-context">Squad {slot.squadId}</p>}
      <p className="next-domain-scope-note">Showing {visibleCapabilities} Capability contract{visibleCapabilities === 1 ? "" : "s"} registered for {scope}. A source compile can still use any scope the Ruleset and Jinrei compiler allow.</p>
      <div className="next-jinrei-domain-mount" ref={hostRef} />
      {completionItems.length > 0 && (
        <div className="next-jinrei-completions" role="listbox" aria-label="Catalog completions">
          <strong>Catalog completions</strong>
          {completionItems.map((item) => (
            <button key={`${item.kind}:${item.insertText}`} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseCompletion(item)} role="option" type="button">
              <code>{item.insertText}</code><span>{item.kind} · {item.detail}</span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
