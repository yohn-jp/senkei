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
const baseAssaultSnapshotPath = resolve(repoRoot, "target/next-balance/visual-battlefield-base-assault-snapshot.json");
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

function requiredRecord(value: unknown, label: string): JsonRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`The visual capture ${label} is missing or is not an object.`);
  }
  return value as JsonRecord;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`The visual capture ${label} is missing or is not a nonempty string.`);
  }
  return value;
}

function domainString(value: unknown, label: string): string {
  const domainValue = requiredRecord(value, label);
  if (domainValue.kind !== "string") throw new Error(`The visual capture ${label} is not a typed string value.`);
  return requiredString(domainValue.value, label);
}

function configuredHeroesAt(snapshot: JsonRecord, side: "attacker" | "defender"): JsonRecord[] {
  const sideSnapshot = requiredRecord(snapshot[side], `${side} Senkei snapshot`);
  const configuration = requiredRecord(sideSnapshot.configuration, `${side} configuration`);
  const heroesValue = requiredRecord(configuration.heroes, `${side} configured Heroes`);
  if (heroesValue.kind !== "list" || !Array.isArray(heroesValue.value)) {
    throw new Error(`The visual capture ${side} Heroes are not a typed list.`);
  }
  return heroesValue.value.map((rawHero: unknown, index: number) => {
    const heroValue = requiredRecord(rawHero, `${side} Hero ${index + 1} configuration`);
    if (heroValue.kind !== "record") throw new Error(`The visual capture ${side} Hero ${index + 1} is not a typed record.`);
    const hero = requiredRecord(heroValue.value, `${side} Hero ${index + 1} fields`);
    return {
      catalogId: domainString(hero.catalog_id, `${side} Hero ${index + 1} catalog ID`),
      squad: domainString(hero.squad, `${side} Hero ${index + 1} squad`),
      node: domainString(hero.node, `${side} Hero ${index + 1} start node`),
    };
  });
}

function entitiesAt(replay: JsonRecord, tick: number): [string, JsonRecord][] {
  return Object.entries(frameAt(replay, tick).visible_state?.entities ?? {}) as [string, JsonRecord][];
}

function bridgeAt(replay: JsonRecord, tick: number, site: string): JsonRecord | undefined {
  return bridgeEntryAt(replay, tick, site)?.[1];
}

function bridgeEntryAt(replay: JsonRecord, tick: number, site: string): [string, JsonRecord] | undefined {
  return entitiesAt(replay, tick).find(([, entity]) =>
    entity.entity_type === "bridge" && field(entity, "site") === site,
  );
}

function catalogEntityEntryAt(replay: JsonRecord, tick: number, entityType: string, catalogId: string): [string, JsonRecord] | undefined {
  return entitiesAt(replay, tick).find(([, entity]) =>
    entity.entity_type === entityType && field(entity, "catalog_id") === catalogId,
  );
}

function firstCenterBridgeTransit(
  replay: JsonRecord,
  catalogId: string,
  site: string,
  from: string,
  to: string,
  afterTick: number,
): JsonRecord | undefined {
  for (const frame of replay.frames as JsonRecord[]) {
    if (frame.tick <= afterTick) continue;
    const bridge = bridgeAt(replay, frame.tick, site);
    if (field(bridge, "bridge_state") !== "normal") continue;
    const hero = entitiesAt(replay, frame.tick).map(([, entity]) => entity).find((entity) =>
      entity.entity_type === "hero" && field(entity, "catalog_id") === catalogId,
    );
    if (field(hero, "node") !== from || field(hero, "edge_to") !== to ||
      (integerField(hero, "edge_progress") ?? 0) <= 0 || field(hero, "track") !== "CENTER") continue;
    return {
      tick: frame.tick,
      catalogId,
      site,
      node: field(hero, "node"),
      edgeTo: field(hero, "edge_to"),
      edgeProgress: integerField(hero, "edge_progress"),
      track: field(hero, "track"),
      bridgeState: field(bridge, "bridge_state"),
    };
  }
  return undefined;
}

function observationAt(replay: JsonRecord, tick: number): JsonRecord | undefined {
  return entitiesAt(replay, tick).map(([, entity]) => entity).find((entity) =>
    entity.entity_type === "observation" && field(entity, "node") === "N.MID.OBS",
  );
}

function heroAttackSourcesAt(frame: JsonRecord): { entityId: string; entity: JsonRecord; event: JsonRecord }[] {
  const entities = frame.visible_state?.entities ?? {};
  return (frame.events ?? []).flatMap((event: JsonRecord) => {
    if (event.event !== "next.attack") return [];
    const source = event.payload?.source;
    const sourceId = source?.kind === "entity" ? source.value : event.entity;
    const entity = typeof sourceId === "string" ? entities[sourceId] : undefined;
    return entity?.entity_type === "hero" ? [{ entityId: sourceId as string, entity, event }] : [];
  });
}

function heroAttacksTargeting(replay: JsonRecord, tick: number, targetEntityId: string): { entityId: string; entity: JsonRecord; event: JsonRecord }[] {
  const frame = frameAt(replay, tick);
  const entities = frame.visible_state?.entities ?? {};
  return (frame.events ?? []).flatMap((event: JsonRecord) => {
    if (event.event !== "next.attack" || event.payload?.target?.kind !== "entity" || event.payload.target.value !== targetEntityId) return [];
    const sourceId = event.payload?.source?.kind === "entity" ? event.payload.source.value : undefined;
    const entity = typeof sourceId === "string" ? entities[sourceId] : undefined;
    return entity?.entity_type === "hero" ? [{ entityId: sourceId as string, entity, event }] : [];
  });
}

function frameHasHeroAttack(frame: JsonRecord): boolean {
  return heroAttackSourcesAt(frame).length > 0;
}

function firstHeroAttackSource(ownerReplay: JsonRecord, publicReplay: JsonRecord): JsonRecord | undefined {
  const candidates = [
    ...(ownerReplay.frames as JsonRecord[]).flatMap((frame) => heroAttackSourcesAt(frame).map((source) => ({ replay: ownerReplay, frame, tick: frame.tick, ...source }))),
    ...(publicReplay.frames as JsonRecord[]).flatMap((frame) => heroAttackSourcesAt(frame).map((source) => ({ replay: publicReplay, frame, tick: frame.tick, ...source }))),
  ];
  if (candidates.length === 0) return undefined;
  const firstTick = Math.min(...candidates.map((candidate) => candidate.tick));
  const atFirstTick = candidates.filter((candidate) => candidate.tick === firstTick);
  return atFirstTick.find((candidate) => candidate.replay === ownerReplay && candidate.entity.owner === "attacker") ??
    atFirstTick.find((candidate) => candidate.replay === publicReplay) ?? atFirstTick[0];
}

function heroAt(replay: JsonRecord, tick: number, catalogId: string): JsonRecord | undefined {
  return entitiesAt(replay, tick).map(([, entity]) => entity).find((entity) =>
    entity.entity_type === "hero" && field(entity, "catalog_id") === catalogId,
  );
}

function heroMovementFactsAt(replay: JsonRecord, tick: number, catalogId: string): JsonRecord | null {
  const hero = heroAt(replay, tick, catalogId);
  if (!hero) return null;
  return {
    catalogId,
    node: field(hero, "node") ?? null,
    edgeTo: field(hero, "edge_to") ?? null,
    edgeProgress: integerField(hero, "edge_progress"),
    track: field(hero, "track") ?? null,
    crossRemaining: integerField(hero, "cross_remaining"),
    fordRemaining: integerField(hero, "ford_remaining"),
    hp: integerField(hero, "hp"),
  };
}

