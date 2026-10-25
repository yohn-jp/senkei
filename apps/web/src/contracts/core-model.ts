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
export type ActionId = string;
export type ArtifactId = string;
export type DiagnosticCode = string;
export type EventId = string;
export type MatchId = string;
export type ObservationPath = string;
export type ParameterId = string;
export type ProjectionId = string;
export type RevisionId = string;
export type RuleId = string;
export type CostOperationId = string;
export type CostScheduleId = string;
export type PrimitiveSetId = string;
export type ScenarioId = string;
export type SymbolDomainId = string;
export type FieldPath = string;

/** Stable identifiers in the initial Senritsu lane schema. */
export const SENRITSU_LANE_SYMBOL_DOMAIN_ID = "lane" as const;
export const SENRITSU_LANE_FIELD_ID = "lane" as const;

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
  | { readonly kind: "filtered_collection"; readonly value: { readonly binding: string; readonly collection: TacticalCollection; readonly predicates: readonly TacticalPredicate[] } }
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
  | { readonly kind: "enum"; readonly value: { readonly domain: SymbolDomainId; readonly values: readonly SymbolId[] } }
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
  readonly source: ObservationSource;
}

export interface CollectionSchema {
  readonly element_type: TypeId;
  readonly max_items: number;
  readonly visibility: Visibility;
  readonly source: CollectionSource;
  readonly visible_fields: Readonly<Record<FieldId, ObservationFieldSchema>>;
  readonly order_by: readonly FieldId[];
  readonly unique_keys: readonly CollectionUniqueKey[];
}

export interface ParameterSchema {
  readonly id: ParameterId;
  readonly value_type: DomainType;
  readonly optional: boolean;
}

export interface CapabilitySchema {
  readonly arguments: readonly ParameterSchema[];
  readonly target_type: TypeId | null;
  readonly actor_argument: number | null;
  readonly target_argument: number | null;
  readonly target_owner: TargetOwnerConstraint;
  readonly phases: readonly PhaseId[];
  readonly preconditions: readonly RuleExpression[];
  readonly issue_cost: CostOperationId;
}

export interface DomainSchema {
  readonly schema_version: import("./core").CoreVersion;
  readonly senkei_configuration: Readonly<Record<FieldId, ConfigurationFieldSchema>>;
  readonly observation_fields: Readonly<Record<string, ObservationFieldSchema>>;
  readonly collections: Readonly<Record<CollectionId, CollectionSchema>>;
  readonly capabilities: Readonly<Record<CapabilityId, CapabilitySchema>>;
  readonly tactical_memory: Readonly<Record<StateId, DomainType>>;
  readonly symbol_domains: Readonly<Record<SymbolDomainId, readonly SymbolId[]>>;
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
  readonly collections: Readonly<Record<CollectionId, WorldCollectionSchema>>;
  readonly max_entities: number;
}

export interface WorldCollectionSchema {
  readonly element_type: DomainType;
  readonly max_items: number;
}

export type TargetOwnerConstraint = "any" | "own_side" | "other_side" | "unowned";

export type ObservationSource =
  | { readonly kind: "tick" }
  | { readonly kind: "world_global_field"; readonly value: { readonly field: FieldId } }
  | { readonly kind: "world_entity_field"; readonly value: { readonly entity: WorldEntitySelector; readonly field: FieldId } }
  | { readonly kind: "current_entity_field"; readonly value: { readonly field: FieldId } }
  | { readonly kind: "derived"; readonly value: RuleExpression };

export type CollectionUniqueKey =
  | { readonly kind: "entity_id" }
  | { readonly kind: "fields"; readonly value: readonly FieldId[] };

export type CollectionSource = {
  readonly kind: "world_entities";
  readonly value: {
    readonly entity_types: readonly TypeId[];
    readonly owner: EntityOwnerSelector;
    readonly filter: RuleExpression | null;
  };
};

export type EntityOwnerSelector =
  | "any"
  | "own_side"
  | "other_side"
  | "unowned"
  | "attacker"
  | "defender";

