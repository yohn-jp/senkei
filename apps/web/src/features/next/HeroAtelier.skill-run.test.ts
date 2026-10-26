import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HeroAtelier, type HeroAtelierProps } from "./HeroAtelier";

const actual = JSON.parse(readFileSync("tests/fixtures/s06-actual-owner-frames.json", "utf8"));
const props = {
  nextRules: { heroes: [actual.hero], map: { nodes: {} } }, slots: [actual.slot], activeSlot: 0,
  screen: "skills", onActiveSlotChange() {}, onScreenChange() {}, onSlotChange() {},
  onSquadPattern() {}, onMoveSquad() {}, onReady() {}, onJinrei() {}, canActivate: true, activateArgumentIds: [],
} as unknown as HeroAtelierProps;

describe("HeroAtelier Run acquisition consumer", () => {
  it("renders actual acquired state beside the unchanged editable plan", () => {
    const html = renderToStaticMarkup(createElement(HeroAtelier, { ...props, skillRunContext: { ...actual, tick: 85 } }));
    expect(html).toContain("Run skill acquisition context");
    expect(html).toContain("Tick 85"); expect(html).toContain("Planned · Acquired");
    expect(html).toContain("Choose one branch for the match"); expect(html).toContain("PLANNED · LV");
  });
  it("keeps unavailable and absent Run states explicit", () => {
    const publicHtml = renderToStaticMarkup(createElement(HeroAtelier, { ...props, skillRunContext: { ...actual, tick: 85, ownerReplay: null } }));
    expect(publicHtml).toContain("Unavailable"); expect(publicHtml).toContain("Unknown");
    const noRun = renderToStaticMarkup(createElement(HeroAtelier, props));
    expect(noRun).toContain("Run skill acquisition context"); expect(noRun).toContain("No confirmed Run");
  });
});
