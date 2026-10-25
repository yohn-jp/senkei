import { describe, expect, it } from "vitest";
import type {
  MatchResult,
  PresentationReplay as CoreReplay,
  RulePackage,
} from "../../../apps/web/src/contracts/core-model";
import { presentationToGraphics } from "./next-adapter";
import { decodeReplay, type PresentationReplay } from "./index";

function project(edges: readonly { from:string; to:string; length:number; region:string; blocked:boolean; id?:string; bridge_site?:string; ford?:boolean }[] = [
  { from: "attacker", to: "camp", length: 250, region: "jungle", blocked: false },
  { from: "camp", to: "defender", length: 250, region: "jungle", blocked: true },
], frames: CoreReplay["frames"] = [], nodes: Record<string, { x: number; y: number; region: string }> = {
  attacker: { x: 0, y: 0, region: "base" },
  camp: { x: 250, y: 125, region: "jungle" },
  defender: { x: 500, y: 250, region: "base" },
}) {
  const ruleset = {
    ruleset: { id: "senkei.next", digest: "a".repeat(64) },
    minimum_engine_version: { major: 1, minor: 2, patch: 0 },
    next: {
      parameters: { tick_duration_ms: 100 },
      map: {
        attacker_base: "attacker", defender_base: "defender",
        nodes,
        edges,
        lanes: { mid: ["attacker", "camp", "defender"] },
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
  return presentationToGraphics(replay, ruleset, result);
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

  it("projects one ordered river centerline through each canonical bridge site and ford", () => {
    const edges = [
      { id: "bridge.TOP", from: "top-a", to: "top-b", length: 100, region: "bridge", blocked: false, bridge_site: "TOP" },
      { id: "ford.upper", from: "upper-a", to: "upper-b", length: 100, region: "river_ford", blocked: false, ford: true },
      { id: "bridge.MID.A", from: "mid-a", to: "observation", length: 50, region: "bridge", blocked: false, bridge_site: "MID" },
      { id: "bridge.MID.B", from: "observation", to: "mid-b", length: 50, region: "bridge", blocked: false, bridge_site: "MID" },
      { id: "ford.lower", from: "lower-a", to: "lower-b", length: 100, region: "river_ford", blocked: false, ford: true },
      { id: "bridge.BOT", from: "bot-a", to: "bot-b", length: 100, region: "bridge", blocked: false, bridge_site: "BOT" },
    ];
    const nodes = {
      attacker: { x: 0, y: 0, region: "base" },
      camp: { x: 100, y: 100, region: "jungle" },
      defender: { x: 500, y: 500, region: "base" },
      "top-a": { x: 80, y: -20, region: "riverbank" },
      "top-b": { x: 120, y: 20, region: "riverbank" },
      "upper-a": { x: 130, y: 80, region: "jungle" },
      "upper-b": { x: 170, y: 120, region: "jungle" },
      "mid-a": { x: 180, y: 180, region: "riverbank" },
      observation: { x: 200, y: 200, region: "observation" },
      "mid-b": { x: 220, y: 220, region: "riverbank" },
      "lower-a": { x: 230, y: 280, region: "jungle" },
      "lower-b": { x: 270, y: 320, region: "jungle" },
      "bot-a": { x: 280, y: 380, region: "riverbank" },
      "bot-b": { x: 320, y: 420, region: "riverbank" },
    };
    const river = project(edges, [], nodes).scene.river!;
    expect(river).toHaveLength(7);
    expect(river.slice(1, -1)).toEqual([
      { x: 4, y: 0 }, { x: 6, y: 4 }, { x: 8, y: 8 }, { x: 10, y: 12 }, { x: 12, y: 16 },
    ]);
    expect(river[0]!.y).toBeLessThan(river[1]!.y);
    expect(river.at(-1)!.y).toBeGreaterThan(river.at(-2)!.y);
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
    expect(replay.scene.river).toHaveLength(4);
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
