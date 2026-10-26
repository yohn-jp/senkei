import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { reproductionSnapshotDigest } from "../../../apps/web/src/features/next/experiment-restoration";
import { completePreflight } from "../helpers/preflight";

type JsonRecord = Record<string, any>;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const prebuiltScenarioDirectory = process.env.BATTLEFIELD_PREBUILT_SCENARIO_DIR;
const snapshotPath = prebuiltScenarioDirectory
  ? resolve(prebuiltScenarioDirectory, "canonical.json")
  : resolve(repoRoot, "target/next-balance/battlefield-canonical-browser-snapshot.json");
const evidenceDirectory = resolve(repoRoot, "docs/evidence/battlefield/canonical-browser");
const bridgeSiteIds = { TOP: "bridge.top", MID: "bridge.mid", BOT: "bridge.bot" } as const;
const expectedNodes = [
  "A.BASE", "B.BASE", "N.MID.OBS",
  ...["TOP", "MID", "BOT"].flatMap((lane) => [
    `A.${lane}.T1`, `A.${lane}.T2`, `A.${lane}.J`, `A.${lane}.BANK`,
    `B.${lane}.BANK`, `B.${lane}.J`, `B.${lane}.T2`, `B.${lane}.T1`,
  ]),
  "N.A.UJ", "N.B.UJ", "N.A.LJ", "N.B.LJ", "N.A.UC", "N.B.UC", "N.A.LC", "N.B.LC",
];

function requiredRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The canonical browser ${label} is missing or is not an object.`);
  }
  return value as JsonRecord;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The canonical browser ${label} is missing or is not a nonempty string.`);
  }
  return value;
}

async function compileScenarioInput(): Promise<void> {
  if (prebuiltScenarioDirectory) {
    const manifestPath = resolve(prebuiltScenarioDirectory, "manifest.json");
    if (!existsSync(snapshotPath) || !existsSync(manifestPath)) {
      throw new Error(`The prebuilt battlefield scenario artifact must contain canonical.json and manifest.json: ${prebuiltScenarioDirectory}`);
    }
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as JsonRecord;
    const fixtureSourceRevision = requiredString(manifest.sourceRevision, "fixture manifest source revision");
    const currentSourceRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    if (fixtureSourceRevision !== currentSourceRevision) {
      throw new Error(`The prebuilt canonical scenario is from ${fixtureSourceRevision}, not the checked out source ${currentSourceRevision}.`);
    }
    const files = requiredRecord(manifest.files, "fixture manifest files");
    const canonical = requiredRecord(files.canonical, "canonical fixture manifest entry");
    if (canonical.filename !== "canonical.json") throw new Error("The prebuilt canonical fixture manifest names an unexpected file.");
    const expectedSha256 = requiredString(canonical.sha256, "canonical fixture SHA-256");
    const actualSha256 = createHash("sha256").update(readFileSync(snapshotPath)).digest("hex");
    if (manifest.schema !== "senkei-battlefield-browser-scenario-fixtures/v1" || expectedSha256 !== actualSha256) {
      throw new Error("The prebuilt canonical scenario does not match its fixture manifest.");
    }
    return;
  }
  mkdirSync(dirname(snapshotPath), { recursive: true });
  execFileSync("cargo", [
    "test", "--locked", "--release", "-p", "enbu", "--test", "next_scenarios",
    "canonical_battlefield_real_jinrei_match_covers_tracks_fords_bridges_and_node_combat", "--", "--exact",
  ], {
    cwd: repoRoot,
    env: { ...process.env, BATTLEFIELD_SCENARIO_SNAPSHOT_PATH: snapshotPath },
    stdio: "inherit",
  });
}

