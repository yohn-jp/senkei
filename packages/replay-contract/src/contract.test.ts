import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { decodeReplay } from "./index";
import type { Event, PresentationReplay, WorldIdentityRef } from "./generated";
import schema from "../replay.schema.json";
import basic from "../fixtures/basic-three-lane.json";
import clash from "../fixtures/clash-and-loss.json";
import tower from "../fixtures/tower-collapse.json";
import badVersion from "../fixtures/invalid/schema-version.json";
import badOrder from "../fixtures/invalid/event-order.json";
import badRef from "../fixtures/invalid/entity-reference.json";
import badValue from "../fixtures/invalid/missing-value.json";
import badSecret from "../fixtures/invalid/secret-field.json";
const validator = new Ajv2020({ strict: true }).compile(schema);
describe("JSON Schema 2020-12 and normative semantic validation", () => {
  it.each([basic, clash, tower])("accepts valid synthetic fixture", (r) => {
    expect(validator(r)).toBe(true);
    expect(decodeReplay(r).header.origin).toBe("sample");
  });
  it.each([badVersion, badValue, badSecret])(
    "rejects structural invalid fixture in JSON Schema",
    (r) => {
      expect(validator(r)).toBe(false);
      expect(() => decodeReplay(r)).toThrow("Schema");
    },
  );
  it.each([badOrder, badRef])(
    "rejects semantically invalid fixture after Schema",
    (r) => {
      expect(validator(r)).toBe(true);
      expect(() => decodeReplay(r)).toThrow();
    },
  );
  function invalid(mutate: (r: PresentationReplay) => void, message?: string) {
    const r = structuredClone(tower) as PresentationReplay;
    mutate(r);
    expect(() => decodeReplay(r)).toThrow(message);
  }
  it("rejects duplicate and decreasing same-tick order", () => {
    invalid((r) => {
      r.timeline[1].order = r.timeline[0].order;
    }, "Event order");
    invalid((r) => {
      r.timeline[1].order = -1;
    }, "Schema");
    invalid((r) => {
      r.timeline[19].tick = 0;
    }, "Event order");
  });
  it("requires and cross-checks exact World Compiler identity on executed 0.4 replays", () => {
    const r = structuredClone(basic) as PresentationReplay;
    r.schemaVersion = "0.4";
    r.header.origin = "local";
    r.header.enbuVersion = "1.2.0";
    r.scene.nodes = [{ id: "a", allegiance: "A", position: { x: 1, y: 1 } }];
    r.scene.routes = [{ id: "r", region: "lane", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }];
    expect(() => decodeReplay(r)).toThrow("complete RulePackage");
    r.header.ruleset = { id: r.header.senritsu.id, version: { major: 2, minor: 0, patch: 0 }, digest: "a".repeat(64) };
    r.header.world = {
      world_id: "world-a", schema_version: { major: 1, minor: 0, patch: 0 },
      compiler_version: { major: 1, minor: 0, patch: 0 },
      minimum_compiler: { major: 1, minor: 0, patch: 0 }, maximum_compiler_exclusive: null,
      validation_profile_id: null, validation_profile_version: null,
      logic_digest: "b".repeat(64), presentation_digest: "c".repeat(64),
    };
    r.header.senritsu.digest = `sha256:${"a".repeat(64)}`;
    expect(decodeReplay(r).header.world?.presentation_digest).toBe("c".repeat(64));
    const missingCompiler = structuredClone(r);
    delete (missingCompiler.header.world as unknown as Record<string, unknown>).compiler_version;
    expect(() => decodeReplay(missingCompiler)).toThrow("Replay 0.4 requires an exact World Compiler version");
    const zeroCompiler = structuredClone(r);
    (zeroCompiler.header.world as WorldIdentityRef).compiler_version = { major: 0, minor: 0, patch: 0 };
    expect(() => decodeReplay(zeroCompiler)).toThrow("World compiler version cannot be zero");
    const legacy = structuredClone(r);
    legacy.schemaVersion = "0.3";
    delete (legacy.header.world as unknown as Record<string, unknown>).compiler_version;
    expect(decodeReplay(legacy).header.world?.world_id).toBe("world-a");
    r.header.ruleset.digest = "d".repeat(64);
    expect(() => decodeReplay(r)).toThrow("does not match the Senritsu reference");
  });
  it("accepts capture contest only as an observation fact in Replay 0.5", () => {
    const replay = structuredClone(basic) as PresentationReplay;
    replay.schemaVersion = "0.5";
    replay.scene.nodes = [{ id: "a", allegiance: "A", position: { x: 1, y: 1 } }];
    replay.scene.routes = [{ id: "r", region: "lane", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] }];
    replay.initialView.push({
      id: "objective", side: "neutral", kind: "observation", archetype: "observation", appearanceKey: "observation",
      position: { x: 0, y: 0 }, hp: 1, maxHp: 1,
      battlefield: { captureContested: true },
    });
    expect(decodeReplay(replay).initialView.at(-1)?.battlefield?.captureContested).toBe(true);
    const oldVersion = structuredClone(replay);
    oldVersion.schemaVersion = "0.4";
    expect(() => decodeReplay(oldVersion)).toThrow("Capture contest requires replay 0.5");
    const wrongKind = structuredClone(replay);
    wrongKind.initialView.at(-1)!.kind = "unit";
    expect(() => decodeReplay(wrongKind)).toThrow("Capture contest requires an observation facility");
    const wrongType = structuredClone(replay) as unknown as { initialView: { battlefield?: Record<string, unknown> }[] };
    wrongType.initialView.at(-1)!.battlefield!.captureContested = "true";
    expect(() => decodeReplay(wrongType)).toThrow("Schema");
  });
  it("rejects noninteger, negative, beyond-end and out-of-bounds values", () => {
    invalid((r) => {
      r.timeline[0].tick = 0.5;
    }, "Schema");
    invalid((r) => {
      r.timeline[0].tick = -1;
    }, "Schema");
    invalid((r) => {
      r.timeline[0].tick = 29;
    }, "beyond result");
    invalid((r) => {
      r.initialView[0].position.x = 100;
    }, "outside scene");
  });
  it("rejects duplicate IDs, reused IDs and dead references", () => {
    invalid((r) => {
      r.initialView[1].id = r.initialView[0].id;
    }, "ID reused");
    invalid((r) => {
      const e = r.timeline.find((e) => e.type === "spawn")!;
      if ("entity" in e && e.entity) e.entity.id = r.initialView[0].id;
    }, "ID reused");
    invalid((r) => {
      r.timeline.splice(-1, 0, {
        type: "move",
        tick: 24,
        order: 0,
        entityId: "vermilion-mid-infantry",
        position: { x: 0, y: 0 },
      });
    }, "inactive entity");
    invalid((r) => {
      const e = r.timeline.find((e) => e.type === "attack")!;
      e.targetId = "unobserved";
    }, "attack target");
  });
  it("rejects damage increases, premature destruction and result mismatch", () => {
    invalid((r) => {
      r.initialView[0].hp = 501;
    }, "HP");
    invalid((r) => {
      r.timeline.find((e) => e.type === "damage")!.hp = 101;
    }, "increase HP");
    invalid((r) => {
      const zeroDamage = r.timeline.find(
        (event): event is Extract<Event, { type: "damage" }> =>
          event.type === "damage" && event.hp === 0,
      )!;
      zeroDamage.hp = 1;
    }, "zero HP");
    invalid((r) => {
      r.result.winner = "draw";
    }, "Result does not match");
    invalid((r) => {
      r.timeline.pop();
    }, "Missing match-end");
    invalid((r) => {
      r.timeline.push({ ...r.timeline.at(-1)! });
    }, "after match-end");
  });
  it("rejects private fields at each public object boundary", () => {
    for (const path of [
      "header",
      "presentation",
      "scene",
      "entity",
      "event",
      "point",
      "result",
    ]) {
      const r = structuredClone(tower);
      const target = {
        header: r.header,
        presentation: r.presentation,
        scene: r.scene,
        entity: r.initialView[0],
        event: r.timeline[0],
        point: r.initialView[0].position,
        result: r.result,
      }[path]!;
      Object.assign(target, { restrictedDiagnostics: { jinreiIR: "secret" } });
      expect(() => decodeReplay(r)).toThrow("Schema");
    }
  });
  it("accepts arbitrary scene lane counts, unknown appearances, tick-zero events and order gaps", () => {
    const r = structuredClone(basic);
    r.scene.lanes.splice(1);
    r.initialView[0].appearanceKey = "future-model";
    r.timeline[0].tick = 0;
    for (const event of r.timeline) event.order *= 2;
    expect(decodeReplay(r).scene.lanes).toHaveLength(1);
  });
  it("accepts optional graph routes and validates their bounds and identities", () => {
    const r = structuredClone(basic) as PresentationReplay;
    expect(decodeReplay(r).scene.routes).toBeUndefined();
    r.scene.routes = [
      { id: "map-edge-0", region: "jungle", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
    ];
    expect(decodeReplay(r).scene.routes?.[0].points).toHaveLength(2);
    invalid((value) => {
      value.scene.routes = [
        { id: "map-edge-0", region: "jungle", points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] },
        { id: "map-edge-0", region: "jungle", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }] },
      ];
    }, "Duplicate route ID");
    invalid((value) => {
      value.scene.routes = [
        { id: "map-edge-0", region: "jungle", points: [{ x: 0, y: 0 }, { x: 100, y: 100 }] },
      ];
    }, "outside scene");
  });
  it("clones and freezes input", () => {
    const r = structuredClone(basic),
      decoded = decodeReplay(r);
    r.initialView[0].hp = 1;
    expect(decoded.initialView[0].hp).toBe(500);
    expect(() => {
      (decoded.initialView[0] as { hp: number }).hp = 1;
    }).toThrow();
  });
});
