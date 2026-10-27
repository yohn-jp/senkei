import type { CatalogStamp } from "@senkei/jinrei-editor";
import type { CoreJsonValue } from "./core";
import type { CombatantSide, DomainValue, RulePackage, TacticalDiagnostic, TacticalIntent } from "./core-model";

export interface BehaviorResolveRequest {
  readonly revision: number;
  readonly stamp: CatalogStamp;
  readonly rulePackage: RulePackage;
  readonly catalogMetadataExtension?: CoreJsonValue | null;
  readonly actor: {
    readonly subjectId: string;
    readonly scope: "army" | "squad" | "hero" | "lane_limited_minion";
    readonly heroCatalogId: string | null;
    readonly squadMembers: readonly { readonly subjectId: string; readonly heroCatalogId: string }[];
  };
  readonly preferences: {
    readonly armyId: string;
    readonly army: Readonly<Record<string, DomainValue>>;
    readonly squadId: string;
    readonly squad: Readonly<Record<string, DomainValue>>;
  };
  readonly tick: number;
  readonly side: CombatantSide;
  /** Provided evaluation is caller evidence, not an authenticated Enbu result. */
  readonly evaluation: { readonly kind: "defaults_only" } | {
    readonly kind: "provided";
    readonly intents: readonly TacticalIntent[];
    readonly diagnostics: readonly TacticalDiagnostic[];
    readonly legality: Readonly<Record<string,
      | { readonly kind: "known_legal" }
      | { readonly kind: "known_rejected" | "unknown" | "permission_denied"; readonly reason: string }>>;
  };
}

export interface BehaviorProfileComposition {
  readonly catalog_identity: CatalogStamp;
  readonly actor_scope: BehaviorResolveRequest["actor"]["scope"];
  readonly actor_id: string;
  readonly movement_authority: "Army" | "Squad" | "SoloHero" | "HeroInSquad" | "LaneGroup";
  readonly tick: number;
  readonly side: CombatantSide;
  readonly squad_members: readonly string[];
  readonly values: Readonly<Record<string, DomainValue>>;
  readonly provenance: Readonly<Record<string, { readonly layer: string; readonly source: string }>>;
  readonly digest: string;
  readonly unknown_conditions: readonly { readonly action_id: string; readonly truth: "true" | "false" | "unknown" }[];
  readonly unknown_overrides: readonly { readonly action_id: string; readonly reason: string }[];
  readonly rejected_overrides: readonly { readonly action_id: string; readonly reason: CoreJsonValue }[];
}

export type BehaviorResolveReply = {
  readonly revision: number;
  readonly stamp: CatalogStamp;
  readonly evaluationKind: "defaults_only" | "provided";
} & (
  | { readonly status: "resolved"; readonly composition: BehaviorProfileComposition }
  | { readonly status: "not_declared" }
  | { readonly status: "rejected"; readonly reason: string }
);
