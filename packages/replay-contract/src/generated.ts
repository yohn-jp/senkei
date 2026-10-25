/* Generated from replay.schema.json. Run npm run contract:types. */

export type Event =
  | {
      type: "spawn";
      tick: number;
      order: number;
      entity: Entity;
    }
  | {
      type: "move";
      tick: number;
      order: number;
      entityId: string;
      position: WorldPoint;
      logicalPosition?: BattlefieldState;
    }
  | {
      type: "attack";
      tick: number;
      order: number;
      entityId: string;
      targetId: string;
    }
  | {
      type: "damage";
      tick: number;
      order: number;
      entityId: string;
      hp: number;
    }
  | {
      type: "destroy";
      tick: number;
      order: number;
      entityId: string;
    }
  | {
      type: "disappear";
      tick: number;
      order: number;
      entityId: string;
    }
  | {
      type: "match-end";
      tick: number;
      order: number;
      result: Result;
    }
  | {
      type: "vitals";
      tick: number;
      order: number;
      entityId: string;
      hp: number;
      maxHp: number;
    }
  | {
      type: "skill";
      tick: number;
      order: number;
      entityId: string;
      targetId: string;
      skillKey: string;
    }
  | {
      type: "facility-state";
      tick: number;
      order: number;
      entityId: string;
      battlefield: BattlefieldState;
    };

export interface PresentationReplay {
  schemaVersion: "0.1" | "0.2" | "0.3";
  header: {
    origin: "sample" | "official" | "local";
    title: string;
    enbuVersion: string | null;
    senritsu: {
      id: string;
      digest: string;
    };
    view: "public" | "attacker" | "defender";
  };
  presentation: {
    coordinates: "x-right-y-down";
    assetCatalogVersion: string;
    tickDurationMs: number;
  };
  scene: {
    bounds: {
      min: WorldPoint;
      max: WorldPoint;
    };
    /**
     * @minItems 1
     * @maxItems 32
     */
    lanes: [Lane, ...Lane[]];
    /**
     * @maxItems 32
     */
    camps?: {
      id: string;
      position: WorldPoint;
    }[];
    /**
     * Traversable map edges projected from the ruleset world graph.
     */
    routes?: Route[];
    /**
     * Immutable base locations from the public World map. This is not facility state or visibility.
     *
     * @maxItems 2
     */
    baseSites?:
      | []
      | [
          {
            id: string;
            side: "azure" | "vermilion";
            position: WorldPoint;
          }
        ]
      | [
          {
            id: string;
            side: "azure" | "vermilion";
            position: WorldPoint;
          },
          {
            id: string;
            side: "azure" | "vermilion";
            position: WorldPoint;
          }
        ];
    /**
     * @maxItems 256
     */
    nodes?: MapNode[];
    /**
     * @minItems 2
     * @maxItems 64
     */
    river?: [WorldPoint, WorldPoint, ...WorldPoint[]];
    trackOffset?: number;
    captureTicks?: number;
  };
  /**
   * @minItems 0
   * @maxItems 2000
   */
  initialView: Entity[];
  /**
   * @minItems 1
   * @maxItems 500000
   */
  timeline: [Event, ...Event[]];
  result: Result;
  fog?: {
    worldUnitsPerRenderUnit: number;
    /**
     * @minItems 1
     */
    frames: [FogFrame, ...FogFrame[]];
  };
}
export interface WorldPoint {
  x: number;
  y: number;
}
export interface Lane {
  id: string;
  label: string;
  /**
   * @minItems 2
   * @maxItems 100
   */
  points: [WorldPoint, WorldPoint, ...WorldPoint[]];
  elevation: number;
}
export interface Route {
  id: string;
  region: string;
  /**
   * @minItems 2
   * @maxItems 2
   */
  points: [WorldPoint, WorldPoint];
  bridgeSite?: "TOP" | "MID" | "BOT";
  ford?: boolean;
}
export interface MapNode {
  id: string;
  allegiance: "A" | "B" | "N";
  position: WorldPoint;
}
export interface Entity {
  id: string;
  side: "azure" | "vermilion" | "neutral";
  kind: "unit" | "tower" | "base" | "bridge" | "observation";
  archetype: string;
  appearanceKey: string;
  position: WorldPoint;
  hp: number;
  maxHp: number;
  catalogId?: string;
  battlefield?: BattlefieldState;
}
export interface BattlefieldState {
  node?: string;
  edgeTo?: string;
  progress?: number;
  track?: "LEFT" | "CENTER" | "RIGHT";
  crossing?: "none" | "track" | "bridge" | "ford";
  remaining?: number;
  bridgeSite?: "TOP" | "MID" | "BOT";
  bridgeState?: "normal" | "expanded" | "destroyed";
  buildRemaining?: number;
  captureProgress?: number;
  facilityOwner?: "azure" | "vermilion" | "neutral";
  captureSide?: "azure" | "vermilion" | "neutral";
}
export interface Result {
  winner: "azure" | "vermilion" | "draw";
  reason: string;
  tick: number;
}
export interface FogFrame {
  schema_version: 1;
  tick: number;
  side: "attacker" | "defender";
  nodes: {
    [k: string]: "unexplored" | "explored" | "visible";
  };
  edges: {
    /**
     * @minItems 9
     * @maxItems 9
     */
    [k: string]: [
      "unexplored" | "explored" | "visible",
      "unexplored" | "explored" | "visible",
      "unexplored" | "explored" | "visible",
      "unexplored" | "explored" | "visible",
      "unexplored" | "explored" | "visible",
      "unexplored" | "explored" | "visible",
      "unexplored" | "explored" | "visible",
      "unexplored" | "explored" | "visible",
      "unexplored" | "explored" | "visible"
    ];
  };
  contacts: {
    id: string;
    state: "last_known";
    kind: "hero" | "minion" | "monster";
    side: "attacker" | "defender";
    x: number;
    y: number;
    last_seen_tick: number;
  }[];
}
