import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";
import { expect, test, type Page } from "@playwright/test";
import { completePreflight } from "../helpers/preflight";

type JsonRecord = Record<string, any>;
type ViewCapture = {
  readonly name: string;
  readonly tick: number;
  readonly cameraMode: string | null;
  readonly tracking: string | null;
  readonly poseEntityId: string | null;
  readonly pose: string | null;
  readonly poseSample: string | null;
  readonly cueLabels: readonly string[];
  readonly facts: JsonRecord;
  readonly image: { readonly path: string; readonly sha256: string };
};

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sourceInputPath = resolve(
  repoRoot,
  "docs/evidence/battlefield/visual-acceptance/root-20261025025946/2026-10-25T02-59-54-115Z-pid2972976/default-enbu-victory-input.json.gz",
);
const outputRoot = resolve(repoRoot, process.env.BATTLEFIELD_EVENT_PROOF_OUTPUT_DIR ??
  "docs/evidence/battlefield/graphics-completion/combat-event-proof-8728a8e");
const runId = `${new Date().toISOString().replaceAll(/[:.]/g, "-")}-pid${process.pid}`;
const outputDirectory = join(outputRoot, runId);
const expectedPreviewUrl = process.env.BATTLEFIELD_EXPECTED_PREVIEW_URL ?? "http://127.0.0.1:4196";
const expectedBuildRevision = process.env.BATTLEFIELD_EXPECTED_APP_REVISION ?? "8728a8e47fd3c6669458445c2bb250701dd41166";
const expectedWasmSha256 = process.env.BATTLEFIELD_EXPECTED_WASM_SHA256 ??
  "f1889c3686ef3d62de53e206709c7f36177cdf1a27bbb13ea3a0c5bef07b7a18";
const expectedSourceInputSha256 = process.env.BATTLEFIELD_EXPECTED_INPUT_SHA256 ??
  "1f73d71c44f945ad08c1d02df624883d0f17cf352baca6c293346b5bfad612b7";
const expectedRulesetDigest = process.env.BATTLEFIELD_EXPECTED_RULESET_DIGEST ??
  "31ce86db9492354e339ed4172ca19b4a5f92b076ea73fe36e0d8be1ce97eb481";

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function field(entity: JsonRecord | undefined, key: string): unknown {
  const value = entity?.fields?.[key];
  return value && typeof value === "object" && "value" in value ? value.value : undefined;
}

function entityReference(value: JsonRecord | undefined): string | null {
  return value?.kind === "entity" && typeof value.value === "string" ? value.value : null;
}

function frameAt(replay: JsonRecord, tick: number): JsonRecord {
  const frame = (replay.frames as JsonRecord[] | undefined)?.find((candidate) => candidate.tick === tick);
  if (!frame) throw new Error(`The current Enbu Worker replay has no frame at T${tick}.`);
  return frame;
}

function stateEntities(replay: JsonRecord, tick: number): Record<string, JsonRecord> {
  return frameAt(replay, tick).visible_state?.entities ?? {};
}

function typedEntityPosition(entity: JsonRecord): JsonRecord | null {
  const x = field(entity, "x");
  const y = field(entity, "y");
  const track = field(entity, "track");
  const edgeProgress = field(entity, "edge_progress");
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y) ||
    typeof track !== "string" || !Number.isSafeInteger(edgeProgress)) return null;
  return { x, y, track, edgeProgress };
}

function identity(entity: JsonRecord, replayEntityId?: string): JsonRecord {
  return {
    entityType: entity.entity_type ?? null,
    replayEntityId: replayEntityId ?? entity.id ?? null,
    catalogId: field(entity, "catalog_id") ?? null,
    owner: entity.owner ?? null,
    hp: field(entity, "hp") ?? null,
    node: field(entity, "node") ?? null,
    edgeTo: field(entity, "edge_to") ?? null,
    position: typedEntityPosition(entity),
  };
}

