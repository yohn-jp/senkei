import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";

type JsonRecord = Record<string, any>;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const snapshotPath = resolve(repoRoot, "target/next-balance/battlefield-canonical-browser-snapshot.json");
const evidenceDirectory = resolve(repoRoot, "docs/evidence/battlefield/canonical-browser");
const expectedNodes = [
  "A.BASE", "B.BASE", "N.MID.OBS",
  ...["TOP", "MID", "BOT"].flatMap((lane) => [
    `A.${lane}.T1`, `A.${lane}.T2`, `A.${lane}.J`, `A.${lane}.BANK`,
    `B.${lane}.BANK`, `B.${lane}.J`, `B.${lane}.T2`, `B.${lane}.T1`,
  ]),
  "N.A.UJ", "N.B.UJ", "N.A.LJ", "N.B.LJ", "N.A.UC", "N.B.UC", "N.A.LC", "N.B.LC",
];

async function compileScenarioInput(): Promise<void> {
  mkdirSync(dirname(snapshotPath), { recursive: true });
  execFileSync("cargo", [
    "test", "--locked", "-p", "enbu", "--test", "next_scenarios",
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
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.context().on("response", (response) => {
    if (new URL(response.url()).pathname.endsWith("/wasm/senkei_wasm.wasm")) wasmResponses.push(response.status());
  });
  await page.addInitScript((controlledSnapshot: JsonRecord) => {
    const NativeWorker = window.Worker;
    class CapturingWorker extends NativeWorker {
      postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions): void {
        const request = message as { operation?: unknown; payload?: Record<string, unknown> } | null;
        let outgoing = message;
        if (request?.operation === "simulate") {
          const target = window as typeof window & { __canonicalRequest?: unknown; __canonicalResponse?: unknown };
          const modified = structuredClone(message) as { payload?: Record<string, unknown> };
          if (!modified.payload) throw new Error("canonical browser simulation has no payload");
          modified.payload.snapshot = structuredClone(controlledSnapshot);
          outgoing = modified;
          target.__canonicalRequest = structuredClone(outgoing);
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
          const data = (event as MessageEvent).data as { operation?: unknown } | null;
          if (data?.operation === "simulate") {
            const target = window as typeof window & { __canonicalResponse?: unknown };
            target.__canonicalResponse = structuredClone(data);
          }
          listener.call(this, event as WorkerEventMap[K]);
        }, options);
      }
    }
    Object.defineProperty(window, "Worker", { configurable: true, value: CapturingWorker });
  }, snapshot);

  await page.setViewportSize({ width, height });
  await page.goto("/", { waitUntil: "networkidle" });
  await page.getByTestId("nav-next").click();
  await expect(page.getByRole("heading", { name: /Battle workbench|Battlefield console|Observe the battlefield/ })).toBeVisible();
  await page.locator("#next-tab-jinrei").click();
  await page.getByRole("button", { name: "Compile tactics" }).click();
  await expect(page.getByText("Compilation completed by the Jinrei core.")).toBeVisible({ timeout: 60_000 });
  await page.locator("#next-tab-battle").click();
  await page.getByRole("button", { name: /Launch local battle|New local battle/i }).click();
  await expect(page.getByText(/AUTHORITATIVE ENBU RESULT|Confirmed result/i).first()).toBeVisible({ timeout: 120_000 });
  const canvas = page.locator(".next-renderer-host canvas");
  await expect(canvas).toHaveAttribute("data-rendered", "true", { timeout: 30_000 });
  await expect(canvas).toHaveAttribute("data-tick", "0");
  await expect.poll(() => page.evaluate(() => Boolean((window as typeof window & { __canonicalResponse?: unknown }).__canonicalResponse))).toBe(true);
  const response = await page.evaluate(() => (window as typeof window & { __canonicalResponse?: JsonRecord }).__canonicalResponse ?? null);
  expect(response?.operation).toBe("simulate");
  expect(response?.ok).toBe(true);
  expect(response?.request_id).toBeTruthy();
  expect(wasmResponses).toContain(200);

  const simulation = response.result as JsonRecord;
  const result = simulation.outcome.result as JsonRecord;
  const publicReplay = simulation.outcome.presentation_replay as JsonRecord;
  const replay = simulation.owner_replay as JsonRecord | undefined;
  expect(replay?.perspective, "the local WASM result includes the authorized attacker replay").toBe("attacker");
  expect(result.match_id).toBe(snapshot.context.match_id);
  expect(result.final_tick).toBeGreaterThanOrEqual(50);
  expect(result.final_state_digest).toBeTruthy();
  expect(publicReplay.result_digest).toBeTruthy();
  const ownerEntitiesAt = (tick: number): JsonRecord[] => {
    const frame = replay!.frames.find((candidate: JsonRecord) => candidate.tick === tick);
    return Object.values(frame?.visible_state?.entities ?? {}) as JsonRecord[];
  };
  const ownerHeroAt = (tick: number, catalogId: string): JsonRecord | undefined => ownerEntitiesAt(tick).find((entity) =>
    entity.entity_type === "hero" && entity.fields?.catalog_id?.value === catalogId);
  const bridgeAt = (tick: number): JsonRecord | undefined => ownerEntitiesAt(tick).find((entity) =>
    entity.entity_type === "bridge" && entity.fields?.site?.value === "TOP");
  expect(ownerHeroAt(1, "F02")?.fields?.ford_remaining?.value).toBeGreaterThan(0);
  expect(ownerHeroAt(1, "F03")?.fields?.edge_to?.value).toBe("A.MID.J");
  expect(ownerHeroAt(2, "F01")?.fields?.track?.value).toBe("LEFT");
  expect(ownerHeroAt(2, "F01")?.fields?.edge_to?.value).toBe("A.TOP.T2");
  expect(ownerHeroAt(2, "R02")?.fields?.node?.value).toBe("A.MID.BANK");
  expect(ownerHeroAt(2, "R02")?.fields?.edge_to?.value ?? "").toBe("");
  expect(ownerHeroAt(50, "R01")?.fields?.node?.value).toBe("A.TOP.BANK");
  expect(ownerHeroAt(50, "R01")?.fields?.edge_to?.value).toBe("B.TOP.BANK");
  expect(bridgeAt(0)?.fields?.bridge_state?.value).toBe("normal");
  expect(bridgeAt(13)?.fields?.bridge_state?.value).toBe("expanded");
  expect(bridgeAt(23)?.fields?.bridge_state?.value).toBe("destroyed");
  expect(bridgeAt(49)?.fields?.bridge_state?.value).toBe("normal");
  expect(JSON.stringify(publicReplay)).not.toContain("slot_id");
  expect(JSON.stringify(publicReplay)).not.toContain("goal");

  await page.getByRole("button", { name: "Toggle battlefield map context" }).click();
  const nodeRows = page.getByTestId("battle-map-node");
  const nodeIds = await nodeRows.evaluateAll((nodes) => nodes.map((node) => (node as SVGElement).dataset.nodeId ?? ""));
  expect(nodeIds).toHaveLength(35);
  expect(new Set(nodeIds)).toEqual(new Set(expectedNodes));
  expect(await page.getByTestId("battle-map-route").count()).toBe(42);
  expect(await page.getByTestId("battle-map-river").count()).toBe(1);
  const bridgeRoutes = page.locator('[data-testid="battle-map-route"][data-bridge-site]');
  expect(await bridgeRoutes.count()).toBe(4);
  expect(await page.locator('[data-bridge-site="TOP"]').count()).toBe(1);
  expect(await page.locator('[data-bridge-site="MID"]').count()).toBe(2);
  expect(await page.locator('[data-bridge-site="BOT"]').count()).toBe(1);
  expect(await page.locator('[data-testid="battle-map-route"][data-ford="true"]').count()).toBe(2);

  const routeStateAt = async (tick: number): Promise<string> => {
    const slider = page.getByRole("slider", { name: "Seek replay tick" });
    await slider.evaluate((element, targetTick) => {
      const input = element as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, String(targetTick));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }, tick);
    await expect(slider).toHaveValue(String(tick));
    await expect(canvas).toHaveAttribute("data-tick", String(tick));
    return await page.locator('[data-bridge-site="TOP"]').getAttribute("data-bridge-state") ?? "";
  };
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
  expect(await routeStateAt(50)).toBe("normal");

  if (width > 700) {
    await page.screenshot({ path: join(evidenceDirectory, `desktop-${width}x${height}-bridge-transit.png`), animations: "disabled" });
    await page.getByTestId("battle-visible-roster-toggle").click();
    const roster = page.getByTestId("battle-visible-roster");
    await expect(roster).toBeVisible();
    const observer = page.getByLabel("Observe visible entity");
    const heroLabel = (await observer.locator("option").allTextContents()).find((label) => label.includes("F01"));
    expect(heroLabel, "the replay exposes an actual visible F01 Hero").toBeTruthy();
    await observer.selectOption({ label: heroLabel! });
    await expect(page.locator(".next-detail-card")).toContainText("F01");
  } else {
    await expect(page.getByTestId("battle-mobile-console")).toBeVisible();
    await page.getByRole("button", { name: "Details view" }).click();
    await expect(page.locator(".next-detail-card")).toBeVisible();
    await page.getByRole("button", { name: "Battle view" }).click();
    await expect(canvas).toBeVisible();
    await page.screenshot({ path: join(evidenceDirectory, `mobile-${width}x${height}-bridge-transit.png`), animations: "disabled" });
  }
  expect(pageErrors).toEqual([]);
  return { result, publicReplay, frameCount: publicReplay.frames.length, wasmStatuses: wasmResponses };
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
    expect(mobile.publicReplay.result_digest).toBe(desktop.publicReplay.result_digest);
  } finally {
    await mobilePage.close();
  }
});
