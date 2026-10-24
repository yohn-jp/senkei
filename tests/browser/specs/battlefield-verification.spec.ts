import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

test.use({ video: "on" });

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const baselineSha = "c9fe67c0b28b2806dbfd70b5c6995ba4e3008acb";
const viewportCases = [
  { name: "1920x1080", width: 1920, height: 1080 },
  { name: "1440x900", width: 1440, height: 900 },
  { name: "430x932", width: 430, height: 932 },
  { name: "390x844", width: 390, height: 844 },
  { name: "320x844", width: 320, height: 844 },
] as const;

type JsonRecord = Record<string, any>;

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

async function seekToTick(page: import("@playwright/test").Page, tick: number): Promise<void> {
  const slider = page.getByRole("slider", { name: "Seek replay tick" });
  await slider.evaluate((element, selectedTick) => {
    const input = element as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(input, String(selectedTick));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, tick);
  await expect(slider).toHaveValue(String(tick));
  await expect(page.locator(".next-renderer-host canvas")).toHaveAttribute("data-tick", String(tick));
}

async function clickCameraMode(page: import("@playwright/test").Page, mode: "tactical" | "overview"): Promise<boolean> {
  const candidates = mode === "tactical"
    ? [/^Tactical view$/i, /^Tactical$/i, /^Battle view$/i]
    : [/^Overview view$/i, /^Overview$/i];
  for (const name of candidates) {
    const button = page.getByRole("button", { name });
    if (await button.count()) {
      await button.first().click();
      return true;
    }
  }
  // c9fe67c has no explicit camera modes. Its default pose and Overview
  // control both reset to the same whole-world pose; record that limitation.
  return false;
}

async function clickFollow(page: import("@playwright/test").Page): Promise<{ supported: boolean; target: string | null }> {
  const selector = page.getByRole("combobox", { name: /Observe visible entity/i });
  if (!(await selector.count())) return { supported: false, target: null };
  const value = await selector.locator("option").evaluateAll((options) => {
    const hero = options.find((option) => /\b[FR]0[1-6]\b/.test(option.textContent ?? ""));
    const firstTarget = options.find((option) => Boolean(option.getAttribute("value")));
    return hero?.getAttribute("value") ?? firstTarget?.getAttribute("value") ?? null;
  });
  if (!value) return { supported: false, target: null };
  await selector.selectOption(value);
  const target = await selector.locator("option:checked").innerText();
  const followButton = page.getByRole("button", { name: /^(Follow selected unit|Follow|Follow view)$/i });
  if (!(await followButton.count())) return { supported: false, target };
  await followButton.first().click();
  return { supported: true, target };
}

function frameEvents(replay: JsonRecord): { tick: number; event: string; entity: string | null; entityType: string | null }[] {
  return (replay.frames ?? []).flatMap((frame: JsonRecord) =>
    (frame.events ?? []).map((event: JsonRecord) => ({
      tick: frame.tick as number,
      event: String(event.event),
      entity: typeof event.entity === "string" ? event.entity : null,
      entityType: typeof event.entity === "string"
        ? frame.visible_state?.entities?.[event.entity]?.entity_type ?? null
        : null,
    })),
  );
}

function firstTick(events: ReturnType<typeof frameEvents>, pattern: RegExp): number | null {
  return events.find((event) => pattern.test(event.event))?.tick ?? null;
}

function firstDestroyTick(events: ReturnType<typeof frameEvents>, entityType: string): number | null {
  return events.find((event) => event.entityType === entityType && /destroy|death|collapse/i.test(event.event))?.tick ?? null;
}

function firstMovementTick(replay: JsonRecord): number | null {
  const frames = replay.frames ?? [];
  const coordinate = (entity: JsonRecord | undefined, key: "x" | "y"): number | null => {
    const field = entity?.fields?.[key];
    return field?.kind === "integer" && Number.isFinite(field.value) ? field.value : null;
  };
  for (let index = 1; index < frames.length; index += 1) {
    const previous = frames[index - 1]?.visible_state?.entities ?? {};
    const current = frames[index]?.visible_state?.entities ?? {};
    for (const [id, entity] of Object.entries(current) as [string, JsonRecord][]) {
      const old = previous[id] as JsonRecord | undefined;
      const oldX = coordinate(old, "x");
      const oldY = coordinate(old, "y");
      const newX = coordinate(entity, "x");
      const newY = coordinate(entity, "y");
      if (oldX !== null && oldY !== null && newX !== null && newY !== null && (oldX !== newX || oldY !== newY)) {
        return frames[index].tick as number;
      }
    }
  }
  return null;
}

function pngFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? pngFiles(path) : entry.isFile() && entry.name.endsWith(".png") ? [path] : [];
  });
}