function activeSkillDamageProof(replay: JsonRecord): JsonRecord {
  const frames = replay.frames as JsonRecord[];
  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const entities = frame.visible_state?.entities as Record<string, JsonRecord> | undefined;
    const previousEntities = frames[index - 1]?.visible_state?.entities as Record<string, JsonRecord> | undefined;
    if (!entities) continue;
    for (const skill of (frame.events ?? []) as JsonRecord[]) {
      if (skill.event !== "next.skill") continue;
      const sourceId = entityReference(skill.payload?.source);
      if (!sourceId || entities[sourceId]?.entity_type !== "hero") continue;
      const damage = (frame.events as JsonRecord[]).find((candidate) =>
        candidate.event === "next.skill_damage" &&
        entityReference(candidate.payload?.source) === sourceId &&
        entities[entityReference(candidate.payload?.target) ?? ""]?.entity_type === "hero",
      );
      if (!damage) continue;
      const targetId = entityReference(damage.payload?.target);
      if (!targetId) continue;
      const source = entities[sourceId];
      const target = entities[targetId];
      const previousHp = field(previousEntities?.[targetId], "hp");
      const currentHp = field(target, "hp");
      if (!Number.isSafeInteger(previousHp) || !Number.isSafeInteger(currentHp) || Number(currentHp) >= Number(previousHp)) continue;
      return {
        tick: frame.tick,
        skillKey: skill.payload?.skill?.kind === "string" ? skill.payload.skill.value : null,
        sourceId,
        source: identity(source, sourceId),
        targetId,
        target: identity(target, targetId),
        targetHpBefore: previousHp,
        targetHpAfter: currentHp,
        skillEvent: skill,
        damageEvent: damage,
      };
    }
  }
  throw new Error("The actual current-WASM replay has no Hero-targeted Skill damage event followed by lower authorized target HP.");
}

function heroDeathWithAttackProof(replay: JsonRecord): JsonRecord {
  for (const frame of replay.frames as JsonRecord[]) {
    const entities = frame.visible_state?.entities as Record<string, JsonRecord> | undefined;
    if (!entities) continue;
    for (const death of (frame.events ?? []) as JsonRecord[]) {
      if (death.event !== "next.death" || typeof death.entity !== "string") continue;
      const target = entities[death.entity];
      if (target?.entity_type !== "hero" || field(target, "hp") !== 0) continue;
      const sourceId = entityReference(death.payload?.source);
      if (!sourceId || entities[sourceId]?.entity_type !== "hero") continue;
      const attack = (frame.events as JsonRecord[]).find((candidate) =>
        candidate.event === "next.attack" &&
        entityReference(candidate.payload?.source) === sourceId &&
        entityReference(candidate.payload?.target) === death.entity,
      );
      if (!attack) continue;
      return {
        tick: frame.tick,
        sourceId,
        source: identity(entities[sourceId], sourceId),
        targetId: death.entity,
        target: identity(target, death.entity),
        attackEvent: attack,
        deathEvent: death,
      };
    }
  }
  throw new Error("The actual current-WASM replay has no Hero-targeted attack followed by confirmed Hero death in one frame.");
}

function heroVisibilityLossWithoutDeath(replay: JsonRecord): JsonRecord {
  const frames = replay.frames as JsonRecord[];
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]!;
    const current = frames[index]!;
    const priorEntities = previous.visible_state?.entities as Record<string, JsonRecord> | undefined;
    const currentEntities = current.visible_state?.entities as Record<string, JsonRecord> | undefined;
    if (!priorEntities || !currentEntities) continue;
    const deathIds = new Set<string>();
    for (const event of (current.events ?? []) as JsonRecord[]) {
      if (event.event !== "next.death") continue;
      if (typeof event.entity === "string") deathIds.add(event.entity);
      const targetId = entityReference(event.payload?.target);
      if (targetId) deathIds.add(targetId);
    }
    for (const [entityId, entity] of Object.entries(priorEntities)) {
      if (entity.entity_type !== "hero" || typeof entity.owner !== "string" ||
        !Number.isSafeInteger(field(entity, "hp")) || Number(field(entity, "hp")) <= 0) continue;
      const catalogId = field(entity, "catalog_id");
      if (typeof catalogId !== "string") continue;
      const sameIdentityVisible = Object.values(currentEntities).some((candidate) =>
        candidate.entity_type === "hero" && candidate.owner === entity.owner && field(candidate, "catalog_id") === catalogId,
      );
      if (sameIdentityVisible || deathIds.has(entityId)) continue;
      return {
        tick: current.tick,
        previousTick: previous.tick,
        entityId,
        entity: identity(entity, entityId),
        lastSeenHp: field(entity, "hp"),
        currentViewState: "absent",
        confirmedDeathEventForEntity: false,
        interpretation: "last seen with positive HP; absent from current authorized view; no confirmed death event",
        noCurrentEntityWithSameOwnerAndCatalogId: true,
      };
    }
  }
  throw new Error("The actual current-WASM replay has no living Hero that disappears from the current view without a death event.");
}