export type EntitySelector =
  | { readonly kind: "intent_actor" }
  | { readonly kind: "intent_target" }
  | { readonly kind: "by_intent_argument"; readonly value: number }
  | { readonly kind: "observed_entity" }
  | { readonly kind: "fixed"; readonly value: EntityId }
  | {
      readonly kind: "by_projection_key";
      readonly value: {
        readonly projection_id: ProjectionId;
        readonly entity_type: TypeId;
        readonly owner: EntityOwnerSelector;
        readonly key: DomainValue;
      };
    };

export type WorldEntitySelector =
  | { readonly kind: "fixed"; readonly value: EntityId }
  | {
      readonly kind: "by_projection_key";
      readonly value: {
        readonly projection_id: ProjectionId;
        readonly entity_type: TypeId;
        readonly owner: EntityOwnerSelector;
        readonly key: DomainValue;
      };
    };

export type RuleExpression =
  | { readonly kind: "literal"; readonly value: DomainValue }
  | { readonly kind: "intent_argument"; readonly value: number }
  | { readonly kind: "current_tick" }
  | { readonly kind: "field"; readonly value: { readonly target: EntitySelector; readonly field: FieldId } }
  | { readonly kind: "global_field"; readonly value: FieldId }
  | { readonly kind: "add_integer"; readonly value: { readonly left: RuleExpression; readonly right: RuleExpression } }
  | { readonly kind: "subtract_integer"; readonly value: { readonly left: RuleExpression; readonly right: RuleExpression } }
  | { readonly kind: "add_fixed"; readonly value: { readonly left: RuleExpression; readonly right: RuleExpression } }
  | { readonly kind: "equal"; readonly value: { readonly left: RuleExpression; readonly right: RuleExpression } }
  | { readonly kind: "less_than"; readonly value: { readonly left: RuleExpression; readonly right: RuleExpression } }
  | { readonly kind: "and" | "or"; readonly value: readonly RuleExpression[] }
  | { readonly kind: "not"; readonly value: RuleExpression };

export interface WorldInitialization {
  readonly entities: readonly EntityProjection[];
  readonly global_fields: Readonly<Record<FieldId, DomainValue>>;
  readonly collections: Readonly<Record<CollectionId, readonly DomainValue[]>>;
}

export interface EntityProjection {
  readonly projection_id: ProjectionId;
  readonly applies_to: ProjectionSides;
  readonly source: EntityProjectionSource;
  readonly entity_type: TypeId;
  readonly entity_id: EntityIdProjection;
  readonly owner: EntityOwnerProjection;
  readonly fields: Readonly<Record<FieldId, ProjectionValue>>;
}

export type ProjectionSides = "both" | "attacker_only" | "defender_only";

export type EntityProjectionSource =
  | { readonly kind: "singleton" }
  | { readonly kind: "each_configuration_item"; readonly value: { readonly field: FieldId } };

export type EntityIdProjection =
  | { readonly kind: "fixed"; readonly value: EntityId }
  | { readonly kind: "constant_key"; readonly value: string }
  | { readonly kind: "configuration_key"; readonly value: { readonly root: FieldId; readonly path: readonly FieldId[] } }
  | { readonly kind: "configuration_item_key"; readonly value: { readonly path: readonly FieldId[] } };

export type EntityOwnerProjection =
  | { readonly kind: "unowned" }
  | { readonly kind: "fixed"; readonly value: CombatantSide }
  | { readonly kind: "snapshot_side" };

export type ProjectionValue =
  | { readonly kind: "constant"; readonly value: DomainValue }
  | { readonly kind: "configuration_path"; readonly value: { readonly root: FieldId; readonly path: readonly FieldId[] } }
  | { readonly kind: "configuration_item_path"; readonly value: { readonly path: readonly FieldId[] } }
  | { readonly kind: "snapshot_side" };

export type PhaseKind =
  | "snapshot"
  | "tactical_evaluation"
  | "intent_validation"
  | "arbitration"
  | "transition"
  | "termination";

