import type { DomainType, DomainValue } from "../../contracts";

const valueKinds = ["null", "bool", "integer", "fixed", "string", "enum", "entity", "list", "record"] as const;

export function domainValueForType(type: DomainType, depth = 0): DomainValue {
  if (depth > 16) return { kind: "null" };
  switch (type.kind) {
    case "bool":
      return { kind: "bool", value: false };
    case "integer":
      return { kind: "integer", value: 0 };
    case "fixed":
      return { kind: "fixed", value: { coefficient: 0, scale: type.value.scale } };
    case "string":
      return { kind: "string", value: "" };
    case "enum":
      return { kind: "enum", value: type.value.values[0] ?? "" };
    case "entity":
      return { kind: "entity", value: "" };
    case "optional":
      return { kind: "null" };
    case "list":
    case "vector":
    case "matrix":
      return { kind: "list", value: [] };
    case "record":
      return {
        kind: "record",
        value: Object.fromEntries(
          Object.entries(type.value.fields).map(([field, fieldType]) => [field, domainValueForType(fieldType, depth + 1)]),
        ),
      };
  }
}

export function configurationDefaults(
  schema: Readonly<Record<string, { readonly value_type: DomainType; readonly default: DomainValue | null }>>,
): Readonly<Record<string, DomainValue>> {
  return Object.fromEntries(
    Object.entries(schema).map(([field, definition]) => [field, definition.default ?? domainValueForType(definition.value_type)]),
  );
}

export function memoryDefaults(schema: Readonly<Record<string, DomainType>>): Readonly<Record<string, DomainValue>> {
  return Object.fromEntries(Object.entries(schema).map(([key, type]) => [key, domainValueForType(type)]));
}

function typeName(type: DomainType | undefined): string {
  if (!type) return "Value";
  if (type.kind === "optional") return "Optional " + typeName(type.value);
  if (type.kind === "list" || type.kind === "vector") return type.kind + " of " + typeName(type.value.element);
  if (type.kind === "matrix") return "Matrix of " + typeName(type.value.element);
  return type.kind;
}

function compatibleKind(type: DomainType | undefined): readonly string[] {
  if (!type) return valueKinds;
  switch (type.kind) {
    case "bool": return ["bool"];
    case "integer": return ["integer"];
    case "fixed": return ["fixed"];
    case "string": return ["string"];
    case "enum": return ["enum"];
    case "entity": return ["entity"];
    case "optional": return ["null", ...compatibleKind(type.value)];
    case "list":
    case "vector":
    case "matrix": return ["list"];
    case "record": return ["record"];
  }
}

export interface DomainValueEditorProps {
  readonly value: DomainValue;
  readonly valueType?: DomainType;
  readonly symbols?: readonly string[];
  readonly label?: string;
  readonly depth?: number;
  readonly onChange: (value: DomainValue) => void;
}

