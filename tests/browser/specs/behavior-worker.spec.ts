import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("versioned Behavior input crosses the real Worker/WASM boundary with owner isolation", async ({ page }) => {
  const fixture = JSON.parse(readFileSync(new URL("../../conformance/behavior-fixture.request.json", import.meta.url), "utf8"));
  const workerStarted = page.waitForEvent("worker", worker => worker.url().includes("core.worker"));
  await page.goto("/");
  const workerUrl = (await workerStarted).url();
  const invoke = (payload: unknown) => page.evaluate(async ({ workerUrl, payload }) => {
    return await new Promise<any>((resolve, reject) => {
      const worker = new Worker(workerUrl, { type: "module" });
      worker.onmessage = event => { worker.terminate(); resolve(event.data); };
      worker.onerror = event => { worker.terminate(); reject(new Error(event.message)); };
      worker.postMessage({ web_protocol_version: 1, request_id: "behavior-browser", operation: "simulate_behavior", payload });
    });
  }, { workerUrl, payload });

  const owner = await invoke(fixture.payload);
  expect(owner.ok).toBe(true);
  expect(owner.result.owner.authorized_side).toBe("attacker");
  expect(owner.result.owner.diagnostics.identity.schema_version).toBe(2);
  expect(owner.result.owner.diagnostics.identity.snapshot_digest).toBe(owner.result.owner.behavior_run_digest);
  expect(owner.result.owner.trace).toEqual(expect.arrayContaining([
    expect.objectContaining({ side: "attacker", arbitration_accepted: true, transition_completed: true }),
  ]));
  expect(owner.result.replay.frames.at(-1).events).toEqual(expect.arrayContaining([expect.objectContaining({ event: "lane_shifted" })]));

  const publicPayload = { ...fixture.payload, include_diagnostics: false };
  delete publicPayload.diagnostics_side;
  const publicResult = await invoke(publicPayload);
  expect(publicResult.ok).toBe(true);
  expect(publicResult.result).not.toHaveProperty("owner");
  expect(publicResult.result.result).toEqual(owner.result.result);
  expect(publicResult.result.replay).toEqual(owner.result.replay);

  const defender = await invoke({ ...fixture.payload, diagnostics_side: "defender" });
  expect(defender.ok).toBe(true);
  expect(defender.result.owner.authorized_side).toBe("defender");
  expect(defender.result.owner.trace).toEqual([]);
  expect(defender.result.owner.diagnostics.events.every((event: { side: string }) => event.side === "defender")).toBe(true);
  const refused = await invoke({ ...fixture.payload, diagnostics_side: undefined });
  expect(refused.ok).toBe(false);
});
