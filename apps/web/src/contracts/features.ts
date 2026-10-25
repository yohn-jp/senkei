import type { CompileOutcome, TacticalInput } from "./core";
import type { RulePackage } from "./core-model";
import type { StructuredTacticsAst } from "./core-model";
import type { RulesetRef } from "./core";
import type { EditorDraft } from "./workspace";

export interface EditorFeatureProps {
  readonly ruleset: RulePackage | null;
  readonly draft: EditorDraft;
  readonly compilation: CompileOutcome | null;
  onDraftChange(draft: EditorDraft): void;
  onParse(source: string, ruleset_ref: RulesetRef): Promise<StructuredTacticsAst>;
  onFormat(ast: StructuredTacticsAst, ruleset_ref: RulesetRef): Promise<string>;
  onCompile(input: TacticalInput): Promise<void>;
}
