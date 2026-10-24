import { describe, expect, it } from "vitest";
import Ajv2020 from "ajv/dist/2020.js";
import { decodeReplay } from "./index";
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
  function invalid(mutate: (r: typeof tower) => void, message?: string) {
    const r = structuredClone(tower);
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
      r.timeline.find((e) => e.type === "damage" && e.hp === 0)!.hp = 1;
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