export interface ExecutionPhase {
  readonly id: PhaseId;
  readonly order: number;
  readonly kind: PhaseKind;
}

export type TransitionPrimitiveKind =
  | "battle_navigation" | "battle_vision" | "battle_squads" | "battle_combat"
  | "set_field"
  | "add_integer"
  | "add_fixed"
  | "create_entity"
  | "remove_entity"
  | "append_collection"
  | "remove_collection_value"
  | "emit_event"
  | "set_outcome";

export type EntityOwnerSource =
  | { readonly kind: "unowned" }
  | { readonly kind: "fixed"; readonly value: CombatantSide }
  | { readonly kind: "intent_side" };

export type EntityIdSource = "deterministic_invocation";

export type TransitionPrimitive =
  | { readonly kind: "set_field"; readonly target: EntitySelector; readonly field: FieldId; readonly value: RuleExpression }
  | { readonly kind: "add_integer"; readonly target: EntitySelector; readonly field: FieldId; readonly amount: RuleExpression }
  | { readonly kind: "add_fixed"; readonly target: EntitySelector; readonly field: FieldId; readonly amount: RuleExpression }
  | { readonly kind: "set_global_field"; readonly field: FieldId; readonly value: RuleExpression }
  | { readonly kind: "add_global_integer"; readonly field: FieldId; readonly amount: RuleExpression }
  | { readonly kind: "create_entity"; readonly id: EntityIdSource; readonly entity_type: TypeId; readonly owner: EntityOwnerSource; readonly fields: Readonly<Record<FieldId, RuleExpression>> }
  | { readonly kind: "remove_entity"; readonly target: EntitySelector }
  | { readonly kind: "append_collection"; readonly collection: CollectionId; readonly value: RuleExpression }
  | { readonly kind: "remove_collection_value"; readonly collection: CollectionId; readonly value: RuleExpression }
  | { readonly kind: "emit_event"; readonly event: EventId; readonly payload: Readonly<Record<FieldId, RuleExpression>> }
  | { readonly kind: "set_outcome"; readonly outcome: RuleExpression; readonly reason: SymbolId };

export interface TransitionRule {
  readonly id: RuleId;
  readonly phase: PhaseId;
  readonly order: number;
  readonly capability: CapabilityId | null;
  readonly when: RuleExpression | null;
  readonly operations: readonly TransitionPrimitive[];
}

export interface ArbitrationRule {
  readonly conflict_keys: readonly IntentKey[];
  readonly resolution: ArbitrationResolution;
}

export type IntentKey =
  | { readonly kind: "priority" }
  | { readonly kind: "side" }
  | { readonly kind: "actor" }
  | { readonly kind: "target" }
  | { readonly kind: "action_id" }
  | { readonly kind: "capability" }
  | { readonly kind: "argument"; readonly value: number };

export type SortDirection = "ascending" | "descending";

export interface IntentSortTerm {
  readonly key: IntentKey;
  readonly direction: SortDirection;
}

export type ArbitrationResolution =
  | { readonly kind: "allow_all"; readonly value: { readonly max_accepted: number } }
  | { readonly kind: "reject_conflicts" }
  | { readonly kind: "select_ordered"; readonly value: { readonly sort_by: readonly IntentSortTerm[]; readonly max_accepted: number } };

export interface TerminationPolicy {
  readonly max_ticks: number;
  readonly conditions: readonly TerminationCondition[];
  readonly on_timeout: MatchOutcome;
  readonly on_timeout_reason: SymbolId;
}

export interface TerminationCondition {
  readonly order: number;
  readonly when: RuleExpression;
  readonly outcome: MatchOutcome;
  readonly reason: SymbolId;
}

export interface LogicalCuCost {
  readonly base: number;
  readonly per_item: number;
}

export type BudgetOverrunPolicy = "reject_tick_and_keep_memory" | "abort_match";
export type MemoryCommitPolicy = "on_completed_evaluation" | "on_any_intent_accepted";

