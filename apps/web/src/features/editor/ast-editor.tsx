import { useId } from "react";
import type {
  CapabilitySchema,
  ComparisonOperator,
  DomainSchema,
  DomainType,
  StructuredTacticsAst,
  TacticalCapabilityCall,
  TacticalCollection,
  TacticalDeclaration,
  TacticalPath,
  TacticalPredicate,
  TacticalValue,
} from "../../contracts";
import { domainValueForType, DomainValueEditor } from "./value-editor";

const comparisonOperators: readonly ComparisonOperator[] = [
  "equal",
  "not_equal",
  "less_than",
  "less_than_or_equal",
  "greater_than",
  "greater_than_or_equal",
];

const initialTruth: TacticalPredicate = { kind: "literal_truth", value: true };
const initialValue: TacticalValue = { kind: "literal", value: { kind: "integer", value: 0 } };

function firstObservationPath(domain: DomainSchema): TacticalPath {
  const first = Object.keys(domain.observation_fields)[0];
  return first ? first.split(".") : [];
}

function firstCollectionPath(domain: DomainSchema): TacticalPath {
  const first = Object.keys(domain.collections)[0];
  return first ? first.split(".") : [];
}

function firstUniqueKey(domain: DomainSchema): TacticalPath {
  const collectionId = Object.keys(domain.collections)[0];
  const firstOrderPath = collectionId ? domain.collections[collectionId]?.order_by[0] : undefined;
  return firstOrderPath ? firstOrderPath.split(".") : firstObservationPath(domain);
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function domainSymbols(domain: DomainSchema): readonly string[] {
  return [...new Set(Object.values(domain.symbol_domains).flat())];
}

function defaultCall(domain: DomainSchema): TacticalCapabilityCall {
  const capability = Object.keys(domain.capabilities)[0] ?? "";
  const schema = domain.capabilities[capability];
  return {
    capability: capability ? capability.split(".") : [],
    arguments: schema
      ? schema.arguments.filter((argument) => !argument.optional).map((argument) => ({ kind: "literal", value: domainValueForType(argument.value_type) }))
      : [],
  };
}

function PathField({
  label,
  path,
  suggestions,
  onChange,
}: {
  readonly label: string;
  readonly path: TacticalPath;
  readonly suggestions?: readonly string[];
  readonly onChange: (path: TacticalPath) => void;
}) {
  const listId = useId();
  return (
    <label className="editor-field">
      <span>{label}</span>
      <input
        aria-label={label}
        list={suggestions?.length ? listId : undefined}
        placeholder="schema.path"
        value={path.join(".")}
        onChange={(event) => {
          const segments = event.currentTarget.value.split(".").filter((segment, index, all) => segment.length > 0 || index === all.length - 1);
          onChange(segments);
        }}
      />
      {suggestions && suggestions.length > 0 && (
        <datalist id={listId}>{suggestions.map((item) => <option key={item} value={item} />)}</datalist>
      )}
    </label>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <input aria-label={label} placeholder={placeholder} type="text" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </label>
  );
}

function CollectionEditor({
  collection,
  schema,
  onChange,
  depth = 0,
}: {
  readonly collection: TacticalCollection;
  readonly schema: DomainSchema;
  readonly onChange: (collection: TacticalCollection) => void;
  readonly depth?: number;
}) {
  if (depth > schema.max_expression_depth) {
    return <div className="editor-inline-error">Expression depth limit reached.</div>;
  }
  if (collection.kind === "path") {
    const collections = Object.keys(schema.collections);
    return (
      <div className="editor-node-fields">
        <PathField
          label="Collection path"
          path={collection.value}
          suggestions={collections}
          onChange={(path) => onChange({ kind: "path", value: path })}
        />
        <button className="editor-inline-button" onClick={() => onChange({
          kind: "filter",
          value: { binding: "item", collection, predicates: [initialTruth] },
        })} type="button">Filter this collection</button>
      </div>
    );
  }
  return (
    <div className="editor-node-fields">
      <TextField label="Binding name" value={collection.value.binding} onChange={(binding) => onChange({ ...collection, value: { ...collection.value, binding } })} />
      <CollectionEditor
        collection={collection.value.collection}
        depth={depth + 1}
        onChange={(next) => onChange({ ...collection, value: { ...collection.value, collection: next } })}
        schema={schema}
      />
      <PredicateList
        label="Filter conditions"
        predicates={collection.value.predicates}
        onChange={(predicates) => onChange({ ...collection, value: { ...collection.value, predicates } })}
        schema={schema}
      />
    </div>
  );
}

function ValueEditor({
  expression,
  schema,
  valueType,
  onChange,
  depth = 0,
}: {
  readonly expression: TacticalValue;
  readonly schema: DomainSchema;
  readonly valueType?: DomainType;
  readonly onChange: (expression: TacticalValue) => void;
  readonly depth?: number;
}) {
  if (depth > schema.max_expression_depth) {
    return <div className="editor-inline-error">Expression depth limit reached.</div>;
  }
  const updateAggregateBinding = (binding: string) => {
    if (expression.kind === "sum") onChange({ ...expression, value: { ...expression.value, binding } });
    else if (expression.kind === "min") onChange({ ...expression, value: { ...expression.value, binding } });
    else if (expression.kind === "max") onChange({ ...expression, value: { ...expression.value, binding } });
    else if (expression.kind === "arg_min") onChange({ ...expression, value: { ...expression.value, binding } });
    else if (expression.kind === "arg_max") onChange({ ...expression, value: { ...expression.value, binding } });
  };
  const updateAggregateCollection = (collection: TacticalCollection) => {
    if (expression.kind === "sum") onChange({ ...expression, value: { ...expression.value, collection } });
    else if (expression.kind === "min") onChange({ ...expression, value: { ...expression.value, collection } });
    else if (expression.kind === "max") onChange({ ...expression, value: { ...expression.value, collection } });
    else if (expression.kind === "arg_min") onChange({ ...expression, value: { ...expression.value, collection } });
    else if (expression.kind === "arg_max") onChange({ ...expression, value: { ...expression.value, collection } });
  };
  const updateAggregateExpression = (value: TacticalValue) => {
    if (expression.kind === "sum") onChange({ ...expression, value: { ...expression.value, expression: value } });
    else if (expression.kind === "min") onChange({ ...expression, value: { ...expression.value, expression: value } });
    else if (expression.kind === "max") onChange({ ...expression, value: { ...expression.value, expression: value } });
    else if (expression.kind === "arg_min") onChange({ ...expression, value: { ...expression.value, expression: value } });
    else if (expression.kind === "arg_max") onChange({ ...expression, value: { ...expression.value, expression: value } });
  };
  const updateAggregateKey = (unique_key: TacticalPath) => {
    if (expression.kind === "arg_min") onChange({ ...expression, value: { ...expression.value, unique_key } });
    else if (expression.kind === "arg_max") onChange({ ...expression, value: { ...expression.value, unique_key } });
  };
  const changeKind = (kind: string) => {
    if (kind === "literal") onChange(initialValue);
    else if (kind === "path") onChange({ kind: "path", value: firstObservationPath(schema) });
    else if (kind === "filtered_collection") onChange({
      kind: "filtered_collection",
      value: { binding: "item", collection: { kind: "path", value: firstCollectionPath(schema) }, predicates: [initialTruth] },
    });
    else if (kind === "count") onChange({ kind: "count", value: { binding: "item", collection: { kind: "path", value: firstCollectionPath(schema) }, predicates: [initialTruth] } });
    else if (kind === "sum" || kind === "min" || kind === "max") {
      onChange({ kind, value: { binding: "item", collection: { kind: "path", value: firstCollectionPath(schema) }, expression: initialValue } });
    } else if (kind === "arg_min" || kind === "arg_max") {
      onChange({ kind, value: { binding: "item", collection: { kind: "path", value: firstCollectionPath(schema) }, expression: initialValue, unique_key: firstUniqueKey(schema) } });
    }
  };

  return (
    <div className="editor-expression">
      <label className="editor-field">
        <span>Value expression</span>
        <select value={expression.kind} onChange={(event) => changeKind(event.currentTarget.value)}>
          <option value="literal">Literal</option>
          <option value="path">Field path</option>
          <option value="filtered_collection">Filtered collection</option>
          <option value="count">Count</option>
          <option value="sum">Sum</option>
          <option value="min">Minimum</option>
          <option value="max">Maximum</option>
          <option value="arg_min">Choose minimum item</option>
          <option value="arg_max">Choose maximum item</option>
        </select>
      </label>
      {expression.kind === "literal" && (
        <DomainValueEditor
          onChange={(value) => onChange({ kind: "literal", value })}
          symbols={domainSymbols(schema)}
          value={expression.value}
          valueType={valueType}
        />
      )}
      {expression.kind === "path" && (
        <PathField label="Value path" path={expression.value} suggestions={Object.keys(schema.observation_fields)} onChange={(value) => onChange({ kind: "path", value })} />
      )}
      {expression.kind === "filtered_collection" && (
        <div className="editor-node-fields">
          <TextField
            label="Binding name"
            value={expression.value.binding}
            onChange={(binding) => onChange({
              ...expression,
              value: { ...expression.value, binding },
            })}
          />
          <CollectionEditor
            collection={expression.value.collection}
            onChange={(collection) => onChange({ ...expression, value: { ...expression.value, collection } })}
            schema={schema}
            depth={depth + 1}
          />
          <PredicateList
            label="Filter conditions"
            predicates={expression.value.predicates}
            onChange={(predicates) => onChange({ ...expression, value: { ...expression.value, predicates } })}
            schema={schema}
            depth={depth + 1}
          />
        </div>
      )}
      {expression.kind === "count" && (
        <div className="editor-node-fields">
          <TextField label="Binding name" value={expression.value.binding} onChange={(binding) => onChange({ ...expression, value: { ...expression.value, binding } })} />
          <CollectionEditor collection={expression.value.collection} onChange={(collection) => onChange({ ...expression, value: { ...expression.value, collection } })} schema={schema} depth={depth + 1} />
          <PredicateList label="Count conditions" predicates={expression.value.predicates} onChange={(predicates) => onChange({ ...expression, value: { ...expression.value, predicates } })} schema={schema} />
        </div>
      )}
      {(expression.kind === "sum" || expression.kind === "min" || expression.kind === "max" || expression.kind === "arg_min" || expression.kind === "arg_max") && (
        <div className="editor-node-fields">
          <TextField label="Binding name" value={expression.value.binding} onChange={updateAggregateBinding} />
          <CollectionEditor collection={expression.value.collection} onChange={updateAggregateCollection} schema={schema} depth={depth + 1} />
          <ValueEditor expression={expression.value.expression} onChange={updateAggregateExpression} schema={schema} depth={depth + 1} />
          {(expression.kind === "arg_min" || expression.kind === "arg_max") && (
            <PathField label="Unique tie-break key" path={expression.value.unique_key} suggestions={Object.keys(schema.observation_fields)} onChange={updateAggregateKey} />
          )}
        </div>
      )}
    </div>
  );
}

function PredicateEditor({
  predicate,
  schema,
  stateNames,
  onChange,
  depth = 0,
}: {
  readonly predicate: TacticalPredicate;
  readonly schema: DomainSchema;
  readonly stateNames: readonly string[];
  readonly onChange: (predicate: TacticalPredicate) => void;
  readonly depth?: number;
}) {
  const stateListId = useId();
  if (depth > schema.max_expression_depth) {
    return <div className="editor-inline-error">Expression depth limit reached.</div>;
  }

  const groups = ["and", "or", "ordered_and", "ordered_or"];
  return (
    <div className="editor-expression">
      <label className="editor-field">
        <span>Condition node</span>
        <select
          value={predicate.kind}
          onChange={(event) => {
            const kind = event.currentTarget.value;
            if (kind === "literal_truth") onChange(initialTruth);
            else if (kind === "state_reference") onChange({ kind, value: stateNames[0] ?? "" });
            else if (kind === "compare") onChange({ kind, value: { left: initialValue, operator: "equal", right: initialValue } });
            else if (kind === "knownness") onChange({ kind, value: { value: { kind: "path", value: firstObservationPath(schema) }, test: "unknown" } });
            else if (groups.includes(kind)) onChange({ kind: kind as "and" | "or" | "ordered_and" | "ordered_or", value: [initialTruth] });
            else if (kind === "not") onChange({ kind, value: initialTruth });
            else onChange({ kind: "quantified", value: { quantifier: "any", binding: "item", collection: { kind: "path", value: firstCollectionPath(schema) }, predicates: [initialTruth] } });
          }}
        >
          <option value="literal_truth">Always true / false</option>
          <option value="state_reference">Named state</option>
          <option value="compare">Compare values</option>
          <option value="knownness">Check whether a value is known</option>
          <option value="and">AND</option>
          <option value="or">OR</option>
          <option value="not">NOT</option>
          <option value="ordered_and">Ordered AND</option>
          <option value="ordered_or">Ordered OR</option>
          <option value="quantified">Any / all in a collection</option>
        </select>
      </label>
      {predicate.kind === "literal_truth" && (
        <label className="editor-field">
          <span>Truth value</span>
          <select value={String(predicate.value)} onChange={(event) => onChange({ kind: "literal_truth", value: event.currentTarget.value === "true" })}>
            <option value="true">true</option>
            <option value="false">false</option>
          </select>
        </label>
      )}
      {predicate.kind === "state_reference" && (
        <label className="editor-field">
          <span>State</span>
          <input list={stateListId} value={predicate.value} onChange={(event) => onChange({ kind: "state_reference", value: event.currentTarget.value })} />
          <datalist id={stateListId}>{stateNames.map((name) => <option key={name} value={name} />)}</datalist>
        </label>
      )}
      {predicate.kind === "compare" && (
        <div className="editor-node-fields">
          <ValueEditor expression={predicate.value.left} onChange={(left) => onChange({ ...predicate, value: { ...predicate.value, left } })} schema={schema} depth={depth + 1} />
          <label className="editor-field">
            <span>Operator</span>
            <select value={predicate.value.operator} onChange={(event) => onChange({ ...predicate, value: { ...predicate.value, operator: event.currentTarget.value as ComparisonOperator } })}>
              {comparisonOperators.map((operator) => <option key={operator} value={operator}>{operator.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <ValueEditor expression={predicate.value.right} onChange={(right) => onChange({ ...predicate, value: { ...predicate.value, right } })} schema={schema} depth={depth + 1} />
        </div>
      )}
      {predicate.kind === "knownness" && (
        <div className="editor-node-fields">
          <ValueEditor expression={predicate.value.value} onChange={(value) => onChange({ ...predicate, value: { ...predicate.value, value } })} schema={schema} depth={depth + 1} />
          <label className="editor-field">
            <span>Knownness check</span>
            <select value={predicate.value.test} onChange={(event) => onChange({ ...predicate, value: { ...predicate.value, test: event.currentTarget.value as "known" | "unknown" } })}>
              <option value="known">is known</option>
              <option value="unknown">is unknown</option>
            </select>
          </label>
        </div>
      )}
      {(predicate.kind === "and" || predicate.kind === "or" || predicate.kind === "ordered_and" || predicate.kind === "ordered_or") && (
        <PredicateList label={titleCase(predicate.kind) + " terms"} predicates={predicate.value} onChange={(value) => onChange({ ...predicate, value })} schema={schema} stateNames={stateNames} depth={depth + 1} />
      )}
      {predicate.kind === "not" && (
        <PredicateEditor predicate={predicate.value} onChange={(value) => onChange({ kind: "not", value })} schema={schema} stateNames={stateNames} depth={depth + 1} />
      )}
      {predicate.kind === "quantified" && (
        <div className="editor-node-fields">
          <label className="editor-field">
            <span>Quantifier</span>
            <select value={predicate.value.quantifier} onChange={(event) => onChange({ ...predicate, value: { ...predicate.value, quantifier: event.currentTarget.value as "any" | "all" } })}>
              <option value="any">Any item</option>
              <option value="all">All items</option>
            </select>
          </label>
          <TextField label="Binding name" value={predicate.value.binding} onChange={(binding) => onChange({ ...predicate, value: { ...predicate.value, binding } })} />
          <CollectionEditor collection={predicate.value.collection} onChange={(collection) => onChange({ ...predicate, value: { ...predicate.value, collection } })} schema={schema} depth={depth + 1} />
          <PredicateList label="Conditions for each item" predicates={predicate.value.predicates} onChange={(predicates) => onChange({ ...predicate, value: { ...predicate.value, predicates } })} schema={schema} stateNames={stateNames} depth={depth + 1} />
        </div>
      )}
    </div>
  );
}

function PredicateList({
  label,
  predicates,
  schema,
  stateNames = [],
  onChange,
  depth = 0,
}: {
  readonly label: string;
  readonly predicates: readonly TacticalPredicate[];
  readonly schema: DomainSchema;
  readonly stateNames?: readonly string[];
  readonly onChange: (predicates: readonly TacticalPredicate[]) => void;
  readonly depth?: number;
}) {
  return (
    <section className="editor-predicate-list">
      <div className="editor-list-heading"><strong>{label}</strong><span>{predicates.length} condition{predicates.length === 1 ? "" : "s"}</span></div>
      {predicates.map((predicate, index) => (
        <div className="editor-predicate-item" key={index}>
          <PredicateEditor
            depth={depth}
            onChange={(next) => onChange(predicates.map((item, itemIndex) => itemIndex === index ? next : item))}
            predicate={predicate}
            schema={schema}
            stateNames={stateNames}
          />
          {predicates.length > 1 && (
            <button className="editor-icon-button" aria-label={"Remove condition " + (index + 1)} onClick={() => onChange(predicates.filter((_, itemIndex) => itemIndex !== index))} type="button">×</button>
          )}
        </div>
      ))}
      <button className="editor-inline-button" onClick={() => onChange([...predicates, initialTruth])} type="button">Add condition</button>
    </section>
  );
}

function CapabilityCallEditor({
  call,
  capabilities,
  schema,
  onChange,
}: {
  readonly call: TacticalCapabilityCall;
  readonly capabilities: Readonly<Record<string, CapabilitySchema>>;
  readonly schema: DomainSchema;
  readonly onChange: (call: TacticalCapabilityCall) => void;
}) {
  const id = call.capability.join(".");
  const capability = capabilities[id];
  const capabilityIds = [...new Set([...Object.keys(capabilities), id])].filter(Boolean);
  const selectCapability = (nextId: string) => {
    const nextSchema = capabilities[nextId];
    const args = nextSchema
      ? nextSchema.arguments.filter((argument) => !argument.optional).map((argument) => ({ kind: "literal" as const, value: domainValueForType(argument.value_type) }))
      : call.arguments;
    onChange({ capability: nextId.split(".").filter(Boolean), arguments: args });
  };
  return (
    <div className="editor-node-fields">
      <label className="editor-field">
        <span>Capability</span>
        <select value={id} onChange={(event) => selectCapability(event.currentTarget.value)}>
          {capabilityIds.length === 0 && <option value="">No capabilities in this ruleset</option>}
          {capabilityIds.map((capabilityId) => <option key={capabilityId} value={capabilityId}>{capabilityId}</option>)}
        </select>
      </label>
      {capability ? (
        <div className="editor-argument-list">
          {capability.arguments.map((parameter, index) => {
            const argument = call.arguments[index];
            if (!argument && parameter.optional) {
              return (
                <button className="editor-inline-button" key={parameter.id} onClick={() => onChange({ ...call, arguments: [...call.arguments, { kind: "literal", value: domainValueForType(parameter.value_type) }] })} type="button">
                  Add optional argument: {parameter.id}
                </button>
              );
            }
            const expression = argument ?? { kind: "literal" as const, value: domainValueForType(parameter.value_type) };
            return (
              <div className="editor-argument" key={parameter.id}>
                <span className="editor-argument-name">{parameter.id}{parameter.optional ? " · optional" : ""}</span>
                <ValueEditor expression={expression} onChange={(next) => {
                  const args = [...call.arguments];
                  args[index] = next;
                  onChange({ ...call, arguments: args });
                }} schema={schema} valueType={parameter.value_type} />
              </div>
            );
          })}
          {call.arguments.slice(capability.arguments.length).map((argument, offset) => {
            const index = capability.arguments.length + offset;
            return (
              <div className="editor-argument" key={index}>
                <span className="editor-argument-name">Additional argument {offset + 1}</span>
                <ValueEditor expression={argument} onChange={(next) => {
                  const args = [...call.arguments];
                  args[index] = next;
                  onChange({ ...call, arguments: args });
                }} schema={schema} />
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <PathField label="Custom capability path" path={call.capability} suggestions={Object.keys(capabilities)} onChange={(capabilityPath) => onChange({ ...call, capability: capabilityPath })} />
          <ArgumentList call={call} onChange={onChange} schema={schema} />
        </>
      )}
    </div>
  );
}

function ArgumentList({
  call,
  schema,
  onChange,
}: {
  readonly call: TacticalCapabilityCall;
  readonly schema: DomainSchema;
  readonly onChange: (call: TacticalCapabilityCall) => void;
}) {
  return (
    <div className="editor-argument-list">
      {call.arguments.map((argument, index) => (
        <div className="editor-argument" key={index}>
          <span className="editor-argument-name">Argument {index + 1}</span>
          <ValueEditor expression={argument} onChange={(next) => onChange({ ...call, arguments: call.arguments.map((item, itemIndex) => itemIndex === index ? next : item) })} schema={schema} />
          <button className="editor-icon-button" aria-label={"Remove argument " + (index + 1)} onClick={() => onChange({ ...call, arguments: call.arguments.filter((_, itemIndex) => itemIndex !== index) })} type="button">×</button>
        </div>
      ))}
      <button className="editor-inline-button" onClick={() => onChange({ ...call, arguments: [...call.arguments, initialValue] })} type="button">Add argument</button>
    </div>
  );
}

export function StructuredTacticsEditor({
  ast,
  domain,
  onChange,
}: {
  readonly ast: StructuredTacticsAst;
  readonly domain: DomainSchema;
  readonly onChange: (ast: StructuredTacticsAst) => void;
}) {
  const stateNames = ast.declarations.filter((declaration) => declaration.kind === "state").map((declaration) => declaration.name);
  const suggestions = Object.keys(domain.observation_fields);

  const updateDeclaration = (index: number, declaration: TacticalDeclaration) => {
    onChange({ ...ast, declarations: ast.declarations.map((item, itemIndex) => itemIndex === index ? declaration : item) });
  };
  return (
    <div className="editor-ast">
      <div className="editor-ast-heading">
        <div>
          <div className="editor-eyebrow">STRUCTURED TACTICS</div>
          <p>Build conditions and actions from the current ruleset schema. Advanced nodes remain editable.</p>
        </div>
        <label className="editor-field editor-program-name">
          <span>Program name</span>
          <input value={ast.program_name} onChange={(event) => onChange({ ...ast, program_name: event.currentTarget.value })} />
        </label>
      </div>

      {ast.declarations.map((declaration, index) => (
        <article className="editor-declaration" key={index}>
          <div className="editor-declaration-heading">
            <span className="editor-node-number">{String(index + 1).padStart(2, "0")}</span>
            <select
              aria-label="Declaration type"
              value={declaration.kind}
              onChange={(event) => {
                if (event.currentTarget.value === "state") {
                  updateDeclaration(index, { kind: "state", name: "new_state", predicates: [initialTruth] });
                } else {
                  updateDeclaration(index, { kind: "action", name: "new_action", when: initialTruth, do_call: defaultCall(domain) });
                }
              }}
            >
              <option value="state">State</option>
              <option value="action">Action</option>
            </select>
            <input
              aria-label="Declaration name"
              placeholder={declaration.kind === "state" ? "state name" : "action name"}
              value={declaration.name}
              onChange={(event) => updateDeclaration(index, { ...declaration, name: event.currentTarget.value })}
            />
            <button className="editor-icon-button" aria-label={"Remove " + declaration.kind + " " + declaration.name} onClick={() => onChange({ ...ast, declarations: ast.declarations.filter((_, itemIndex) => itemIndex !== index) })} type="button">×</button>
          </div>

          {declaration.kind === "state" ? (
            <PredicateList
              label="State conditions (AND)"
              predicates={declaration.predicates}
              onChange={(predicates) => updateDeclaration(index, { ...declaration, predicates })}
              schema={domain}
              stateNames={stateNames.filter((name) => name !== declaration.name)}
            />
          ) : (
            <div className="editor-action-body">
              <div className="editor-when">
                <span className="editor-section-label">WHEN</span>
                <PredicateEditor predicate={declaration.when} onChange={(when) => updateDeclaration(index, { ...declaration, when })} schema={domain} stateNames={stateNames} />
              </div>
              <div className="editor-do">
                <span className="editor-section-label">DO</span>
                <CapabilityCallEditor call={declaration.do_call} capabilities={domain.capabilities} onChange={(do_call) => updateDeclaration(index, { ...declaration, do_call })} schema={domain} />
              </div>
            </div>
          )}
          {declaration.kind === "action" && suggestions.length > 0 && (
            <span className="editor-schema-note">Fields and capabilities come from this ruleset.</span>
          )}
        </article>
      ))}

      <div className="editor-add-declaration">
        <button className="editor-secondary-button" onClick={() => onChange({ ...ast, declarations: [...ast.declarations, { kind: "state", name: "new_state", predicates: [initialTruth] }] })} type="button">Add state</button>
        <button className="editor-secondary-button" onClick={() => onChange({ ...ast, declarations: [...ast.declarations, { kind: "action", name: "new_action", when: initialTruth, do_call: defaultCall(domain) }] })} type="button">Add action</button>
      </div>
    </div>
  );
}
