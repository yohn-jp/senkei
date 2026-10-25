import { describe, expect, it } from "vitest";
import type { DisplayEntity, DisplayState, Replay, WorldPoint } from "@senkei/replay-contract";
import { NodeDisplayLayout } from "./node-display-layout";

type NodeRow = NonNullable<Replay["scene"]["nodes"]>[number];
type RouteRow = NonNullable<Replay["scene"]["routes"]>[number];

function replay(nodes: NodeRow[], river: WorldPoint[] = [], routes: RouteRow[] = []): Replay {
  return {
    scene: {
      bounds: { min: { x: -50, y: -50 }, max: { x: 50, y: 50 } },
      nodes,
      river: river.length >= 2 ? river as [WorldPoint, WorldPoint, ...WorldPoint[]] : undefined,
      routes,
    },
  } as unknown as Replay;
}

function unit(id: string, node: string, position: WorldPoint, extra: Partial<DisplayEntity["battlefield"]> = {}): DisplayEntity {
  return {
    id,
    side: "azure",
    kind: "unit",
    archetype: "hero",
    appearanceKey: "hero-f01",
    position,
    hp: 100,
    maxHp: 100,
    destroyed: false,
    battlefield: { node, crossing: "none", ...extra },
  } as DisplayEntity;
}

function state(...entities: DisplayEntity[]): DisplayState {
  return { tick: 1, entities: Object.fromEntries(entities.map((entity) => [entity.id, entity])), cues: [], result: null } as DisplayState;
}

function point(node: string, x: number, y: number, allegiance: "A" | "B" | "N" = "N"): NodeRow {
  return { id: node, position: { x, y }, allegiance };
}

function worldPoint(entity: DisplayEntity, offset: WorldPoint): WorldPoint {
  return { x: entity.position.x + offset.x, y: entity.position.y + offset.y };
}

