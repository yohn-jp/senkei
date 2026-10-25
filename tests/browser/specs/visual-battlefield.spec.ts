import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";

type JsonRecord = Record<string, any>;
type Viewport = { readonly name: string; readonly width: number; readonly height: number };
type ReplayRun = {
  readonly request: JsonRecord;
  readonly response: JsonRecord;
  readonly result: JsonRecord;
  readonly publicReplay: JsonRecord;
  readonly ownerReplay: JsonRecord;
  readonly sourceReplay: JsonRecord;
  readonly wasmResponses: readonly { status: number; url: string }[];
  readonly pageErrors: readonly string[];
  readonly buildRevision: string | null;
};
type CaptureEntry = {
  readonly evidenceKind: string;
  readonly sourceRevision: string;
  readonly buildRevision: string | null;
  readonly scenario: string;
  readonly state: string;
  readonly tick: number;
  readonly viewport: { width: number; height: number };
  readonly requestedView: "Tactical" | "Overview" | "Follow";
  readonly camera: {
    readonly mode: string | null;
    readonly pose: string | null;
    readonly target: string | null;
    readonly tracking: string | null;
  };
  readonly renderer: { readonly pixel3d: boolean | null; readonly rendered: string | null };
  readonly replay: {
    readonly matchId: string | null;
    readonly finalStateDigest: string | null;
    readonly publicReplayDigest: string | null;
    readonly ownerReplayDigest: string | null;
  };
  readonly facts: JsonRecord;
  readonly image: { readonly path: string; readonly sha256: string };
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const canonicalSnapshotPath = resolve(repoRoot, "target/next-balance/visual-battlefield-canonical-snapshot.json");
const captureSnapshotPath = resolve(repoRoot, "target/next-balance/visual-battlefield-capture-snapshot.json");
const viewports: readonly Viewport[] = [
  { name: "1440x900", width: 1440, height: 900 },
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "390x844", width: 390, height: 844 },
  { name: "430x932", width: 430, height: 932 },
  { name: "320x740", width: 320, height: 740 },
];
const beforeCommit = "6fa8296de8c3f85a50b064012f5a0bf3b891600e";
const beforeImages = {
  desktop: `https://github.com/yohn-jp/senkei/blob/${beforeCommit}/docs/evidence/battlefield/canonical-browser/desktop-1440x900-bridge-destroyed.png`,
  mobile: `https://github.com/yohn-jp/senkei/blob/${beforeCommit}/docs/evidence/battlefield/canonical-default/mobile-390x844-t016.png`,
} as const;
const outputRoot = resolve(process.env.BATTLEFIELD_VISUAL_OUTPUT_DIR ?? join(repoRoot, "docs/evidence/battlefield/visual-acceptance"));
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-pid${process.pid}`;
const outputDirectory = join(outputRoot, runId);
let activeSourceRevision: string | null = null;
const evidenceKind = "real-ui-jinrei-enbu-wasm-authorized-presentation-replay";

const canonicalStates = [
  { id: "initial", tick: 0 },
  { id: "node-fight", tick: 1 },
  { id: "lane-crossing", tick: 3 },
  { id: "mid-bridge-destroyed", tick: 11 },
  { id: "top-bridge-expanded", tick: 13 },
  { id: "top-bridge-destroyed", tick: 23 },
  { id: "ford-transit", tick: 24 },
  { id: "top-bridge-rebuilt", tick: 49 },
  { id: "fixed-bridge-transit", tick: 50 },
  { id: "draw-end", tick: 70 },
] as const;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function frameAt(replay: JsonRecord, tick: number): JsonRecord {
  const frame = replay.frames?.find((candidate: JsonRecord) => candidate.tick === tick);
  if (!frame) throw new Error(`Replay is missing tick ${tick}.`);
  return frame;
}

function field(entity: JsonRecord | undefined, key: string): unknown {
  const value = entity?.fields?.[key];
  return value && typeof value === "object" && "value" in value ? value.value : undefined;
}

function integerField(entity: JsonRecord | undefined, key: string): number | null {
  const value = entity?.fields?.[key];
  return value?.kind === "integer" && Number.isSafeInteger(value.value) ? value.value : null;
}

function entitiesAt(replay: JsonRecord, tick: number): [string, JsonRecord][] {
  return Object.entries(frameAt(replay, tick).visible_state?.entities ?? {}) as [string, JsonRecord][];
}

function bridgeAt(replay: JsonRecord, tick: number, site: string): JsonRecord | undefined {
  return entitiesAt(replay, tick).map(([, entity]) => entity).find((entity) =>
    entity.entity_type === "bridge" && field(entity, "site") === site,
  );
}

function observationAt(replay: JsonRecord, tick: number): JsonRecord | undefined {
  return entitiesAt(replay, tick).map(([, entity]) => entity).find((entity) =>
    entity.entity_type === "observation" && field(entity, "node") === "N.MID.OBS",
  );
}

function heroAt(replay: JsonRecord, tick: number, catalogId: string): JsonRecord | undefined {
  return entitiesAt(replay, tick).map(([, entity]) => entity).find((entity) =>
    entity.entity_type === "hero" && field(entity, "catalog_id") === catalogId,
  );
}

function findFollowHero(replay: JsonRecord, tick: number, requestedCatalogId?: string): { id: string; catalogId: string; entityType: string } {
  const heroes = entitiesAt(replay, tick)
    .filter(([, entity]) => entity.entity_type === "hero"
      && integerField(entity, "hp") !== null
      && integerField(entity, "hp")! > 0
      && (requestedCatalogId === undefined || field(entity, "catalog_id") === requestedCatalogId))
    .sort(([, left], [, right]) => String(field(left, "catalog_id")).localeCompare(String(field(right, "catalog_id"))));
  const first = heroes[0];
  if (!first) {
    const requested = requestedCatalogId ? ` (${requestedCatalogId})` : "";
    throw new Error(`No living, replay-visible Hero${requested} is available to follow at tick ${tick}.`);
  }
  const [id, entity] = first;
  const catalogId = field(entity, "catalog_id");
  if (typeof catalogId !== "string") throw new Error(`The selected replay Hero has no catalog identity at tick ${tick}.`);
  return { id, catalogId, entityType: "hero" };
}

async function createScenarioSnapshots(): Promise<void> {
  mkdirSync(dirname(canonicalSnapshotPath), { recursive: true });
  execFileSync("cargo", [
    "test", "--locked", "--release", "-p", "enbu", "--test", "next_scenarios",
    "canonical_battlefield_real_jinrei_match_covers_tracks_fords_bridges_and_node_combat", "--", "--exact",
  ], {
    cwd: repoRoot,
    env: { ...process.env, BATTLEFIELD_SCENARIO_SNAPSHOT_PATH: canonicalSnapshotPath },
    stdio: "inherit",
  });
  execFileSync("cargo", [
    "test", "--locked", "--release", "-p", "enbu", "--test", "next_scenarios",
    "real_jinrei_enbu_capture_match_exports_visual_snapshot", "--", "--exact",
  ], {
    cwd: repoRoot,
    env: { ...process.env, BATTLEFIELD_CAPTURE_SCENARIO_SNAPSHOT_PATH: captureSnapshotPath },
    stdio: "inherit",
  });
}

async function launchBattle(page: Page, baseURL: string, controlledSnapshot?: JsonRecord): Promise<ReplayRun> {
  const pageErrors: string[] = [];
  const wasmResponses: { status: number; url: string }[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.context().on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) {
      wasmResponses.push({ status: response.status(), url: response.url() });
    }
  });
  await page.addInitScript((snapshot: JsonRecord | null) => {
    const NativeWorker = window.Worker;
    class CapturingWorker extends NativeWorker {
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        const request = message as { operation?: unknown; request_id?: unknown; payload?: Record<string, unknown> } | null;
        let outgoing = message;
        if (request?.operation === "simulate") {
          const target = window as typeof window & { __visualRequest?: unknown; __visualResponse?: unknown };
          if (snapshot) {
            const modified = structuredClone(message) as { payload?: Record<string, unknown> };
            if (!modified.payload) throw new Error("Visual scenario simulation has no payload.");
            modified.payload.snapshot = structuredClone(snapshot);
            outgoing = modified;
          }
          target.__visualRequest = structuredClone(outgoing);
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
          const data = (event as MessageEvent).data as { request_id?: unknown } | null;
          const target = window as typeof window & {
            __visualRequest?: { request_id?: unknown };
            __visualResponse?: unknown;
          };
          if (data?.request_id !== undefined && data.request_id === target.__visualRequest?.request_id) {
            target.__visualResponse = structuredClone(data);
          }
          listener.call(this, event as WorkerEventMap[K]);
        }, options);
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: CapturingWorker });
  }, controlledSnapshot ?? null);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByTestId("nav-next").click();
  await expect(page.getByRole("heading", { name: /Battle workbench|Battlefield console|Observe the battlefield/ })).toBeVisible();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.locator("#next-tab-battle").click();
  const launch = page.getByRole("button", { name: /Launch local battle|New local battle/i });
  await expect(launch).toBeEnabled();
  await launch.click();
  await expect(page.getByText(/Confirmed result/i)).toContainText(/Attacker Victory|Defender Victory|Draw/, { timeout: 180_000 });
  const canvas = page.locator(".next-renderer-host canvas");
  await expect(canvas).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __visualResponse?: unknown }).__visualResponse))).toBe(true);
  const captured = await page.evaluate(() => {
    const current = window as typeof window & { __visualRequest?: JsonRecord; __visualResponse?: JsonRecord };
    return { request: current.__visualRequest ?? null, response: current.__visualResponse ?? null };
  });
  expect(captured.request?.operation, "the local UI issued a real Enbu simulation").toBe("simulate");
  expect(captured.response?.ok, "the real Worker/WASM response succeeded").toBe(true);
  expect(captured.response?.request_id).toBe(captured.request?.request_id);
  expect(wasmResponses.some((response) => response.status === 200), "the browser loaded the actual WASM binary").toBe(true);
  const simulation = captured.response.result as JsonRecord;
  const result = simulation.outcome.result as JsonRecord;
  const publicReplay = simulation.outcome.presentation_replay as JsonRecord;
  const ownerReplay = simulation.owner_replay as JsonRecord | undefined;
  expect(ownerReplay?.perspective).toBe("attacker");
  expect(ownerReplay?.frames.length).toBe(result.final_tick + 1);
  expect(publicReplay.frames.length).toBe(result.final_tick + 1);
  expect(result.match_id).toBe(captured.request.payload.snapshot.context.match_id);
  expect(result.final_state_digest).toBeTruthy();
  expect(pageErrors).toEqual([]);
  return {
    request: captured.request,
    response: simulation,
    result,
    publicReplay,
    ownerReplay: ownerReplay!,
    sourceReplay: ownerReplay ?? publicReplay,
    wasmResponses,
    pageErrors,
    buildRevision: await page.locator('meta[name="senkei-build-revision"]').getAttribute("content"),
  };
}

async function seekToTick(page: Page, tick: number): Promise<void> {
  const slider = page.getByRole("slider", { name: "Seek replay tick" });
  await slider.evaluate((element, targetTick) => {
    const input = element as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(targetTick));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, tick);
  await expect(slider).toHaveValue(String(tick));
  await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-tick", String(tick));
}

async function waitForSettledCamera(page: Page): Promise<void> {
  await page.waitForTimeout(350);
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".next-renderer-host canvas");
    const pose = canvas?.getAttribute("data-camera");
    if (!pose) return false;
    const tracker = window as typeof window & { __visualLastCameraPose?: string; __visualStableFrames?: number };
    tracker.__visualStableFrames = tracker.__visualLastCameraPose === pose
      ? (tracker.__visualStableFrames ?? 0) + 1
      : 0;
    tracker.__visualLastCameraPose = pose;
    return (tracker.__visualStableFrames ?? 0) >= 8;
  }, null, { timeout: 8_000 });
}

async function setView(page: Page, viewport: Viewport, view: "Tactical" | "Overview"): Promise<void> {
  const mobile = viewport.width <= 760;
  const label = view === "Overview" ? "Overview view" : mobile ? "Battle view" : "Tactical view";
  await page.getByRole("button", { name: label }).click();
  const expected = view === "Overview" ? "overview" : "tactical";
  await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-camera-mode", expected);
  await waitForSettledCamera(page);
}

async function followHero(page: Page, viewport: Viewport, replay: JsonRecord, tick: number, requestedCatalogId?: string): Promise<JsonRecord> {
  const target = findFollowHero(replay, tick, requestedCatalogId);
  await seekToTick(page, tick);
  const canvas = page.locator(".next-renderer-host canvas");
  if (viewport.width <= 760) {
    await page.getByRole("button", { name: "Follow view" }).click();
    const clusters = page.locator(".next-follow-sheet .next-visible-cluster");
    let followed = false;
    for (let index = 0; index < await clusters.count(); index += 1) {
      const cluster = clusters.nth(index);
      const toggle = cluster.locator(".next-visible-cluster-toggle");
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      const buttons = cluster.locator(".next-visible-entity-actions button[aria-label^='Follow ']");
      for (let action = 0; action < await buttons.count(); action += 1) {
        const label = await buttons.nth(action).getAttribute("aria-label");
        if (label?.startsWith(`Follow ${target.catalogId} `)) {
          await buttons.nth(action).click();
          followed = true;
          break;
        }
      }
      if (followed) break;
    }
    expect(followed, `the actual mobile Follow sheet contains ${target.catalogId}`).toBe(true);
  } else {
    await page.getByRole("combobox", { name: "Observe visible entity" }).selectOption(target.id);
    await page.getByRole("button", { name: "Follow selected unit" }).click();
  }
  await expect(canvas).toHaveAttribute("data-tracking", target.id);
  await waitForSettledCamera(page);
  return target;
}

async function assertMapContract(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Toggle battlefield map context" });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  const nodes = page.getByTestId("battle-map-node");
  const nodeIds = await nodes.evaluateAll((elements) => elements.map((element) => (element as SVGElement).dataset.nodeId ?? ""));
  expect(nodeIds).toHaveLength(35);
  expect(new Set(nodeIds).size).toBe(35);
  expect(await page.getByTestId("battle-map-route").count()).toBe(42);
  expect(await page.getByTestId("battle-map-river").count()).toBe(1);
  expect(await page.locator('[data-testid="battle-map-route"][data-bridge-site]').count()).toBe(4);
  expect(await page.locator('[data-testid="battle-map-route"][data-ford="true"]').count()).toBe(2);
  expect(nodeIds).toContain("N.MID.OBS");
  await toggle.click();
}

async function assertBridgeRoute(page: Page, tick: number, site: string, state: string): Promise<void> {
  await seekToTick(page, tick);
  const toggle = page.getByRole("button", { name: "Toggle battlefield map context" });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await expect(page.locator(`[data-testid="battle-map-route"][data-bridge-site="${site}"]`).first())
    .toHaveAttribute("data-bridge-state", state);
  await toggle.click();
}

async function ensureViewport(page: Page, viewport: Viewport): Promise<void> {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
  const layout = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(layout.width, `${viewport.name} has no horizontal overflow`).toBeLessThanOrEqual(layout.viewport);
  await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-rendered", "true");
}

async function saveCapture(
  page: Page,
  scenario: string,
  state: string,
  tick: number,
  viewport: Viewport,
  requestedView: CaptureEntry["requestedView"],
  facts: JsonRecord,
  captures: CaptureEntry[],
): Promise<void> {
  const canvas = page.locator(".next-renderer-host canvas");
  await expect(canvas).toHaveAttribute("data-tick", String(tick));
  await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
  if (!activeSourceRevision) throw new Error("The visual capture source revision has not been pinned.");
  const replay = await page.evaluate(() => {
    const current = window as typeof window & { __visualResponse?: JsonRecord };
    const simulation = current.__visualResponse?.result as JsonRecord | undefined;
    const outcome = simulation?.outcome as JsonRecord | undefined;
    const result = outcome?.result as JsonRecord | undefined;
    return {
      matchId: typeof result?.match_id === "string" ? result.match_id : null,
      finalStateDigest: typeof result?.final_state_digest === "string" ? result.final_state_digest : null,
      publicReplayDigest: typeof outcome?.presentation_replay?.result_digest === "string" ? outcome.presentation_replay.result_digest : null,
      ownerReplayDigest: typeof simulation?.owner_replay?.result_digest === "string" ? simulation.owner_replay.result_digest : null,
    };
  });
  expect(replay.matchId, "each screenshot is bound to the real Worker match").toBeTruthy();
  expect(replay.finalStateDigest, "each screenshot is bound to the confirmed Enbu result").toBeTruthy();
  const filename = `${state}-t${String(tick).padStart(3, "0")}-${requestedView.toLowerCase()}.png`;
  const screenshotPath = join(outputDirectory, scenario, viewport.name, filename);
  mkdirSync(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, animations: "disabled" });
  const pixelToggle = page.getByRole("button", { name: "Toggle Pixel 3D" });
  const pressed = await pixelToggle.getAttribute("aria-pressed");
  captures.push({
    evidenceKind,
    sourceRevision: activeSourceRevision,
    buildRevision: await page.locator('meta[name="senkei-build-revision"]').getAttribute("content"),
    scenario,
    state,
    tick,
    viewport: { width: viewport.width, height: viewport.height },
    requestedView,
    camera: {
      mode: await canvas.getAttribute("data-camera-mode"),
      pose: await canvas.getAttribute("data-camera"),
      target: await canvas.getAttribute("data-camera-target"),
      tracking: await canvas.getAttribute("data-tracking"),
    },
    renderer: {
      pixel3d: pressed === null ? null : pressed === "true",
      rendered: await canvas.getAttribute("data-rendered"),
    },
    replay,
    facts,
    image: {
      path: relative(repoRoot, screenshotPath).replaceAll("\\", "/"),
      sha256: sha256(readFileSync(screenshotPath)),
    },
  });
}

function saveGzip(name: string, value: unknown): { path: string; uncompressedBytes: number; compressedBytes: number; sha256: string } {
  const data = Buffer.from(JSON.stringify(value));
  const compressed = gzipSync(data, { level: 9 });
  const path = join(outputDirectory, name);
  writeFileSync(path, compressed);
  return { path: relative(repoRoot, path).replaceAll("\\", "/"), uncompressedBytes: data.length, compressedBytes: compressed.length, sha256: sha256(data) };
}

test("captures real Jinrei–Enbu–WASM Battlefield visual states across desktop and mobile", async ({ page, browser, baseURL }) => {
  test.setTimeout(900_000);
  if (!baseURL) throw new Error("The visual acceptance capture requires the production preview URL.");
  const appRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  activeSourceRevision = appRevision;
  mkdirSync(outputDirectory, { recursive: true });
  await createScenarioSnapshots();
  const canonicalSnapshot = JSON.parse(readFileSync(canonicalSnapshotPath, "utf8")) as JsonRecord;
  const captureSnapshot = JSON.parse(readFileSync(captureSnapshotPath, "utf8")) as JsonRecord;
  const captures: CaptureEntry[] = [];
  const viewportChecks: JsonRecord = {};

  const canonical = await launchBattle(page, baseURL, canonicalSnapshot);
  expect(canonical.result.final_tick).toBe(70);
  expect(canonical.result.outcome).toBe("draw");
  expect(frameAt(canonical.publicReplay, 1).events.some((event: JsonRecord) => event.event === "next.attack"),
    "the actual tick-1 node encounter produces a confirmed Enbu attack").toBe(true);
  expect(field(bridgeAt(canonical.ownerReplay, 0, "TOP"), "bridge_state")).toBe("normal");
  expect(field(bridgeAt(canonical.ownerReplay, 13, "TOP"), "bridge_state")).toBe("expanded");
  expect(field(bridgeAt(canonical.ownerReplay, 23, "TOP"), "bridge_state")).toBe("destroyed");
  expect(field(bridgeAt(canonical.ownerReplay, 49, "TOP"), "bridge_state")).toBe("normal");
  expect(field(bridgeAt(canonical.ownerReplay, 11, "MID"), "bridge_state")).toBe("destroyed");
  expect(integerField(heroAt(canonical.ownerReplay, 3, "F01"), "cross_remaining")).toBeGreaterThan(0);
  expect(field(heroAt(canonical.ownerReplay, 5, "F01"), "track")).toBe("RIGHT");
  expect(integerField(heroAt(canonical.ownerReplay, 24, "F02"), "ford_remaining")).toBeGreaterThan(0);
  expect(field(heroAt(canonical.ownerReplay, 50, "R01"), "edge_to")).toBe("B.TOP.BANK");

  await assertMapContract(page);
  for (const [tick, site, state] of [
    [0, "TOP", "normal"], [11, "MID", "destroyed"], [13, "TOP", "expanded"],
    [23, "TOP", "destroyed"], [49, "TOP", "normal"],
  ] as const) await assertBridgeRoute(page, tick, site, state);

  for (const viewport of viewports) {
    await ensureViewport(page, viewport);
    await setView(page, viewport, "Tactical");
    const tacticalStates = viewport.name === "1440x900"
      ? canonicalStates
      : viewport.name === "1920x1080"
        ? canonicalStates.filter(({ id }) => ["initial", "node-fight", "lane-crossing", "top-bridge-expanded", "top-bridge-destroyed", "ford-transit", "draw-end"].includes(id))
        : canonicalStates.filter(({ id }) => ["initial", "lane-crossing", "top-bridge-destroyed", "ford-transit", "draw-end"].includes(id));
    for (const state of tacticalStates) {
      await setView(page, viewport, "Tactical");
      await seekToTick(page, state.tick);
      await saveCapture(page, "canonical-real-battle", state.id, state.tick, viewport, "Tactical", {
        outcome: canonical.result.outcome,
        finalTick: canonical.result.final_tick,
        topBridge: field(bridgeAt(canonical.ownerReplay, state.tick, "TOP"), "bridge_state") ?? "unobserved",
        midBridge: field(bridgeAt(canonical.ownerReplay, state.tick, "MID"), "bridge_state") ?? "unobserved",
        lateralTrack: field(heroAt(canonical.ownerReplay, state.tick, "F01"), "track") ?? "unobserved",
        crossRemaining: integerField(heroAt(canonical.ownerReplay, state.tick, "F01"), "cross_remaining"),
        fordRemaining: integerField(heroAt(canonical.ownerReplay, state.tick, "F02"), "ford_remaining"),
        confirmedAttackEvent: frameAt(canonical.publicReplay, state.tick).events.some((event: JsonRecord) => event.event === "next.attack"),
      }, captures);
    }

    const overviewTicks = viewport.width > 700 ? [0, 23, 70] : [0, 23];
    for (const tick of overviewTicks) {
      await setView(page, viewport, "Overview");
      await seekToTick(page, tick);
      await saveCapture(page, "canonical-real-battle", tick === 0 ? "world-overview" : tick === 70 ? "draw-end" : "destroyed-bridge-overview", tick, viewport, "Overview", {
        outcome: canonical.result.outcome,
        topBridge: field(bridgeAt(canonical.ownerReplay, tick, "TOP"), "bridge_state") ?? "unobserved",
      }, captures);
    }

    if (viewport.width > 700 || viewport.name === "390x844" || viewport.name === "320x740") {
      await setView(page, viewport, "Tactical");
      const followTarget = await followHero(page, viewport, canonical.ownerReplay, 50, "R01");
      await saveCapture(page, "canonical-real-battle", "bridge-crossing-follow", 50, viewport, "Follow", {
        entityType: followTarget.entityType,
        catalogId: followTarget.catalogId,
        replayEntityId: followTarget.id,
        bridge: "rebuilt TOP fixed crossing",
      }, captures);
    }

    if (viewport.width <= 760) {
      await seekToTick(page, 3);
      await page.getByRole("button", { name: "Battle view" }).click();
      await waitForSettledCamera(page);
      const startCamera = await page.locator(".next-renderer-host canvas").getAttribute("data-camera");
      await page.getByRole("button", { name: "Follow view" }).click();
      const clusters = page.locator(".next-follow-sheet .next-visible-cluster");
      const target = findFollowHero(canonical.ownerReplay, 3);
      let selected = false;
      for (let index = 0; index < await clusters.count(); index += 1) {
        const cluster = clusters.nth(index);
        const toggle = cluster.locator(".next-visible-cluster-toggle");
        if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
        const buttons = cluster.locator(".next-visible-entity-actions button[aria-label^='Select ']");
        for (let action = 0; action < await buttons.count(); action += 1) {
          const label = await buttons.nth(action).getAttribute("aria-label");
          if (label?.startsWith(`Select ${target.catalogId} `)) {
            await buttons.nth(action).click();
            selected = true;
            break;
          }
        }
        if (selected) break;
      }
      expect(selected, `mobile details can select the real ${target.catalogId} Hero`).toBe(true);
      const detail = page.locator(".next-detail-card").filter({ hasText: "VISIBLE STATE" });
      await expect(detail).toBeVisible();
      await expect(page.locator('[data-testid="logical-detail-field"][data-field="cross_remaining"]')).toHaveCount(1);
      await saveCapture(page, "canonical-real-battle", "lane-crossing-details", 3, viewport, "Tactical", {
        selectedHero: target.catalogId,
        crossRemaining: integerField(heroAt(canonical.ownerReplay, 3, target.catalogId), "cross_remaining"),
        operation: "mobile Follow sheet → select Hero → Details sheet",
      }, captures);
      await page.getByRole("button", { name: "Close details sheet" }).click();
      await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-tick", "3");
      await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-camera", startCamera!);
      await seekToTick(page, 1);
      await page.getByRole("button", { name: "Timeline view" }).click();
      await expect(page.locator(".next-mobile-timeline")).toBeVisible();
      await expect(page.locator(".next-mobile-timeline .next-timeline")).toBeVisible();
      await saveCapture(page, "canonical-real-battle", "node-attack-timeline", 1, viewport, "Tactical", {
        operation: "Timeline sheet opened from the replay controls",
        confirmedAttackEvent: true,
      }, captures);
      await page.getByRole("button", { name: "Battle view" }).click();
      await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-tick", "1");
    }

    if (viewport.name === "1440x900") {
      await setView(page, viewport, "Tactical");
      await seekToTick(page, 3);
      const pixelToggle = page.getByRole("button", { name: "Toggle Pixel 3D" });
      const initialPressed = await pixelToggle.getAttribute("aria-pressed");
      expect(initialPressed, "the capture begins in the intended Pixel 3D mode").toBe("true");
      await pixelToggle.click();
      await expect(pixelToggle).toHaveAttribute("aria-pressed", "false");
      await saveCapture(page, "canonical-real-battle", "lane-crossing-smooth-toggle", 3, viewport, "Tactical", { pixel3d: false }, captures);
      await pixelToggle.click();
      await expect(pixelToggle).toHaveAttribute("aria-pressed", "true");
      await saveCapture(page, "canonical-real-battle", "lane-crossing-pixel-toggle", 3, viewport, "Tactical", { pixel3d: true }, captures);

      const slider = page.getByRole("slider", { name: "Seek replay tick" });
      await slider.focus();
      await slider.press("Home");
      await page.getByRole("button", { name: "Play replay", exact: true }).click();
      await expect.poll(async () => Number(await slider.inputValue()), { timeout: 10_000 }).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Pause replay", exact: true }).click();
      const pausedTick = await slider.inputValue();
      await page.waitForTimeout(200);
      await expect(slider).toHaveValue(pausedTick);
      await seekToTick(page, 3);
    }

    const stage = await page.locator(".next-renderer-host").boundingBox();
    const replayControls = await page.locator(".next-replay-controls").boundingBox();
    viewportChecks[viewport.name] = {
      viewport: { width: viewport.width, height: viewport.height },
      document: await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })),
      stage,
      replayControls,
      mobileConsole: viewport.width <= 760 ? await page.getByTestId("battle-mobile-console").isVisible() : null,
    };
  }

  const capturePage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let captureRun: ReplayRun;
  try {
    captureRun = await launchBattle(capturePage, baseURL, captureSnapshot);
    expect(captureRun.result.final_tick).toBe(16);
    expect(integerField(observationAt(captureRun.ownerReplay, 1), "capture_progress")).toBe(1);
    expect(integerField(observationAt(captureRun.ownerReplay, 7), "capture_progress")).toBe(7);
    expect(field(observationAt(captureRun.ownerReplay, 8), "capture_owner")).toBe("attacker");
    expect(frameAt(captureRun.publicReplay, 8).events.some((event: JsonRecord) => event.event === "next.observation_capture")).toBe(true);
    await assertMapContract(capturePage);
    for (const viewport of [viewports[0], viewports[2], viewports[4]]) {
      await ensureViewport(capturePage, viewport);
      await setView(capturePage, viewport, "Tactical");
      for (const tick of [7, 8]) {
        await seekToTick(capturePage, tick);
        await saveCapture(capturePage, "real-mid-capture", tick === 7 ? "capture-progress" : "observation-captured", tick, viewport, "Tactical", {
          captureProgress: integerField(observationAt(captureRun.ownerReplay, tick), "capture_progress"),
          captureProgressSide: field(observationAt(captureRun.ownerReplay, tick), "capture_progress_side"),
          captureOwner: field(observationAt(captureRun.ownerReplay, tick), "capture_owner"),
        }, captures);
      }
      if (viewport.name === "1440x900") {
        await setView(capturePage, viewport, "Overview");
        await seekToTick(capturePage, 8);
        await saveCapture(capturePage, "real-mid-capture", "captured-observation-overview", 8, viewport, "Overview", {
          captureOwner: "attacker",
        }, captures);
        await setView(capturePage, viewport, "Tactical");
        const target = await followHero(capturePage, viewport, captureRun.ownerReplay, 7, "F01");
        await saveCapture(capturePage, "real-mid-capture", "capture-progress-follow", 7, viewport, "Follow", {
          catalogId: target.catalogId,
          captureProgress: 7,
        }, captures);
      }
    }
  } finally {
    await capturePage.close();
  }

  const defaultPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let defaultRun: ReplayRun;
  try {
    defaultRun = await launchBattle(defaultPage, baseURL);
    expect(defaultRun.result.final_tick).toBe(420);
    expect(defaultRun.result.outcome).toBe("attacker_victory");
    expect(defaultRun.result.termination_reason).toBe("base_destroyed");
    const clashTick = defaultRun.publicReplay.frames.find((frame: JsonRecord) =>
      frame.events.some((event: JsonRecord) => event.event === "next.attack"),
    )?.tick as number | undefined;
    expect(clashTick, "the real default match presents a confirmed attack tick").toBeDefined();
    for (const viewport of viewports) {
      await ensureViewport(defaultPage, viewport);
      await seekToTick(defaultPage, clashTick!);
      await setView(defaultPage, viewport, "Tactical");
      if (viewport.name === "1440x900" || viewport.name === "390x844") {
        await saveCapture(defaultPage, "default-enbu-victory", "first-node-clash", clashTick!, viewport, "Tactical", {
          outcome: defaultRun.result.outcome,
          eventKinds: frameAt(defaultRun.publicReplay, clashTick!).events.map((event: JsonRecord) => event.event),
        }, captures);
      }
      await seekToTick(defaultPage, defaultRun.result.final_tick);
      await setView(defaultPage, viewport, "Tactical");
      await saveCapture(defaultPage, "default-enbu-victory", "base-destruction-end", defaultRun.result.final_tick, viewport, "Tactical", {
        outcome: defaultRun.result.outcome,
        terminationReason: defaultRun.result.termination_reason,
        finalStateDigest: defaultRun.result.final_state_digest,
      }, captures);
      await setView(defaultPage, viewport, "Overview");
      await saveCapture(defaultPage, "default-enbu-victory", "base-destruction-overview", defaultRun.result.final_tick, viewport, "Overview", {
        outcome: defaultRun.result.outcome,
        terminationReason: defaultRun.result.termination_reason,
      }, captures);
      await seekToTick(defaultPage, defaultRun.result.final_tick);
      const target = await followHero(defaultPage, viewport, defaultRun.ownerReplay, defaultRun.result.final_tick);
      await saveCapture(defaultPage, "default-enbu-victory", "base-destruction-follow", defaultRun.result.final_tick, viewport, "Follow", {
        catalogId: target.catalogId,
        entityType: target.entityType,
        outcome: defaultRun.result.outcome,
      }, captures);
    }
  } finally {
    await defaultPage.close();
  }

  const wasmPath = join(repoRoot, "apps/web/public/wasm/senkei_wasm.wasm");
  const screenshotPaths = captures.map((capture) => join(repoRoot, capture.image.path));
  const imageHashes = Object.fromEntries(captures.map((capture) => [capture.image.path, capture.image.sha256]));
  const artifacts = {
    canonicalInput: saveGzip("canonical-real-battle-input.json.gz", canonical.request.payload.snapshot),
    canonicalPublicReplay: saveGzip("canonical-real-battle-public-replay.json.gz", canonical.publicReplay),
    canonicalOwnerReplay: saveGzip("canonical-real-battle-owner-replay.json.gz", canonical.ownerReplay),
    captureInput: saveGzip("real-mid-capture-input.json.gz", captureRun.request.payload.snapshot),
    captureOwnerReplay: saveGzip("real-mid-capture-owner-replay.json.gz", captureRun.ownerReplay),
    defaultInput: saveGzip("default-enbu-victory-input.json.gz", defaultRun.request.payload.snapshot),
    defaultPublicReplay: saveGzip("default-enbu-victory-public-replay.json.gz", defaultRun.publicReplay),
    defaultOwnerReplay: saveGzip("default-enbu-victory-owner-replay.json.gz", defaultRun.ownerReplay),
  };
  const metadata = {
    schema: "senkei-battlefield-visual-acceptance/v1",
    evidenceKind,
    captureRunId: runId,
    sourceRevision: appRevision,
    buildRevision: defaultRun.buildRevision,
    wasmSha256: sha256(readFileSync(wasmPath)),
    browser: await browser.version(),
    renderer: "Three.js production renderer in Chromium/SwiftShader; physical GPU and touch hardware NOT_CHECKED",
    comparisonBefore: {
      commit: beforeCommit,
      desktop: beforeImages.desktop,
      mobile: beforeImages.mobile,
      afterDesktop: "canonical-real-battle/1440x900/initial-t000-tactical.png",
      afterMobile: "canonical-real-battle/390x844/initial-t000-tactical.png",
    },
    viewports,
    viewportChecks,
    scenarios: {
      canonical: {
        provenance: "snapshot generated by the real Jinrei + Enbu canonical interaction test; simulated again by the browser Worker and WASM",
        matchId: canonical.result.match_id,
        outcome: canonical.result.outcome,
        finalTick: canonical.result.final_tick,
        finalStateDigest: canonical.result.final_state_digest,
        publicReplayDigest: canonical.publicReplay.result_digest,
        ownerReplayDigest: canonical.ownerReplay.result_digest,
        workerRequestId: canonical.request.request_id,
        wasmResponses: canonical.wasmResponses,
        nodes: 35,
        edges: 42,
        confirmedNodeAttackTick: 1,
        ticks: { initial: 0, nodeFight: 1, lateralCrossing: 3, midBridgeDestroyed: 11, topBridgeExpanded: 13,
          topBridgeDestroyed: 23, fordTransit: 24, topBridgeRebuilt: 49, fixedBridgeTransit: 50, end: 70 },
      },
      observationCapture: {
        provenance: "real Jinrei idle orders + real Enbu capture lifecycle; same snapshot executed by browser Worker and WASM",
        matchId: captureRun.result.match_id,
        outcome: captureRun.result.outcome,
        finalTick: captureRun.result.final_tick,
        captureProgressTick: 7,
        capturedTick: 8,
          captureOwner: field(observationAt(captureRun.ownerReplay, 8), "capture_owner"),
        publicReplayDigest: captureRun.publicReplay.result_digest,
        ownerReplayDigest: captureRun.ownerReplay.result_digest,
        workerRequestId: captureRun.request.request_id,
        wasmResponses: captureRun.wasmResponses,
      },
      defaultVictory: {
        provenance: "unmodified five-Hero default Jinrei draft executed by the real browser Worker, local WASM and Enbu",
        matchId: defaultRun.result.match_id,
        outcome: defaultRun.result.outcome,
        terminationReason: defaultRun.result.termination_reason,
        finalTick: defaultRun.result.final_tick,
        finalStateDigest: defaultRun.result.final_state_digest,
        firstNodeFightTick: defaultRun.publicReplay.frames.find((frame: JsonRecord) => frame.events.some((event: JsonRecord) => event.event === "next.attack"))?.tick,
        publicReplayDigest: defaultRun.publicReplay.result_digest,
        ownerReplayDigest: defaultRun.ownerReplay.result_digest,
        workerRequestId: defaultRun.request.request_id,
        wasmResponses: defaultRun.wasmResponses,
      },
    },
    interactionChecks: {
      replaySeek: true,
      replayPlayPause: true,
      pixelAndSmooth3dToggle: true,
      desktopTacticalOverviewFollow: true,
      mobileBattleOverviewFollowTimelineDetails: true,
      mapRoutesAndRiver: true,
      mapRouteBridgeState: true,
      pageErrors: [...canonical.pageErrors, ...captureRun.pageErrors, ...defaultRun.pageErrors],
    },
    artifacts,
    captures,
    imageHashes,
    captureCount: captures.length,
    uncompressedImageBytes: screenshotPaths.reduce((sum, path) => sum + readFileSync(path).length, 0),
  };
  writeFileSync(join(outputDirectory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);
  const comparison = [
    "# Battlefield visual acceptance captures",
    "",
    `Source HEAD: \`${appRevision}\`. The Before column is the PR #7 baseline pinned by BATTLEFIELD-VISUAL.md.`,
    "",
    "| Scene | Before | After | Evidence |",
    "| --- | --- | --- | --- |",
    `| Desktop battlefield and destroyed crossing | [6fa8296 baseline](${beforeImages.desktop}) | [real initial battlefield](canonical-real-battle/1440x900/initial-t000-tactical.png) | 1440×900, T0, Tactical |`,
    `| Mobile battlefield | [6fa8296 baseline](${beforeImages.mobile}) | [real initial battlefield](canonical-real-battle/390x844/initial-t000-tactical.png) | 390×844, T0, Tactical |`,
    `| Track and river crossings | — | [lateral crossing](canonical-real-battle/1440x900/lane-crossing-t003-tactical.png), [ford transit](canonical-real-battle/1440x900/ford-transit-t024-tactical.png) | real Jinrei + Enbu + WASM |`,
    `| Bridge states | — | [expanded](canonical-real-battle/1440x900/top-bridge-expanded-t013-tactical.png), [destroyed](canonical-real-battle/1440x900/top-bridge-destroyed-t023-tactical.png), [rebuilt](canonical-real-battle/1440x900/top-bridge-rebuilt-t049-tactical.png) | replay-confirmed |`,
    `| MID capture and victory | — | [capture progress](real-mid-capture/1440x900/capture-progress-t007-tactical.png), [T420 victory](default-enbu-victory/1440x900/base-destruction-end-t420-tactical.png) | actual simulation state |`,
    "",
    "Each screenshot's SHA-256, tick, viewport, requested camera mode, renderer camera pose/target, replay identity and scene facts are listed in `metadata.json`.",
    "",
  ].join("\n");
  writeFileSync(join(outputDirectory, "comparison.md"), comparison);
  expect(existsSync(join(outputDirectory, "metadata.json"))).toBe(true);
  expect(captures.length).toBeGreaterThanOrEqual(70);
});
