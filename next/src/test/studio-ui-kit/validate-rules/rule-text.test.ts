import type {
  RuleCondition,
  RuleOperand,
  ValidateRule,
} from "@/components/studio-ui-kit/validate-rules/types";
import {
  formatCondition,
  formatOperand,
  needsStepNames,
  type RuleFormat,
} from "@/components/studio-ui-kit/validate-rules/rule-text";

const format: RuleFormat<string> = {
  formatConstant: value => JSON.stringify(value),
  reference: (label, full) =>
    label === full ? `[${label}]` : `[${label}|${full}]`,
  constant: text => text,
  compare: (left, symbol, right) => `${left} ${symbol} ${right}`,
  operator: (operator, left, right) =>
    right === null ? `${operator}(${left})` : `${operator}(${left}, ${right})`,
  agg: (agg, target) => `${agg}(${target})`,
  attr: (attr, target) => `${attr}:${target}`,
  scope: (scope, target) => `${scope} ${target}`,
};

const operand = (patch: Partial<RuleOperand>): RuleOperand => ({
  nodeType: "extract",
  nodeName: "Invoice",
  field: null,
  rowField: null,
  attr: null,
  agg: null,
  scope: null,
  path: null,
  matchSide: null,
  matchOutputKey: null,
  ...patch,
});

const condition = (
  left: RuleOperand,
  operator: string,
  right: RuleOperand | null,
): RuleCondition => ({ kind: "condition", left, operator, right });

describe("formatOperand", () => {
  it("shows the field and keeps the step name for the tooltip", () => {
    expect(formatOperand(operand({ field: "total" }), format, false)).toBe(
      "[total|Invoice.total]",
    );
    expect(
      formatOperand(
        operand({ field: "items", rowField: "amount" }),
        format,
        true,
      ),
    ).toBe("[Invoice.items[].amount]");
  });

  it("wraps attribute, aggregate and scope in that order", () => {
    expect(
      formatOperand(
        operand({
          field: "items",
          rowField: "amount",
          attr: "confidence",
          agg: "min",
          scope: "all",
        }),
        format,
        true,
      ),
    ).toBe("all min(confidence:[Invoice.items[].amount])");
    expect(
      formatOperand(operand({ field: "total", attr: "value" }), format, true),
    ).toBe("[Invoice.total]");
    expect(
      formatOperand(operand({ field: "total", attr: "odd" }), format, true),
    ).toBe("[Invoice.total.odd]");
  });

  it("formats constants as JSON and paths as-is", () => {
    const constant = (value: RuleOperand["constant"]) =>
      formatOperand(
        operand({ nodeName: null, nodeType: null, constant: value }),
        format,
        false,
      );
    expect(constant("KRW")).toBe('"KRW"');
    expect(constant(0.8)).toBe("0.8");
    expect(
      formatOperand(
        operand({ nodeName: null, path: "$.total" }),
        format,
        false,
      ),
    ).toBe("[$.total]");
  });

  it("marks match side and output key", () => {
    expect(
      formatOperand(
        operand({
          nodeName: "Match",
          field: "score",
          matchOutputKey: "best",
          matchSide: "anchor",
        }),
        format,
        true,
      ),
    ).toBe("[Match.score.best (anchor)]");
  });
});

describe("formatCondition", () => {
  const total = operand({ field: "total" });
  const subtotal = operand({ field: "subtotal" });

  it("uses symbols for comparisons", () => {
    expect(
      formatCondition(condition(total, "gte", subtotal), format, true),
    ).toBe("[Invoice.total] ≥ [Invoice.subtotal]");
    expect(
      formatCondition(condition(total, "neq", subtotal), format, true),
    ).toBe("[Invoice.total] ≠ [Invoice.subtotal]");
  });

  it("passes other operators through, with null right for unary ones", () => {
    expect(
      formatCondition(condition(total, "filled", null), format, true),
    ).toBe("filled([Invoice.total])");
    expect(
      formatCondition(condition(total, "contains", subtotal), format, true),
    ).toBe("contains([Invoice.total], [Invoice.subtotal])");
  });
});

describe("needsStepNames", () => {
  const rule = (
    left: RuleOperand,
    right: RuleOperand | null,
  ): ValidateRule => ({
    name: "r",
    severity: "error",
    condition: {
      kind: "group",
      logic: "and",
      conditions: [condition(left, right ? "eq" : "filled", right)],
    },
  });

  it("is false when every reference points at one step", () => {
    expect(
      needsStepNames([rule(operand({ field: "a" }), operand({ field: "b" }))]),
    ).toBe(false);
    expect(needsStepNames([])).toBe(false);
  });

  it("is true when references span steps", () => {
    expect(
      needsStepNames([
        rule(operand({ field: "a" }), null),
        rule(operand({ nodeName: "Other", field: "a" }), null),
      ]),
    ).toBe(true);
  });
});
