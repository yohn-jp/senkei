import { describe, expect, it } from "vitest";
import type {
  MatchResult,
  PresentationReplay as CoreReplay,
  RulePackage,
} from "../../../apps/web/src/contracts/core-model";
import {
  NEXT_BATTLEFIELD_PRESENTATION_WORLD,
  presentationToGraphics,
  type NextPresentationWorldDefinition,
} from "./next-adapter";
import { decodeReplay, type PresentationReplay } from "./index";

function project(edges: readonly { from:string; to:string; length:number; region:string; blocked:boolean; id?:string; bridge_site?:string; ford?:boolean }[] = [
  { from: "attacker", to: "camp", length: 250, region: "jungle", blocked: false },
  { from: "camp", to: "defender", length: 250, region: "jungle", blocked: true },
], frames: CoreReplay["frames"] = [], nodes: Record<string, { x: number; y: number; region: string }> = {
  attacker: { x: 0, y: 0, region: "base" },
  camp: { x: 250, y: 125, region: "jungle" },
  defender: { x: 500, y: 250, region: "base" },
}, presentationWorld: NextPresentationWorldDefinition = NEXT_BATTLEFIELD_PRESENTATION_WORLD, lanes: Record<string, string[]> = { mid: ["attacker", "camp", "defender"] }) {
  const ruleset = {
    ruleset: { id: "senkei.next", digest: "a".repeat(64) },
    minimum_engine_version: { major: 1, minor: 2, patch: 0 },
    next: {
      parameters: { tick_duration_ms: 100 },
      map: {
        attacker_base: "attacker", defender_base: "defender",
        nodes,
        edges,
        lanes,
      },
      camps: [{ id: "camp-nw", node: "camp" }],
      heroes: [],
    },
  } as unknown as RulePackage;
  const replay = {
    schema_version: { major: 1, minor: 0, patch: 0 },
    match_id: "match-1",
    result_digest: "b".repeat(64),
    frames,
  } as unknown as CoreReplay;
  const result = {
    match_id: "match-1",
    outcome: "draw",
    termination_reason: "tick_limit",
    final_tick: 1,
    statistics: {},
    cu_spent: { attacker: 0, defender: 0 },
    final_state_digest: "c".repeat(64),
  } as unknown as MatchResult;
  return presentationToGraphics(replay, ruleset, result, ruleset.minimum_engine_version, presentationWorld);
}