function actualMovementTickBefore(replay: JsonRecord, entityId: string, beforeTick: number): JsonRecord | undefined {
  let prior: { tick: number; x: number; y: number } | undefined;
  let latest: JsonRecord | undefined;
  for (const frame of replay.frames as JsonRecord[]) {
    if (frame.tick >= beforeTick) break;
    const entity = frame.visible_state?.entities?.[entityId] as JsonRecord | undefined;
    if (!entity || entity.entity_type !== "hero") {
      prior = undefined;
      continue;
    }
    const x = integerField(entity, "x");
    const y = integerField(entity, "y");
    if (x === null || y === null) {
      prior = undefined;
      continue;
    }
    const moved = prior !== undefined && (prior.x !== x || prior.y !== y);
    const attacked = heroAttackSourcesAt(frame).some((source) => source.entityId === entityId);
    if (moved && !attacked) {
      latest = {
        tick: frame.tick,
        previousTick: prior!.tick,
        previousPosition: { x: prior!.x, y: prior!.y },
        position: { x, y },
        node: field(entity, "node") ?? null,
        edgeTo: field(entity, "edge_to") ?? null,
        edgeProgress: integerField(entity, "edge_progress"),
        track: field(entity, "track") ?? null,
        eventKinds: (frame.events ?? []).map((event: JsonRecord) => event.event),
        sourceCoreEntityId: entityId,
      };
    }
    prior = { tick: frame.tick, x, y };
  }
  return latest;
}