async function runBattle(page: Page, snapshot: JsonRecord, width: number, height: number): Promise<JsonRecord> {
  const pageErrors: string[] = [];
  const wasmResponses: number[] = [];
  const snapshotDigest = await reproductionSnapshotDigest(snapshot as Parameters<typeof reproductionSnapshotDigest>[0]);
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.context().on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) wasmResponses.push(response.status());
  });
  await page.addInitScript(({ controlledSnapshot, controlledSnapshotDigest }: { controlledSnapshot: JsonRecord; controlledSnapshotDigest: string }) => {
    const NativeWorker = window.Worker;
    class CapturingWorker extends NativeWorker {
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        const request = message as { operation?: unknown; request_id?: unknown; payload?: Record<string, unknown> } | null;
        let outgoing = message;
        if (request?.operation === "simulate" || request?.operation === "reproduce") {
          const target = window as typeof window & { __canonicalRequest?: { request_id?: unknown }; __canonicalResponse?: unknown };
          const modified = structuredClone(request) as { operation?: unknown; request_id?: unknown; payload?: Record<string, unknown> };
          if (!modified.payload) throw new Error("canonical browser battle request has no payload");
          modified.payload.snapshot = structuredClone(controlledSnapshot);
          if (modified.operation === "reproduce") modified.payload.snapshot_digest = controlledSnapshotDigest;
          outgoing = modified;
          if (typeof modified.request_id !== "string" || modified.request_id.length === 0) {
            throw new Error("canonical browser battle request has no request ID");
          }
          target.__canonicalRequest = { request_id: modified.request_id };
        }
        if (transfer === undefined) super.postMessage(outgoing);
        else super.postMessage(outgoing, transfer as Transferable[]);
      }

      addEventListener<K extends keyof WorkerEventMap>(
        type: K,
        listener: (this: Worker, event: WorkerEventMap[K]) => unknown,
        options?: boolean | AddEventListenerOptions,
      ): void {
        if (type !== "message" || typeof listener !== "function") {
          super.addEventListener(type, listener as EventListener, options);
          return;
        }
        super.addEventListener(type, (event: Event) => {
          const data = (event as MessageEvent).data as { request_id?: unknown; operation?: unknown; ok?: unknown } | null;
          const target = window as typeof window & {
            __canonicalRequest?: { request_id?: unknown };
            __canonicalResponse?: unknown;
            __canonicalRulesetResponse?: unknown;
          };
          if (data?.operation === "next_ruleset" && data.ok === true) {
            target.__canonicalRulesetResponse = structuredClone(data);
          }
          if (data?.request_id !== undefined && data.request_id === target.__canonicalRequest?.request_id) {
            target.__canonicalResponse = structuredClone(data);
          }
          listener.call(this, event as WorkerEventMap[K]);
        }, options);
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: CapturingWorker });
  }, { controlledSnapshot: snapshot, controlledSnapshotDigest: snapshotDigest });

  await page.setViewportSize({ width, height });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByTestId("nav-next").click();
  await expect(page.getByRole("heading", { name: /Battle workbench|Battlefield console|Observe the battlefield/ })).toBeVisible();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.locator("#next-tab-battle").click();
  await page.getByRole("button", { name: /Launch local battle|New local battle/i }).click();
  await completePreflight(page);
  await expect(page.getByText(/AUTHORITATIVE ENBU RESULT|Confirmed result/i).first()).toBeVisible({ timeout: 120_000 });
  const canvas = page.locator(".next-renderer-host canvas");
  await expect(canvas).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
  await expect(canvas).toHaveAttribute("data-tick", "0");
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __canonicalResponse?: unknown }).__canonicalResponse))).toBe(true);
  const captured = await page.evaluate(() => {
    const current = window as typeof window & {
      __canonicalRequest?: unknown;
      __canonicalResponse?: unknown;
      __canonicalRulesetResponse?: unknown;
    };
    return { request: current.__canonicalRequest, response: current.__canonicalResponse, rulesetResponse: current.__canonicalRulesetResponse };
  });
  const modeControls = page.getByRole("group", { name: "Presentation mode", exact: true });
  const tacticalCamera = await canvas.getAttribute("data-camera");
  const cameraContext = await canvas.getAttribute("data-camera-mode");
  const fogNodes = await canvas.getAttribute("data-fog-nodes");
  await modeControls.getByRole("button", { name: "Cinematic", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-presentation-mode", "cinematic");
  await expect.poll(() => canvas.getAttribute("data-camera")).not.toBe(tacticalCamera);
  const cinematicCamera = await canvas.getAttribute("data-camera");
  await expect(canvas).toHaveAttribute("data-tick", "0");
  await expect(canvas).toHaveAttribute("data-camera-mode", cameraContext!);
  await expect(canvas).toHaveAttribute("data-fog", "authorized-graph-samples");
  await expect(canvas).toHaveAttribute("data-fog-nodes", fogNodes!);
  await page.screenshot({ path: join(evidenceDirectory, `${width > 700 ? "desktop" : "mobile"}-${width}x${height}-cinematic-t000.png`), animations: "disabled" });
  const visionLayer = page.getByRole("group", { name: "Information layers", exact: true }).getByRole("checkbox", { name: "Vision", exact: true });
  await visionLayer.uncheck();
  await expect.poll(async () => JSON.parse(await canvas.getAttribute("data-information-layers") ?? "{}").vision).toBe(false);
  await expect(canvas).toHaveAttribute("data-fog", "authorized-graph-samples");
  await expect(canvas).toHaveAttribute("data-fog-nodes", fogNodes!);
  await visionLayer.check();
  await modeControls.getByRole("button", { name: "Tactical", exact: true }).click();
  await expect(canvas).toHaveAttribute("data-presentation-mode", "tactical");
  await expect(canvas).toHaveAttribute("data-tick", "0");
  const responseAfterModes = await page.evaluate(() => (window as typeof window & { __canonicalResponse?: unknown }).__canonicalResponse);
  const responseDigest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  expect(responseDigest(responseAfterModes), "presentation and layer changes preserve the exact authorized Worker response").toBe(responseDigest(captured.response));
  const request = requiredRecord(captured.request, "Worker request identity");
  const requestId = requiredString(request.request_id, "Worker request ID");
  const response = requiredRecord(captured.response, "Worker response");
  if (response.ok !== true) throw new Error("The canonical browser Worker response did not succeed.");
  const responseRequestId = requiredString(response.request_id, "Worker response request ID");
  if (responseRequestId !== requestId) throw new Error("The canonical Worker response does not match its Enbu battle request.");
  expect(wasmResponses).toContain(200);

  const simulation = requiredRecord(response.result, "Worker simulation result");
  const rulesetResponse = requiredRecord(captured.rulesetResponse, "WASM Next ruleset response");
  if (rulesetResponse.operation !== "next_ruleset" || rulesetResponse.ok !== true) {
    throw new Error("The browser did not capture the actual Next ruleset from the production Worker.");
  }
  const ruleset = requiredRecord(rulesetResponse.result, "WASM Next ruleset");
  const outcome = requiredRecord(simulation.outcome, "simulation outcome");
  const result = requiredRecord(outcome.result, "Enbu result");
  const publicReplay = requiredRecord(outcome.presentation_replay, "public presentation replay");
  if (simulation.authorized_side !== "attacker") throw new Error("The owner response lacks explicit attacker authorization.");
  const ownerChannels = requiredRecord(simulation.owner_replays, "authorized owner channels");
  expect(Object.keys(ownerChannels)).toEqual(["attacker"]);
  const replay = requiredRecord(ownerChannels.attacker, "authorized owner replay");
  if (replay.perspective !== "attacker") throw new Error("The canonical owner replay is not the authorized attacker perspective.");
  const snapshotContext = requiredRecord(snapshot.context, "snapshot context");
  const snapshotRuleset = requiredRecord(snapshotContext.ruleset, "snapshot ruleset identity");
  const rulesetIdentity = requiredRecord(ruleset.ruleset, "WASM ruleset identity");
  expect(rulesetIdentity.digest).toBe(snapshotRuleset.digest);
  const snapshotMatchId = requiredString(snapshotContext.match_id, "snapshot match ID");
  if (result.match_id !== snapshotMatchId) throw new Error(`The canonical Enbu result match ID does not match snapshot ${snapshotMatchId}.`);
  expect(result.final_tick).toBeGreaterThanOrEqual(50);
  requiredString(result.final_state_digest, "final state digest");
  requiredString(publicReplay.result_digest, "public replay digest");
  if (replay.frames?.length !== result.final_tick + 1) throw new Error("The canonical owner replay is missing one or more tick frames.");
  if (publicReplay.frames?.length !== result.final_tick + 1) throw new Error("The canonical public replay is missing one or more tick frames.");
  const ownerEntitiesAt = (tick: number): JsonRecord[] => {
    const frame = replay!.frames.find((candidate: JsonRecord) => candidate.tick === tick);
    return Object.values(frame?.visible_state?.entities ?? {}) as JsonRecord[];
  };
  const ownerHeroAt = (tick: number, catalogId: string): JsonRecord | undefined => ownerEntitiesAt(tick).find((entity) =>
    entity.entity_type === "hero" && entity.fields?.catalog_id?.value === catalogId);
  const bridgeAt = (tick: number, lane: keyof typeof bridgeSiteIds = "TOP"): JsonRecord | undefined => ownerEntitiesAt(tick).find((entity) =>
    entity.entity_type === "bridge" && entity.fields?.site?.value === bridgeSiteIds[lane]);
  const fixedBridgeTransitFrame = replay!.frames.find((frame: JsonRecord) => {
    if (frame.tick <= 49) return false;
    const entities = Object.values(frame.visible_state?.entities ?? {}) as JsonRecord[];
    const bridge = entities.find((entity) => entity.entity_type === "bridge" && entity.fields?.site?.value === bridgeSiteIds.TOP);
    const hero = entities.find((entity) => entity.entity_type === "hero" && entity.fields?.catalog_id?.value === "R01");
    return bridge?.fields?.bridge_state?.value === "normal" &&
      hero?.fields?.node?.value === "A.TOP.BANK" && hero?.fields?.edge_to?.value === "B.TOP.BANK" &&
      hero?.fields?.edge_progress?.kind === "integer" && hero.fields.edge_progress.value > 0 &&
      hero?.fields?.track?.value === "CENTER";
  });
  expect(fixedBridgeTransitFrame, "R01 eventually enters the rebuilt TOP bridge on CENTER").toBeTruthy();
  const fixedBridgeTransitTick = fixedBridgeTransitFrame!.tick as number;
  expect(fixedBridgeTransitTick).toBeGreaterThan(49);
  expect(fixedBridgeTransitTick).toBeLessThanOrEqual(result.final_tick);
  const observation = ownerEntitiesAt(1).find((entity) =>
    entity.entity_type === "observation" && entity.fields?.node?.value === "N.MID.OBS");
  expect(observation, "the authorized replay contains the actual MID observation facility").toBeTruthy();
  expect(observation?.fields?.hp, "the authorized observation projection does not expose an HP field").toBeUndefined();
  const fordEntryFrame = replay!.frames.find((frame: JsonRecord) => ownerEntitiesAt(frame.tick).some((entity) =>
    entity.entity_type === "hero" && entity.fields?.catalog_id?.value === "F02" &&
    entity.fields?.ford_remaining?.kind === "integer" && entity.fields.ford_remaining.value > 0));
  expect(fordEntryFrame, "the real owner replay contains F02's canonical ford-entry delay").toBeTruthy();
  const fordEntryTick = fordEntryFrame!.tick as number;
  const fordEntryHero = ownerHeroAt(fordEntryTick, "F02");
  const nextRules = requiredRecord(ruleset.next, "Next rules");
  const map = requiredRecord(nextRules.map, "Next map");
  const edges = map.edges as JsonRecord[];
  const fordEdge = edges.find((edge) => edge.id === "edge-n-a-uj-n-b-uj" ||
    (edge.from === "N.A.UJ" && edge.to === "N.B.UJ") ||
    (edge.from === "N.B.UJ" && edge.to === "N.A.UJ"));
  expect(fordEdge, "the Worker ruleset identifies F02's canonical Jungle crossing edge").toBeTruthy();
  const edgeId = fordEdge!.id ?? "edge-n-a-uj-n-b-uj";
  const projection = requiredRecord(map.world_projection, "paired World projection");
  const edgeFacts = requiredRecord(projection.edge_facts, "paired World edge facts");
  const fordInterval = requiredRecord(requiredRecord(edgeFacts[edgeId], "Jungle edge facts").river_crossing, "Jungle crossing interval");
  expect(fordInterval.kind).toBe("foot_ford");
  expect(fordInterval.start_progress_wu).toBeLessThan(fordInterval.end_progress_wu);
  expect(fordEntryHero?.fields?.edge_progress?.value).toBe(fordInterval.start_progress_wu);
  expect(ownerHeroAt(1, "F03")?.fields?.edge_to?.value).toBe("A.MID.J");
  expect(ownerHeroAt(2, "F01")?.fields?.track?.value).toBe("LEFT");
  expect(ownerHeroAt(2, "F01")?.fields?.edge_to?.value).toBe("A.TOP.T2");
  expect(ownerHeroAt(3, "F01")?.fields?.cross_remaining?.value).toBeGreaterThan(0);
  expect(ownerHeroAt(5, "F01")?.fields?.track?.value).toBe("RIGHT");
  expect(ownerHeroAt(2, "R02")?.fields?.node?.value).toBe("A.MID.BANK");
  expect(ownerHeroAt(2, "R02")?.fields?.edge_to?.value ?? "").toBe("");
  expect(ownerHeroAt(fixedBridgeTransitTick, "R01")?.fields?.node?.value).toBe("A.TOP.BANK");
  expect(ownerHeroAt(fixedBridgeTransitTick, "R01")?.fields?.edge_to?.value).toBe("B.TOP.BANK");
  expect(ownerHeroAt(fixedBridgeTransitTick, "R01")?.fields?.track?.value).toBe("CENTER");
  expect(bridgeAt(0)?.fields?.bridge_state?.value).toBe("normal");
  expect(bridgeAt(13)?.fields?.bridge_state?.value).toBe("expanded");
  expect(bridgeAt(23)?.fields?.bridge_state?.value).toBe("destroyed");
  expect(bridgeAt(49)?.fields?.bridge_state?.value).toBe("normal");
  expect(bridgeAt(0, "MID")?.fields?.bridge_state?.value).toBe("normal");
  expect(bridgeAt(11, "MID")?.fields?.bridge_state?.value).toBe("destroyed");
  expect(JSON.stringify(publicReplay)).not.toContain("slot_id");
  expect(JSON.stringify(publicReplay)).not.toContain("goal");

  const mapToggle = page.getByRole("button", { name: "Toggle battlefield map context" });
  if (await mapToggle.getAttribute("aria-expanded") !== "true") await mapToggle.click();
  const nodeRows = page.getByTestId("battle-map-node");
  const nodeIds = await nodeRows.evaluateAll((nodes) => nodes.map((node) => (node as SVGElement).dataset.nodeId ?? ""));
  expect(nodeIds).toHaveLength(35);
  expect(new Set(nodeIds)).toEqual(new Set(expectedNodes));
  expect(await page.getByTestId("battle-map-route").count()).toBe(42);
  expect(await page.getByTestId("battle-map-river").count()).toBe(1);
  const bridgeRoutes = page.locator('[data-testid="battle-map-route"][data-bridge-site]');
  expect(await bridgeRoutes.count()).toBe(4);
  expect(await page.locator(`[data-bridge-site="${bridgeSiteIds.TOP}"]`).count()).toBe(1);
  expect(await page.locator(`[data-bridge-site="${bridgeSiteIds.MID}"]`).count()).toBe(2);
  expect(await page.locator(`[data-bridge-site="${bridgeSiteIds.BOT}"]`).count()).toBe(1);
  const bridgeRoles = (await bridgeRoutes.evaluateAll((routes) => routes.map((route) => {
    const element = route as SVGElement;
    return [element.dataset.bridgeSite, element.dataset.bridgeKind];
  }))).sort((left, right) => `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`));
  expect(bridgeRoles).toEqual([
    [bridgeSiteIds.TOP, "lane"],
    [bridgeSiteIds.MID, "facility"],
    [bridgeSiteIds.MID, "facility"],
    [bridgeSiteIds.BOT, "lane"],
  ].sort((left, right) => `${left[0]}:${left[1]}`.localeCompare(`${right[0]}:${right[1]}`)));
  expect(await page.locator('[data-testid="battle-map-route"][data-ford="true"]').count()).toBe(2);
  const observationLabel = page.locator(".entity-world-label").filter({ hasText: /^MID OBSERVATION/ });
  await expect(observationLabel).toHaveCount(1);
  await expect(observationLabel).not.toContainText(/HP\s+1\/1|·\s*1\/1/);

  const routeStateAt = async (tick: number, lane: keyof typeof bridgeSiteIds = "TOP"): Promise<string> => {
    const slider = page.getByRole("slider", { name: "Seek replay tick" });
    await slider.evaluate((element, targetTick) => {
      const input = element as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(targetTick));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, tick);
    await expect(slider).toHaveValue(String(tick));
    await expect(canvas).toHaveAttribute("data-tick", String(tick));
    return await page.locator(`[data-testid="battle-map-route"][data-bridge-site="${bridgeSiteIds[lane]}"]`).first().getAttribute("data-bridge-state") ?? "";
  };
  expect(await routeStateAt(3)).toBe("normal");
  if (width > 700) {
    await page.screenshot({ path: join(evidenceDirectory, "desktop-track-crossing.png"), animations: "disabled" });
  } else {
    await page.screenshot({ path: join(evidenceDirectory, "mobile-track-crossing.png"), animations: "disabled" });
  }
  expect(await routeStateAt(0, "MID")).toBe("normal");
  expect(await routeStateAt(11, "MID")).toBe("destroyed");
  expect(await routeStateAt(0)).toBe("normal");
  expect(await routeStateAt(13)).toBe("expanded");
  expect(await routeStateAt(23)).toBe("destroyed");
  if (width > 700) {
    await page.getByRole("button", { name: "Overview view" }).click();
    await page.screenshot({ path: join(evidenceDirectory, `desktop-${width}x${height}-bridge-destroyed.png`), animations: "disabled" });
  } else {
    await page.getByRole("button", { name: "Timeline view" }).click();
    await page.screenshot({ path: join(evidenceDirectory, `mobile-${width}x${height}-bridge-destroyed.png`), animations: "disabled" });
  }
  expect(await routeStateAt(49)).toBe("normal");
  expect(await routeStateAt(fixedBridgeTransitTick)).toBe("normal");

  if (width > 700) {
    await page.screenshot({ path: join(evidenceDirectory, `desktop-${width}x${height}-bridge-transit.png`), animations: "disabled" });
    await page.getByTestId("battle-visible-roster-toggle").click();
    const roster = page.getByTestId("battle-visible-roster");
    await expect(roster).toBeVisible();
    const observer = page.getByLabel("Observe visible entity");
    const heroLabel = (await observer.locator("option").allTextContents()).find((label) => label.includes("F01"));
    expect(heroLabel, "the replay exposes an actual visible F01 Hero").toBeTruthy();
    await observer.selectOption({ label: heroLabel! });
    await expect(page.locator(".next-detail-card").filter({ hasText: "VISIBLE STATE" })).toContainText("F01");
  } else {
    await expect(page.getByTestId("battle-mobile-console")).toBeVisible();
    await page.getByRole("button", { name: "Details view" }).click();
    await expect(page.locator(".next-detail-card").filter({ hasText: "VISIBLE STATE" })).toBeVisible();
    await page.getByRole("button", { name: "Battle view" }).click();
    await expect(canvas).toBeVisible();
    await page.screenshot({ path: join(evidenceDirectory, `mobile-${width}x${height}-bridge-transit.png`), animations: "disabled" });
  }
  expect(pageErrors).toEqual([]);
  return {
    result,
    publicReplay,
    ownerReplay: replay,
    frameCount: publicReplay.frames.length,
    fixedBridgeTransitTick,
    fordEntryTick,
    fordInterval,
    fordEntryProgressWu: fordEntryHero?.fields?.edge_progress?.value,
    bridgeRoles,
    presentationModes: { tacticalCamera, cinematicCamera, cameraContext, tick: 0, authorizedResponseUnchanged: true, fogUnchanged: true },
    wasmStatuses: wasmResponses,
    buildRevision: await page.locator('meta[name="senkei-build-revision"]').getAttribute("content") };
}

