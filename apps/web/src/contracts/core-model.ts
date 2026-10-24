import type { CoreJsonValue } from "./core";

export type FieldId = string;
export type StateId = string;
export type SymbolId = string;
export type EntityId = string;
export type TypeId = string;
export type CapabilityId = string;
export type CollectionId = string;
export type PhaseId = string;
export type RulesetId = string;
export type ContentDigest = string;

export type DomainValue =
  | { readonly kind: "null" }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "integer"; readonly value: number }
  | { readonly kind: "fixed"; readonly value: { readonly coefficient: number; readonly scale: number } }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "enum"; readonly value: SymbolId }
  | { readonly kind: "entity"; readonly value: EntityId }
  | { readonly kind: "list"; readonly value: readonly DomainValue[] }
  | { readonly kind: "record"; readonly value: Readonly<Record<FieldId, DomainValue>> };

export interface StructuredTacticsAst {
  readonly schema_version: import("./core").CoreVersion;
  readonly program_name: string;
  readonly declarations: readonly TacticalDeclaration[];
}

export type TacticalSource =
  | { readonly kind: "text"; readonly source: string }
  | { readonly kind: "structured_ast"; readonly ast: StructuredTacticsAst };

export type TacticalDeclaration =
  | {
      readonly kind: "state";
      readonly name: string;
      readonly predicates: readonly TacticalPredicate[];
    }
  | {
      readonly kind: "action";
      readonly name: string;
      readonly when: TacticalPredicate;
      readonly do_call: TacticalCapabilityCall;
    };

export type TacticalPredicate =
  | { readonly kind: "literal_truth"; readonly value: boolean }
  | { readonly kind: "state_reference"; readonly value: string }
  | { readonly kind: "compare"; readonly value: { readonly left: TacticalValue; readonly operator: ComparisonOperator; readonly right: TacticalValue } }
  | { readonly kind: "knownness"; readonly value: { readonly value: TacticalValue; readonly test: KnownnessTest } }
  | { readonly kind: "and"; readonly value: readonly TacticalPredicate[] }
  | { readonly kind: "or"; readonly value: readonly TacticalPredicate[] }
  | { readonly kind: "not"; readonly value: TacticalPredicate }
  | { readonly kind: "ordered_and"; readonly value: readonly TacticalPredicate[] }
  | { readonly kind: "ordered_or"; readonly value: readonly TacticalPredicate[] }
  | {
      readonly kind: "quantified";
      readonly value: {
        readonly quantifier: Quantifier;
        readonly binding: string;
        readonly collection: TacticalCollection;
        readonly predicates: readonly TacticalPredicate[];
      };
    };

export type ComparisonOperator =
  | "equal"
  | "not_equal"
  | "less_than"
  | "less_than_or_equal"
  | "greater_than"
  | "greater_than_or_equal";
export type KnownnessTest = "known" | "unknown";
export type Quantifier = "any" | "all";

export type TacticalValue =
  | { readonly kind: "literal"; readonly value: DomainValue }
  | { readonly kind: "path"; readonly value: TacticalPath }
  | { readonly kind: "count"; readonly value: { readonly binding: string; readonly collection: TacticalCollection; readonly predicates: readonly TacticalPredicate[] } }
  | { readonly kind: "sum"; readonly value: { readonly binding: string; readonly collection: TacticalCollection; readonly expression: TacticalValue } }
  | { readonly kind: "min"; readonly value: { readonly binding: string; readonly collection: TacticalCollection; readonly expression: TacticalValue } }
  | { readonly kind: "max"; readonly value: { readonly binding: string; readonly collection: TacticalCollection; readonly expression: TacticalValue } }
  | { readonly kind: "arg_min"; readonly value: { readonly binding: string; readonly collection: TacticalCollection; readonly expression: TacticalValue; readonly unique_key: TacticalPath } }
  | { readonly kind: "arg_max"; readonly value: { readonly binding: string; readonly collection: TacticalCollection; readonly expression: TacticalValue; readonly unique_key: TacticalPath } };

export type TacticalCollection =
  | { readonly kind: "path"; readonly value: TacticalPath }
  | { readonly kind: "filter"; readonly value: { readonly binding: string; readonly collection: TacticalCollection; readonly predicates: readonly TacticalPredicate[] } };

export type TacticalPath = readonly string[];

export interface TacticalCapabilityCall {
  readonly capability: TacticalPath;
  readonly arguments: readonly TacticalValue[];
}

export type Observed<T> =
  | { readonly status: "known"; readonly value: T }
  | { readonly status: "unknown" };

export type Truth = "true" | "false" | "unknown";
export type Visibility = "public" | "owning_side" | "enemy_visible" | "internal";
export type CombatantSide = "attacker" | "defender";
export type MatchOutcome = "attacker_victory" | "defender_victory" | "draw" | "aborted";

