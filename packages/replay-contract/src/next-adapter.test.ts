import { describe, expect, it } from "vitest";
import type {
  DomainValue,
  MatchResult,
  PresentationReplay as CoreReplay,
  RulePackage,
} from "../../../apps/web/src/contracts/core-model";
import {
  presentationToGraphics,
} from "./next-adapter";
import { decodeReplay, type PresentationReplay } from "./index";
import { stateAt } from "../../replay-player/src/index";
import type { RulesetIdentity, WorldIdentityRef } from "./generated";

const WORLD: WorldIdentityRef = {
  world_id: "fixture-world", schema_version: { major: 1, minor: 0, patch: 0 },
  compiler_version: { major: 1, minor: 0, patch: 0 },
  minimum_compiler: { major: 1, minor: 0, patch: 0 }, maximum_compiler_exclusive: null,
  validation_profile_id: null, validation_profile_version: null,
  logic_digest: "d".repeat(64), presentation_digest: "e".repeat(64),
};
const RULESET: RulesetIdentity = { id: "senkei.next", version: { major: 2, minor: 0, patch: 0 }, digest: "a".repeat(64) };
type TestRiverAnchor =
  | { readonly kind: "bridge-midpoint"; readonly edgeId: string; readonly site: "TOP" | "MID" | "BOT" }
  | { readonly kind: "ford-midpoint"; readonly edgeId: string }
  | { readonly kind: "node"; readonly nodeId: string; readonly region: string };
interface TestPresentationWorld { readonly river: { readonly anchors: readonly TestRiverAnchor[]; readonly terminalExtension: number } }
const TEST_PRESENTATION_WORLD: TestPresentationWorld = { river: { anchors: [
  { kind: "bridge-midpoint", edgeId: "bridge.TOP", site: "TOP" },
  { kind: "ford-midpoint", edgeId: "ford.jungle.upper" },
  { kind: "node", nodeId: "N.MID.OBS", region: "observation" },
  { kind: "ford-midpoint", edgeId: "ford.jungle.lower" },
  { kind: "bridge-midpoint", edgeId: "bridge.BOT", site: "BOT" },
], terminalExtension: 8 } };
const value = (kind: "integer" | "string", value: number | string): DomainValue => ({ kind, value } as DomainValue);
const viewEntity = (entity_type: string, fields: Record<string, DomainValue>) => ({ entity_type, owner: "attacker", fields });

it("emits Replay 0.4 and requires Core Replay 1.1.0", () => {
  expect(project().schemaVersion).toBe("0.4");
  expect(() => project(
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, { major: 1, minor: 0, patch: 0 },
  )).toThrow("Unsupported core replay version");
});