function attackDisplacementAudit(replay: JsonRecord): JsonRecord {
  const frames = replay.frames as JsonRecord[];
  const changed: JsonRecord[] = [];
  let compared = 0;
  let skippedVisibilityOrIdentityGaps = 0;
  let skippedDeadOrRespawning = 0;
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]!;
    const current = frames[index]!;
    const priorEntities = previous.visible_state?.entities as Record<string, JsonRecord> | undefined;
    const currentEntities = current.visible_state?.entities as Record<string, JsonRecord> | undefined;
    if (!priorEntities || !currentEntities) continue;
    for (const event of (current.events ?? []) as JsonRecord[]) {
      if (event.event !== "next.attack") continue;
      const sourceId = entityReference(event.payload?.source);
      const before = sourceId ? priorEntities[sourceId] : undefined;
      const after = sourceId ? currentEntities[sourceId] : undefined;
      if (!sourceId || before?.entity_type !== "hero" || after?.entity_type !== "hero" ||
        field(before, "catalog_id") !== field(after, "catalog_id") || before.owner !== after.owner) {
        skippedVisibilityOrIdentityGaps += 1;
        continue;
      }
      const beforeHp = field(before, "hp");
      const afterHp = field(after, "hp");
      const beforeRespawnAt = field(before, "respawn_at");
      const afterRespawnAt = field(after, "respawn_at");
      if (!Number.isSafeInteger(beforeHp) || !Number.isSafeInteger(afterHp) || Number(beforeHp) <= 0 || Number(afterHp) <= 0 ||
        (beforeRespawnAt !== undefined && beforeRespawnAt !== 0) || (afterRespawnAt !== undefined && afterRespawnAt !== 0)) {
        skippedDeadOrRespawning += 1;
        continue;
      }
      const beforePosition = typedEntityPosition(before);
      const afterPosition = typedEntityPosition(after);
      if (!beforePosition || !afterPosition) {
        skippedVisibilityOrIdentityGaps += 1;
        continue;
      }
      compared += 1;
      if (JSON.stringify(beforePosition) !== JSON.stringify(afterPosition)) {
        changed.push({
          tick: current.tick,
          sourceId,
          catalogId: field(after, "catalog_id"),
          owner: after.owner,
          from: beforePosition,
          to: afterPosition,
          attackEvent: event,
        });
      }
    }
  }
  return {
    comparedHeroAttackSources: compared,
    skippedVisibilityOrIdentityGaps,
    skippedDeadOrRespawning,
    positionDefinition: "same continuously visible Hero identity; compare authorized final x/y, track and edge_progress at consecutive replay ticks",
    confirmedAttackWithActualDisplacement: changed,
  };
}

async function seekToTick(page: Page, tick: number): Promise<void> {
  const slider = page.getByRole("slider", { name: "Seek replay tick" });
  await expect(slider).toBeEnabled();
  const min = Number(await slider.getAttribute("min"));
  const max = Number(await slider.getAttribute("max"));
  expect(Number.isSafeInteger(tick) && tick >= min && tick <= max).toBe(true);
  await slider.focus();
  let value = Number(await slider.inputValue());
  const pressAndRead = async (key: string): Promise<number> => {
    const before = value;
    await slider.press(key);
    await expect.poll(async () => Number(await slider.inputValue()), { timeout: 2_000 }).not.toBe(before);
    value = Number(await slider.inputValue());
    return value;
  };
  if (tick === min && value !== min) value = await pressAndRead("Home");
  else if (tick === max && value !== max) value = await pressAndRead("End");
  else if (value !== tick) {
    if (Math.abs(tick - value) > 12) {
      const useHome = tick - min <= max - tick;
      if (useHome && value !== min) value = await pressAndRead("Home");
      else if (!useHome && value !== max) value = await pressAndRead("End");
    }
    const pageDirection = tick > value ? 1 : -1;
    let pageSteps = 0;
    while (value !== tick && (tick - value) * pageDirection > 3 && pageSteps < 10) {
      const before = value;
      value = await pressAndRead(pageDirection > 0 ? "PageUp" : "PageDown");
      expect((value - before) * pageDirection).toBeGreaterThan(0);
      pageSteps += 1;
      if ((tick - value) * pageDirection <= 0) break;
    }
    let arrowSteps = 0;
    while (value !== tick && arrowSteps <= max - min) {
      const direction = tick > value ? 1 : -1;
      const before = value;
      value = await pressAndRead(direction > 0 ? "ArrowRight" : "ArrowLeft");
      expect((value - before) * direction).toBeGreaterThan(0);
      arrowSteps += 1;
    }
    expect(value).toBe(tick);
  }
  await expect(slider).toHaveValue(String(tick));
  await expect(page.locator(".next-tick-readout strong")).toHaveText(String(tick));
  await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-tick", String(tick));
}