test("captures fixed-tick real Enbu replay and battlefield views", async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  if (!baseURL) throw new Error("The browser runner must provide its local preview URL.");

  const outputDirectory = resolve(process.env.BATTLEFIELD_OUTPUT_DIR ?? join(repoRoot, "docs/evidence/battlefield/local-capture"));
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(outputDirectory, { recursive: true });
  const appSha = process.env.BATTLEFIELD_APP_SHA ?? execFileSync("git", ["-C", repoRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const wasmPath = join(repoRoot, "apps/web/public/wasm/senkei_wasm.wasm");
  const wasmSha = sha256(readFileSync(wasmPath));
  const wasmResponses: { status: number; fromServiceWorker: boolean; url: string }[] = [];
  page.context().on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) {
      wasmResponses.push({ status: response.status(), fromServiceWorker: response.fromServiceWorker(), url: response.url() });
    }
  });

  // Capture the actual Next worker request and reply. The page still executes
  // the production Next route, real worker, real WASM adapter and real renderer.
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    class CapturingWorker extends NativeWorker {
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        if ((message as { operation?: unknown } | null)?.operation === "simulate") {
          const target = window as typeof window & { __battlefieldSimRequest?: unknown };
          target.__battlefieldSimRequest = structuredClone(message);
        }
        if (transfer === undefined) super.postMessage(message);
        else super.postMessage(message, transfer as Transferable[]);
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
          const data = (event as MessageEvent).data as { operation?: unknown; request_id?: unknown } | null;
          if (data?.operation === "simulate") {
            const target = window as typeof window & { __battlefieldSimResponse?: unknown };
            target.__battlefieldSimResponse = structuredClone(data);
          }
          listener.call(this, event as WorkerEventMap[K]);
        }, options);
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: CapturingWorker });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByTestId("nav-next").click();
  await expect(page.getByRole("heading", { name: /Battle workbench/ })).toBeVisible();
  await expect(page.getByText("REAL LOCAL SIMULATION")).toBeVisible();

  await page.locator("#next-tab-jinrei").click();
  const compile = page.getByRole("button", { name: "Compile tactics" });
  await compile.click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.locator("#next-tab-battle").click();
  await page.getByRole("button", { name: "Launch local battle" }).click();
  await expect(page.getByText(/AUTHORITATIVE ENBU RESULT|Confirmed result/i).first()).toBeVisible({ timeout: 120_000 });
  const canvas = page.locator(".next-renderer-host canvas");
  await expect(canvas).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
  await expect(canvas).toHaveAttribute("data-tick", "0");

  const captured = await page.evaluate(() => {
    const current = window as typeof window & { __battlefieldSimRequest?: JsonRecord; __battlefieldSimResponse?: JsonRecord };
    return { request: current.__battlefieldSimRequest ?? null, response: current.__battlefieldSimResponse ?? null };
  });
  expect(captured.request, "the UI must have submitted an actual local simulation request").not.toBeNull();
  expect(captured.response, "the real worker must have returned the local simulation result").not.toBeNull();
  expect(captured.request!.operation).toBe("simulate");
  expect(captured.response!.operation).toBe("simulate");
  expect(captured.response!.ok).toBe(true);
  expect(captured.response!.request_id).toBe(captured.request!.request_id);
  expect(captured.request!.payload.snapshot.context.match_id).toBeTruthy();
  expect(wasmResponses.length, "the browser must fetch the real WASM module").toBeGreaterThan(0);
  expect(wasmResponses.some((response) => response.status === 200)).toBe(true);

  const simulation = captured.response!.result as JsonRecord;
  const outcome = simulation.outcome as JsonRecord;
  const result = outcome.result as JsonRecord;
  const publicReplay = outcome.presentation_replay as JsonRecord;
  const sourceReplay = (simulation.owner_replay as JsonRecord | undefined) ?? publicReplay;
  const requestSnapshot = captured.request!.payload.snapshot as JsonRecord;
  expect(result.match_id).toBe(requestSnapshot.context.match_id);
  expect(sourceReplay.match_id).toBe(result.match_id);
  expect(publicReplay.match_id).toBe(result.match_id);
  expect(sourceReplay.frames.length).toBeGreaterThan(0);
  expect(sourceReplay.perspective ?? "public").toMatch(/^(attacker|defender|public)$/);

  const events = frameEvents(sourceReplay);
  const movementTick = firstMovementTick(sourceReplay);
  const clashTick = firstTick(events, /attack|damage|skill|hit/i);
  const skillTick = firstTick(events, /skill|ability|activate/i);
  const towerDestroyTick = firstDestroyTick(events, "tower");
  const baseDestroyTick = firstDestroyTick(events, "base");
  const heroDeathTick = firstDestroyTick(events, "hero");
  const respawnTick = firstTick(events, /respawn|revive/i);
  const finalTick = result.final_tick as number;
  const followTick = Math.min(50, finalTick);
  const stateTicks = {
    tactical: 0,
    overview: 0,
    follow: followTick,
    advance: movementTick,
    clash: clashTick,
    tower_destroy: towerDestroyTick,
    base_destroy: baseDestroyTick,
    hero_death: heroDeathTick,
    respawn: respawnTick,
    skill: skillTick,
    end: finalTick,
  };

  const replayJson = `${JSON.stringify(sourceReplay, null, 2)}\n`;
  const publicReplayJson = `${JSON.stringify(publicReplay, null, 2)}\n`;
  const inputJson = `${JSON.stringify(captured.request!.payload.snapshot, null, 2)}\n`;
  writeFileSync(join(outputDirectory, "actual-owner-presentation-replay.json"), replayJson);
  writeFileSync(join(outputDirectory, "actual-public-presentation-replay.json"), publicReplayJson);
  writeFileSync(join(outputDirectory, "actual-simulation-input.json"), inputJson);

  const modeSupport: Record<string, boolean> = {};
  const followSupport: Record<string, boolean> = {};
  const mobileConsoleSupport: Record<string, Record<string, boolean>> = {};
  const layoutByViewport: Record<string, JsonRecord> = {};
  const followTarget = await clickFollow(page);
  followSupport.initial = followTarget.supported;

  for (const viewport of viewportCases) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.locator(".next-renderer-host").scrollIntoViewIfNeeded();
    await expect(canvas).toHaveAttribute("data-rendered", "true");
    const directory = join(outputDirectory, viewport.name);
    mkdirSync(directory, { recursive: true });

    await seekToTick(page, stateTicks.tactical ?? 0);
    modeSupport.tactical = await clickCameraMode(page, "tactical");
    await page.screenshot({ path: join(directory, "tactical-t000.png"), animations: "disabled" });

    await seekToTick(page, stateTicks.overview ?? 0);
    modeSupport.overview = await clickCameraMode(page, "overview");
    await page.screenshot({ path: join(directory, "overview-t000.png"), animations: "disabled" });

    await seekToTick(page, followTick);
    const followControl = page.getByRole("button", { name: /^(Follow selected unit|Follow)$/i });
    if (followTarget.target && await followControl.count()) {
      await followControl.first().click();
      followSupport[viewport.name] = true;
    } else {
      followSupport[viewport.name] = false;
    }
    await page.screenshot({ path: join(directory, `follow-t${String(followTick).padStart(3, "0")}.png`), animations: "disabled" });

    for (const [name, tick] of [
      ["advance", movementTick],
      ["clash", clashTick],
      ["tower-destroy", towerDestroyTick],
      ["base-destroy", baseDestroyTick],
      ["hero-death", heroDeathTick],
      ["respawn", respawnTick],
      ["skill", skillTick],
      ["end", finalTick],
    ] as const) {
      if (tick === null) continue;
      await seekToTick(page, tick);
      await clickCameraMode(page, "tactical");
      await page.screenshot({ path: join(directory, `${name}-t${String(tick).padStart(3, "0")}.png`), animations: "disabled" });
    }

    if (viewport.width <= 700) {
      mobileConsoleSupport[viewport.name] = {};
      for (const view of ["Timeline view", "Details view"] as const) {
        const button = page.getByRole("button", { name: view });
        if (await button.count()) {
          await button.first().click();
          mobileConsoleSupport[viewport.name][view] = true;
          await page.screenshot({ path: join(directory, `${view.toLowerCase().replaceAll(" ", "-")}-t${String(clashTick ?? 0).padStart(3, "0")}.png`), animations: "disabled" });
        } else {
          mobileConsoleSupport[viewport.name][view] = false;
        }
      }
      const battleView = page.getByRole("button", { name: "Battle view" });
      if (await battleView.count()) await battleView.first().click();
    }

    const stageBox = await page.locator(".next-renderer-host").boundingBox();
    const controls = page.locator(".next-replay-controls");
    const controlsBox = await controls.count() ? await controls.boundingBox() : null;
    layoutByViewport[viewport.name] = {
      viewport: { width: viewport.width, height: viewport.height },
      document: await page.evaluate(() => ({
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      })),
      stageBox,
      controlsBox,
      camera: await canvas.evaluate((element) => ({
        pose: element.getAttribute("data-camera"),
        mode: element.getAttribute("data-camera-mode"),
        tick: element.getAttribute("data-tick"),
      })),
    };
  }

  const imageSha256 = Object.fromEntries(pngFiles(outputDirectory).map((path) => [
    path.slice(outputDirectory.length + 1).replaceAll("\\", "/"),
    sha256(readFileSync(path)),
  ]));
  const metadata = {
    captureType: "actual-real-wasm-enbu-presentation-replay",
    baselineCommit: baselineSha,
    appCommit: appSha,
    wasmSha256: wasmSha,
    worker: {
      requestId: captured.request!.request_id,
      operation: captured.request!.operation,
      responseOk: captured.response!.ok,
      wasmResponses,
    },
    input: {
      matchId: requestSnapshot.context.match_id,
      ruleset: requestSnapshot.context.ruleset,
      contextSchemaVersion: requestSnapshot.context.schema_version,
      sha256: sha256(inputJson),
    },
    replay: {
      matchId: sourceReplay.match_id,
      view: sourceReplay.perspective ?? "public-presentation",
      schemaVersion: sourceReplay.schema_version,
      presentationDigest: sourceReplay.result_digest,
      publicPresentationDigest: publicReplay.result_digest,
      sourceFrameCount: sourceReplay.frames.length,
      timelineEventCount: events.length,
      eventKinds: [...new Set(events.map((event) => event.event))].sort(),
      sha256: sha256(replayJson),
    },
    result: {
      outcome: result.outcome,
      terminationReason: result.termination_reason,
      finalTick,
      finalStateDigest: result.final_state_digest,
    },
    exactTicks: stateTicks,
    availableCues: {
      advance: movementTick !== null,
      clash: clashTick !== null,
      towerDestroy: towerDestroyTick !== null,
      baseDestroy: baseDestroyTick !== null,
      heroDeath: heroDeathTick !== null,
      respawn: respawnTick !== null,
      activeSkill: skillTick !== null,
      end: true,
    },
    cameraControls: {
      explicitTacticalMode: Boolean(modeSupport.tactical),
      explicitOverviewMode: Boolean(modeSupport.overview),
      followTarget: followTarget.target,
      followAvailable: followSupport,
    },
    mobileConsole: mobileConsoleSupport,
    layoutByViewport,
    viewports: viewportCases,
    screenshotNames: [
      "tactical", "overview", "follow", "advance", "clash", "tower-destroy", "base-destroy",
      "hero-death", "respawn", "skill", "end",
    ].filter((name) => stateTicks[name.replaceAll("-", "_") as keyof typeof stateTicks] !== null),
    hashes: {
      simulationResponseSha256: sha256(JSON.stringify(simulation)),
      ownerReplaySha256: sha256(replayJson),
      publicReplaySha256: sha256(publicReplayJson),
      inputSnapshotSha256: sha256(inputJson),
      imageSha256,
    },
  };
  writeFileSync(join(outputDirectory, "metadata.json"), `${JSON.stringify(metadata, null, 2)}\n`);

  expect(metadata.captureType).toBe("actual-real-wasm-enbu-presentation-replay");
  expect(metadata.input.matchId).toBe(metadata.replay.matchId);
  expect(metadata.replay.presentationDigest).toBe(sourceReplay.result_digest);
  expect(metadata.result.finalStateDigest).toBe(result.final_state_digest);
  expect(metadata.availableCues.end).toBe(true);

  const video = page.video();
  await page.close();
  if (video) await video.saveAs(join(outputDirectory, "battlefield-capture.webm"));
});
