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
    };

export interface PresentationReplay {
  schemaVersion: "0.1";
  header: {
    origin: "sample" | "official";
    title: string;
    enbuVersion: string | null;
    senritsu: {
      id: string;
      digest: string;
    };
    view: "public";
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
  };
  /**
   * @minItems 1
   * @maxItems 2000
   */
  initialView: [Entity, ...Entity[]];
  /**
   * @minItems 1
   * @maxItems 20000
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
export interface Entity {
  id: string;
  side: "azure" | "vermilion" | "neutral";
  kind: "unit" | "tower" | "base";
  archetype: string;
  appearanceKey: string;
  position: WorldPoint;
  hp: number;
  maxHp: number;
}
export interface Result {
  winner: "azure" | "vermilion" | "draw";
  reason: string;
  tick: number;
}
