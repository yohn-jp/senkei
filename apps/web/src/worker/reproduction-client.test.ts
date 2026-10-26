import { describe, expect, it } from "vitest";
import type { ReproductionAssets, SimulationSnapshot } from "../contracts/core";
import type { RulePackage } from "../contracts/core-model";
import type { WebWorkerRequest } from "../contracts/worker";
import { WorkerCoreClient } from "./client";

class RecordingWorker {
  readonly requests: WebWorkerRequest[] = [];
  private readonly listeners = new Map<string, (event: MessageEvent<unknown>) => void>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === "function") this.listeners.set(type, listener as (event: MessageEvent<unknown>) => void);
  }

  removeEventListener(type: string): void {
    this.listeners.delete(type);
  }

  postMessage(value: unknown): void {
    const request = value as WebWorkerRequest;
    this.requests.push(request);
    const result = request.operation === "next_reproduction_assets"
      ? assets
      : response;
    queueMicrotask(() => this.listeners.get("message")?.({
      data: {
        web_protocol_version: 1,
        request_id: request.request_id,
        operation: request.operation,
        ok: true,
        result,
      },
    } as MessageEvent<unknown>));
  }

  terminate(): void {}
}

const assets: ReproductionAssets = {
  format_version: 1,
  rule_package: {} as RulePackage,
  world_definition: { id: "battlefield" },
};
const snapshot: SimulationSnapshot = {
  attacker: {} as SimulationSnapshot["attacker"],
  defender: {} as SimulationSnapshot["defender"],
  context: {} as SimulationSnapshot["context"],
};
const response = {
  outcome: {
    result: { match_id: "match-1" },
    presentation_replay: { match_id: "match-1" },
  },
};

describe("reproduction Core client transport", () => {
  it("loads the reproduction assets with the explicit Worker operation", async () => {
    const worker = new RecordingWorker();
    const client = new WorkerCoreClient({ worker: worker as unknown as Worker });

    await expect(client.reproductionAssets()).resolves.toEqual(assets);
    expect(worker.requests[0]).toMatchObject({
      operation: "next_reproduction_assets",
      payload: {},
    });
    client.dispose();
  });

  it("sends retained assets, exact snapshot digest, and explicit diagnostics selection", async () => {
    const worker = new RecordingWorker();
    const client = new WorkerCoreClient({ worker: worker as unknown as Worker });

    await expect(client.reproduce(snapshot, assets, "a".repeat(64), {
      include_diagnostics: true,
      diagnostics_side: "attacker",
    })).resolves.toEqual(response);
    expect(worker.requests[0]).toMatchObject({
      operation: "reproduce",
      payload: {
        assets,
        snapshot,
        snapshot_digest: "a".repeat(64),
        include_diagnostics: true,
        diagnostics_side: "attacker",
      },
    });
    client.dispose();
  });

  it("keeps reproduction subject to the configured request byte bound", async () => {
    const worker = new RecordingWorker();
    const client = new WorkerCoreClient({
      worker: worker as unknown as Worker,
      max_request_bytes: 128,
    });

    await expect(client.reproduce(snapshot, {
      ...assets,
      world_definition: { authored_payload: "x".repeat(256) },
    }, "a".repeat(64))).rejects.toMatchObject({ code: "invalid_request" });
    expect(worker.requests).toHaveLength(0);
    client.dispose();
  });
});