function project(edges: readonly { from:string; to:string; length:number; region:string; blocked:boolean; id?:string; bridge_site?:string; bridge_kind?:string; crossing_start?:number; crossing_end?:number; ford?:boolean }[] = [
  { from: "attacker", to: "camp", length: 250, region: "jungle", blocked: false },
  { from: "camp", to: "defender", length: 250, region: "jungle", blocked: true },
], frames: CoreReplay["frames"] = [], nodes: Record<string, { x: number; y: number; region: string }> = {
  attacker: { x: 0, y: 0, region: "base" },
  camp: { x: 250, y: 125, region: "jungle" },
  defender: { x: 500, y: 250, region: "base" },
}, presentationWorld: TestPresentationWorld = TEST_PRESENTATION_WORLD, lanes: Record<string, string[]> = { mid: ["attacker", "camp", "defender"] }, sourceWorld: WorldIdentityRef | null = WORLD, packageWorld: WorldIdentityRef | null = WORLD, mapWorld: WorldIdentityRef | null = packageWorld, sourceRuleset: RulesetIdentity | null = RULESET, presentationNodes: Record<string, { x: number; y: number }> = Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, { x: node.x, y: node.y }])), presentationPaths: Record<string, { points: { x: number; y: number }[] }> = {}, sourceSchemaVersion: { major: number; minor: number; patch: number } = { major: 1, minor: 1, patch: 0 }) {
  const edgePaths = Object.fromEntries(edges.map(edge => [edge.id || `${edge.from}-${edge.to}`, presentationPaths[edge.id || `${edge.from}-${edge.to}`] ?? {
    points: [{ x: presentationNodes[edge.from]?.x ?? nodes[edge.from]?.x ?? 0, y: presentationNodes[edge.from]?.y ?? nodes[edge.from]?.y ?? 0 },
      { x: presentationNodes[edge.to]?.x ?? nodes[edge.to]?.x ?? 0, y: presentationNodes[edge.to]?.y ?? nodes[edge.to]?.y ?? 0 }],
  }]));
  const edgeFacts = Object.fromEntries(edges.map(edge => [edge.id || `${edge.from}-${edge.to}`, { river_crossing:
    edge.bridge_site ? { kind: edge.bridge_kind ?? "fixed_facility_bridge", bridge_site_id: edge.bridge_site, start_progress_wu: edge.crossing_start ?? 0, end_progress_wu: edge.crossing_end ?? edge.length }
      : edge.ford ? { kind: "foot_ford", bridge_site_id: null, start_progress_wu: 0, end_progress_wu: edge.length }
        : null,
  }]));
  const bridgeSites = Object.fromEntries([...new Set(edges.flatMap(edge => edge.bridge_site ? [edge.bridge_site] : []))].map(site => [site,
    edges.filter(edge => edge.bridge_site === site).map(edge => edge.id || `${edge.from}-${edge.to}`),
  ]));
  const riverPoints = testRiverPoints(edges, nodes, presentationNodes, presentationWorld);
  const ruleset = {
    ruleset: RULESET,
    minimum_engine_version: { major: 1, minor: 2, patch: 0 },
    next: {
      parameters: { tick_duration_ms: 100 },
      world_identity: packageWorld,
      map: {
        world_identity: mapWorld,
        world_projection: { source_identity: mapWorld, edge_facts: edgeFacts, bridge_sites: bridgeSites, presentation_artifact: { schema_version: { major: 1, minor: 0, patch: 0 }, content: {
          node_positions: Object.fromEntries(Object.entries(presentationNodes).map(([id, position]) => [id, { position }])),
          edge_paths: edgePaths,
          rivers: riverPoints.length >= 2 ? { "river.fixture": { points: riverPoints } } : {},
        } } },
        attacker_base: "attacker", defender_base: "defender",
        nodes: Object.fromEntries(Object.entries(nodes).map(([id, node]) => [id, {
          ...node, presentation_x: presentationNodes[id]?.x, presentation_y: presentationNodes[id]?.y,
        }])),
        edges,
        lanes,
      },
      camps: [{ id: "camp-nw", node: "camp" }],
      heroes: [],
    },
  } as unknown as RulePackage;
  const replay = {
    schema_version: sourceSchemaVersion,
    match_id: "match-1",
    ...(sourceRuleset ? { ruleset: sourceRuleset } : {}),
    ...(sourceWorld ? { world_identity: sourceWorld } : {}),
    result_digest: "b".repeat(64),
    frames,
  } as unknown as CoreReplay;
  const result = {
    match_id: "match-1",
    outcome: "draw",
    termination_reason: "tick_limit",
    final_tick: Math.max(1, ...frames.map(frame => frame.tick)),
    statistics: {},
    cu_spent: { attacker: 0, defender: 0 },
    final_state_digest: "c".repeat(64),
  } as unknown as MatchResult;
  return presentationToGraphics(replay, ruleset, result, ruleset.minimum_engine_version);
}

it("projects only confirmed observation contest facts across seek and visibility loss", () => {
  const observation = (contested?: DomainValue) => viewEntity("observation", {
    node: value("string", "camp"),
    capture_progress: value("integer", 2),
    capture_owner: value("string", "neutral"),
    capture_progress_side: value("string", "attacker"),
    ...(contested === undefined ? {} : { capture_contested: contested }),
  });
  const frame = (tick: number, entities: Record<string, ReturnType<typeof viewEntity>>) =>
    ({ tick, events: [], visible_state: { entities, global_fields: {} } }) as unknown as CoreReplay["frames"][number];
  const replay = project(undefined, [
    frame(0, { obs: observation() }),
    frame(1, { obs: observation({ kind: "bool", value: true }) }),
    frame(2, {}),
    frame(3, { obs: observation({ kind: "bool", value: false }) }),
    frame(4, { obs: observation() }),
  ]);
  const entityAt = (tick: number) => Object.values(stateAt(replay, tick).entities).find(entity => entity.kind === "observation");
  expect(replay.schemaVersion).toBe("0.5");
  expect(entityAt(0)?.battlefield?.captureContested).toBeUndefined();
  expect(entityAt(1)?.battlefield?.captureContested).toBe(true);
  expect(entityAt(2)).toBeUndefined();
  expect(entityAt(3)?.battlefield?.captureContested).toBe(false);
  expect(entityAt(4)?.battlefield?.captureContested).toBeUndefined();
  expect(entityAt(1)?.battlefield?.captureContested).toBe(true);
  expect(() => project(undefined, [frame(0, { obs: observation({ kind: "integer", value: 1 }) })]))
    .toThrow("Invalid public capture_contested");
});