export interface CostSchedule {
  readonly id: CostScheduleId;
  readonly version: import("./core").CoreVersion;
  readonly operations: Readonly<Record<CostOperationId, LogicalCuCost>>;
  readonly per_tick_budget: number;
  readonly per_match_budget: number;
  readonly overrun_policy: BudgetOverrunPolicy;
  readonly memory_commit_policy: MemoryCommitPolicy;
  readonly budget_overrun_reason: SymbolId;
}

export interface PresentationPolicy {
  readonly visible_events: Readonly<Record<EventId, EventSchema>>;
  readonly visible_entity_fields: Readonly<Record<TypeId, readonly FieldId[]>>;
  readonly visible_global_fields: readonly FieldId[];
}

export interface EventSchema {
  readonly payload: Readonly<Record<FieldId, DomainType>>;
}

export interface RuleLimits {
  readonly max_input_bytes: number;
  readonly max_entities: number;
  readonly max_events: number;
  readonly max_diagnostic_events: number;
  readonly max_output_bytes: number;
  readonly max_intents_per_side_per_tick: number;
  readonly max_value_depth: number;
}

export interface ExecutionBudget {
  readonly available_cu: number;
  readonly max_intents: number;
}

export type TacticalExecutionStatus = "completed" | "budget_exceeded";

/** Full, validated Senritsu package JSON returned by the core adapter. */
export interface RulePackage {
  readonly next?: NextRules;
  readonly ruleset: import("./core").RulesetRef;
  readonly minimum_engine_version: import("./core").CoreVersion;
  readonly model_version: import("./core").CoreVersion;
  readonly primitive_set_id: PrimitiveSetId;
  readonly primitive_set_version: import("./core").CoreVersion;
  readonly jinrei_language_version: import("./core").CoreVersion;
  readonly structured_ast_version: import("./core").CoreVersion;
  readonly typed_ir_version: import("./core").CoreVersion;
  readonly bytecode_version: import("./core").CoreVersion;
  readonly domain: DomainSchema;
  readonly world_initialization: WorldInitialization;
  readonly world: WorldSchema;
  readonly phases: readonly ExecutionPhase[];
  readonly required_primitives: readonly TransitionPrimitiveKind[];
  readonly transitions: readonly TransitionRule[];
  readonly arbitration: Readonly<Record<CapabilityId, ArbitrationRule>>;
  readonly termination: TerminationPolicy;
  readonly cost_schedule: CostSchedule;
  readonly presentation: PresentationPolicy;
  readonly limits: RuleLimits;
}

/** Normalized engine input generated only after package validation. */
export type RulePlan = Omit<RulePackage, "ruleset">;

export interface EngineCompatibility {
  readonly engine: import("./core").CoreVersion;
  readonly model: import("./core").CoreVersion;
  readonly primitive_set_id: PrimitiveSetId;
  readonly primitive_set: import("./core").CoreVersion;
  readonly jinrei_language: import("./core").CoreVersion;
  readonly structured_ast: import("./core").CoreVersion;
  readonly typed_ir: import("./core").CoreVersion;
  readonly bytecode: import("./core").CoreVersion;
  readonly available_primitives: readonly TransitionPrimitiveKind[];
}

export interface ComponentVersions {
  readonly model: import("./core").CoreVersion;
  readonly engine: import("./core").CoreVersion;
  readonly ruleset: import("./core").CoreVersion;
  readonly jinrei_language: import("./core").CoreVersion;
  readonly structured_ast: import("./core").CoreVersion;
  readonly typed_ir: import("./core").CoreVersion;
  readonly bytecode: import("./core").CoreVersion;
  readonly cost_schedule: import("./core").CoreVersion;
  readonly replay_schema: import("./core").CoreVersion;
}

export interface TacticalProgram {
  readonly language_version: import("./core").CoreVersion;
  readonly ir_version: import("./core").CoreVersion;
  readonly bytecode_version: import("./core").CoreVersion;
  readonly cost_schedule_id: CostScheduleId;
  readonly cost_schedule_version: import("./core").CoreVersion;
  readonly ruleset: import("./core").RulesetRef;
  readonly content_digest: ContentDigest;
  readonly bytecode: readonly number[];
}

