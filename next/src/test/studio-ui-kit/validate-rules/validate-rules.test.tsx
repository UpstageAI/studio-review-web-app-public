import { render, screen } from "@testing-library/react";
import {
  ValidateRules,
  type ValidateRulesLabels,
} from "@/components/studio-ui-kit/validate-rules/validate-rules";
import type {
  RuleCondition,
  RuleNode,
  RuleOperand,
  ValidateRule,
} from "@/components/studio-ui-kit/validate-rules/types";

const labels: ValidateRulesLabels = {
  empty: "규칙 없음",
  severity: { error: "ERR", warning: "WARN" },
  logic: { and: "ALL", or: "ANY" },
  operator: {
    filled: left => <>filled({left})</>,
    empty: left => <>empty({left})</>,
    contains: (left, right) => (
      <>
        {left} has {right}
      </>
    ),
    matches: (left, right) => (
      <>
        {left} ~ {right}
      </>
    ),
  },
  agg: {
    sum: target => <>sum({target})</>,
    count: target => <>count({target})</>,
    min: target => <>min({target})</>,
    max: target => <>max({target})</>,
  },
  attr: {
    confidence: target => <>conf({target})</>,
    length: target => <>len({target})</>,
  },
  scope: {
    all: target => <>all {target}</>,
    any: target => <>any {target}</>,
  },
};

const formatConstant = (value: unknown) => JSON.stringify(value);

const EMPTY: RuleOperand = {
  nodeType: null,
  nodeName: null,
  field: null,
  rowField: null,
  attr: null,
  agg: null,
  scope: null,
  path: null,
  matchSide: null,
  matchOutputKey: null,
};

const ref = (
  field: string,
  more: Partial<RuleOperand> = {},
  step = "Extract",
): RuleOperand => ({ ...EMPTY, nodeName: step, field, ...more });

const constant = (value: unknown): RuleOperand => ({
  ...EMPTY,
  constant: value,
});

const condition = (
  left: RuleOperand,
  operator: string,
  right: RuleOperand | null,
): RuleCondition => ({ kind: "condition", left, operator, right });

const group = (logic: "and" | "or", conditions: RuleNode[]): RuleNode => ({
  kind: "group",
  logic,
  conditions,
});

const rule = (condition: RuleNode | null): ValidateRule => ({
  name: "r",
  severity: "error",
  condition,
});

const lines = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("p.leading-6")).map(
    line => line.textContent,
  );

function linesOf(conditions: RuleNode[]): (string | null)[] {
  const { container } = render(
    <ValidateRules
      rules={[rule(group("and", conditions))]}
      formatConstant={formatConstant}
      labels={labels}
    />,
  );
  return lines(container);
}

