import { describe, expect, it } from "vitest";
import {
  isDomainValueRecord,
  isStructuredTacticsAst,
} from "../../../apps/web/src/features/next/draft-validation";
import type { StructuredTacticsAst } from "../../../apps/web/src/contracts/core-model";

const validAst: StructuredTacticsAst = {
  schema_version: { major: 1, minor: 0, patch: 0 },
  program_name: "recovery_fixture",
  declarations: [
    {
      kind: "state",
      name: "can_advance",
      predicates: [
        { kind: "literal_truth", value: true },
        {
          kind: "compare",
          value: {
            left: {
              kind: "count",
              value: {
                binding: "hero",
                collection: {
                  kind: "filter",
                  value: {
                    binding: "hero",
                    collection: { kind: "path", value: ["own_heroes"] },
                    predicates: [{ kind: "knownness", value: { value: { kind: "path", value: ["hero", "hp"] }, test: "known" } }],
                  },
                },
                predicates: [{ kind: "state_reference", value: "alive" }],
              },
            },
            operator: "greater_than",
            right: { kind: "literal", value: { kind: "integer", value: 0 } },
          },
        },
      ],
    },
    {
      kind: "action",
      name: "move_forward",
      when: { kind: "not", value: { kind: "literal_truth", value: false } },
      do_call: {
        capability: ["move"],
        arguments: [
          {
            kind: "arg_min",
            value: {
              binding: "hero",
              collection: { kind: "path", value: ["own_heroes"] },
              expression: { kind: "path", value: ["hero", "hp"] },
              unique_key: ["hero", "slot_id"],
            },
          },
          { kind: "literal", value: { kind: "string", value: "mid_1" } },
        ],
      },
    },
  ],
};

describe("Next persisted-draft structural validation", () => {
  it("accepts the recursive AST shapes used by the visual tactics editor", () => {
    expect(isStructuredTacticsAst(validAst)).toBe(true);
  });

  it("rejects malformed declaration, predicate and nested value records", () => {
    expect(isStructuredTacticsAst({})).toBe(false);
    expect(isStructuredTacticsAst({ ...validAst, declarations: [{ kind: "state", name: "broken" }] })).toBe(false);
    expect(isStructuredTacticsAst({
      ...validAst,
      declarations: [{ kind: "state", name: "broken", predicates: [{ kind: "compare", value: {} }] }],
    })).toBe(false);
    expect(isStructuredTacticsAst({
      ...validAst,
      declarations: [{ kind: "action", name: "broken", when: { kind: "literal_truth", value: true }, do_call: { capability: ["move"], arguments: [{ kind: "unknown" }] } }],
    })).toBe(false);
  });

  it("validates nested DomainValue configuration and memory maps", () => {
    expect(isDomainValueRecord({
      enabled: { kind: "bool", value: true },
      count: { kind: "integer", value: 4 },
      threshold: { kind: "fixed", value: { coefficient: 125, scale: 2 } },
      name: { kind: "string", value: "formation" },
      lane: { kind: "enum", value: "mid" },
      subject: { kind: "entity", value: "hero-01" },
      nested: {
        kind: "record",
        value: { values: { kind: "list", value: [{ kind: "null" }, { kind: "integer", value: 1 }] } },
      },
    })).toBe(true);
    expect(isDomainValueRecord({})).toBe(true);
    expect(isDomainValueRecord({ broken: { kind: "record", value: { count: { kind: "integer", value: "one" } } } })).toBe(false);
    expect(isDomainValueRecord([{ kind: "integer", value: 1 }])).toBe(false);
  });
});