export interface CompileDiagnostic {
  readonly severity: "info" | "warning";
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly path: string | null;
}

export interface SenkeiSnapshot {
  readonly schema_version: import("./core").CoreVersion;
  readonly id: ArtifactId;
  readonly revision: RevisionId;
  readonly ruleset: import("./core").RulesetRef;
  readonly configuration: Readonly<Record<FieldId, DomainValue>>;
  readonly program: TacticalProgram;
  readonly initial_memory: Readonly<Record<StateId, DomainValue>>;
}

export interface WorldState {
  readonly entities: Readonly<Record<EntityId, EntityState>>;
  readonly global_fields: Readonly<Record<FieldId, DomainValue>>;
  readonly collections: Readonly<Record<CollectionId, readonly DomainValue[]>>;
}

export interface EntityState {
  readonly entity_type: TypeId;
  readonly owner: CombatantSide | null;
  readonly fields: Readonly<Record<FieldId, DomainValue>>;
}

export interface EntityObservation {
  readonly id: EntityId;
  readonly entity_type: TypeId;
  readonly fields: Readonly<Record<FieldId, Observed<DomainValue>>>;
}

export interface ObservationSnapshot {
  readonly tick: number;
  readonly side: CombatantSide;
  readonly fields: Readonly<Record<ObservationPath, Observed<DomainValue>>>;
  readonly collections: Readonly<Record<CollectionId, Observed<readonly EntityObservation[]>>>;
}

export interface HostLimits {
  readonly max_input_bytes: number;
  readonly max_entities: number;
  readonly max_events: number;
  readonly max_diagnostic_events: number;
  readonly max_output_bytes: number;
}

export interface MatchContext {
  readonly schema_version: import("./core").CoreVersion;
  readonly match_id: MatchId;
  readonly ruleset: import("./core").RulesetRef;
  readonly versions: ComponentVersions;
  readonly initial_world: WorldState;
  readonly max_ticks: number;
  readonly host_limits: HostLimits;
}

export interface MatchResult {
  readonly match_id: MatchId;
  readonly outcome: MatchOutcome;
  readonly termination_reason: SymbolId;
  readonly final_tick: number;
  readonly statistics: Readonly<Record<SymbolId, DomainValue>>;
  readonly cu_spent: Readonly<Record<CombatantSide, number>>;
  readonly final_state_digest: ContentDigest;
}

export interface PresentationReplay {
  readonly perspective?: CombatantSide;
  readonly schema_version: import("./core").CoreVersion;
  readonly match_id: MatchId;
  readonly result_digest: ContentDigest;
  readonly frames: readonly ReplayFrame[];
}

export interface ReplayFrame {
  readonly tick: number;
  readonly events: readonly PresentationEvent[];
  readonly visible_state: WorldStateView | null;
}

export interface PresentationEvent {
  readonly event: EventId;
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
  readonly action_id: ActionId;
  readonly capability: CapabilityId;
  readonly actor: EntityId | null;
  readonly target: EntityId | null;
  readonly arguments: readonly DomainValue[];
  readonly priority: number | null;
}

export interface IntentBatch {
  readonly tick: number;
  readonly side: CombatantSide;
  readonly intents: readonly TacticalIntent[];
}

export type TacticalDiagnostic =
  | { readonly kind: "state_evaluated"; readonly value: { readonly state: StateId; readonly result: Truth } }
  | { readonly kind: "intent_proposed"; readonly value: { readonly intent: TacticalIntent } }
  | { readonly kind: "cost_charged"; readonly value: { readonly operation: CostOperationId; readonly amount: number } }
  | { readonly kind: "memory_read"; readonly value: { readonly state: StateId; readonly value: DomainValue | null } }
  | { readonly kind: "memory_written"; readonly value: { readonly state: StateId; readonly value: DomainValue } }
  | { readonly kind: "runtime_notice"; readonly value: { readonly code: string; readonly details: Readonly<Record<string, string>> } };

