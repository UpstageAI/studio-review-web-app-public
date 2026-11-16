import { describe, expect, it } from "vitest";
import { validateRulesFromResponse } from "../validate-rules";

const extractTotal = {
  nodeType: "extract",
  nodeName: "Invoice",
  field: "total",
  value: 1200,
};

const sumCheck = {
  name: "total_matches_sum",
  severity: "error",
  passed: true,
  reason: "…",
  conditions: {
    kind: "group",
    logic: "and",
    passed: true,
    conditions: [
      {
        kind: "condition",
        passed: true,
        left: extractTotal,
        operator: "filled",
        right: null,
      },
      {
        kind: "condition",
        passed: true,
        left: {
          nodeType: "extract",
          nodeName: "Invoice",
          field: "items",
          rowField: "amount",
          agg: "sum",
          value: 1100,
        },
        operator: "eq",
        right: {
          nodeType: "extract",
          nodeName: "Invoice",
          field: "subtotal",
          value: 1100,
        },
      },
    ],
  },
};

const confidenceCheck = {
  name: "confidence",
  severity: "warning",
  passed: false,
  reason: "…",
  conditions: {
    kind: "condition",
    passed: false,
    left: { ...extractTotal, attr: "confidence", value: 0.5 },
    operator: "gte",
    right: { const: 0.8, value: 0.8 },
  },
};

function validateMessage(stepId: string, checks: unknown[], asString = true) {
  const additional = { verdict: "green", checks };
  return {
    type: "message",
    step_id: stepId,
    step_type: "validate",
    model: "Validate",
    content: [
      {
        type: "output_text",
        text: '"green"',
        additional_values: asString ? JSON.stringify(additional) : additional,
      },
    ],
  };
}

describe("validateRulesFromResponse", () => {
  it("reads rules per step and drops run-time values", () => {
    const rules = validateRulesFromResponse({
      output: [validateMessage("st_val", [sumCheck, confidenceCheck])],
    });
    expect(Object.keys(rules)).toEqual(["st_val"]);
    const [sum, confidence] = rules.st_val!;
    expect(sum!.name).toBe("total_matches_sum");
    expect(sum!.severity).toBe("error");
    expect(sum!.condition).toMatchObject({
      kind: "group",
      logic: "and",
      conditions: [
        { kind: "condition", operator: "filled", right: null },
        { kind: "condition", operator: "eq" },
      ],
    });
    expect(JSON.stringify(sum)).not.toContain("value");
    expect(JSON.stringify(sum)).not.toContain("passed");
    expect(confidence!.severity).toBe("warning");
    expect(confidence!.condition).toMatchObject({
      kind: "condition",
      left: { nodeName: "Invoice", field: "total", attr: "confidence" },
      operator: "gte",
      right: { constant: 0.8 },
    });
  });

  it("merges rules across documents by name, keeping first order", () => {
    const rules = validateRulesFromResponse({
      output: [
        validateMessage("st_val", [sumCheck]),
        validateMessage("st_val", [sumCheck, confidenceCheck], false),
      ],
    });
    expect(rules.st_val!.map(rule => rule.name)).toEqual([
      "total_matches_sum",
      "confidence",
    ]);
  });

  it("fills a missing condition from a later document", () => {
    const bare = { name: "total_matches_sum", severity: "error" };
    const rules = validateRulesFromResponse({
      output: [
        validateMessage("st_val", [bare]),
        validateMessage("st_val", [sumCheck]),
      ],
    });
    expect(rules.st_val![0]!.condition?.kind).toBe("group");
  });

  it("supports the legacy node operand and unknown severity", () => {
    const rules = validateRulesFromResponse({
      output: [
        validateMessage("st_val", [
          {
            name: "legacy",
            severity: "fatal",
            conditions: {
              kind: "condition",
              left: { node: "Extract", field: "a" },
              operator: "empty",
            },
          },
        ]),
      ],
    });
    const [rule] = rules.st_val!;
    expect(rule!.severity).toBe("error");
    expect(rule!.condition).toMatchObject({
      left: { nodeType: null, nodeName: "Extract", field: "a" },
      right: null,
    });
  });

  it("ignores other steps, broken additional values and nameless checks", () => {
    expect(
      validateRulesFromResponse({
        output: [
          {
            step_id: "st_ext",
            step_type: "information-extract",
            content: [{ additional_values: "{}" }],
          },
          {
            step_id: "st_val",
            step_type: "validate",
            content: [{ additional_values: "{not json" }],
          },
          validateMessage("st_val2", [{ severity: "error" }]),
        ],
      }),
    ).toEqual({});
    expect(validateRulesFromResponse(null)).toEqual({});
  });

  it("keeps step ids that look like Object.prototype names as plain own keys", () => {
    const rules = validateRulesFromResponse({
      output: [validateMessage("st_1", [sumCheck])],
    });
    expect(Object.getPrototypeOf(rules)).toBeNull();
    for (const name of ["constructor", "__proto__", "toString"]) {
      expect(Object.hasOwn(rules, name)).toBe(false);
    }

    const proto = validateRulesFromResponse({
      output: [validateMessage("__proto__", [sumCheck])],
    });
    expect(Object.keys(proto)).toEqual(["__proto__"]);
    expect(Object.hasOwn(proto, "__proto__")).toBe(true);
    expect(proto["__proto__"]!.map(rule => rule.name)).toEqual([
      "total_matches_sum",
    ]);
  });
});