describe("Next map graph projection", () => {
  it("projects traversable map edges and camps from their real world nodes", () => {
    const replay = project();
    expect(replay.scene.routes).toEqual([
      {
        id: "attacker-camp",
        region: "jungle",
        points: [{ x: 0, y: 0 }, { x: 10, y: 5 }],
      },
    ]);
    expect(replay.scene.baseSites).toEqual([
      {id:"attacker",side:"azure",position:{x:0,y:0}},
      {id:"defender",side:"vermilion",position:{x:20,y:10}},
    ]);
    // Known geography remains available without revealing a live base entity.
    expect(replay.initialView).toEqual([]);
    expect(replay.scene.camps).toEqual([
      { id: "camp-nw", position: { x: 10, y: 5 } },
    ]);
    expect(replay.scene.lanes[0].points).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 10 },
    ]);
  });

  it("rejects graph edges that reference a missing Senritsu node", () => {
    expect(() => project([
      { from: "attacker", to: "absent", length: 1, region: "jungle", blocked: false },
    ])).toThrow("Missing public map node: absent");
  });

  it("projects the explicit river presentation order instead of sorting crossing positions", () => {
    const edges: { id: string; from: string; to: string; length: number; region: string; blocked: boolean; bridge_site?: string; ford?: boolean }[] = [
      { id: "bridge.BOT", from: "bot-a", to: "bot-b", length: 100, region: "bridge", blocked: false, bridge_site: "BOT" },
      { id: "ford.jungle.lower", from: "lower-a", to: "lower-b", length: 100, region: "river_ford", blocked: false, ford: true },
      { id: "bridge.MID.B", from: "N.MID.OBS", to: "mid-b", length: 50, region: "bridge", blocked: false, bridge_site: "MID" },
      { id: "bridge.TOP", from: "top-a", to: "top-b", length: 100, region: "bridge", blocked: false, bridge_site: "TOP" },
      { id: "ford.jungle.upper", from: "upper-a", to: "upper-b", length: 100, region: "river_ford", blocked: false, ford: true },
      { id: "bridge.MID.A", from: "mid-a", to: "N.MID.OBS", length: 50, region: "bridge", blocked: false, bridge_site: "MID" },
    ];
    const nodes = {
      attacker: { x: 0, y: 0, region: "base" },
      camp: { x: 100, y: 100, region: "jungle" },
      defender: { x: 500, y: 500, region: "base" },
      // TOP appears below the upper ford in y coordinates, so coordinate sort
      // would reverse the authored river order.
      "top-a": { x: 80, y: 180, region: "riverbank" },
      "top-b": { x: 120, y: 220, region: "riverbank" },
      "upper-a": { x: 130, y: 80, region: "jungle" },
      "upper-b": { x: 170, y: 120, region: "jungle" },
      "mid-a": { x: 180, y: 180, region: "riverbank" },
      "N.MID.OBS": { x: 200, y: 200, region: "observation" },
      "mid-b": { x: 220, y: 220, region: "riverbank" },
      "lower-a": { x: 230, y: 280, region: "jungle" },
      "lower-b": { x: 270, y: 320, region: "jungle" },
      "bot-a": { x: 280, y: 380, region: "riverbank" },
      "bot-b": { x: 320, y: 420, region: "riverbank" },
    };
    const river = project(edges, [], nodes).scene.river!;
    expect(river).toHaveLength(7);
    expect(river.slice(1, -1)).toEqual([
      { x: 4, y: 8 }, { x: 6, y: 4 }, { x: 8, y: 8 }, { x: 10, y: 12 }, { x: 12, y: 16 },
    ]);
    expect(river[0]!.x).toBeLessThan(river[1]!.x);
    expect(river.at(-1)!.y).toBeGreaterThan(river.at(-2)!.y);
  });

  it("omits a river when an older map has only some of the authored landmarks", () => {
    const edges = [
      { id: "bridge.TOP", from: "top-a", to: "top-b", length: 100, region: "bridge", blocked: false, bridge_site: "TOP" },
      { id: "ford.jungle.upper", from: "upper-a", to: "upper-b", length: 100, region: "river_ford", blocked: false, ford: true },
    ];
    const nodes = {
      attacker: { x: 0, y: 0, region: "base" },
      camp: { x: 100, y: 100, region: "jungle" },
      defender: { x: 500, y: 500, region: "base" },
      "top-a": { x: 80, y: -20, region: "riverbank" },
      "top-b": { x: 120, y: 20, region: "riverbank" },
      "upper-a": { x: 130, y: 80, region: "jungle" },
      "upper-b": { x: 170, y: 120, region: "jungle" },
    };
    expect(project(edges, [], nodes).scene.river).toBeUndefined();
  });

  it("does not treat an edge ID with the wrong crossing role as a river anchor", () => {
    const presentationWorld: NextPresentationWorldDefinition = {
      river: {
        anchors: [
          { kind: "bridge-midpoint", edgeId: "bridge.TOP", site: "TOP" },
          { kind: "ford-midpoint", edgeId: "ford.jungle.upper" },
        ],
        terminalExtension: 8,
      },
    };
    const edges = [
      { id: "bridge.TOP", from: "top-a", to: "top-b", length: 100, region: "bridge", blocked: false, bridge_site: "BOT" },
      { id: "ford.jungle.upper", from: "upper-a", to: "upper-b", length: 100, region: "river_ford", blocked: false, ford: true },
    ];
    const nodes = {
      attacker: { x: 0, y: 0, region: "base" },
      camp: { x: 100, y: 100, region: "jungle" },
      defender: { x: 500, y: 500, region: "base" },
      "top-a": { x: 80, y: -20, region: "riverbank" },
      "top-b": { x: 120, y: 20, region: "riverbank" },
      "upper-a": { x: 130, y: 80, region: "jungle" },
      "upper-b": { x: 170, y: 120, region: "jungle" },
    };
    expect(project(edges, [], nodes, presentationWorld).scene.river).toBeUndefined();
  });

  it("keeps five crossing alignments, separated lanes and 180-degree symmetry on a representative 35/42 projection fixture", () => {
    const nodes: Record<string, { x: number; y: number; region: string }> = {
      attacker: { x: 0, y: 0, region: "base" },
      camp: { x: 100, y: 100, region: "jungle" },
      defender: { x: 1600, y: 1600, region: "base" },
      "A.TOP.BANK": { x: 350, y: 430, region: "riverbank" },
      "B.TOP.BANK": { x: 430, y: 350, region: "riverbank" },
      "N.A.UJ": { x: 450, y: 700, region: "jungle" },
      "N.B.UJ": { x: 700, y: 450, region: "jungle" },
      "A.MID.BANK": { x: 735, y: 865, region: "riverbank" },
      "N.MID.OBS": { x: 800, y: 800, region: "observation" },
      "B.MID.BANK": { x: 865, y: 735, region: "riverbank" },
      "N.A.LJ": { x: 900, y: 1150, region: "jungle" },
      "N.B.LJ": { x: 1150, y: 900, region: "jungle" },
      "A.BOT.BANK": { x: 1170, y: 1250, region: "riverbank" },
      "B.BOT.BANK": { x: 1250, y: 1170, region: "riverbank" },
      "A.TOP.J": { x: 260, y: 520, region: "top" },
      "B.TOP.J": { x: 520, y: 260, region: "top" },
      "A.MID.J": { x: 650, y: 950, region: "mid" },
      "B.MID.J": { x: 950, y: 650, region: "mid" },
      "A.BOT.J": { x: 1080, y: 1340, region: "bot" },
      "B.BOT.J": { x: 1340, y: 1080, region: "bot" },
    };
    // Exercise the graph cardinality. Filler geometry has no river or lane semantics.
    for (let index = 0; Object.keys(nodes).length < 35; index++) {
      nodes["filler." + index] = { x: 20 + index * 5, y: 1500, region: "jungle" };
    }
    const edges: { id: string; from: string; to: string; length: number; region: string; blocked: boolean; bridge_site?: string; ford?: boolean }[] = [
      { id: "bridge.TOP", from: "A.TOP.BANK", to: "B.TOP.BANK", length: 100, region: "bridge", blocked: false, bridge_site: "TOP" },
      { id: "ford.jungle.upper", from: "N.A.UJ", to: "N.B.UJ", length: 100, region: "river_ford", blocked: false, ford: true },
      { id: "bridge.MID.A", from: "A.MID.BANK", to: "N.MID.OBS", length: 50, region: "bridge", blocked: false, bridge_site: "MID" },
      { id: "bridge.MID.B", from: "N.MID.OBS", to: "B.MID.BANK", length: 50, region: "bridge", blocked: false, bridge_site: "MID" },
      { id: "ford.jungle.lower", from: "N.A.LJ", to: "N.B.LJ", length: 100, region: "river_ford", blocked: false, ford: true },
      { id: "bridge.BOT", from: "A.BOT.BANK", to: "B.BOT.BANK", length: 100, region: "bridge", blocked: false, bridge_site: "BOT" },
    ];
    const fillerIds = Object.keys(nodes).filter(id => id.startsWith("filler."));
    for (let index = 0; index < 36; index++) {
      edges.push({
        id: "filler.edge." + index,
        from: fillerIds[index % fillerIds.length]!,
        to: fillerIds[(index + 1) % fillerIds.length]!,
        length: 20,
        region: "jungle",
        blocked: false,
      });
    }
    const lanes = {
      top: ["A.TOP.J", "B.TOP.J"],
      mid: ["A.MID.J", "N.MID.OBS", "B.MID.J"],
      bot: ["A.BOT.J", "B.BOT.J"],
    };
    const forward = project(edges, [], nodes, NEXT_BATTLEFIELD_PRESENTATION_WORLD, lanes);

    expect(forward.scene.nodes).toHaveLength(35);
    expect(forward.scene.routes).toHaveLength(42);
    expect(forward.scene.lanes.map(lane => lane.id)).toEqual(["top", "mid", "bot"]);

    const river = forward.scene.river!;
    const anchors = river.slice(1, -1);
    expect(anchors).toEqual([
      { x: 15.6, y: 15.6 },
      { x: 23, y: 23 },
      { x: 32, y: 32 },
      { x: 41, y: 41 },
      { x: 48.4, y: 48.4 },
    ]);
    const crossingEdges = [
      ["bridge.TOP", 0],
      ["ford.jungle.upper", 1],
      ["bridge.MID.A", 2],
      ["bridge.MID.B", 2],
      ["ford.jungle.lower", 3],
      ["bridge.BOT", 4],
    ] as const;
    const pointOnRoute = (point: { x: number; y: number }, route: NonNullable<typeof forward.scene.routes>[number]) => {
      const [start, end] = route.points;
      const dx = end!.x - start!.x, dy = end!.y - start!.y;
      const lengthSquared = dx * dx + dy * dy;
      const cross = (point.x - start!.x) * dy - (point.y - start!.y) * dx;
      const projection = (point.x - start!.x) * dx + (point.y - start!.y) * dy;
      return Math.abs(cross) < 1e-8 && projection >= -1e-8 && projection <= lengthSquared + 1e-8;
    };
    for (const [edgeId, anchorIndex] of crossingEdges) {
      const route = forward.scene.routes!.find(item => item.id === edgeId)!;
      expect(pointOnRoute(anchors[anchorIndex]!, route)).toBe(true);
    }

    const orient = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) =>
      (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const onSegment = (a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }) =>
      Math.min(a.x, b.x) - 1e-8 <= p.x && p.x <= Math.max(a.x, b.x) + 1e-8 &&
      Math.min(a.y, b.y) - 1e-8 <= p.y && p.y <= Math.max(a.y, b.y) + 1e-8;
    const segmentsIntersect = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) => {
      const abC = orient(a, b, c), abD = orient(a, b, d);
      const cdA = orient(c, d, a), cdB = orient(c, d, b);
      return (abC * abD < 0 && cdA * cdB < 0) ||
        (Math.abs(abC) < 1e-8 && onSegment(a, b, c)) ||
        (Math.abs(abD) < 1e-8 && onSegment(a, b, d)) ||
        (Math.abs(cdA) < 1e-8 && onSegment(c, d, a)) ||
        (Math.abs(cdB) < 1e-8 && onSegment(c, d, b));
    };
    for (let first = 0; first < river.length - 1; first++) {
      for (let second = first + 2; second < river.length - 1; second++) {
        expect(segmentsIntersect(river[first]!, river[first + 1]!, river[second]!, river[second + 1]!)).toBe(false);
      }
    }

    const laneCenters = forward.scene.lanes.map(lane => lane.points[Math.floor(lane.points.length / 2)]!);
    for (let first = 0; first < laneCenters.length; first++) {
      for (let second = first + 1; second < laneCenters.length; second++) {
        expect(Math.hypot(laneCenters[first]!.x - laneCenters[second]!.x, laneCenters[first]!.y - laneCenters[second]!.y)).toBeGreaterThan(10);
      }
    }

    const rotations: readonly (readonly [string, string])[] = [
      ["attacker", "defender"], ["defender", "attacker"],
      ["A.TOP.BANK", "B.BOT.BANK"], ["B.TOP.BANK", "A.BOT.BANK"],
      ["A.BOT.BANK", "B.TOP.BANK"], ["B.BOT.BANK", "A.TOP.BANK"],
      ["N.A.UJ", "N.B.LJ"], ["N.B.UJ", "N.A.LJ"],
      ["N.A.LJ", "N.B.UJ"], ["N.B.LJ", "N.A.UJ"],
      ["A.MID.BANK", "B.MID.BANK"], ["B.MID.BANK", "A.MID.BANK"],
      ["A.TOP.J", "B.BOT.J"], ["B.TOP.J", "A.BOT.J"],
      ["A.MID.J", "B.MID.J"], ["B.MID.J", "A.MID.J"],
      ["A.BOT.J", "B.TOP.J"], ["B.BOT.J", "A.TOP.J"],
      ["bridge.TOP", "bridge.BOT"], ["bridge.BOT", "bridge.TOP"],
      ["bridge.MID.A", "bridge.MID.B"], ["bridge.MID.B", "bridge.MID.A"],
      ["ford.jungle.upper", "ford.jungle.lower"], ["ford.jungle.lower", "ford.jungle.upper"],
    ];
    const rotateId = (id: string) => rotations.find(([from]) => from === id)?.[1] ?? id;
    const rotatedNodes = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [
      rotateId(id),
      { ...node, x: 1600 - node.x, y: 1600 - node.y },
    ]));
    const rotatedEdges = edges.map(edge => ({
      ...edge,
      id: rotateId(edge.id!),
      from: rotateId(edge.from),
      to: rotateId(edge.to),
      ...(edge.bridge_site === "TOP" || edge.bridge_site === "BOT"
        ? { bridge_site: edge.bridge_site === "TOP" ? "BOT" : "TOP" }
        : {}),
    }));
    const rotatedLanes = {
      bot: lanes.top.map(rotateId),
      mid: lanes.mid.map(rotateId),
      top: lanes.bot.map(rotateId),
    };
    const rotated = project(rotatedEdges, [], rotatedNodes, NEXT_BATTLEFIELD_PRESENTATION_WORLD, rotatedLanes).scene.river!;
    const rotateBack = [...river].reverse().map(point => ({ x: 64 - point.x, y: 64 - point.y }));
    rotated.forEach((point, index) => {
      expect(point.x).toBeCloseTo(rotateBack[index]!.x, 8);
      expect(point.y).toBeCloseTo(rotateBack[index]!.y, 8);
    });
  });

  it("projects only authorized logical position and facility changes, including destroyed bridges", () => {
    const value = (kind: "integer" | "string", value: number | string) => ({ kind, value });
    const viewEntity = (entity_type: string, fields: Record<string, ReturnType<typeof value>>) => ({ entity_type, owner: null, fields });
    const common = { hp: value("integer", 500), max_hp: value("integer", 500), x: value("integer", 125), y: value("integer", 60) };
    const mapEdges = [
      { from: "attacker", to: "camp", length: 250, region: "lane", blocked: false, id: "edge_top", bridge_site: "TOP", ford: false },
      { from: "camp", to: "defender", length: 250, region: "jungle", blocked: false, id: "edge_ford", bridge_site: "", ford: true },
    ];
    const hero = (track: string, x: number) => viewEntity("hero", {
      hp: value("integer", 100), max_hp: value("integer", 100), x: value("integer", x), y: value("integer", 25),
      node: value("string", "attacker"), edge_to: value("string", "camp"), edge_progress: value("integer", x), track: value("string", track),
      cross_remaining: value("integer", 0), ford_remaining: value("integer", 0),
      ford_active: value("integer", 0),
    });
    const bridge = (state: string, hp: number) => viewEntity("bridge", {
      ...common, hp: value("integer", hp), site: value("string", "TOP"), bridge_state: value("string", state), build_remaining: value("integer", 0),
    });
    const fordTraveler = () => viewEntity("hero", {
      hp: value("integer", 100), max_hp: value("integer", 100), x: value("integer", 260), y: value("integer", 130),
      node: value("string", "camp"), edge_to: value("string", "defender"), edge_progress: value("integer", 20),
      ford_remaining: value("integer", 0), ford_active: value("integer", 1),
    });
    const observation = (captureOwner: string, progress: number, side: string) => viewEntity("observation", {
      x: value("integer", 250), y: value("integer", 125), node: value("string", "camp"),
      capture_owner: value("string", captureOwner), capture_progress: value("integer", progress), capture_progress_side: value("string", side),
    });
    const frame = (tick: number, entities: Record<string, ReturnType<typeof viewEntity>>) => ({ tick, events: [], visible_state: { entities, global_fields: {} } }) as unknown as CoreReplay["frames"][number];
    const replay = project(mapEdges, [
      frame(0, { hero: hero("RIGHT", 1), fordTraveler: fordTraveler(), bridge: bridge("normal", 500), obs: observation("neutral", 0, "") }),
      frame(1, { hero: hero("LEFT", 10), fordTraveler: fordTraveler(), bridge: bridge("destroyed", 0), obs: observation("attacker", 4, "defender") }),
    ]);
    expect(replay.header.enbuVersion).toBe("1.2.0");
    expect(replay.scene.nodes).toHaveLength(3);
    expect(replay.scene.routes?.map(route => [route.id, route.bridgeSite, route.ford])).toEqual([
      ["edge_top", "TOP", undefined], ["edge_ford", undefined, true],
    ]);
    // A partial topology lacks the authored river landmarks, so the adapter
    // does not invent a course by sorting whatever crossings happen to exist.
    expect(replay.scene.river).toBeUndefined();
    const move = replay.timeline.find(event => event.type === "move");
    expect(move).toMatchObject({ type: "move", logicalPosition: { node: "attacker", edgeTo: "camp", progress: 10, track: "LEFT" } });
    const bridgeState = replay.timeline.find(event => event.type === "facility-state" && event.battlefield.bridgeSite === "TOP");
    expect(bridgeState).toMatchObject({ type: "facility-state", battlefield: { bridgeState: "destroyed" } });
    expect(replay.initialView.find(entity => entity.kind === "bridge")).toMatchObject({ hp: 500, maxHp: 500, battlefield: { bridgeState: "normal" } });
    expect(replay.timeline.find(event => event.type === "damage" && event.entityId === replay.initialView.find(entity => entity.kind === "bridge")?.id)).toMatchObject({ type: "damage", hp: 0 });
    expect(replay.timeline.some(event => event.type === "destroy" && event.entityId === replay.initialView.find(entity => entity.kind === "bridge")?.id)).toBe(false);
    expect(replay.initialView.find(entity => entity.archetype === "hero")?.battlefield?.crossing).toBe("ford");
    expect(replay.initialView.find(entity => entity.archetype === "hero")?.battlefield?.remaining).toBe(0);
    expect(replay.timeline.some(event => event.type === "facility-state" && event.battlefield.captureSide === "vermilion" && event.battlefield.facilityOwner === "azure")).toBe(true);
  });
});


describe("known base geography", () => {
  it("rejects live/private state in static sites and validates authored positions", () => {
    const withHp = structuredClone(project()) as PresentationReplay;
    Object.assign(withHp.scene.baseSites![0]!, {hp: 999});
    expect(() => decodeReplay(withHp)).toThrow(/Schema/);
    const outside = structuredClone(project()) as PresentationReplay;
    outside.scene.baseSites![0]!.position.x = 100;
    expect(() => decodeReplay(outside)).toThrow(/outside scene/);
    const duplicate = structuredClone(project()) as PresentationReplay;
    duplicate.scene.baseSites![1]!.id = duplicate.scene.baseSites![0]!.id;
    expect(() => decodeReplay(duplicate)).toThrow(/Duplicate base site/);
  });
});
