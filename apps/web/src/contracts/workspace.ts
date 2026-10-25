import type {
  CoreJsonValue,
  CoreVersion,
  RulesetRef,
} from "./core";
import type { DomainValue, TacticalSource } from "./core-model";

/** A browser-owned storage wrapper around a core-owned Senkei JSON document. */
export interface LocalSenkeiDocument {
  readonly format: "senkei.local-document";
  readonly document_version: 1;
  readonly id: string;
  readonly name: string;
  readonly revision: number;
  readonly created_at: string;
  readonly updated_at: string;
  readonly payload: SenkeiDraft;
}

export type LocalSenkeiDocumentSummary = Pick<
  LocalSenkeiDocument,
  "id" | "name" | "revision" | "updated_at"
>;

export interface LocalSenkeiRevisionSummary {
  readonly document_id: string;
  readonly revision: number;
  readonly saved_at: string;
}

export interface SenkeiDocumentDiffEntry {
  readonly path: string;
  readonly before_present: boolean;
  readonly before: CoreJsonValue | null;
  readonly after_present: boolean;
  readonly after: CoreJsonValue | null;
}

/** Browser presentation wrapper; the battle payload itself remains a core DTO. */
export interface LocalPveScenario {
  readonly id: string;
  readonly campaign_id: string;
  readonly campaign_title: string;
  readonly order: number;
  readonly difficulty: "beginner" | "standard" | "expert";
  readonly title: string;
  readonly description: string;
  readonly objective: string;
  readonly criteria: readonly LocalPveScenarioCriterion[];
  /** NPC defender input; the selected player Senkei is supplied by the App. */
  readonly npc: SenkeiDraft;
}

export interface LocalPveScenarioCriterion {
  readonly id: string;
  readonly label: string;
}

/** Browser editing state before compilation into a verified TacticalProgram. */
export interface SenkeiDraft {
  readonly schema_version: CoreVersion;
  readonly id: string;
  readonly revision: string;
  readonly ruleset: RulesetRef;
  readonly configuration: Readonly<Record<string, DomainValue>>;
  readonly program_input: TacticalSource;
  readonly initial_memory: Readonly<Record<string, DomainValue>>;
}

export type EditorDraft = SenkeiDraft | null;