export interface ValidationIssue {
  readonly code: DiagnosticCode;
  readonly path: string;
  readonly message: string;
  readonly details: Readonly<Record<string, string>>;
}

export interface ApiError {
  readonly code: import("./core").ApiErrorCode;
  readonly message: string;
  readonly path: string | null;
  readonly details: Readonly<Record<string, string>>;
}

export interface StateWrite {
  readonly state: StateId;
  readonly value: DomainValue;
}

export type DiagnosticRecord =
  | { readonly kind: "state_evaluated"; readonly value: { readonly state: StateId; readonly result: Truth } }
  | { readonly kind: "intent_proposed"; readonly value: { readonly intent: TacticalIntent } }
  | { readonly kind: "intent_accepted"; readonly value: { readonly intent: TacticalIntent } }
  | { readonly kind: "intent_rejected"; readonly value: { readonly intent: TacticalIntent; readonly reason: SymbolId } }
  | { readonly kind: "cost_charged"; readonly value: { readonly operation: CostOperationId; readonly amount: number } }
  | { readonly kind: "memory_read"; readonly value: { readonly state: StateId; readonly value: DomainValue | null } }
  | { readonly kind: "memory_written"; readonly value: { readonly state: StateId; readonly value: DomainValue } }
  | { readonly kind: "runtime_notice"; readonly value: { readonly code: string; readonly details: Readonly<Record<string, string>> } };

export interface DiagnosticEvent {
  readonly tick: number;
  readonly side: CombatantSide;
  readonly sequence: number;
  /** Null when a trace event cannot be associated with a tactical action. */
  readonly action_id: ActionId | null;
  /** Entity link for schema-based lane attribution when the trace provides one. */
  readonly entity_id: EntityId | null;
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

/** Senritsu-owned versioned content, matching senkei-model::NextRules. */
export interface NextRules {
  readonly mechanics_version: import("./core").CoreVersion;
  readonly map: BattleMap;
  readonly heroes: readonly HeroDefinition[];
  readonly minions: readonly UnitDefinition[];
  readonly monsters: readonly UnitDefinition[];
  readonly camps: readonly CampDefinition[];
  readonly parameters: Readonly<Record<string, number>>;
}
export interface BattleMap {
  readonly id: string;
  readonly nodes: Readonly<Record<string, { readonly x:number; readonly y:number; readonly region:string; readonly allegiance?:string }>>;
  readonly edges: readonly { readonly from:string; readonly to:string; readonly length:number; readonly region:string; readonly blocked:boolean; readonly id?:string; readonly bridge_site?:string; readonly ford?:boolean }[];
  readonly lanes: Readonly<Record<string, readonly string[]>>;
  readonly attacker_base:string;
  readonly defender_base:string;
  readonly towers: readonly { readonly id:string; readonly node:string; readonly side:string; readonly lane:string }[];
}
export interface UnitStats { readonly hp:number; readonly attack:number; readonly defense:number; readonly speed:number; readonly range:number; readonly attack_interval:number; readonly vision:number }
export interface HeroDefinition {
  readonly id:string; readonly name:string; readonly placement:string; readonly role:string; readonly trait_id:string;
  readonly appearance_key:string; readonly stats:UnitStats; readonly growth:UnitStats;
  readonly skills:readonly SkillDefinition[]; readonly skill_paths:Readonly<Record<string,readonly string[]>>;
  readonly synergy:Readonly<Record<string,number>>;
}
export interface SkillDefinition {
  readonly id:string; readonly name:string; readonly passive:boolean; readonly unlock_level:number;
  readonly prerequisites:readonly string[]; readonly cooldown:number; readonly cost:number;
  readonly range:number; readonly target:string; readonly effect:"area_damage"|"damage"|"heal"|"shield"|"haste"|"slow"|"reveal"|"empower"|"defense";
  readonly power:number; readonly duration:number;
}
export interface UnitDefinition { readonly id:string; readonly stats:UnitStats; readonly xp:number }
export interface CampDefinition { readonly id:string; readonly node:string; readonly monster:string; readonly respawn_ticks:number }