describe("ValidateRules", () => {
  it("빈 규칙이면 labels.empty 만 그린다", () => {
    const { container } = render(
      <ValidateRules
        rules={[]}
        formatConstant={formatConstant}
        labels={labels}
      />,
    );
    expect(container.textContent).toBe("규칙 없음");
    expect(container.querySelector("ul")).toBeNull();
  });

  it("연산자 4 종을 labels.operator 로 감싸고 비교는 기호로 쓴다", () => {
    expect(
      linesOf([
        condition(ref("a"), "filled", null),
        condition(ref("a"), "empty", null),
        condition(ref("a"), "contains", constant("x")),
        condition(ref("a"), "matches", constant("^x")),
        condition(ref("a"), "gte", constant(1)),
      ]),
    ).toEqual(["filled(a)", "empty(a)", 'a has "x"', 'a ~ "^x"', "a ≥ 1"]);
  });

  it("집계 4 종·속성 2 종·범위 2 종을 labels 로 감싼다", () => {
    expect(
      linesOf([
        condition(ref("a", { agg: "sum" }), "filled", null),
        condition(ref("a", { agg: "count" }), "filled", null),
        condition(ref("a", { agg: "min" }), "filled", null),
        condition(ref("a", { agg: "max" }), "filled", null),
        condition(ref("a", { attr: "confidence" }), "filled", null),
        condition(ref("a", { attr: "length" }), "filled", null),
        condition(ref("a", { scope: "all" }), "filled", null),
        condition(ref("a", { scope: "any" }), "filled", null),
      ]),
    ).toEqual([
      "filled(sum(a))",
      "filled(count(a))",
      "filled(min(a))",
      "filled(max(a))",
      "filled(conf(a))",
      "filled(len(a))",
      "filled(all a)",
      "filled(any a)",
    ]);
  });

  it("모르는 연산자·집계·속성·범위는 원문 표기로 남긴다", () => {
    expect(
      linesOf([
        condition(ref("a"), "between", constant([1, 2])),
        condition(ref("a", { agg: "median" }), "lt", constant(5)),
        condition(ref("a", { attr: "raw" }), "eq", constant(1)),
        condition(ref("a", { scope: "some" }), "eq", constant(true)),
        condition(ref("a"), "odd", null),
      ]),
    ).toEqual([
      "a between [1,2]",
      "median(a) < 5",
      "a.raw = 1",
      "a = true",
      "a odd",
    ]);
  });

  it("상수는 formatConstant 로 쓰고, 던지면 String(value) 로 쓴다", () => {
    const { container } = render(
      <ValidateRules
        rules={[rule(condition(ref("a"), "eq", constant(7)))]}
        formatConstant={() => {
          throw new Error("no");
        }}
        labels={labels}
      />,
    );
    expect(lines(container)).toEqual(["a = 7"]);
  });

  it("그룹은 labels.logic 머리와 함께 중첩해 그린다", () => {
    const { container } = render(
      <ValidateRules
        rules={[
          rule(
            group("and", [
              condition(ref("a"), "filled", null),
              group("or", [condition(ref("b"), "empty", null)]),
            ]),
          ),
        ]}
        formatConstant={formatConstant}
        labels={labels}
      />,
    );
    expect(container.textContent).toBe("rERRALLfilled(a)ANYempty(b)");
  });

  it("심각도 칩은 labels.severity, 조건이 없으면 조건 줄이 없다", () => {
    const { container } = render(
      <ValidateRules
        rules={[
          { name: "e", severity: "error", condition: null },
          { name: "w", severity: "warning", condition: null },
        ]}
        formatConstant={formatConstant}
        labels={labels}
      />,
    );
    const items = container.querySelectorAll(":scope > div > ul > li");
    expect(Array.from(items, item => item.textContent)).toEqual([
      "eERR",
      "wWARN",
    ]);
    expect(lines(container)).toEqual([]);
  });

  it("여러 Step 을 참조하면 필드 앞에 Step 이름을 붙인다", () => {
    const { container } = render(
      <ValidateRules
        rules={[rule(condition(ref("a"), "eq", ref("b", {}, "Other")))]}
        formatConstant={formatConstant}
        labels={labels}
      />,
    );
    expect(lines(container)).toEqual(["Extract.a = Other.b"]);
  });

  it("testId 가 없으면 testid 를 붙이지 않고, 나머지 div props·className 은 루트로 간다", () => {
    const { container, rerender } = render(
      <ValidateRules
        rules={[]}
        formatConstant={formatConstant}
        labels={labels}
      />,
    );
    expect(container.querySelectorAll("[data-testid]")).toHaveLength(0);
    rerender(
      <ValidateRules
        rules={[]}
        formatConstant={formatConstant}
        labels={labels}
        testId="rules"
        data-extra="x"
        className="mt-2"
      />,
    );
    const root = screen.getByTestId("rules");
    expect(root).toBe(container.firstElementChild);
    expect(root).toHaveAttribute("data-extra", "x");
    expect(root.className.endsWith(" mt-2")).toBe(true);
  });
});

describe("ValidateRules DOM 계약", () => {
  const CONTRACT = [["title", "Extract.total"]] as const;

  it.each(CONTRACT)(
    "참조 칩 code 의 %s=%s(Step 이름까지 붙인 전체 이름)",
    (name, value) => {
      render(
        <ValidateRules
          rules={[rule(condition(ref("total"), "filled", null))]}
          formatConstant={formatConstant}
          labels={labels}
        />,
      );
      const chip = screen.getByText("total");
      expect(chip.tagName).toBe("CODE");
      expect(chip).toHaveAttribute(name, value);
    },
  );
});