async function waitForSettledCamera(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".next-renderer-host canvas");
    const pose = canvas?.getAttribute("data-camera");
    if (!pose) return false;
    const tracker = window as typeof window & { __eventProofLastPose?: string; __eventProofStableFrames?: number };
    tracker.__eventProofStableFrames = tracker.__eventProofLastPose === pose ? (tracker.__eventProofStableFrames ?? 0) + 1 : 0;
    tracker.__eventProofLastPose = pose;
    return (tracker.__eventProofStableFrames ?? 0) >= 8;
  }, null, { timeout: 8_000 });
}

async function followHero(page: Page, replay: JsonRecord, tick: number, catalogId: string): Promise<JsonRecord> {
  await seekToTick(page, tick);
  const entities = stateEntities(replay, tick);
  const targetEntry = Object.entries(entities).find(([, entity]) => entity.entity_type === "hero" &&
    field(entity, "catalog_id") === catalogId && Number(field(entity, "hp")) > 0);
  expect(targetEntry, `the authorized owner replay shows living ${catalogId} at T${tick}`).toBeTruthy();
  const [replayEntityId, target] = targetEntry!;
  const side = target.owner === "attacker" ? "Azure" : target.owner === "defender" ? "Vermilion" : null;
  expect(side).not.toBeNull();
  await page.getByRole("button", { name: "Tactical view" }).click();
  const observer = page.getByRole("combobox", { name: "Observe visible entity" });
  const options = await observer.locator("option").all();
  let rendererEntityId: string | null = null;
  for (const option of options) {
    const label = (await option.innerText()).trim();
    if (!label.startsWith(`${side} · ${catalogId}`)) continue;
    rendererEntityId = await option.getAttribute("value");
    break;
  }
  expect(rendererEntityId, `the current renderer roster exposes ${side} ${catalogId} at T${tick}`).toBeTruthy();
  await observer.selectOption(rendererEntityId!);
  await page.getByRole("button", { name: "Follow selected unit" }).click();
  const canvas = page.locator(".next-renderer-host canvas");
  await expect(canvas).toHaveAttribute("data-tracking", rendererEntityId!);
  await waitForSettledCamera(page);
  return { replayEntityId, rendererEntityId, catalogId, side };
}

function saveGzip(name: string, value: unknown): JsonRecord {
  const data = Buffer.from(JSON.stringify(value));
  const compressed = gzipSync(data, { level: 9 });
  const path = join(outputDirectory, name);
  writeFileSync(path, compressed);
  return {
    path: relative(repoRoot, path).replaceAll("\\", "/"),
    uncompressedBytes: data.length,
    compressedBytes: compressed.length,
    sha256: sha256(data),
  };
}