function distance(a: WorldPoint, b: WorldPoint): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe("presentation-only discrete battlefield layouts", () => {
  it("separates same-node units into the node-specific public plaza rings", () => {
    const map = replay([
      point("A.BASE", 0, 0, "A"),
      point("A.TOP.T1", 12, 0, "A"),
      point("N.MID.OBS", 24, 0),
      point("A.TOP.BANK", 36, 0, "A"),
      point("N.A.UJ", 48, 0),
    ]);
    const entities = [
      unit("base-a", "A.BASE", { x: 0, y: 0 }), unit("base-b", "A.BASE", { x: 0, y: 0 }),
      unit("tower-a", "A.TOP.T1", { x: 12, y: 0 }), unit("tower-b", "A.TOP.T1", { x: 12, y: 0 }),
      unit("obs-a", "N.MID.OBS", { x: 24, y: 0 }), unit("obs-b", "N.MID.OBS", { x: 24, y: 0 }),
      unit("bank-a", "A.TOP.BANK", { x: 36, y: 0 }), unit("bank-b", "A.TOP.BANK", { x: 36, y: 0 }),
      unit("jungle-a", "N.A.UJ", { x: 48, y: 0 }), unit("jungle-b", "N.A.UJ", { x: 48, y: 0 }),
    ];
    const before = JSON.stringify(entities);
    const offsets = new NodeDisplayLayout().update(state(...entities), map);

    for (const pair of [[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]]) {
      const [first, second] = pair.map((index) => entities[index]);
      const a = offsets.get(first.id), b = offsets.get(second.id);
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      expect(distance(worldPoint(first, a!), worldPoint(second, b!))).toBeGreaterThan(0.5);
    }
    expect(distance({ x: 0, y: 0 }, offsets.get("base-a")!)).toBeCloseTo(1.5, 5);
    expect(distance({ x: 0, y: 0 }, offsets.get("tower-a")!)).toBeCloseTo(2, 5);
    expect(distance({ x: 0, y: 0 }, offsets.get("obs-a")!)).toBeCloseTo(1.25, 5);
    expect(JSON.stringify(entities)).toBe(before);
  });

  it("keeps visible slots fixed when peers appear or leave and ignores raw unit geometry", () => {
    const map = replay([point("N.A.UJ", 3, 4)]);
    const layout = new NodeDisplayLayout();
    const a = unit("b-unit", "N.A.UJ", { x: 3, y: 4 });
    const b = unit("c-unit", "N.A.UJ", { x: 3, y: 4 });
    const first = layout.update(state(a, b), map);
    const aBefore = first.get(a.id)!, bBefore = first.get(b.id)!;

    const earlierId = unit("a-unit", "N.A.UJ", { x: 3, y: 4 });
    const added = layout.update(state(a, b, earlierId), map);
    expect(added.get(a.id)).toEqual(aBefore);
    expect(added.get(b.id)).toEqual(bBefore);
    expect(added.get(earlierId.id)).toBeDefined();

    const newcomer = unit("z-unit", "N.A.UJ", { x: 3, y: 4 });
    const removed = layout.update(state(b, newcomer), map);
    expect(removed.get(b.id)).toEqual(bBefore);
    expect(removed.get(newcomer.id)).not.toEqual(bBefore);
    expect(a.position).toEqual({ x: 3, y: 4 });
    expect(b.position).toEqual({ x: 3, y: 4 });
  });

  it("only lays out currently visible settled units and never moves edge or structure entities", () => {
    const map = replay([point("A.TOP.BANK", 0, 0, "A"), point("B.TOP.BANK", 8, 0, "B")]);
    const settled = unit("settled", "A.TOP.BANK", { x: 0, y: 0 });
    const edge = unit("edge", "A.TOP.BANK", { x: 1, y: 0 }, { edgeTo: "B.TOP.BANK", progress: 50, track: "CENTER", crossing: "bridge" });
    const trackCrossing = unit("track-crossing", "A.TOP.BANK", { x: 0, y: 0 }, { crossing: "track" });
    const fordCrossing = unit("ford-crossing", "A.TOP.BANK", { x: 0, y: 0 }, { crossing: "ford" });
    const structure = { ...settled, id: "tower", kind: "tower" } as DisplayEntity;
    const layout = new NodeDisplayLayout();
    const offsets = layout.update(state(settled, edge, trackCrossing, fordCrossing, structure), map);
    expect([...offsets.keys()]).toEqual(["settled"]);
    expect(layout.update(state(), map).size).toBe(0);
  });

  it("places large bank crowds outward from the nearest public river segment within a bounded radius", () => {
    const bank = point("A.TOP.BANK", -2, 1, "A");
    const map = replay([bank], [{ x: 0, y: -20 }, { x: 0, y: 20 }]);
    const entities = Array.from({ length: 55 }, (_, index) => unit(`unit-${String(index).padStart(2, "0")}`, bank.id, bank.position));
    const inputBefore = JSON.stringify(entities);
    const offsets = new NodeDisplayLayout().update(state(...entities), map);
    expect(offsets.size).toBe(55);
    for (const entity of entities) {
      const world = worldPoint(entity, offsets.get(entity.id)!);
      expect(world.x).toBeLessThan(-0.29);
      expect(distance(world, bank.position)).toBeLessThanOrEqual(2.101);
    }
    expect(JSON.stringify(entities)).toBe(inputBefore);
  });

  it("forms coincident same-track edge units along the directed route without crossing its endpoints", () => {
    const map = replay(
      [point("A.TOP.BANK", 0, 0, "A"), point("B.TOP.BANK", 12, 0, "B")],
      [],
      [{ id: "bridge.TOP", region: "bridge", bridgeSite: "TOP", points: [{ x: 0, y: 0 }, { x: 12, y: 0 }] } as RouteRow],
    );
    const makeCrowd = (x: number) => [
      unit("a", "A.TOP.BANK", { x, y: 0 }, { edgeTo: "B.TOP.BANK", progress: 100, track: "CENTER", crossing: "bridge" }),
      unit("b", "A.TOP.BANK", { x, y: 0 }, { edgeTo: "B.TOP.BANK", progress: 100, track: "CENTER", crossing: "bridge" }),
      unit("c", "A.TOP.BANK", { x, y: 0 }, { edgeTo: "B.TOP.BANK", progress: 100, track: "CENTER", crossing: "bridge" }),
      unit("d", "A.TOP.BANK", { x, y: 0 }, { edgeTo: "B.TOP.BANK", progress: 100, track: "CENTER", crossing: "bridge" }),
    ];
    const layout = new NodeDisplayLayout();
    const crowd = makeCrowd(6);
    const before = JSON.stringify(crowd);
    const offsets = layout.update(state(...crowd), map);
    expect(offsets.get("a")).toEqual({ x: 0, y: 0 });
    expect(offsets.get("b")?.x).toBeCloseTo(-0.65, 5);
    expect(offsets.get("c")?.x).toBeCloseTo(0.65, 5);
    expect(offsets.get("d")?.x).toBeCloseTo(-1.3, 5);
    for (const offset of offsets.values()) expect(offset.y).toBe(0);
    expect(JSON.stringify(crowd)).toBe(before);

    const nearbyProgress = unit("e", "A.TOP.BANK", { x: 6.1, y: 0 }, { edgeTo: "B.TOP.BANK", progress: 101, track: "CENTER", crossing: "bridge" });
    const differentProgress = layout.update(state(...crowd, nearbyProgress), map);
    expect(differentProgress.has(nearbyProgress.id)).toBe(false);
    expect(differentProgress.get("d")).toEqual(offsets.get("d"));

    const withoutB = layout.update(state(crowd[0], crowd[2], crowd[3]), map);
    expect(withoutB.get("a")).toEqual(offsets.get("a"));
    expect(withoutB.get("c")).toEqual(offsets.get("c"));
    expect(withoutB.get("d")).toEqual(offsets.get("d"));
    expect(withoutB.has("b")).toBe(false);

    const edgeOnly = unit("solo", "A.TOP.BANK", { x: 3, y: 0 }, { edgeTo: "B.TOP.BANK", progress: 80, track: "CENTER", crossing: "bridge" });
    expect(layout.update(state(edgeOnly), map).size).toBe(0);

    const nearStart = makeCrowd(0.2);
    const compressed = layout.update(state(...nearStart), map);
    expect(compressed.get("d")?.x).toBeCloseTo(-0.2, 5);
    for (const entity of nearStart) {
      const shownX = entity.position.x + compressed.get(entity.id)!.x;
      expect(shownX).toBeGreaterThanOrEqual(-1e-7);
      expect(shownX).toBeLessThanOrEqual(12 + 1e-7);
    }

    const offTrack = unit("left-track", "A.TOP.BANK", { x: 6, y: 1 }, { edgeTo: "B.TOP.BANK", progress: 100, track: "LEFT", crossing: "bridge" });
    expect(layout.update(state(crowd[0], crowd[1], offTrack), map).has(offTrack.id)).toBe(false);
    expect(offTrack.battlefield?.track).toBe("LEFT");
  });

  it("separates same-track lane coincidences along the lane without lateral nudging", () => {
    const map = replay(
      [point("A.BASE", 0, 0, "A"), point("A.TOP.T1", 12, 0, "A")],
      [],
      [{ id: "lane.TOP", region: "lane", points: [{ x: 0, y: 0 }, { x: 12, y: 0 }] } as RouteRow],
    );
    const centerA = unit("center-a", "A.BASE", { x: 6, y: 0 }, { edgeTo: "A.TOP.T1", progress: 75, track: "CENTER" });
    const centerB = unit("center-b", "A.BASE", { x: 6, y: 0 }, { edgeTo: "A.TOP.T1", progress: 75, track: "CENTER" });
    const left = unit("left", "A.BASE", { x: 6, y: -0.8 }, { edgeTo: "A.TOP.T1", progress: 75, track: "LEFT" });
    const offsets = new NodeDisplayLayout().update(state(centerA, centerB, left), map);
    expect(offsets.get(centerA.id)).toEqual({ x: 0, y: 0 });
    expect(offsets.get(centerB.id)?.x).toBeCloseTo(-0.65, 5);
    expect(offsets.get(centerB.id)?.y).toBe(0);
    expect(offsets.has(left.id)).toBe(false);
    expect(left.battlefield?.track).toBe("LEFT");
  });
});