export function DomainValueEditor({
  value,
  valueType,
  symbols = [],
  label,
  depth = 0,
  onChange,
}: DomainValueEditorProps) {
  const allowedKinds = compatibleKind(valueType);
  const expectedType = valueType?.kind === "optional" ? valueType.value : valueType;
  const nestingType = depth > 16 ? undefined : expectedType;
  const isMatrix = valueType?.kind === "matrix";
  const childType = valueType?.kind === "list" || valueType?.kind === "vector" || isMatrix
    ? valueType.value.element
    : undefined;
  const recordFields = valueType?.kind === "record" ? valueType.value.fields : undefined;

  const kindControl = !valueType ? (
    <label className="editor-field">
      <span>Value type</span>
      <select
        aria-label={(label ?? "Value") + " type"}
        value={value.kind}
        onChange={(event) => {
          const kind = event.currentTarget.value;
          if (kind === "null") onChange({ kind: "null" });
          else if (kind === "bool") onChange({ kind: "bool", value: false });
          else if (kind === "integer") onChange({ kind: "integer", value: 0 });
          else if (kind === "fixed") onChange({ kind: "fixed", value: { coefficient: 0, scale: 0 } });
          else if (kind === "string") onChange({ kind: "string", value: "" });
          else if (kind === "enum") onChange({ kind: "enum", value: symbols[0] ?? "" });
          else if (kind === "entity") onChange({ kind: "entity", value: "" });
          else if (kind === "list") onChange({ kind: "list", value: [] });
          else onChange({ kind: "record", value: {} });
        }}
      >
        {valueKinds.map((kind) => <option key={kind} value={kind}>{kind}</option>)}
      </select>
    </label>
  ) : null;

  if (value.kind === "null") {
    return (
      <div className="editor-value">
        {label && <strong className="editor-value-label">{label}</strong>}
        {kindControl}
        {valueType?.kind === "optional" && (
          <button className="editor-inline-button" onClick={() => onChange(domainValueForType(valueType.value))} type="button">
            Set a value
          </button>
        )}
        {valueType && valueType.kind !== "optional" && (
          <div className="editor-inline-error">
            <span>Expected {typeName(valueType)}, received null.</span>
            <button className="editor-inline-button" onClick={() => onChange(domainValueForType(valueType))} type="button">Reset to schema type</button>
          </div>
        )}
      </div>
    );
  }

  const scalar = (() => {
    switch (value.kind) {
      case "bool":
        return (
          <label className="editor-field">
            <span>{label ?? "Value"}</span>
            <select value={String(value.value)} onChange={(event) => onChange({ kind: "bool", value: event.currentTarget.value === "true" })}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>
        );
      case "integer": {
        const min = expectedType?.kind === "integer" ? expectedType.value.min ?? undefined : undefined;
        const max = expectedType?.kind === "integer" ? expectedType.value.max ?? undefined : undefined;
        return (
          <label className="editor-field">
            <span>{label ?? "Value"}</span>
            <input type="number" min={min} max={max} step="1" value={value.value} onChange={(event) => onChange({ kind: "integer", value: event.currentTarget.value === "" ? 0 : event.currentTarget.valueAsNumber })} />
          </label>
        );
      }
      case "fixed":
        const fixedMin = expectedType?.kind === "fixed" ? expectedType.value.min ?? undefined : undefined;
        const fixedMax = expectedType?.kind === "fixed" ? expectedType.value.max ?? undefined : undefined;
        return (
          <div className="editor-field-row">
            <label className="editor-field">
              <span>{label ?? "Coefficient"}</span>
              <input type="number" min={fixedMin} max={fixedMax} step="1" value={value.value.coefficient} onChange={(event) => onChange({ kind: "fixed", value: { ...value.value, coefficient: event.currentTarget.value === "" ? 0 : event.currentTarget.valueAsNumber, scale: expectedType?.kind === "fixed" ? expectedType.value.scale : value.value.scale } })} />
            </label>
            <label className="editor-field editor-field-small">
              <span>Scale</span>
              <input disabled={expectedType?.kind === "fixed"} type="number" min="0" step="1" value={expectedType?.kind === "fixed" ? expectedType.value.scale : value.value.scale} onChange={(event) => onChange({ kind: "fixed", value: { ...value.value, scale: event.currentTarget.value === "" ? 0 : event.currentTarget.valueAsNumber } })} />
            </label>
          </div>
        );
      case "string":
        return (
          <label className="editor-field">
            <span>{label ?? "Value"}</span>
            <input type="text" value={value.value} onChange={(event) => onChange({ kind: "string", value: event.currentTarget.value })} />
          </label>
        );
      case "enum": {
        const options = [...new Set([...symbols, ...(expectedType?.kind === "enum" ? expectedType.value.values : []), value.value])].filter(Boolean);
        return (
          <label className="editor-field">
            <span>{label ?? "Symbol"}</span>
            <select value={value.value} onChange={(event) => onChange({ kind: "enum", value: event.currentTarget.value })}>
              {options.length === 0 && <option value="">Choose a symbol</option>}
              {options.map((symbol) => <option key={symbol} value={symbol}>{symbol}</option>)}
            </select>
          </label>
        );
      }
      case "entity":
        return (
          <label className="editor-field">
            <span>{label ?? "Entity ID"}</span>
            <input type="text" value={value.value} onChange={(event) => onChange({ kind: "entity", value: event.currentTarget.value })} />
          </label>
        );
      default:
        return null;
    }
  })();

  if (value.kind === "record") {
    const fieldNames = [...new Set([...Object.keys(recordFields ?? {}), ...Object.keys(value.value)])];
    return (
      <section className="editor-value">
        <div className="editor-value-heading">
          <strong>{label ?? "Record"}</strong>
          {kindControl}
        </div>
        {fieldNames.map((field) => {
          const fieldType = recordFields?.[field];
          const fieldValue = value.value[field] ?? (fieldType ? domainValueForType(fieldType) : { kind: "null" as const });
          return (
            <div className="editor-record-field" key={field}>
              <DomainValueEditor
                depth={depth + 1}
                label={field}
                onChange={(next) => onChange({ kind: "record", value: { ...value.value, [field]: next } })}
                symbols={symbols}
                value={fieldValue}
                valueType={fieldType}
              />
              {!fieldType && (
                <button className="editor-icon-button" aria-label={"Remove " + field} onClick={() => {
                  const next = { ...value.value };
                  delete next[field];
                  onChange({ kind: "record", value: next });
                }} type="button">×</button>
              )}
            </div>
          );
        })}
        <div className="editor-field-row">
          <input aria-label="New record field" className="editor-compact-input" placeholder="Field ID" data-record-field />
          <button className="editor-inline-button" onClick={(event) => {
            const input = event.currentTarget.parentElement?.querySelector<HTMLInputElement>("[data-record-field]");
            const field = input?.value.trim();
            if (field && !(field in value.value)) {
              onChange({ kind: "record", value: { ...value.value, [field]: { kind: "null" } } });
              if (input) input.value = "";
            }
          }} type="button">Add field</button>
        </div>
      </section>
    );
  }

  if (value.kind === "list") {
    const rows = value.value;
    const maximum = valueType?.kind === "list" || valueType?.kind === "vector"
      ? valueType.value.max_items
      : valueType?.kind === "matrix" ? valueType.value.max_rows : Number.POSITIVE_INFINITY;
    return (
      <section className="editor-value">
        <div className="editor-value-heading">
          <strong>{label ?? typeName(valueType)}</strong>
          {kindControl}
        </div>
        <div className="editor-list-values">
          {rows.map((item, index) => {
            if (valueType?.kind === "matrix" && item.kind === "list") {
              return (
                <div className="editor-matrix-row" key={index}>
                  <span>Row {index + 1}</span>
                  <DomainValueEditor
                    depth={depth + 1}
                    label="Values"
                    onChange={(next) => onChange({ kind: "list", value: rows.map((entry, row) => row === index ? next : entry) })}
                    symbols={symbols}
                    value={item}
                    valueType={{ kind: "list", value: { element: childType!, max_items: valueType.value.max_columns } }}
                  />
                  <button className="editor-icon-button" aria-label={"Remove row " + (index + 1)} onClick={() => onChange({ kind: "list", value: rows.filter((_, row) => row !== index) })} type="button">×</button>
                </div>
              );
            }
            return (
              <div className="editor-list-item" key={index}>
                <DomainValueEditor
                  depth={depth + 1}
                  label={"Item " + (index + 1)}
                  onChange={(next) => onChange({ kind: "list", value: rows.map((entry, itemIndex) => itemIndex === index ? next : entry) })}
                  symbols={symbols}
                  value={item}
                  valueType={childType}
                />
                <button className="editor-icon-button" aria-label={"Remove item " + (index + 1)} onClick={() => onChange({ kind: "list", value: rows.filter((_, itemIndex) => itemIndex !== index) })} type="button">×</button>
              </div>
            );
          })}
        </div>
        {rows.length < maximum && (
          <button className="editor-inline-button" onClick={() => {
            if (valueType?.kind === "matrix") {
              onChange({ kind: "list", value: [...rows, { kind: "list", value: [] }] });
            } else {
              onChange({ kind: "list", value: [...rows, childType ? domainValueForType(childType) : { kind: "null" }] });
            }
          }} type="button">Add {isMatrix ? "row" : "item"}</button>
        )}
      </section>
    );
  }

  return (
    <div className="editor-value">
      {kindControl}
      {scalar}
      {valueType && !allowedKinds.includes(value.kind) && (
        <div className="editor-inline-error">
          <span>Expected {typeName(nestingType)}.</span>
          <button className="editor-inline-button" onClick={() => onChange(domainValueForType(valueType))} type="button">Reset to schema type</button>
        </div>
      )}
    </div>
  );
}