test("re-simulates a real v2 Enbu battle and captures authorized Skill, hit, Hero death and visibility loss cues", async ({ page, browser, baseURL }) => {
  test.skip(process.env.BATTLEFIELD_EVENT_PROOF !== "1", "Run only as a focused external-preview event proof.");
  test.setTimeout(600_000);
  expect(process.env.SENKEI_BROWSER_EXTERNAL_PREVIEW).toBe("true");
  expect(baseURL).toBe(expectedPreviewUrl);
  if (!baseURL) throw new Error("The focused combat event proof requires the frozen external preview.");
  if (!existsSync(sourceInputPath)) throw new Error(`The existing real current-ruleset scenario input is missing: ${sourceInputPath}`);

  const sourceInputGzip = readFileSync(sourceInputPath);
  const sourceInput = JSON.parse(gunzipSync(sourceInputGzip).toString("utf8")) as JsonRecord;
  const sourceInputJson = JSON.stringify(sourceInput);
  const sourceInputSha256 = sha256(sourceInputJson);
  expect(sourceInputSha256, "the injected input is the identified real scenario snapshot").toBe(expectedSourceInputSha256);
  expect(sourceInput.context?.ruleset?.digest, "the input uses the identified authorized ruleset").toBe(expectedRulesetDigest);
  const captures: ViewCapture[] = [];
  mkdirSync(outputDirectory, { recursive: true });
  const progressPath = join(outputDirectory, "capture-progress.json");
  const writeProgress = (status: string, details: JsonRecord = {}) => {
    const temporaryPath = `${progressPath}.tmp-${process.pid}`;
    writeFileSync(temporaryPath, `${JSON.stringify({
      schema: "senkei-battlefield-combat-event-proof-progress/v1",
      status,
      runId,
      expectedPreviewUrl,
      expectedBuildRevision,
      expectedWasmSha256,
      expectedSourceInputSha256,
      expectedRulesetDigest,
      sourceInputPath: relative(repoRoot, sourceInputPath).replaceAll("\\", "/"),
      sourceInputGzipSha256: sha256(sourceInputGzip),
      sourceInputSha256,
      matchId: sourceInput.context?.match_id ?? null,
      ruleset: sourceInput.context?.ruleset ?? null,
      browser: browser.version(),
      captures,
      ...details,
    }, null, 2)}\n`);
    renameSync(temporaryPath, progressPath);
  };
  writeProgress("PREPARING");

  const pageErrors: string[] = [];
  const wasmResponses: { status: number; url: string }[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.context().on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) {
      wasmResponses.push({ status: response.status(), url: response.url() });
    }
  });
  await page.addInitScript((snapshot: JsonRecord) => {
    const NativeWorker = window.Worker;
    class EventProofWorker extends NativeWorker {
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        const request = message as { operation?: unknown; request_id?: unknown; payload?: Record<string, unknown> } | null;
        let outgoing = message;
        const state = window as typeof window & {
          __combatEventRequest?: JsonRecord;
          __combatEventRequestId?: string;
          __combatEventResponse?: JsonRecord;
          __combatEventRuleset?: JsonRecord;
        };
        if (request?.operation === "simulate") {
          const modified = structuredClone(message) as { payload?: Record<string, unknown> };
          if (!modified.payload) throw new Error("The current UI simulation request has no payload.");
          modified.payload.snapshot = structuredClone(snapshot);
          outgoing = modified;
          state.__combatEventRequest = structuredClone(outgoing) as JsonRecord;
          state.__combatEventRequestId = String(request.request_id ?? "");
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
          const data = (event as MessageEvent).data as JsonRecord | null;
          const state = window as typeof window & {
            __combatEventRequestId?: string;
            __combatEventResponse?: JsonRecord;
            __combatEventRuleset?: JsonRecord;
          };
          if (data?.operation === "next_ruleset" && data.ok === true) state.__combatEventRuleset = structuredClone(data);
          if (data?.request_id !== undefined && data.request_id === state.__combatEventRequestId) {
            state.__combatEventResponse = structuredClone(data);
          }
          listener.call(this, event as WorkerEventMap[K]);
        }, options);
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: EventProofWorker });
  }, sourceInput);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  const buildRevision = await page.locator('meta[name="senkei-build-revision"]').getAttribute("content");
  expect(buildRevision, "capture uses the requested frozen production app revision").toBe(expectedBuildRevision);
  await page.getByTestId("nav-next").click();
  await expect(page.getByRole("heading", { name: /Battle workbench|Battlefield console|Observe the battlefield/ })).toBeVisible();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("tab", { name: "Jinrei Text", exact: true }).click();
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.locator("#next-tab-battle").click();
  const launch = page.getByRole("button", { name: /Launch local battle|New local battle/i });
  await expect(launch).toBeEnabled();
  await launch.click();
  await completePreflight(page);
  await expect(page.getByText(/Confirmed result/i)).toContainText(/Attacker Victory|Defender Victory|Draw/, { timeout: 180_000 });
  const canvas = page.locator(".next-renderer-host canvas");
  await expect(canvas).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __combatEventResponse?: unknown }).__combatEventResponse)), { timeout: 30_000 }).toBe(true);

  const captured = await page.evaluate(() => {
    const current = window as typeof window & {
      __combatEventRequest?: JsonRecord;
      __combatEventResponse?: JsonRecord;
      __combatEventRuleset?: JsonRecord;
    };
    return {
      request: current.__combatEventRequest ?? null,
      response: current.__combatEventResponse ?? null,
      rulesetResponse: current.__combatEventRuleset ?? null,
    };
  });
  const request = captured.request;
  const response = captured.response;
  const requestSnapshot = request?.payload?.snapshot as JsonRecord | undefined;
  expect(request?.operation).toBe("simulate");
  expect(response?.ok).toBe(true);
  expect(requestSnapshot).toEqual(sourceInput);
  const rulesetResponse = captured.rulesetResponse?.result;
  expect(rulesetResponse?.ruleset?.digest).toBe(sourceInput.context.ruleset.digest);
  expect(rulesetResponse?.ruleset?.digest).toBe(expectedRulesetDigest);
  const simulation = response!.result as JsonRecord;
  const result = simulation.outcome.result as JsonRecord;
  const publicReplay = simulation.outcome.presentation_replay as JsonRecord;
  const ownerReplay = simulation.owner_replay as JsonRecord;
  expect(ownerReplay.perspective).toBe("attacker");
  expect(result.match_id).toBe(sourceInput.context.match_id);
  expect(result.final_tick).toBeGreaterThan(0);
  expect(typeof result.final_state_digest).toBe("string");
  expect(typeof ownerReplay.result_digest).toBe("string");
  expect(typeof publicReplay.result_digest).toBe("string");
  expect(wasmResponses.some((item) => item.status === 200)).toBe(true);
  const servedWasmHash = wasmResponses.map((item) => new URL(item.url).searchParams.get("rev")).find(Boolean);
  expect(servedWasmHash, "the current production binary is versioned by its SHA-256").toBe(expectedWasmSha256);
  expect(pageErrors).toEqual([]);

  const skillDamage = activeSkillDamageProof(ownerReplay);
  const heroDeath = heroDeathWithAttackProof(ownerReplay);
  const visibilityLoss = heroVisibilityLossWithoutDeath(ownerReplay);
  const displacementAudit = attackDisplacementAudit(ownerReplay);
  const inputArtifact = saveGzip("actual-worker-snapshot.json.gz", requestSnapshot);
  const ownerReplayArtifact = saveGzip("actual-owner-presentation-replay.json.gz", ownerReplay);
  const publicReplayArtifact = saveGzip("actual-public-presentation-replay.json.gz", publicReplay);
  writeProgress("CAPTURING", {
    buildRevision,
    servedWasmHash,
    requestId: request.request_id,
    result: { matchId: result.match_id, outcome: result.outcome, finalTick: result.final_tick, finalStateDigest: result.final_state_digest },
    replayDigests: { owner: ownerReplay.result_digest, public: publicReplay.result_digest },
    eventProofs: { skillDamage, heroDeath, visibilityLoss, displacementAudit },
  });
  expect(displacementAudit.confirmedAttackWithActualDisplacement,
    `confirmed Hero attacks with actual x/y + logical track/progress displacement: ${JSON.stringify(displacementAudit.confirmedAttackWithActualDisplacement)}`,
  ).toEqual([]);

  const capture = async (name: string, tick: number, facts: JsonRecord): Promise<void> => {
    await seekToTick(page, tick);
    await waitForSettledCamera(page);
    const path = join(outputDirectory, `${name}-t${String(tick).padStart(3, "0")}.png`);
    await page.screenshot({ path, animations: "disabled" });
    const cueLabels = await page.locator(`.cue-world-label[data-tick="${tick}"]`).evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("aria-label") ?? ""),
    );
    const entry: ViewCapture = {
      name,
      tick,
      cameraMode: await canvas.getAttribute("data-camera-mode"),
      tracking: await canvas.getAttribute("data-tracking"),
      poseEntityId: await canvas.getAttribute("data-unit-pose-entity"),
      pose: await canvas.getAttribute("data-unit-pose"),
      poseSample: await canvas.getAttribute("data-unit-pose-sample"),
      cueLabels,
      facts,
      image: {
        path: relative(repoRoot, path).replaceAll("\\", "/"),
        sha256: sha256(readFileSync(path)),
      },
    };
    captures.push(entry);
    writeProgress("CAPTURING", {
      buildRevision,
      servedWasmHash,
      requestId: request.request_id,
      result: { matchId: result.match_id, outcome: result.outcome, finalTick: result.final_tick, finalStateDigest: result.final_state_digest },
      replayDigests: { owner: ownerReplay.result_digest, public: publicReplay.result_digest },
      eventProofs: { skillDamage, heroDeath, visibilityLoss, displacementAudit },
      captures,
    });
  };

  const deathSourceCatalog = String(heroDeath.source.catalogId);
  const deathTargetCatalog = String(heroDeath.target.catalogId);
  const deathFollower = await followHero(page, ownerReplay, heroDeath.tick, deathSourceCatalog);
  await expect(canvas).toHaveAttribute("data-unit-pose-entity", deathFollower.rendererEntityId);
  await expect(canvas).toHaveAttribute("data-unit-pose", "attack");
  const deathCueLabels = await page.locator(`.cue-world-label[data-cue-type="destroy"][data-tick="${heroDeath.tick}"]`).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") ?? ""),
  );
  const deathLabel = deathCueLabels.find((label) => label.includes("HERO DEFEATED") && label.includes(deathTargetCatalog));
  expect(deathLabel, `the target-specific Hero defeat cue exists among ${JSON.stringify(deathCueLabels)}`).toBeTruthy();
  const basicAttackLabels = await page.locator(`.cue-world-label[data-cue-type="attack"][data-tick="${heroDeath.tick}"]`).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") ?? ""),
  );
  expect(basicAttackLabels.some((label) => label.includes(deathSourceCatalog) && label.includes(deathTargetCatalog))).toBe(true);
  await capture("confirmed-hero-hit-death", heroDeath.tick, {
    selectedActor: deathFollower,
    attackEvent: heroDeath.attackEvent,
    deathEvent: heroDeath.deathEvent,
    targetStateAtTick: heroDeath.target,
    deathCue: deathLabel,
    attackCueLabels: basicAttackLabels,
  });

  const skillSourceCatalog = String(skillDamage.source.catalogId);
  const skillTargetCatalog = String(skillDamage.target.catalogId);
  const skillFollower = await followHero(page, ownerReplay, skillDamage.tick, skillSourceCatalog);
  await expect(canvas).toHaveAttribute("data-unit-pose-entity", skillFollower.rendererEntityId);
  // The frozen current build exposes a distinct Skill pose. Its generic numeric
  // sample intentionally contains only walk/strike/hit/attackLean channels.
  await expect(canvas).toHaveAttribute("data-unit-pose", "skill");
  const skillPoseSample = (await canvas.getAttribute("data-unit-pose-sample"))?.split(",").map(Number) ?? [];
  expect(skillPoseSample.length).toBe(4);
  expect(skillPoseSample.every(Number.isFinite)).toBe(true);
  const skillCueLabels = await page.locator(`.cue-world-label[data-cue-type="skill"][data-tick="${skillDamage.tick}"]`).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") ?? ""),
  );
  const skillLabel = skillCueLabels.find((label) => {
    const normalized = label.toUpperCase();
    return normalized.includes(String(skillDamage.skillKey).toUpperCase()) &&
      normalized.includes(`HERO · ${skillSourceCatalog}`) && normalized.includes(`HERO · ${skillTargetCatalog}`);
  });
  expect(skillLabel, `the target-specific Skill cue exists among ${JSON.stringify(skillCueLabels)}`).toBeTruthy();
  const skillDamageCueLabels = await page.locator(`.cue-world-label[data-tick="${skillDamage.tick}"]`).evaluateAll((elements) =>
    elements.filter((element) => element.getAttribute("data-cue-type") === "damage")
      .map((element) => element.getAttribute("aria-label") ?? ""),
  );
  expect(skillDamageCueLabels.some((label) => label.toUpperCase().includes(`HERO · ${skillTargetCatalog}`)),
    `the HP decrease is rendered against the replay-confirmed target: ${JSON.stringify(skillDamageCueLabels)}`,
  ).toBe(true);
  await capture("confirmed-skill-and-hit", skillDamage.tick, {
    selectedActor: skillFollower,
    targetHpBefore: skillDamage.targetHpBefore,
    targetHpAfter: skillDamage.targetHpAfter,
    selectedActorPose: await canvas.getAttribute("data-unit-pose"),
    selectedActorPoseSample: skillPoseSample,
    skillEvent: skillDamage.skillEvent,
    skillDamageEvent: skillDamage.damageEvent,
    skillCue: skillLabel,
    hitCueLabels: skillDamageCueLabels,
  });

  const disappearingCatalog = String(visibilityLoss.entity.catalogId);
  const visibilityFollower = await followHero(page, ownerReplay, visibilityLoss.previousTick, disappearingCatalog);
  await seekToTick(page, visibilityLoss.tick);
  const currentEntities = stateEntities(ownerReplay, visibilityLoss.tick);
  expect(Object.values(currentEntities).some((entity) => entity.entity_type === "hero" &&
    entity.owner === visibilityLoss.entity.owner && field(entity, "catalog_id") === disappearingCatalog)).toBe(false);
  const confirmedDeathEventForLostEntity = (frameAt(ownerReplay, visibilityLoss.tick).events as JsonRecord[]).some((event) =>
    event.event === "next.death" && (event.entity === visibilityLoss.entityId ||
      entityReference(event.payload?.target) === visibilityLoss.entityId),
  );
  expect(confirmedDeathEventForLostEntity, "visibility loss is not a confirmed Hero death").toBe(false);
  await expect(canvas).toHaveAttribute("data-tick", String(visibilityLoss.tick));
  const targetPose = await canvas.getAttribute("data-unit-pose");
  expect(targetPose, "a disappeared living Hero has no death pose").not.toBe("death");
  const destroyLabels = await page.locator(`.cue-world-label[data-cue-type="destroy"][data-tick="${visibilityLoss.tick}"]`).evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("aria-label") ?? ""),
  );
  expect(destroyLabels.some((label) => label.includes(disappearingCatalog))).toBe(false);
  await capture("visibility-loss-is-not-death", visibilityLoss.tick, {
    followedBeforeLoss: visibilityFollower,
    disappearance: visibilityLoss,
    confirmedDeathEventForLostEntity,
    interpretation: "last seen with positive HP; absent from current authorized view; no confirmed death event",
    poseAfterLoss: targetPose,
    destroyCueLabelsAtLoss: destroyLabels,
  });

  const metadataPath = join(outputDirectory, "metadata.json");
  const metadata = {
    schema: "senkei-battlefield-combat-event-proof/v1",
    status: "COMPLETE",
    sourceRevision: buildRevision,
    expectedPreviewUrl,
    expectedBuildRevision,
    browser: browser.version(),
    wasmSha256: servedWasmHash,
    expectedWasmSha256,
    expectedSourceInputSha256,
    expectedRulesetDigest,
    scenario: {
      provenance: "previously captured real current-ruleset default Jinrei battle input, re-submitted through the current browser Worker and current WASM; no replay/event injection",
      sourcePath: relative(repoRoot, sourceInputPath).replaceAll("\\", "/"),
      sourceGzipSha256: sha256(sourceInputGzip),
      sourceInputSha256,
      requestSnapshotSha256: sha256(JSON.stringify(requestSnapshot)),
      matchId: result.match_id,
      ruleset: sourceInput.context.ruleset,
      maxTicks: sourceInput.context.max_ticks,
      outcome: result.outcome,
      finalTick: result.final_tick,
      finalStateDigest: result.final_state_digest,
      workerRequestId: request.request_id,
      ownerReplayDigest: ownerReplay.result_digest,
      publicReplayDigest: publicReplay.result_digest,
      wasmResponses,
      wasmArtifacts: { input: inputArtifact, ownerReplay: ownerReplayArtifact, publicReplay: publicReplayArtifact },
    },
    eventProofs: { skillDamage, heroDeath, visibilityLoss, displacementAudit },
    captures,
    pageErrors,
  };
  writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`);
  writeProgress("COMPLETE", {
    expectedPreviewUrl,
    expectedBuildRevision,
    buildRevision,
    servedWasmHash,
    expectedWasmSha256,
    requestId: request.request_id,
    result: { matchId: result.match_id, outcome: result.outcome, finalTick: result.final_tick, finalStateDigest: result.final_state_digest },
    replayDigests: { owner: ownerReplay.result_digest, public: publicReplay.result_digest },
    metadataPath: relative(repoRoot, metadataPath).replaceAll("\\", "/"),
    eventProofs: { skillDamage, heroDeath, visibilityLoss, displacementAudit },
    captures,
  });
  expect(existsSync(metadataPath)).toBe(true);
});