function findFollowHero(replay: JsonRecord, tick: number, requestedCatalogId?: string, requestedSide?: string): { catalogId: string; entityType: string; side: string } {
  const heroes = entitiesAt(replay, tick)
    .filter(([, entity]) => entity.entity_type === "hero"
      && integerField(entity, "hp") !== null
      && integerField(entity, "hp")! > 0
      && (requestedCatalogId === undefined || field(entity, "catalog_id") === requestedCatalogId)
      && (requestedSide === undefined || (entity.owner === "attacker" ? "Azure" : entity.owner === "defender" ? "Vermilion" : "") === requestedSide))
    .sort(([, left], [, right]) => String(field(left, "catalog_id")).localeCompare(String(field(right, "catalog_id"))));
  const first = heroes[0];
  if (!first) {
    const requested = requestedCatalogId ? ` (${requestedCatalogId})` : "";
    throw new Error(`No living, replay-visible Hero${requested} is available to follow at tick ${tick}.`);
  }
  const [, entity] = first;
  const catalogId = field(entity, "catalog_id");
  const side = entity.owner === "attacker" ? "Azure" : entity.owner === "defender" ? "Vermilion" : undefined;
  if (typeof catalogId !== "string" || !side) throw new Error(`The selected replay Hero has no public identity or side at tick ${tick}.`);
  return { catalogId, entityType: "hero", side };
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
  execFileSync("cargo", [
    "test", "--locked", "--release", "-p", "enbu", "--test", "next_scenarios",
    "enbu_confirms_base_node_assaults_for_both_sides", "--", "--exact",
  ], {
    cwd: repoRoot,
    env: { ...process.env, BATTLEFIELD_BASE_ASSAULT_SCENARIO_SNAPSHOT_PATH: baseAssaultSnapshotPath },
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
  const capturedRequest = requiredRecord(captured.request, "Worker request");
  const capturedResponse = requiredRecord(captured.response, "Worker response");
  if (capturedRequest.operation !== "simulate") throw new Error("The local UI did not issue a real Enbu simulation.");
  if (capturedResponse.ok !== true) throw new Error("The real Worker/WASM simulation did not succeed.");
  const requestId = requiredString(capturedRequest.request_id, "Worker request ID");
  const responseRequestId = requiredString(capturedResponse.request_id, "Worker response request ID");
  if (responseRequestId !== requestId) throw new Error("The Worker response does not match the captured Enbu simulation request.");
  expect(wasmResponses.some((response) => response.status === 200), "the browser loaded the actual WASM binary").toBe(true);
  const requestPayload = requiredRecord(capturedRequest.payload, "Worker request payload");
  const requestSnapshot = requiredRecord(requestPayload.snapshot, "Worker snapshot");
  const requestContext = requiredRecord(requestSnapshot.context, "Worker snapshot context");
  const requestedMatchId = requiredString(requestContext.match_id, "Worker snapshot match ID");
  const simulation = requiredRecord(capturedResponse.result, "Worker simulation result");
  const outcome = requiredRecord(simulation.outcome, "simulation outcome");
  const result = requiredRecord(outcome.result, "Enbu result");
  const publicReplay = requiredRecord(outcome.presentation_replay, "public presentation replay");
  const ownerReplay = requiredRecord(simulation.owner_replay, "authorized owner replay");
  if (ownerReplay.perspective !== "attacker") throw new Error("The real Worker response lacks the authorized attacker replay.");
  if (!Array.isArray(ownerReplay.frames) || ownerReplay.frames.length !== result.final_tick + 1) {
    throw new Error("The authorized owner replay does not contain every Enbu tick frame.");
  }
  if (!Array.isArray(publicReplay.frames) || publicReplay.frames.length !== result.final_tick + 1) {
    throw new Error("The public presentation replay does not contain every Enbu tick frame.");
  }
  const resultMatchId = requiredString(result.match_id, "Enbu result match ID");
  if (resultMatchId !== requestedMatchId) throw new Error(`The Enbu result match ID does not match request ${requestedMatchId}.`);
  requiredString(result.final_state_digest, "final state digest");
  requiredString(publicReplay.result_digest, "public replay digest");
  expect(pageErrors).toEqual([]);
  return {
    request: capturedRequest,
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

async function followHero(page: Page, viewport: Viewport, replay: JsonRecord, tick: number, requestedCatalogId?: string, requestedSide?: string): Promise<JsonRecord> {
  const target = findFollowHero(replay, tick, requestedCatalogId, requestedSide);
  await seekToTick(page, tick);
  const canvas = page.locator(".next-renderer-host canvas");
  let rendererEntityId: string | undefined;
  if (viewport.width <= 760) {
    await page.getByRole("button", { name: "Follow view" }).click();
    const clusters = page.locator(".next-follow-sheet .next-visible-cluster");
    let followed = false;
    for (let index = 0; index < await clusters.count(); index += 1) {
      const cluster = clusters.nth(index);
      const toggle = cluster.locator(".next-visible-cluster-toggle");
      if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
      const rows = cluster.locator(".next-visible-cluster-entities > li");
      for (let rowIndex = 0; rowIndex < await rows.count(); rowIndex += 1) {
        const row = rows.nth(rowIndex);
        const identity = await row.locator(".next-visible-entity-copy > strong").innerText();
        const sideAndRole = await row.locator(".next-visible-entity-copy > span").innerText();
        if (!identity.startsWith(target.catalogId) || !sideAndRole.endsWith(target.side)) continue;
        const button = row.locator(".next-visible-entity-actions button[aria-label^='Follow ']");
        const label = await button.getAttribute("aria-label");
        const id = label?.match(/, replay entity (.+)$/)?.[1];
        if (id) {
          rendererEntityId = id;
          await button.click();
          followed = true;
          break;
        }
      }
      if (followed) break;
    }
    expect(followed, `the actual mobile Follow sheet contains ${target.catalogId}`).toBe(true);
  } else {
    const observer = page.getByRole("combobox", { name: "Observe visible entity" });
    const options = await observer.locator("option").all();
    for (const option of options) {
      const label = (await option.innerText()).trim();
      if (!label.startsWith(`${target.side} · ${target.catalogId}`)) continue;
      rendererEntityId = await option.getAttribute("value") ?? undefined;
      break;
    }
    expect(rendererEntityId, `the actual desktop camera list contains ${target.side} ${target.catalogId}`).toBeTruthy();
    await observer.selectOption(rendererEntityId!);
    await page.getByRole("button", { name: "Follow selected unit" }).click();
  }
  expect(rendererEntityId).toBeTruthy();
  await expect(canvas).toHaveAttribute("data-tracking", rendererEntityId!);
  await waitForSettledCamera(page);
  return { ...target, id: rendererEntityId };
}

async function followBridgeSite(page: Page, viewport: Viewport, replay: JsonRecord, tick: number, site: "TOP" | "MID" | "BOT"): Promise<JsonRecord> {
  const bridgeEntry = bridgeEntryAt(replay, tick, site);
  expect(bridgeEntry, `owner replay authorizes the ${site} bridge at tick ${tick}`).toBeTruthy();
  const [ownerReplayEntityId, bridge] = bridgeEntry!;
  const bridgeState = field(bridge, "bridge_state");
  expect(bridgeState, `${site} bridge has a confirmed public state at tick ${tick}`).toBeTruthy();

  const canvas = page.locator(".next-renderer-host canvas");
  await seekToTick(page, tick);
  let rendererEntityId: string | undefined;
  if (viewport.width <= 760) {
    const openFollowSheet = async (): Promise<void> => {
      const followView = page.getByRole("button", { name: "Follow view" });
      if (await page.locator(".next-follow-sheet").isVisible().catch(() => false)) return;
      await followView.click();
      await expect(page.locator(".next-follow-sheet")).toBeVisible();
    };
    const locateBridgeRow = async () => {
      const x = integerField(bridge, "x");
      const y = integerField(bridge, "y");
      expect(x, `${site} bridge owner replay includes its authorized X position`).not.toBeNull();
      expect(y, `${site} bridge owner replay includes its authorized Y position`).not.toBeNull();
      const clusters = page.locator(".next-follow-sheet .next-visible-cluster");
      for (let index = 0; index < await clusters.count(); index += 1) {
        const cluster = clusters.nth(index);
        const toggle = cluster.locator(".next-visible-cluster-toggle");
        if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
        const rows = cluster.locator(".next-visible-cluster-entities > li");
        for (let rowIndex = 0; rowIndex < await rows.count(); rowIndex += 1) {
          const row = rows.nth(rowIndex);
          const description = await row.locator(".next-visible-entity-copy > span").innerText();
          if (!description.includes("Bridge facility")) continue;
          const location = await row.locator(".next-visible-entity-copy small").innerText();
          const coordinates = location.match(/\bX (\d+) · Y (\d+)\b/);
          if (Number(coordinates?.[1]) === x && Number(coordinates?.[2]) === y) return row;
        }
      }
      throw new Error(`The mobile Follow sheet has no currently visible ${site} bridge at owner replay position ${x}, ${y}.`);
    };

    await openFollowSheet();
    const selectedRow = await locateBridgeRow();
    await selectedRow.locator(".next-visible-entity-actions button[aria-label^='Select ']").click();
    const siteField = page.locator('[data-testid="logical-detail-field"][data-field="site"] strong');
    const stateField = page.locator('[data-testid="logical-detail-field"][data-field="bridge_state"] strong');
    await expect(siteField).toHaveText(site);
    await expect(stateField).toHaveText(String(bridgeState));
    await page.getByRole("button", { name: "Close details sheet" }).click();

    await openFollowSheet();
    const followRow = await locateBridgeRow();
    const followButton = followRow.locator(".next-visible-entity-actions button[aria-label^='Follow ']");
    const label = await followButton.getAttribute("aria-label");
    rendererEntityId = label?.match(/, replay entity (.+)$/)?.[1];
    expect(rendererEntityId, `${site} bridge is a current Follow target in the mobile UI`).toBeTruthy();
    await followButton.click();
    const followSheet = page.locator(".next-follow-sheet");
    if (await followSheet.isVisible().catch(() => false)) await page.getByRole("button", { name: "Close follow sheet" }).click();
  } else {
    const detailsButton = page.getByRole("button", { name: "Battle situation details" });
    if (await detailsButton.getAttribute("aria-expanded") !== "true") await detailsButton.click();
    const observer = page.getByRole("combobox", { name: "Observe visible entity" });
    const options = await observer.locator("option").all();
    for (const option of options) {
      if (!(await option.innerText()).includes("Bridge facility")) continue;
      const id = await option.getAttribute("value");
      if (!id) continue;
      await observer.selectOption(id);
      const siteField = page.locator('[data-testid="logical-detail-field"][data-field="site"] strong');
      const stateField = page.locator('[data-testid="logical-detail-field"][data-field="bridge_state"] strong');
      const candidateSite = (await siteField.textContent().catch(() => null))?.trim();
      if (candidateSite !== site) continue;
      expect((await stateField.textContent())?.trim()).toBe(String(bridgeState));
      rendererEntityId = id;
      break;
    }
    expect(rendererEntityId, `the desktop camera selector exposes the authorized ${site} bridge`).toBeTruthy();
    await page.getByRole("button", { name: "Follow selected unit" }).click();
    if (await detailsButton.getAttribute("aria-expanded") === "true") await detailsButton.click();
    const rosterToggle = page.getByTestId("battle-visible-roster-toggle");
    if (await rosterToggle.getAttribute("aria-expanded") === "true") await rosterToggle.click();
  }

  expect(rendererEntityId).toBeTruthy();
  await expect(canvas).toHaveAttribute("data-camera-mode", "tactical");
  await expect(canvas).toHaveAttribute("data-tracking", rendererEntityId!);
  await waitForSettledCamera(page);
  return { id: rendererEntityId, site, bridgeState, ownerReplayEntityId };
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

async function bridgeRouteEndpoints(page: Page): Promise<{ site: string; from: string; to: string }[]> {
  const toggle = page.getByRole("button", { name: "Toggle battlefield map context" });
  const alreadyOpen = await toggle.getAttribute("aria-expanded") === "true";
  if (!alreadyOpen) await toggle.click();
  try {
    const nodes = await page.getByTestId("battle-map-node").evaluateAll((elements) => elements.map((element) => {
      const node = element as SVGCircleElement;
      return { id: node.dataset.nodeId ?? "", point: `${node.getAttribute("cx")},${node.getAttribute("cy")}` };
    }));
    const nodeByPoint = new Map(nodes.map((node) => [node.point, node.id]));
    const routes = await page.locator("[data-testid='battle-map-route'][data-bridge-site]").evaluateAll((elements) => elements.map((element) => {
      const route = element as SVGPolylineElement;
      return { site: route.dataset.bridgeSite ?? "", points: (route.getAttribute("points") ?? "").trim().split(/\s+/).filter(Boolean) };
    }));
    return routes.map((route) => {
      const from = nodeByPoint.get(route.points[0] ?? "");
      const to = nodeByPoint.get(route.points[route.points.length - 1] ?? "");
      expect(from, `${route.site} bridge route start aligns with an authored minimap node`).toBeTruthy();
      expect(to, `${route.site} bridge route end aligns with an authored minimap node`).toBeTruthy();
      return { site: route.site, from: from!, to: to! };
    });
  } finally {
    if (!alreadyOpen) await toggle.click();
  }
}

function normalBridgeCrossingSnapshots(replay: JsonRecord, edges: readonly { site: string; from: string; to: string }[], beforeTick: number): JsonRecord[] {
  const snapshots: JsonRecord[] = [];
  for (const frame of replay.frames as JsonRecord[]) {
    if (frame.tick >= beforeTick) break;
    const normalSites = new Set(edges
      .filter((edge) => field(bridgeAt(replay, frame.tick, edge.site), "bridge_state") === "normal")
      .map((edge) => edge.site));
    if (normalSites.size === 0) continue;
    const crossingHeroes = entitiesAt(replay, frame.tick).flatMap(([entityId, entity]) => {
      if (entity.entity_type !== "hero" || integerField(entity, "edge_progress") === null || integerField(entity, "edge_progress")! <= 0) return [];
      const from = field(entity, "node");
      const to = field(entity, "edge_to");
      const edge = edges.find((candidate) => normalSites.has(candidate.site) &&
        ((candidate.from === from && candidate.to === to) || (candidate.from === to && candidate.to === from)));
      return edge ? [{
        entityId,
        catalogId: field(entity, "catalog_id") ?? null,
        owner: entity.owner ?? null,
        site: edge.site,
        node: from,
        edgeTo: to,
        edgeProgress: integerField(entity, "edge_progress"),
        track: field(entity, "track") ?? null,
      }] : [];
    });
    if (crossingHeroes.length > 0) snapshots.push({ tick: frame.tick, bridgeSites: [...normalSites], crossingHeroes });
  }
  return snapshots;
}

function fordTransitMidpoint(replay: JsonRecord, catalogId: string): JsonRecord | undefined {
  const samplesByEdge = new Map<string, JsonRecord[]>();
  for (const frame of replay.frames as JsonRecord[]) {
    const entry = catalogEntityEntryAt(replay, frame.tick, "hero", catalogId);
    const hero = entry?.[1];
    const node = field(hero, "node");
    const edgeTo = field(hero, "edge_to");
    const edgeProgress = integerField(hero, "edge_progress");
    if (integerField(hero, "ford_active") !== 1 || integerField(hero, "ford_remaining") !== 0 ||
      edgeProgress === null || edgeProgress <= 0 || typeof node !== "string" || typeof edgeTo !== "string" || edgeTo.length === 0) continue;
    const edgeKey = `${node}\u0000${edgeTo}`;
    const samples = samplesByEdge.get(edgeKey) ?? [];
    samples.push({ tick: frame.tick, node, edgeTo, edgeProgress });
    samplesByEdge.set(edgeKey, samples);
  }
  const edgeSamples = [...samplesByEdge.values()].sort((left, right) =>
    right.length - left.length || left[0].tick - right[0].tick,
  )[0];
  return edgeSamples?.[Math.floor((edgeSamples.length - 1) / 2)];
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
  const visibleLabelBounds = await page.locator(".next-renderer-host").evaluate((host) => {
    const hostRect = host.getBoundingClientRect();
    return [...host.querySelectorAll<HTMLElement>(".entity-world-label")]
      .filter((label) => !label.hidden && getComputedStyle(label).display !== "none" && getComputedStyle(label).visibility !== "hidden")
      .map((label) => {
        const rect = label.getBoundingClientRect();
        return {
          text: label.textContent ?? "",
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          hostLeft: hostRect.left,
          hostTop: hostRect.top,
          hostRight: hostRect.right,
          hostBottom: hostRect.bottom,
        };
      });
  });
  for (const label of visibleLabelBounds) {
    expect(label.left, `visible world label ${label.text} stays inside renderer host on the left`).toBeGreaterThanOrEqual(label.hostLeft - 0.5);
    expect(label.top, `visible world label ${label.text} stays inside renderer host at the top`).toBeGreaterThanOrEqual(label.hostTop - 0.5);
    expect(label.right, `visible world label ${label.text} stays inside renderer host on the right`).toBeLessThanOrEqual(label.hostRight + 0.5);
    expect(label.bottom, `visible world label ${label.text} stays inside renderer host at the bottom`).toBeLessThanOrEqual(label.hostBottom + 0.5);
  }
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
    facts: { ...facts, visibleWorldLabelCount: visibleLabelBounds.length, visibleWorldLabelsWithinHost: true },
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
  test.setTimeout(1_800_000);
  if (!baseURL) throw new Error("The visual acceptance capture requires the production preview URL.");
  const appRevision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
  activeSourceRevision = appRevision;
  mkdirSync(outputDirectory, { recursive: true });
  await createScenarioSnapshots();
  const canonicalSnapshot = JSON.parse(readFileSync(canonicalSnapshotPath, "utf8")) as JsonRecord;
  const captureSnapshot = JSON.parse(readFileSync(captureSnapshotPath, "utf8")) as JsonRecord;
  const baseAssaultSnapshot = JSON.parse(readFileSync(baseAssaultSnapshotPath, "utf8")) as JsonRecord;
  const captures: CaptureEntry[] = [];
  const viewportChecks: JsonRecord = {};

  const canonical = await launchBattle(page, baseURL, canonicalSnapshot);
  expect(canonical.buildRevision, "the app preview is built from the capture HEAD").toBe(appRevision);
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
  const fixedBridgeTransit = firstCenterBridgeTransit(canonical.ownerReplay, "R01", "TOP", "A.TOP.BANK", "B.TOP.BANK", 49);
  expect(fixedBridgeTransit, "R01 eventually enters the rebuilt, known TOP bridge on the CENTER track").toBeTruthy();
  expect(fixedBridgeTransit!.tick, "R01's real transit is observed after bridge rebuild and before match end")
    .toBeGreaterThan(49);
  expect(fixedBridgeTransit!.tick).toBeLessThanOrEqual(canonical.result.final_tick);

  await assertMapContract(page);
  for (const [tick, site, state] of [
    [0, "TOP", "normal"], [11, "MID", "destroyed"], [13, "TOP", "expanded"],
    [23, "TOP", "destroyed"], [49, "TOP", "normal"],
  ] as const) await assertBridgeRoute(page, tick, site, state);

  for (const viewport of viewports) {
    await ensureViewport(page, viewport);
    await setView(page, viewport, "Tactical");
    const viewportStates = [
      ...canonicalStates,
      { id: "fixed-bridge-transit", tick: fixedBridgeTransit!.tick },
    ].sort((left, right) => left.tick - right.tick);
    const tacticalStates = viewport.name === "1440x900"
      ? viewportStates
      : viewport.name === "1920x1080"
        ? viewportStates.filter(({ id }) => ["initial", "node-fight", "lane-crossing", "top-bridge-expanded", "top-bridge-destroyed", "ford-transit", "draw-end"].includes(id))
        : viewportStates.filter(({ id }) => ["initial", "lane-crossing", "top-bridge-destroyed", "ford-transit", "draw-end"].includes(id));
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

    const lateralHero = heroAt(canonical.ownerReplay, 3, "F01");
    const lateralCrossRemaining = integerField(lateralHero, "cross_remaining");
    if (lateralCrossRemaining === null) throw new Error("The authorized replay must expose F01's lateral crossing timer at T3.");
    expect(lateralCrossRemaining, "F01 is in the real three-tick LEFT-to-RIGHT transit at T3").toBeGreaterThan(0);
    expect(field(lateralHero, "track"), "the authorized replay retains the selected LEFT track as the transition origin").toBe("LEFT");
    const lateralTarget = await followHero(page, viewport, canonical.ownerReplay, 3, "F01", "Azure");
    await saveCapture(page, "canonical-real-battle", "lateral-crossing-follow", 3, viewport, "Follow", {
      catalogId: lateralTarget.catalogId,
      side: lateralTarget.side,
      rendererEntityId: lateralTarget.id,
      node: field(lateralHero, "node"),
      edgeTo: field(lateralHero, "edge_to"),
      edgeProgress: integerField(lateralHero, "edge_progress"),
      selectedTrack: field(lateralHero, "track"),
      effectiveTrack: lateralCrossRemaining > 0 ? "CENTER" : field(lateralHero, "track"),
      effectiveTrackReason: lateralCrossRemaining > 0 ? "cross_remaining > 0" : "no lateral crossing",
      crossRemaining: lateralCrossRemaining,
    }, captures);

    const fordTransit = fordTransitMidpoint(canonical.ownerReplay, "F02");
    expect(fordTransit, "F02 progresses through the real bridge-free ford with active transit after the entry timer").toBeTruthy();
    const fordTransitTick = fordTransit!.tick as number;
    const fordHero = heroAt(canonical.ownerReplay, fordTransitTick, "F02");
    const fordRemaining = integerField(fordHero, "ford_remaining");
    expect(integerField(fordHero, "ford_active"), "the observed edge movement is an active ford crossing").toBe(1);
    expect(fordRemaining, "F02 has completed the ford-entry timer before advancing on the edge").toBe(0);
    expect(integerField(fordHero, "edge_progress"), "F02 has entered the river crossing edge").toBeGreaterThan(0);
    const fordTarget = await followHero(page, viewport, canonical.ownerReplay, fordTransitTick, "F02", "Azure");
    await saveCapture(page, "canonical-real-battle", "ford-transit-follow", fordTransitTick, viewport, "Follow", {
      catalogId: fordTarget.catalogId,
      side: fordTarget.side,
      rendererEntityId: fordTarget.id,
      node: field(fordHero, "node"),
      edgeTo: field(fordHero, "edge_to"),
      edgeProgress: integerField(fordHero, "edge_progress"),
      track: field(fordHero, "track"),
      fordRemaining,
      fordActive: integerField(fordHero, "ford_active"),
      bridgeFree: true,
    }, captures);

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
      const followTarget = await followHero(page, viewport, canonical.ownerReplay, fixedBridgeTransit!.tick, "R01");
      await saveCapture(page, "canonical-real-battle", "bridge-crossing-follow", fixedBridgeTransit!.tick, viewport, "Follow", {
        entityType: followTarget.entityType,
        catalogId: followTarget.catalogId,
        side: followTarget.side,
        replayEntityId: followTarget.id,
        bridge: "rebuilt TOP fixed crossing",
        edgeProgress: fixedBridgeTransit!.edgeProgress,
        track: fixedBridgeTransit!.track,
        bridgeState: fixedBridgeTransit!.bridgeState,
      }, captures);
    }

    const bridgeFollowStates = [
      { tick: 0, site: "TOP", state: "normal", id: "top-bridge-normal" },
      { tick: 11, site: "MID", state: "destroyed", id: "mid-bridge-destroyed" },
      { tick: 13, site: "TOP", state: "expanded", id: "top-bridge-expanded" },
      { tick: 23, site: "TOP", state: "destroyed", id: "top-bridge-destroyed" },
      { tick: 49, site: "TOP", state: "normal", id: "top-bridge-rebuilt" },
    ] as const;
    for (const bridgeState of bridgeFollowStates) {
      const target = await followBridgeSite(page, viewport, canonical.ownerReplay, bridgeState.tick, bridgeState.site);
      expect(target.bridgeState).toBe(bridgeState.state);
      await saveCapture(page, "canonical-real-battle", `${bridgeState.id}-follow`, bridgeState.tick, viewport, "Follow", {
        bridgeSite: target.site,
        bridgeState: target.bridgeState,
        ownerReplayEntityId: target.ownerReplayEntityId,
        rendererEntityId: target.id,
        cameraOperation: "Follow the currently visible bridge entity in the real authorized owner replay",
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
    expect(captureRun.buildRevision, "the MID capture app preview is built from the capture HEAD").toBe(appRevision);
    expect(captureRun.result.final_tick).toBe(16);
    expect(integerField(observationAt(captureRun.ownerReplay, 1), "capture_progress")).toBe(1);
    expect(integerField(observationAt(captureRun.ownerReplay, 7), "capture_progress")).toBe(7);
    expect(field(observationAt(captureRun.ownerReplay, 8), "capture_owner")).toBe("attacker");
    for (const tick of [1, 7, 8]) {
      expect(observationAt(captureRun.publicReplay, tick), `unseen MID facility state remains private at public tick ${tick}`).toBeUndefined();
      expect(
        frameAt(captureRun.publicReplay, tick).events.some((event: JsonRecord) => event.event === "next.observation_capture"),
        `capture event remains private at public tick ${tick}`,
      ).toBe(false);
    }
    expect(
      frameAt(captureRun.ownerReplay, 8).events.some((event: JsonRecord) => event.event === "next.observation_capture"),
      "authorized owner replay contains the real capture event",
    ).toBe(true);
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
          side: target.side,
          captureProgress: 7,
        }, captures);
      }
    }
  } finally {
    await capturePage.close();
  }

  const defaultPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let defaultRun: ReplayRun;
  let defaultFirstHeroAttackFrame: JsonRecord | undefined;
  let matchedBaselineMovement: JsonRecord = {};
  let normalBridgeEntryFacts: JsonRecord[] = [];
  let defaultAttackHero: { catalogId: string; side: string; coreEntityId: string } | undefined;
  let defaultHeroMovement: JsonRecord | undefined;
  try {
    defaultRun = await launchBattle(defaultPage, baseURL);
    expect(defaultRun.buildRevision, "the default Enbu app preview is built from the capture HEAD").toBe(appRevision);
    const matchedBaselineTick = 16;
    expect(defaultRun.result.final_tick, "the default match reaches the preserved T16 comparison point").toBeGreaterThanOrEqual(matchedBaselineTick);
    const firstAttack = firstHeroAttackSource(defaultRun.ownerReplay, defaultRun.publicReplay);
    defaultFirstHeroAttackFrame = firstAttack?.frame;
    const clashTick = firstAttack?.tick as number | undefined;
    expect(clashTick, "the real default match presents a confirmed Hero attack tick").toBeDefined();
    expect(firstAttack?.entityId, "the first Hero attack resolves to its actual replay entity").toBeTruthy();
    const attackCatalogId = field(firstAttack?.entity, "catalog_id");
    const attackSide = firstAttack?.entity.owner === "attacker" ? "Azure" : firstAttack?.entity.owner === "defender" ? "Vermilion" : undefined;
    expect(typeof attackCatalogId, "the first Hero attack source retains its public catalog identity").toBe("string");
    expect(attackSide, "the first Hero attack source retains its replay-authorized side").toBeTruthy();
    const defaultBridgeRoutes = await bridgeRouteEndpoints(defaultPage);
    normalBridgeEntryFacts = normalBridgeCrossingSnapshots(defaultRun.ownerReplay, defaultBridgeRoutes, clashTick!);
    expect(normalBridgeEntryFacts.length, "the default match reaches a known normal bridge while Heroes are crossing before the first Hero attack").toBeGreaterThan(0);
    for (const snapshot of normalBridgeEntryFacts) {
      expect(heroAttackSourcesAt(frameAt(defaultRun.publicReplay, snapshot.tick)), `no Hero attack occurs during normal bridge entry at tick ${snapshot.tick}`).toHaveLength(0);
      for (const hero of snapshot.crossingHeroes as JsonRecord[]) {
        expect(hero.track, `${hero.catalogId ?? hero.entityId} uses the center track on the known normal bridge at tick ${snapshot.tick}`).toBe("CENTER");
      }
    }
    const attackReplay = firstAttack?.replay as JsonRecord;
    const movement = actualMovementTickBefore(attackReplay, firstAttack!.entityId, clashTick!);
    expect(movement, "the attacking Hero has an earlier observed logical position delta without an attack on that tick").toBeTruthy();
    matchedBaselineMovement = {
      F03: heroMovementFactsAt(defaultRun.ownerReplay, matchedBaselineTick, "F03"),
      R05: heroMovementFactsAt(defaultRun.ownerReplay, matchedBaselineTick, "R05"),
    };
    expect(Object.values(matchedBaselineMovement).some((facts) => facts !== null),
      "the T16 baseline records currently authorized Hero movement facts").toBe(true);
    const attackHero = { catalogId: attackCatalogId as string, side: attackSide!, coreEntityId: firstAttack!.entityId };
    defaultAttackHero = attackHero;
    defaultHeroMovement = movement;
    for (const viewport of viewports) {
      await ensureViewport(defaultPage, viewport);
      await setView(defaultPage, viewport, "Tactical");
      if (viewport.name === "1440x900" || viewport.name === "390x844") {
        await seekToTick(defaultPage, matchedBaselineTick);
        await saveCapture(defaultPage, "default-enbu-battle", "matched-baseline", matchedBaselineTick, viewport, "Tactical", {
          comparisonTick: matchedBaselineTick,
          firstHeroAttackTick: clashTick,
          heroAttackAtComparisonTick: frameHasHeroAttack(frameAt(defaultRun.publicReplay, matchedBaselineTick)),
          eventKindsAtComparisonTick: frameAt(defaultRun.publicReplay, matchedBaselineTick).events.map((event: JsonRecord) => event.event),
          authorizedHeroMovementAtComparisonTick: matchedBaselineMovement,
        }, captures);
        await seekToTick(defaultPage, clashTick!);
        await saveCapture(defaultPage, "default-enbu-battle", "first-hero-clash", clashTick!, viewport, "Tactical", {
          outcome: defaultRun.result.outcome,
          firstHeroAttackTick: clashTick,
          eventKinds: frameAt(defaultRun.publicReplay, clashTick!).events.map((event: JsonRecord) => event.event),
          sourceCatalogId: attackHero.catalogId,
          sourceCoreEntityId: attackHero.coreEntityId,
          sourceSide: attackHero.side,
        }, captures);
      }
      const movementTarget = await followHero(defaultPage, viewport, attackReplay, movement!.tick, attackHero.catalogId, attackHero.side);
      await saveCapture(defaultPage, "default-enbu-battle", "confirmed-move-follow", movement!.tick, viewport, "Follow", {
        catalogId: attackHero.catalogId,
        side: attackHero.side,
        sourceCoreEntityId: attackHero.coreEntityId,
        rendererEntityId: movementTarget.id,
        movementTick: movement!.tick,
        previousTick: movement!.previousTick,
        previousPosition: movement!.previousPosition,
        position: movement!.position,
        node: movement!.node,
        edgeTo: movement!.edgeTo,
        edgeProgress: movement!.edgeProgress,
        track: movement!.track,
        eventKinds: movement!.eventKinds,
      }, captures);
      const attackTarget = await followHero(defaultPage, viewport, attackReplay, clashTick!, attackHero.catalogId, attackHero.side);
      await saveCapture(defaultPage, "default-enbu-battle", "confirmed-attack-follow", clashTick!, viewport, "Follow", {
        catalogId: attackHero.catalogId,
        side: attackHero.side,
        sourceCoreEntityId: attackHero.coreEntityId,
        rendererEntityId: attackTarget.id,
        attackTick: clashTick,
        attackEvent: firstAttack?.event.event,
        target: firstAttack?.event.payload?.target ?? null,
      }, captures);
      await seekToTick(defaultPage, defaultRun.result.final_tick);
      await setView(defaultPage, viewport, "Tactical");
      await saveCapture(defaultPage, "default-enbu-battle", "default-match-end", defaultRun.result.final_tick, viewport, "Tactical", {
        outcome: defaultRun.result.outcome,
        terminationReason: defaultRun.result.termination_reason,
        finalStateDigest: defaultRun.result.final_state_digest,
      }, captures);
      await setView(defaultPage, viewport, "Overview");
      await saveCapture(defaultPage, "default-enbu-battle", "default-match-overview", defaultRun.result.final_tick, viewport, "Overview", {
        outcome: defaultRun.result.outcome,
        terminationReason: defaultRun.result.termination_reason,
      }, captures);
      await seekToTick(defaultPage, defaultRun.result.final_tick);
      const target = await followHero(defaultPage, viewport, defaultRun.ownerReplay, defaultRun.result.final_tick);
      await saveCapture(defaultPage, "default-enbu-battle", "default-match-follow", defaultRun.result.final_tick, viewport, "Follow", {
        catalogId: target.catalogId,
        side: target.side,
        entityType: target.entityType,
        outcome: defaultRun.result.outcome,
      }, captures);
    }
  } finally {
    await defaultPage.close();
  }

  const attackerBaseAssault = configuredHeroesAt(baseAssaultSnapshot, "attacker");
  const defenderBaseAssault = configuredHeroesAt(baseAssaultSnapshot, "defender");
  const expectedAssaultRoster = ["F01", "R01", "F02", "R02", "F03"];
  expect(attackerBaseAssault.map((hero) => hero.catalogId)).toEqual(expectedAssaultRoster);
  expect(defenderBaseAssault.map((hero) => hero.catalogId)).toEqual(expectedAssaultRoster);
  expect(attackerBaseAssault.map((hero) => hero.node)).toEqual(Array(5).fill("B.BASE"));
  expect(defenderBaseAssault.map((hero) => hero.node)).toEqual(Array(5).fill("N.B.UC"));
  expect(new Set(attackerBaseAssault.map((hero) => hero.squad)).size).toBe(5);
  expect(new Set(defenderBaseAssault.map((hero) => hero.squad)).size).toBe(5);

  const baseAssaultPage = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  let baseAssaultRun: ReplayRun;
  let baseAssaultFacts: JsonRecord;
  try {
    baseAssaultRun = await launchBattle(baseAssaultPage, baseURL, baseAssaultSnapshot);
    expect(baseAssaultRun.buildRevision, "the controlled real Enbu base assault uses the capture build").toBe(appRevision);
    expect(baseAssaultRun.result.outcome, "the actual controlled Enbu assault wins as the attacker").toBe("attacker_victory");
    expect(baseAssaultRun.result.termination_reason, "attacker victory comes from destroying the enemy base").toBe("base_destroyed");
    const baseCatalogId = "base.defender";
    const initialBaseEntry = catalogEntityEntryAt(baseAssaultRun.ownerReplay, 0, "base", baseCatalogId);
    expect(initialBaseEntry, "the authorized attacker replay shows the real enemy base before damage").toBeTruthy();
    const [baseEntityId, initialBase] = initialBaseEntry!;
    const initialBaseHp = integerField(initialBase, "hp");
    expect(initialBaseHp, "the base starts with confirmed positive Enbu health").toBeGreaterThan(0);

    const firstDamageFrame = (baseAssaultRun.ownerReplay.frames as JsonRecord[]).find((frame) => {
      if (frame.tick <= 0) return false;
      const entry = catalogEntityEntryAt(baseAssaultRun.ownerReplay, frame.tick, "base", baseCatalogId);
      const hp = integerField(entry?.[1], "hp");
      return hp !== null && hp > 0 && hp < initialBaseHp!;
    });
    expect(firstDamageFrame, "the real owner replay contains an intermediate damaged base state").toBeTruthy();
    const firstDamageTick = firstDamageFrame!.tick as number;
    const damagedBaseEntry = catalogEntityEntryAt(baseAssaultRun.ownerReplay, firstDamageTick, "base", baseCatalogId);
    const damagedBaseHp = integerField(damagedBaseEntry?.[1], "hp");
    expect(damagedBaseHp).toBeGreaterThan(0);
    expect(damagedBaseHp).toBeLessThan(initialBaseHp!);
    const firstDamageAttack = heroAttacksTargeting(baseAssaultRun.ownerReplay, firstDamageTick, baseEntityId)[0];
    expect(firstDamageAttack, "the first base HP decrease is backed by an actual Hero attack event").toBeTruthy();
    const damageHeroCatalogId = requiredString(field(firstDamageAttack?.entity, "catalog_id"), "base damage source Hero catalog ID");
    const damageHeroSide = firstDamageAttack?.entity.owner === "attacker" ? "Azure" : undefined;
    expect(damageHeroSide, "the first base damage source is an attacker-owned Hero").toBe("Azure");

    const finalTick = baseAssaultRun.result.final_tick as number;
    const terminalFrame = frameAt(baseAssaultRun.ownerReplay, finalTick);
    const destroyedBaseEntry = catalogEntityEntryAt(baseAssaultRun.ownerReplay, finalTick, "base", baseCatalogId);
    expect(destroyedBaseEntry, "the terminal owner replay retains the destroyed enemy base").toBeTruthy();
    expect(integerField(destroyedBaseEntry?.[1], "hp"), "the actual terminal base state has zero HP").toBe(0);
    const objectiveDestroyedEvent = (terminalFrame.events as JsonRecord[]).find((event) =>
      event.event === "next.objective_destroyed" && event.entity === baseEntityId && event.payload?.kind?.value === "base",
    );
    expect(objectiveDestroyedEvent, "the terminal replay confirms next.objective_destroyed for the actual base").toBeTruthy();
    const terminalAttack = heroAttacksTargeting(baseAssaultRun.ownerReplay, finalTick, baseEntityId)[0];
    expect(terminalAttack, "the terminal base destruction tick contains the Hero attack that dealt the final damage").toBeTruthy();
    const terminalHeroCatalogId = requiredString(field(terminalAttack?.entity, "catalog_id"), "terminal base damage source Hero catalog ID");
    const terminalHeroSide = terminalAttack?.entity.owner === "attacker" ? "Azure" : undefined;
    expect(terminalHeroSide, "the final base damage source is an attacker-owned Hero").toBe("Azure");
    baseAssaultFacts = {
      initialConditions: {
        scenario: "existing controlled_base_node_assault attacker-winner case",
        classification: "controlled initial-node assault, not a full-map march",
        attackerStart: {
          heroCount: attackerBaseAssault.length,
          node: "B.BASE",
          catalogIds: attackerBaseAssault.map((hero) => hero.catalogId),
        },
        defenderStart: { heroCount: defenderBaseAssault.length, node: "N.B.UC" },
        squadPartition: "five Solo Heroes per side",
      },
      base: { catalogId: baseCatalogId, coreEntityId: baseEntityId, initialHp: initialBaseHp },
      firstDamage: {
        tick: firstDamageTick,
        remainingHp: damagedBaseHp,
        attackEvent: firstDamageAttack!.event.event,
        sourceCoreEntityId: firstDamageAttack!.entityId,
        sourceCatalogId: damageHeroCatalogId,
        sourceSide: damageHeroSide,
      },
      terminal: {
        tick: finalTick,
        outcome: baseAssaultRun.result.outcome,
        terminationReason: baseAssaultRun.result.termination_reason,
        baseHp: integerField(destroyedBaseEntry?.[1], "hp"),
        objectiveDestroyedEvent: objectiveDestroyedEvent!.event,
        attackEvent: terminalAttack!.event.event,
        sourceCoreEntityId: terminalAttack!.entityId,
        sourceCatalogId: terminalHeroCatalogId,
        sourceSide: terminalHeroSide,
      },
    };

    const detailedViewports = new Set(["1440x900", "390x844", "320x740"]);
    for (const viewport of viewports) {
      await ensureViewport(baseAssaultPage, viewport);
      await setView(baseAssaultPage, viewport, "Tactical");
      if (detailedViewports.has(viewport.name)) {
        const beforeTarget = await followHero(baseAssaultPage, viewport, baseAssaultRun.ownerReplay, 0, damageHeroCatalogId, damageHeroSide);
        await saveCapture(baseAssaultPage, "real-base-assault", "base-before-damage-follow", 0, viewport, "Follow", {
          ...baseAssaultFacts.initialConditions,
          baseCatalogId,
          baseCoreEntityId: baseEntityId,
          baseHp: initialBaseHp,
          targetHero: damageHeroCatalogId,
          sourceCoreEntityId: firstDamageAttack!.entityId,
          rendererEntityId: beforeTarget.id,
          nextConfirmedBaseDamageTick: firstDamageTick,
        }, captures);
        const damageTarget = await followHero(baseAssaultPage, viewport, baseAssaultRun.ownerReplay, firstDamageTick, damageHeroCatalogId, damageHeroSide);
        await saveCapture(baseAssaultPage, "real-base-assault", "base-damaged-follow", firstDamageTick, viewport, "Follow", {
          baseCatalogId,
          baseCoreEntityId: baseEntityId,
          initialHp: initialBaseHp,
          currentHp: damagedBaseHp,
          sourceCoreEntityId: firstDamageAttack!.entityId,
          sourceCatalogId: damageHeroCatalogId,
          rendererEntityId: damageTarget.id,
          attackEvent: firstDamageAttack!.event.event,
        }, captures);
      }
      const terminalTarget = await followHero(baseAssaultPage, viewport, baseAssaultRun.ownerReplay, finalTick, terminalHeroCatalogId, terminalHeroSide);
      await saveCapture(baseAssaultPage, "real-base-assault", "enemy-base-destroyed-follow", finalTick, viewport, "Follow", {
        baseCatalogId,
        baseCoreEntityId: baseEntityId,
        baseHp: 0,
        outcome: baseAssaultRun.result.outcome,
        terminationReason: baseAssaultRun.result.termination_reason,
        objectiveDestroyedEvent: objectiveDestroyedEvent!.event,
        attackEvent: terminalAttack!.event.event,
        sourceCoreEntityId: terminalAttack!.entityId,
        sourceCatalogId: terminalHeroCatalogId,
        rendererEntityId: terminalTarget.id,
      }, captures);
    }
  } finally {
    await baseAssaultPage.close();
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
    defaultInput: saveGzip("default-enbu-battle-input.json.gz", defaultRun.request.payload.snapshot),
    defaultPublicReplay: saveGzip("default-enbu-battle-public-replay.json.gz", defaultRun.publicReplay),
    defaultOwnerReplay: saveGzip("default-enbu-battle-owner-replay.json.gz", defaultRun.ownerReplay),
    baseAssaultPublicReplay: saveGzip("real-base-assault-public-replay.json.gz", baseAssaultRun.publicReplay),
    baseAssaultOwnerReplay: saveGzip("real-base-assault-owner-replay.json.gz", baseAssaultRun.ownerReplay),
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
      afterDesktop: "canonical-real-battle/1440x900/destroyed-bridge-overview-t023-overview.png",
      afterMobile: "default-enbu-battle/390x844/matched-baseline-t016-tactical.png",
      actualFirstHeroAttackTick: defaultFirstHeroAttackFrame?.tick ?? null,
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
          topBridgeDestroyed: 23, fordTransit: 24, topBridgeRebuilt: 49, fixedBridgeTransit: fixedBridgeTransit!.tick, end: 70 },
        fixedBridgeTransit,
        normalBridgeEntryBeforeFirstHeroAttack: normalBridgeEntryFacts,
        closeFocusBridgeCaptureCount: captures.filter((capture) => capture.scenario === "canonical-real-battle" && capture.facts.cameraOperation !== undefined).length,
        closeFocusBridgeTargetsByViewport: Object.fromEntries(viewports.map((viewport) => [
          viewport.name,
          captures.filter((capture) => capture.scenario === "canonical-real-battle" &&
            capture.viewport.width === viewport.width && capture.facts.cameraOperation !== undefined)
            .map((capture) => ({ tick: capture.tick, site: capture.facts.bridgeSite, state: capture.facts.bridgeState, path: capture.image.path })),
        ])),
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
      defaultBattle: {
        provenance: "unmodified five-Hero default Jinrei draft executed by the real browser Worker, local WASM and Enbu",
        matchId: defaultRun.result.match_id,
        outcome: defaultRun.result.outcome,
        terminationReason: defaultRun.result.termination_reason,
        finalTick: defaultRun.result.final_tick,
        finalStateDigest: defaultRun.result.final_state_digest,
        matchedBaselineTick: 16,
        matchedBaselineMovement,
        matchedBaselineEvents: frameAt(defaultRun.publicReplay, 16).events.map((event: JsonRecord) => event.event),
        firstHeroAttackTick: defaultFirstHeroAttackFrame?.tick ?? null,
        firstHeroAttackSource: defaultAttackHero ?? null,
        sameHeroEarlierMovement: defaultHeroMovement ?? null,
        normalBridgeEntryFacts,
        movementAndAttackFollowByViewport: Object.fromEntries(viewports.map((viewport) => [viewport.name,
          Object.fromEntries(["confirmed-move-follow", "confirmed-attack-follow"].map((state) => [state,
            captures.filter((capture) => capture.scenario === "default-enbu-battle" && capture.state === state &&
              capture.viewport.width === viewport.width && capture.viewport.height === viewport.height)
              .map((capture) => ({ tick: capture.tick, catalogId: capture.facts.catalogId, side: capture.facts.side,
                coreEntityId: capture.facts.sourceCoreEntityId, rendererEntityId: capture.facts.rendererEntityId, path: capture.image.path }))[0] ?? null,
          ])),
        ])),
        publicReplayDigest: defaultRun.publicReplay.result_digest,
        ownerReplayDigest: defaultRun.ownerReplay.result_digest,
        workerRequestId: defaultRun.request.request_id,
        wasmResponses: defaultRun.wasmResponses,
      },
      controlledBaseAssault: {
        provenance: "existing real controlled_base_node_assault attacker-winner Enbu input, exported by the Rust integration test and executed by the browser Worker + local WASM",
        scope: "controlled initial-node assault; this is separate evidence from the unmodified full-map default battle",
        matchId: baseAssaultRun.result.match_id,
        outcome: baseAssaultRun.result.outcome,
        terminationReason: baseAssaultRun.result.termination_reason,
        finalTick: baseAssaultRun.result.final_tick,
        finalStateDigest: baseAssaultRun.result.final_state_digest,
        publicReplayDigest: baseAssaultRun.publicReplay.result_digest,
        ownerReplayDigest: baseAssaultRun.ownerReplay.result_digest,
        workerRequestId: baseAssaultRun.request.request_id,
        wasmResponses: baseAssaultRun.wasmResponses,
        inputSha256: sha256(JSON.stringify(baseAssaultRun.request.payload.snapshot)),
        facts: baseAssaultFacts,
        capturesByViewport: Object.fromEntries(viewports.map((viewport) => [viewport.name,
          captures.filter((capture) => capture.scenario === "real-base-assault" &&
            capture.viewport.width === viewport.width && capture.viewport.height === viewport.height)
            .map((capture) => ({ state: capture.state, tick: capture.tick, path: capture.image.path })),
        ])),
      },
    },
    interactionChecks: {
      replaySeek: true,
      replayPlayPause: true,
      pixelAndSmooth3dToggle: true,
      desktopTacticalOverviewFollow: true,
      followAuthorizedBridgeFacility: true,
      followActualHeroMovementAndAttack: true,
      followActualLateralAndFordTransit: true,
      actualEnbuBaseDamageAndDestruction: true,
      mobileBattleOverviewFollowTimelineDetails: true,
      mapRoutesAndRiver: true,
      mapRouteBridgeState: true,
      pageErrors: [...canonical.pageErrors, ...captureRun.pageErrors, ...defaultRun.pageErrors, ...baseAssaultRun.pageErrors],
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
    `| Desktop battlefield and destroyed crossing | [6fa8296 baseline](${beforeImages.desktop}) | [real destroyed crossing](canonical-real-battle/1440x900/destroyed-bridge-overview-t023-overview.png) | 1440×900, T23, Overview |`,
    `| Mobile battlefield and matched T16 state | [6fa8296 baseline](${beforeImages.mobile}) | [actual T16 state](default-enbu-battle/390x844/matched-baseline-t016-tactical.png) | 390×844, T16, Tactical; movement facts in metadata |`,
    `| First confirmed Hero attack | — | [actual first attack](default-enbu-battle/390x844/first-hero-clash-t${String(defaultFirstHeroAttackFrame?.tick ?? 0).padStart(3, "0")}-tactical.png) | replay tick T${String(defaultFirstHeroAttackFrame?.tick ?? 0).padStart(3, "0")} |`,
    `| Same-Hero movement and attack Follow | — | [movement](default-enbu-battle/1440x900/confirmed-move-follow-t${String(defaultHeroMovement?.tick ?? 0).padStart(3, "0")}-follow.png), [attack](default-enbu-battle/1440x900/confirmed-attack-follow-t${String(defaultFirstHeroAttackFrame?.tick ?? 0).padStart(3, "0")}-follow.png) | ${defaultAttackHero?.side ?? "unknown"} ${defaultAttackHero?.catalogId ?? "unknown"}; actual replay entity IDs and position facts in metadata |`,
    `| Follow lane and bridge-free ford movement | — | [F01 lateral transit](canonical-real-battle/1440x900/lateral-crossing-follow-t003-follow.png), [F02 ford transit](canonical-real-battle/1440x900/ford-transit-follow-t024-follow.png) | CENTER occupancy and ford remaining are confirmed in the authorized owner replay at all five viewports |`,
    `| Track and river crossings | — | [lateral crossing](canonical-real-battle/1440x900/lane-crossing-t003-tactical.png), [ford transit](canonical-real-battle/1440x900/ford-transit-t024-tactical.png) | real Jinrei + Enbu + WASM |`,
    `| Bridge states | — | [expanded](canonical-real-battle/1440x900/top-bridge-expanded-t013-tactical.png), [destroyed](canonical-real-battle/1440x900/top-bridge-destroyed-t023-tactical.png), [rebuilt](canonical-real-battle/1440x900/top-bridge-rebuilt-t049-tactical.png) | replay-confirmed |`,
    `| Close-focus facility Follow | — | [TOP normal](canonical-real-battle/1440x900/top-bridge-normal-follow-t000-follow.png), [MID destroyed](canonical-real-battle/1440x900/mid-bridge-destroyed-follow-t011-follow.png), [TOP expanded](canonical-real-battle/1440x900/top-bridge-expanded-follow-t013-follow.png), [TOP destroyed](canonical-real-battle/1440x900/top-bridge-destroyed-follow-t023-follow.png), [TOP rebuilt](canonical-real-battle/1440x900/top-bridge-rebuilt-follow-t049-follow.png) | camera follows an authorized visible bridge entity |`,
    `| Real base assault and destruction | — | [initial base](real-base-assault/1440x900/base-before-damage-follow-t000-follow.png), [damaged base](real-base-assault/1440x900/base-damaged-follow-t${String(baseAssaultFacts.firstDamage.tick).padStart(3, "0")}-follow.png), [destroyed base](real-base-assault/1440x900/enemy-base-destroyed-follow-t${String(baseAssaultFacts.terminal.tick).padStart(3, "0")}-follow.png) | controlled existing Enbu scenario: attacker Heroes start at B.BASE; defenders at N.B.UC; terminal event and HP 0 are replay-confirmed |`,
    `| MID capture and default battle result | — | [capture progress](real-mid-capture/1440x900/capture-progress-t007-tactical.png), [match end](default-enbu-battle/1440x900/default-match-end-t${String(defaultRun.result.final_tick).padStart(3, "0")}-tactical.png) | ${defaultRun.result.outcome} at T${defaultRun.result.final_tick} · ${defaultRun.result.termination_reason} |`,
    "",
    "Each screenshot's SHA-256, tick, viewport, requested camera mode, renderer camera pose/target, replay identity and scene facts are listed in `metadata.json`.",
    "",
  ].join("\n");
  writeFileSync(join(outputDirectory, "comparison.md"), comparison);
  expect(existsSync(join(outputDirectory, "metadata.json"))).toBe(true);
  expect(captures.length).toBeGreaterThanOrEqual(70);
});