test("real Enbu Battlefield replay is readable on desktop and mobile", async ({ page, browser }) => {
  test.setTimeout(240_000);
  mkdirSync(evidenceDirectory, { recursive: true });
  await compileScenarioInput();
  const snapshot = JSON.parse(readFileSync(snapshotPath, "utf8")) as JsonRecord;
  expect(snapshot.attacker.program).toBeTruthy();
  expect(snapshot.defender.program).toBeTruthy();
  const desktop = await runBattle(page, snapshot, 1440, 900);
  expect(desktop.result.final_state_digest).toBeTruthy();
  expect(desktop.frameCount).toBeGreaterThan(24);
  const mobilePage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  try {
    const mobile = await runBattle(mobilePage, snapshot, 390, 844);
    expect(mobile.result.final_state_digest).toBe(desktop.result.final_state_digest);
    expect(mobile.fordEntryTick).toBe(desktop.fordEntryTick);
    expect(mobile.fordInterval).toEqual(desktop.fordInterval);
    expect(mobile.bridgeRoles).toEqual(desktop.bridgeRoles);
    expect(mobile.publicReplay).toEqual(desktop.publicReplay);
    expect(mobile.ownerReplay).toEqual(desktop.ownerReplay);
    const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
    writeFileSync(join(evidenceDirectory, "metadata.json"), JSON.stringify({
      evidenceKind: "compiled real Jinrei executed by desktop and mobile browser WASM",
      sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim(),
      buildRevision: desktop.buildRevision, inputSha256: digest(snapshot),
      ruleset: snapshot.context.ruleset, engineVersion: snapshot.context.versions.engine,
      result: desktop.result, publicReplaySha256: digest(desktop.publicReplay), ownerReplaySha256: digest(desktop.ownerReplay),
      fullDesktopMobileReplayEquality: true,
      presentationModes: { desktop: desktop.presentationModes, mobile: mobile.presentationModes },
      viewports: [{ width: 1440, height: 900 }, { width: 390, height: 844 }],
      wasmStatuses: [...desktop.wasmStatuses, ...mobile.wasmStatuses],
      bridgeRoutes: desktop.bridgeRoles,
      fordEntry: {
        tick: desktop.fordEntryTick,
        edgeId: desktop.fordInterval.edgeId,
        sourceWorldStartProgressWu: desktop.fordInterval.start_progress_wu,
        sourceWorldEndProgressWu: desktop.fordInterval.end_progress_wu,
        observedEntityProgressWu: desktop.fordEntryProgressWu,
      },
      ticks: { lateralCrossing: 3, midDestroyed: 11, topExpanded: 13, topDestroyed: 23,
        fordEntry: desktop.fordEntryTick, topRebuilt: 49, bridgeTransit: desktop.fixedBridgeTransitTick },
      renderer: "Chromium with SwiftShader; hardware GPU and physical touch not checked",
    }, null, 2) + "\n");
  } finally {
    await mobilePage.close();
  }
});
