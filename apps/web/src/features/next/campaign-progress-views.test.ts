import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CampaignRunActions } from "./CampaignProgressViews";
import type { CampaignRunActionsProps } from "./CampaignProgressViews";
const props = {
  title: "Final challenge", status: "victory", finalScenario: true, allRecordedComplete: false,
  busy: false, nextTitle: null,
} as unknown as CampaignRunActionsProps;
describe("Campaign result actions", () => {
  it("distinguishes a final win from all earlier completion records and offers no nonexistent next", () => {
    const html = renderToStaticMarkup(createElement(CampaignRunActions, props));
    expect(html).toContain("最終課題を攻略");
    expect(html).toContain("全課題攻略済みとは表示しません");
    expect(html).not.toContain("次の課題を準備");
    expect(html).toContain("同じ課題を再挑戦");
    expect(html).toContain("この課題のJinreiを改善");
    expect(html).toContain("Homeへ戻る");
  });
  it("does not offer victory progression after a Draw", () => {
    const html = renderToStaticMarkup(createElement(CampaignRunActions, { ...props, status: "draw", finalScenario: false, nextTitle: "Next" }));
    expect(html).not.toContain("次の課題を準備");
    expect(html).not.toContain("最終課題を攻略");
  });
});