function testRiverPoints(edges: readonly { id?: string; from: string; to: string; bridge_site?: string; ford?: boolean }[], nodes: Record<string, { x:number; y:number; region:string }>, presentationNodes: Record<string,{x:number;y:number}>, world: TestPresentationWorld): {x:number;y:number}[] {
  const anchors = world.river.anchors.map(anchor => {
    if (anchor.kind === "node") {
      const node = nodes[anchor.nodeId]; const point = presentationNodes[anchor.nodeId];
      return node?.region === anchor.region && point ? point : undefined;
    }
    const edge = edges.find(item => item.id === anchor.edgeId);
    if (!edge || (anchor.kind === "ford-midpoint" && !edge.ford) || (anchor.kind === "bridge-midpoint" && edge.bridge_site !== anchor.site)) return undefined;
    const from = presentationNodes[edge.from] ?? nodes[edge.from]; const to = presentationNodes[edge.to] ?? nodes[edge.to];
    return from && to ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 } : undefined;
  });
  if (anchors.length < 2 || anchors.some(point => !point)) return [];
  const points = anchors as {x:number;y:number}[];
  const first=points[0]!,second=points[1]!,last=points.at(-1)!,before=points.at(-2)!;
  const extend=(from:{x:number;y:number},toward:{x:number;y:number},distance:number)=>{const dx=toward.x-from.x,dy=toward.y-from.y,length=Math.hypot(dx,dy)||1;return{x:from.x+dx/length*distance,y:from.y+dy/length*distance};};
  return [extend(first,second,-world.river.terminalExtension),...points,extend(last,before,-world.river.terminalExtension)];
}