export type DomainType =
  | { readonly kind: "bool" }
  | { readonly kind: "integer"; readonly value: { readonly min: number | null; readonly max: number | null } }
  | { readonly kind: "fixed"; readonly value: { readonly scale: number; readonly min: number | null; readonly max: number | null } }
  | { readonly kind: "string"; readonly value: { readonly max_bytes: number } }
  | { readonly kind: "enum"; readonly value: { readonly domain: string; readonly values: readonly SymbolId[] } }
  | { readonly kind: "entity"; readonly value: { readonly entity_type: TypeId | null } }
  | { readonly kind: "optional"; readonly value: DomainType }
  | { readonly kind: "list"; readonly value: { readonly element: DomainType; readonly max_items: number } }
  | { readonly kind: "vector"; readonly value: { readonly element: DomainType; readonly max_items: number } }
  | { readonly kind: "matrix"; readonly value: { readonly element: DomainType; readonly max_rows: number; readonly max_columns: number } }
  | { readonly kind: "record"; readonly value: { readonly fields: Readonly<Record<FieldId, DomainType>> } };

export interface ConfigurationFieldSchema {
  readonly value_type: DomainType;
  readonly required: boolean;
  readonly default: DomainValue | null;
}

export interface ObservationFieldSchema {
  readonly value_type: DomainType;
  readonly visibility: Visibility;
}

export interface CollectionSchema {
  readonly element_type: TypeId;
  readonly max_items: number;
  readonly visibility: Visibility;
  readonly order_by: readonly string[];
}

export interface ParameterSchema {
  readonly id: string;
  readonly value_type: DomainType;
  readonly optional: boolean;
}

export interface CapabilitySchema {
  readonly arguments: readonly ParameterSchema[];
  readonly target_type: TypeId | null;
  readonly phases: readonly PhaseId[];
  readonly preconditions: readonly CoreJsonValue[];
  readonly issue_cost: string;
}

export interface DomainSchema {
  readonly schema_version: import("./core").CoreVersion;
  readonly senkei_configuration: Readonly<Record<FieldId, ConfigurationFieldSchema>>;
  readonly observation_fields: Readonly<Record<string, ObservationFieldSchema>>;
  readonly collections: Readonly<Record<CollectionId, CollectionSchema>>;
  readonly capabilities: Readonly<Record<CapabilityId, CapabilitySchema>>;
  readonly tactical_memory: Readonly<Record<StateId, DomainType>>;
  readonly symbol_domains: Readonly<Record<string, readonly SymbolId[]>>;
  readonly max_expression_depth: number;
  readonly max_collection_items: number;
}

export interface FieldSchema {
  readonly value_type: DomainType;
  readonly visibility: Visibility;
  readonly writable: boolean;
}

export interface EntityTypeSchema {
  readonly fields: Readonly<Record<FieldId, FieldSchema>>;
  readonly default_owner: CombatantSide | null;
}

export interface WorldSchema {
  readonly entity_types: Readonly<Record<TypeId, EntityTypeSchema>>;
  readonly global_fields: Readonly<Record<FieldId, FieldSchema>>;
  readonly collections: Readonly<Record<CollectionId, CollectionSchema>>;
  readonly max_entities: number;
}

/** Full, validated Senritsu package JSON returned by the core adapter. */
export interface RulePackage {
  readonly ruleset: import("./core").RulesetRef;
  readonly minimum_engine_version: import("./core").CoreVersion;
  readonly model_version: import("./core").CoreVersion;
  readonly primitive_set_id: string;
  readonly primitive_set_version: import("./core").CoreVersion;
  readonly jinrei_language_version: import("./core").CoreVersion;
  readonly typed_ir_version: import("./core").CoreVersion;
  readonly bytecode_version: import("./core").CoreVersion;
  readonly domain: DomainSchema;
  readonly world: WorldSchema;
  readonly phases: readonly CoreJsonValue[];
  readonly required_primitives: readonly string[];
  readonly transitions: readonly CoreJsonValue[];
  readonly arbitration: Readonly<Record<CapabilityId, CoreJsonValue>>;
  readonly termination: CoreJsonValue;
  readonly cost_schedule: CoreJsonValue;
  readonly presentation: CoreJsonValue;
  readonly limits: CoreJsonValue;
}

export interface ComponentVersions {
  readonly model: import("./core").CoreVersion;
  readonly engine: import("./core").CoreVersion;
  readonly ruleset: import("./core").CoreVersion;
  readonly jinrei_language: import("./core").CoreVersion;
  readonly typed_ir: import("./core").CoreVersion;
  readonly bytecode: import("./core").CoreVersion;
  readonly cost_schedule: import("./core").CoreVersion;
  readonly replay_schema: import("./core").CoreVersion;
}

