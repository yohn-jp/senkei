import type {
  DomainValue,
  StructuredTacticsAst,
} from "../../contracts/core-model";

const MAX_NESTING = 128;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRecordOf<T>(
  value: unknown,
  itemGuard: (item: unknown, depth: number) => item is T,
  depth: number,
): value is Record<string, T> {
  return isRecord(value) && depth <= MAX_NESTING &&
    Object.values(value).every((item) => itemGuard(item, depth + 1));
}

function isDomainValue(value: unknown, depth = 0): value is DomainValue {
  if (!isRecord(value) || depth > MAX_NESTING || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "null":
      return Object.keys(value).length === 1;
    case "bool":
      return typeof value.value === "boolean";
    case "integer":
      return isFiniteInteger(value.value);
    case "fixed":
      return isRecord(value.value) && isFiniteInteger(value.value.coefficient) &&
        isFiniteInteger(value.value.scale) && value.value.scale >= 0;
    case "string":
    case "enum":
    case "entity":
      return typeof value.value === "string";
    case "list":
      return Array.isArray(value.value) && value.value.every((item) => isDomainValue(item, depth + 1));
    case "record":
      return isRecordOf(value.value, isDomainValue, depth + 1);
    default:
      return false;
  }
}

/** Checks the recursive tagged values stored in a Jinrei draft map. */
export function isDomainValueRecord(
  value: unknown,
): value is Readonly<Record<string, DomainValue>> {
  return isRecordOf(value, isDomainValue, 0);
}

function isTacticalValue(value: unknown, depth: number): boolean {
  if (!isRecord(value) || depth > MAX_NESTING || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "literal":
      return isDomainValue(value.value, depth + 1);
    case "path":
      return isStringArray(value.value);
    case "filtered_collection":
    case "count":
      return isRecord(value.value) && typeof value.value.binding === "string" &&
        isCollection(value.value.collection, depth + 1) &&
        isPredicateArray(value.value.predicates, depth + 1);
    case "sum":
    case "min":
    case "max":
      return isRecord(value.value) && typeof value.value.binding === "string" &&
        isCollection(value.value.collection, depth + 1) &&
        isTacticalValue(value.value.expression, depth + 1);
    case "arg_min":
    case "arg_max":
      return isRecord(value.value) && typeof value.value.binding === "string" &&
        isCollection(value.value.collection, depth + 1) &&
        isTacticalValue(value.value.expression, depth + 1) &&
        isStringArray(value.value.unique_key);
    default:
      return false;
  }
}

function isCollection(value: unknown, depth: number): boolean {
  if (!isRecord(value) || depth > MAX_NESTING || typeof value.kind !== "string") return false;
  if (value.kind === "path") return isStringArray(value.value);
  return value.kind === "filter" && isRecord(value.value) &&
    typeof value.value.binding === "string" &&
    isCollection(value.value.collection, depth + 1) &&
    isPredicateArray(value.value.predicates, depth + 1);
}

function isPredicate(value: unknown, depth: number): boolean {
  if (!isRecord(value) || depth > MAX_NESTING || typeof value.kind !== "string") return false;
  switch (value.kind) {
    case "literal_truth":
      return typeof value.value === "boolean";
    case "state_reference":
      return typeof value.value === "string";
    case "compare":
      return isRecord(value.value) &&
        isTacticalValue(value.value.left, depth + 1) &&
        ["equal", "not_equal", "less_than", "less_than_or_equal", "greater_than", "greater_than_or_equal"].includes(String(value.value.operator)) &&
        isTacticalValue(value.value.right, depth + 1);
    case "knownness":
      return isRecord(value.value) && isTacticalValue(value.value.value, depth + 1) &&
        (value.value.test === "known" || value.value.test === "unknown");
    case "and":
    case "or":
    case "ordered_and":
    case "ordered_or":
      return isPredicateArray(value.value, depth + 1);
    case "not":
      return isPredicate(value.value, depth + 1);
    case "quantified":
      return isRecord(value.value) &&
        (value.value.quantifier === "any" || value.value.quantifier === "all") &&
        typeof value.value.binding === "string" &&
        isCollection(value.value.collection, depth + 1) &&
        isPredicateArray(value.value.predicates, depth + 1);
    default:
      return false;
  }
}

function isPredicateArray(value: unknown, depth: number): boolean {
  return Array.isArray(value) && depth <= MAX_NESTING &&
    value.every((item) => isPredicate(item, depth + 1));
}

function isDeclaration(value: unknown, depth: number): boolean {
  if (!isRecord(value) || depth > MAX_NESTING || typeof value.name !== "string") return false;
  if (value.kind === "state") return isPredicateArray(value.predicates, depth + 1);
  if (value.kind !== "action" || !isPredicate(value.when, depth + 1) || !isRecord(value.do_call)) return false;
  return isStringArray(value.do_call.capability) && Array.isArray(value.do_call.arguments) &&
    value.do_call.arguments.every((argument) => isTacticalValue(argument, depth + 1));
}

/** Structural guard for ASTs restored into the recursive visual tactics editor. */
export function isStructuredTacticsAst(value: unknown): value is StructuredTacticsAst {
  if (!isRecord(value) || !isRecord(value.schema_version) ||
      !isFiniteInteger(value.schema_version.major) || value.schema_version.major < 0 ||
      !isFiniteInteger(value.schema_version.minor) || value.schema_version.minor < 0 ||
      !isFiniteInteger(value.schema_version.patch) || value.schema_version.patch < 0 ||
      typeof value.program_name !== "string" || !Array.isArray(value.declarations)) return false;
  return value.declarations.every((declaration) => isDeclaration(declaration, 0));
}
