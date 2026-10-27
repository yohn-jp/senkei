import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { OfficialReadPanel } from "./OfficialReadPanel";
import type { OfficialReadRequest } from "../../../../../packages/online-contract/src/progression-read";

describe("OfficialReadPanel", () => {
  it("shows the honest unavailable state without an inactive control or fictional account", () => {
    const html = renderToStaticMarkup(createElement(OfficialReadPanel, { configuration: { kind: "not-configured" } }));
    expect(html).toContain("The official service is not configured");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Player identity");
    expect(html).not.toContain("Libra total: 0");
  });
  it("shows an actionable not-fetched view for an actual configured request without reading during render", () => {
    const read = vi.fn();
    const request: OfficialReadRequest = { queryId: "query", playerId: "player", authorityId: "authority", policy: { id: "policy", version: "1", digest: "digest" }, query: { kind: "balance" } };
    const html = renderToStaticMarkup(createElement(OfficialReadPanel<string>, { configuration: { kind: "configured", authorityId: "authority", authentication: { authenticate: vi.fn() }, provider: { read }, verifier: { verify: vi.fn() } }, credentials: "credentials", request }));
    expect(html).toContain("Not fetched from the authority");
    expect(html).toContain(">Load</button>");
    expect(read).not.toHaveBeenCalled();
  });
});
