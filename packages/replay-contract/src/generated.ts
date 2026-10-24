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
    };

export interface PresentationReplay {
  schemaVersion: "0.1" | "0.2";
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
}
export interface Entity {
  id: string;
  side: "azure" | "vermilion" | "neutral";
  kind: "unit" | "tower" | "base";
  archetype: string;
  appearanceKey: string;
  position: WorldPoint;
  hp: number;
  maxHp: number;
  catalogId?: string;
}
export interface Result {
  winner: "azure" | "vermilion" | "draw";
  reason: string;
  tick: number;
}
