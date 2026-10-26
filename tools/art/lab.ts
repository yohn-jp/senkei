import { createHeroModelPreview, type HeroPreviewLod, type HeroPreviewPose } from "../../packages/renderer/src/renderer-hero-model-preview";
const stage = document.querySelector<HTMLElement>("#stage")!;
const hero = document.querySelector<HTMLSelectElement>("#hero")!;
const lodSelect = document.createElement("select");
lodSelect.id = "lod";
lodSelect.dataset.artLod = "true";
for (const [value, label] of [["automatic", "Automatic"], ["full", "Full"], ["medium", "Medium"], ["far", "Far"]]) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  lodSelect.append(option);
}
const lodLabel = document.createElement("label");
lodLabel.textContent = "LOD ";
lodLabel.append(lodSelect);
hero.closest("label")?.after(lodLabel);
const angleSelect = document.createElement("select");
angleSelect.id = "angle";
angleSelect.dataset.artView = "true";
for (const [value, label] of [["default", "Default"], ["front", "Front"], ["quarter", "Quarter"], ["rear", "Rear"]]) {
  const option = document.createElement("option");
  option.value = value;
  option.textContent = label;
  angleSelect.append(option);
}
const angleLabel = document.createElement("label");
angleLabel.textContent = "View ";
angleLabel.append(angleSelect);
lodLabel.after(angleLabel);
let preview: ReturnType<typeof createHeroModelPreview> | undefined;
function load() {
  preview?.dispose();
  const catalogId = hero.value;
  const lodOverride = lodSelect.value === "automatic" ? undefined : lodSelect.value as HeroPreviewLod;
  preview = createHeroModelPreview(stage, {
    catalogId, appearanceKey: `senkei.next.hero.${catalogId.toLowerCase()}`,
    name: catalogId === "F01" ? "Bannerhold" : "Tempest",
    ...(lodOverride ? { lodOverride } : {}),
  });
  setPose("idle");
}
function setPose(pose: HeroPreviewPose) {
  preview?.setPose(pose);
  document.querySelectorAll<HTMLButtonElement>("[data-pose]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.pose === pose)));
}
hero.addEventListener("change", load);
lodSelect.addEventListener("change", load);
angleSelect.addEventListener("change", () => {
  if (angleSelect.value === "default") {
    preview?.resetView();
    return;
  }
  const yaw = { front: 0, quarter: Math.PI / 4, rear: Math.PI }[angleSelect.value as "front" | "quarter" | "rear"];
  if (yaw !== undefined) preview?.setInspectionAzimuth(yaw);
});
document.querySelector("#reset")!.addEventListener("click", () => {
  preview?.resetView();
  angleSelect.value = "default";
});
document.querySelectorAll<HTMLButtonElement>("[data-pose]").forEach(button => button.addEventListener("click", () => setPose(button.dataset.pose as HeroPreviewPose)));
setInterval(() => { document.querySelector("#metadata")!.textContent = JSON.stringify(stage.querySelector("canvas")?.dataset, null, 2); }, 500);
load();
