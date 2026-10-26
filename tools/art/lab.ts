import { createHeroModelPreview, type HeroPreviewPose } from "../../packages/renderer/src/renderer-hero-model-preview";
const stage = document.querySelector<HTMLElement>("#stage")!;
const hero = document.querySelector<HTMLSelectElement>("#hero")!;
let preview: ReturnType<typeof createHeroModelPreview> | undefined;
function load() {
  preview?.dispose();
  const catalogId = hero.value;
  preview = createHeroModelPreview(stage, {
    catalogId, appearanceKey: `senkei.next.hero.${catalogId.toLowerCase()}`,
    name: catalogId === "F01" ? "Bannerhold" : "Tempest",
  });
  setPose("idle");
}
function setPose(pose: HeroPreviewPose) {
  preview?.setPose(pose);
  document.querySelectorAll<HTMLButtonElement>("[data-pose]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.pose === pose)));
}
hero.addEventListener("change", load);
document.querySelector("#reset")!.addEventListener("click", () => preview?.resetView());
document.querySelectorAll<HTMLButtonElement>("[data-pose]").forEach(button => button.addEventListener("click", () => setPose(button.dataset.pose as HeroPreviewPose)));
setInterval(() => { document.querySelector("#metadata")!.textContent = JSON.stringify(stage.querySelector("canvas")?.dataset, null, 2); }, 500);
load();