export interface TacticalProgram {
  readonly language_version: import("./core").CoreVersion;
  readonly ir_version: import("./core").CoreVersion;
  readonly bytecode_version: import("./core").CoreVersion;
  readonly cost_schedule_id: string;
  readonly cost_schedule_version: import("./core").CoreVersion;
  readonly ruleset: import("./core").RulesetRef;
  readonly content_digest: ContentDigest;
  readonly bytecode: readonly number[];
}

export interface CompileDiagnostic {
  readonly severity: "info" | "warning";
  readonly code: string;
  readonly message: string;
  readonly path: string | null;
}

export interface SenkeiSnapshot {
  readonly schema_version: import("./core").CoreVersion;
  readonly id: string;
  readonly revision: string;
  readonly ruleset: import("./core").RulesetRef;
  readonly configuration: Readonly<Record<FieldId, DomainValue>>;
  readonly program: TacticalProgram;
  readonly initial_memory: Readonly<Record<StateId, DomainValue>>;
}

export interface WorldState {
  readonly entities: Readonly<Record<EntityId, EntityState>>;
  readonly global_fields: Readonly<Record<FieldId, DomainValue>>;
}

export interface EntityState {
  readonly entity_type: TypeId;
  readonly owner: CombatantSide | null;
  readonly fields: Readonly<Record<FieldId, DomainValue>>;
}

export interface HostLimits {
  readonly max_input_bytes: number;
  readonly max_entities: number;
  readonly max_events: number;
  readonly max_diagnostic_events: number;
}

export interface MatchContext {
  readonly schema_version: import("./core").CoreVersion;
  readonly match_id: string;
  readonly ruleset: import("./core").RulesetRef;
  readonly versions: ComponentVersions;
  readonly initial_world: WorldState;
  readonly max_ticks: number;
  readonly host_limits: HostLimits;
}

export interface MatchResult {
  readonly match_id: string;
  readonly outcome: MatchOutcome;
  readonly termination_reason: SymbolId;
  readonly final_tick: number;
  readonly statistics: Readonly<Record<SymbolId, DomainValue>>;
  readonly cu_spent: Readonly<Record<CombatantSide, number>>;
  readonly final_state_digest: ContentDigest;
}

export interface PresentationReplay {
  readonly schema_version: import("./core").CoreVersion;
  readonly match_id: string;
  readonly result_digest: ContentDigest;
  readonly frames: readonly ReplayFrame[];
}

export interface ReplayFrame {
  readonly tick: number;
  readonly events: readonly PresentationEvent[];
  readonly visible_state: WorldStateView | null;
}

export interface PresentationEvent {
  readonly event: string;
  readonly entity: EntityId | null;
  readonly payload: Readonly<Record<FieldId, DomainValue>>;
}

export interface WorldStateView {
  readonly entities: Readonly<Record<EntityId, EntityStateView>>;
  readonly global_fields: Readonly<Record<FieldId, DomainValue>>;
}

export interface EntityStateView {
  readonly entity_type: TypeId;
  readonly owner: CombatantSide | null;
  readonly fields: Readonly<Record<FieldId, DomainValue>>;
}

export interface TacticalIntent {
  readonly action_id: string;
  readonly capability: CapabilityId;
  readonly actor: EntityId | null;
  readonly target: EntityId | null;
  readonly arguments: readonly DomainValue[];
  readonly priority: number | null;
}

export type DiagnosticRecord =
  | { readonly kind: "state_evaluated"; readonly value: { readonly state: StateId; readonly result: Truth } }
  | { readonly kind: "intent_proposed"; readonly value: { readonly intent: TacticalIntent } }
  | { readonly kind: "intent_accepted"; readonly value: { readonly intent: TacticalIntent } }
  | { readonly kind: "intent_rejected"; readonly value: { readonly intent: TacticalIntent; readonly reason: SymbolId } }
  | { readonly kind: "cost_charged"; readonly value: { readonly operation: string; readonly amount: number } }
  | { readonly kind: "memory_read"; readonly value: { readonly state: StateId; readonly value: DomainValue | null } }
  | { readonly kind: "memory_written"; readonly value: { readonly state: StateId; readonly value: DomainValue } }
  | { readonly kind: "runtime_notice"; readonly value: { readonly code: string; readonly details: Readonly<Record<string, string>> } };

export interface DiagnosticEvent {
  readonly tick: number;
  readonly side: CombatantSide;
  readonly sequence: number;
  readonly record: DiagnosticRecord;
}

export type TacticalMemory = Readonly<Record<StateId, DomainValue>>;

export interface RestrictedDiagnostics {
  readonly events: readonly DiagnosticEvent[];
  readonly cu_by_side: Readonly<Record<CombatantSide, number>>;
  readonly final_memory_by_side: Readonly<Record<CombatantSide, TacticalMemory>>;
}

export function isLogicalCu(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}
