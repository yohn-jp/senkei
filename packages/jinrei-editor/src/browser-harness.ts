import rawCatalog from "../fixtures/next-domain-catalog.json";
import { loadDomainCatalog } from "./catalog.js";
import { type ActorSelection } from "./editor.js";
import { type MountedEditor, mountJinreiEditor } from "./view.js";

declare global {
  interface Window { __jinreiScope?: string; __jinreiEditor?: MountedEditor; }
}

const catalog = await loadDomainCatalog(JSON.stringify(rawCatalog), {
  rulesetId: rawCatalog.identity.rulesetId,
  rulesetVersion: rawCatalog.identity.rulesetVersion,
  rulesetDigest: rawCatalog.identity.rulesetDigest,
});
const root = document.querySelector<HTMLElement>("#editor");
if (!root) throw new Error("Editor harness root is missing.");
const actor: ActorSelection = { scope: "hero", side: "attacker", squadId: "squad-1", heroId: "hero-1", packageEntityType: "hero" };
const mounted = mountJinreiEditor(root, catalog, {
  async compile(request) {
    window.__jinreiScope = mounted.session.snapshot().selection.scope;
    if (request.source.includes("invalid")) {
      return { status: "rejected", stamp: request.stamp, error: { code: "compile_failed", path: "/actions/0", message: "unknown symbol" } };
    }
    return { status: "compiled", stamp: request.stamp, result: { ast: {}, program: {}, estimated_cu: 3, diagnostics: [] } };
  },
}, actor);
window.__jinreiEditor = mounted;
root.addEventListener("change", () => { window.__jinreiScope = mounted.session.snapshot().selection.scope; });