describe("Next map graph projection", () => {
  it("preserves opaque canonical bridge site IDs and derives route kind from paired World edge facts", () => {
    const replay = project([
      { id: "edge-lane", from: "attacker", to: "camp", length: 250, region: "lane", blocked: false, bridge_site: "bridge.top", bridge_kind: "fixed_bridge" },
      { id: "edge-facility", from: "camp", to: "defender", length: 250, region: "bridge", blocked: false, bridge_site: "bridge.mid", bridge_kind: "fixed_facility_bridge" },
    ]);
    expect(replay.scene.routes?.map(({ id, bridgeSite, bridgeKind }) => [id, bridgeSite, bridgeKind])).toEqual([
      ["edge-lane", "bridge.top", "lane"],
      ["edge-facility", "bridge.mid", "facility"],
    ]);
  });

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

  it("maps graph progress through presentation coordinates and ignores logical entity x/y for rendering", () => {
    const hero = viewEntity("hero", {
      hp: { kind: "integer", value: 100 }, max_hp: { kind: "integer", value: 100 },
      x: { kind: "integer", value: 999_999 }, y: { kind: "integer", value: -999_999 },
      node: { kind: "string", value: "attacker" }, edge_to: { kind: "string", value: "camp" },
      edge_progress: { kind: "integer", value: 125 },
    });
    const frame = { tick: 0, events: [], visible_state: { entities: { hero }, global_fields: {} } } as unknown as CoreReplay["frames"][number];
    const visual = {
      attacker: { x: 1000, y: 0 }, camp: { x: 2000, y: 500 }, defender: { x: 3000, y: 1000 },
    };
    const replay = project(undefined, [frame], undefined, undefined, undefined, WORLD, WORLD, WORLD, RULESET, visual);
    expect(replay.scene.nodes?.[0]?.position).toEqual({ x: 40, y: 0 });
    expect(replay.initialView[0]?.position).toEqual({ x: 60, y: 10 });
  });

  it("renders the paired World route path and projects entity progress along its authored geometry", () => {
    const hero = viewEntity("hero", {
      hp: { kind: "integer", value: 100 }, max_hp: { kind: "integer", value: 100 },
      node: { kind: "string", value: "attacker" }, edge_to: { kind: "string", value: "camp" },
      edge_progress: { kind: "integer", value: 125 },
    });
    const frame = { tick: 0, events: [], visible_state: { entities: { hero }, global_fields: {} } } as unknown as CoreReplay["frames"][number];
    const replay = project(undefined, [frame], undefined, undefined, undefined, WORLD, WORLD, WORLD, RULESET, undefined, {
      "attacker-camp": { points: [{ x: 0, y: 0 }, { x: 125, y: 200 }, { x: 250, y: 125 }] },
    });
    expect(replay.scene.routes?.[0]?.points).toEqual([{ x: 0, y: 0 }, { x: 5, y: 8 }, { x: 10, y: 5 }]);
    expect(replay.initialView[0]?.position.x).toBeCloseTo(4.045199, 5);
    expect(replay.initialView[0]?.position.y).toBeCloseTo(6.472319, 5);
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
    const presentationWorld: TestPresentationWorld = {
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
    const forward = project(edges, [], nodes, TEST_PRESENTATION_WORLD, lanes);

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
    const rotated = project(rotatedEdges, [], rotatedNodes, TEST_PRESENTATION_WORLD, rotatedLanes).scene.river!;
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
    expect(replay.scene.routes?.map(route => [route.id, route.bridgeSite, route.bridgeKind, route.ford])).toEqual([
      ["edge_top", "TOP", "facility", undefined], ["edge_ford", undefined, undefined, true],
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
    expect(replay.initialView.find(entity => entity.kind === "observation")?.battlefield?.node).toBe("camp");
    expect(replay.timeline.some(event => event.type === "facility-state" && event.battlefield.captureSide === "vermilion" && event.battlefield.facilityOwner === "azure")).toBe(true);
  });
});

it("rejects incomplete or mismatched paired World identity", () => {
  const wrong = { ...WORLD, presentation_digest: "f".repeat(64) };
  const otherCompiler = { ...WORLD, compiler_version: { major: 1, minor: 0, patch: 1 } };
  expect(() => project(undefined, undefined, undefined, undefined, undefined, { ...WORLD, logic_digest: "f".repeat(64) }, WORLD, WORLD))
    .toThrow("World identities do not match");
  expect(() => project(undefined, undefined, undefined, undefined, undefined, WORLD, WORLD, wrong))
    .toThrow("World identities do not match");
  expect(() => project(undefined, undefined, undefined, undefined, undefined, otherCompiler, WORLD, WORLD))
    .toThrow("World identities do not match");
  expect(() => project(undefined, undefined, undefined, undefined, undefined, null, WORLD, WORLD))
    .toThrow("complete RulePackage and paired World identity");
  expect(() => project(undefined, undefined, undefined, undefined, undefined, WORLD, WORLD, WORLD,
    { ...RULESET, digest: "d".repeat(64) }))
    .toThrow("RulePackage identity does not match");
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


it("shares the exact paired crossing-site center with visible and remembered facility consumers", () => {
  const replay = project([
    { id: "left", from: "attacker", to: "camp", length: 250, region: "river", blocked: false,
      bridge_site: "world.bridge.center", crossing_start: 0, crossing_end: 50 },
    { id: "right", from: "camp", to: "defender", length: 250, region: "river", blocked: false,
      bridge_site: "world.bridge.center", crossing_start: 150, crossing_end: 200 },
  ], [{ tick: 0, events: [], visible_state: { global_fields: {}, entities: {
    bridge: { entity_type: "bridge", owner: null, fields: {
      site: value("string", "world.bridge.center"), bridge_state: value("string", "normal"),
      x: value("integer", 100), y: value("integer", 200),
    } },
  } } }], undefined, undefined, undefined, WORLD, WORLD, WORLD, RULESET,
  { attacker: { x: 0, y: 0 }, camp: { x: 250, y: 0 }, defender: { x: 500, y: 0 } });
  // Crossing centers are 25 and 425 WU; the site center is their mean / 25.
  expect(replay.scene.routes?.map(route => route.bridgePosition)).toEqual([{ x: 9, y: 0 }, { x: 9, y: 0 }]);
  expect(replay.initialView.find(entity => entity.kind === "bridge")?.position).toEqual({ x: 9, y: 0 });
  const missing = structuredClone(replay) as PresentationReplay;
  delete missing.scene.routes![0]!.bridgePosition;
  expect(() => decodeReplay(missing)).toThrow(/paired World bridge positions/);
  const outside = structuredClone(replay) as PresentationReplay;
  outside.scene.routes![0]!.bridgePosition = { x: 100, y: 0 };
  expect(() => decodeReplay(outside)).toThrow(/Position outside scene/);
});
