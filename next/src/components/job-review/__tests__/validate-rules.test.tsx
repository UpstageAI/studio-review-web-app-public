import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type {
  RuleCondition,
  RuleNode,
  RuleOperand,
  ValidateRule,
} from "@/lib/review-api/validate-rules";
import { parseJson } from "@/lib/review-model";
import { snapshotHtml } from "@/test/dom-snapshot";
import { renderWithIntl } from "@/test/render";
import { ValidateRules } from "../validate-rules";

const TEST_ID = "job-review-validate-rules";
const EXTRACT = "Information Extract - 청구서";
const CLASSIFY = "Classify - 문서 분류";

const EMPTY_OPERAND: RuleOperand = {
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
  step = EXTRACT,
): RuleOperand => ({
  ...EMPTY_OPERAND,
  nodeType: "extract",
  nodeName: step,
  field,
  ...more,
});

const constant = (json: string): RuleOperand => ({
  ...EMPTY_OPERAND,
  constant: parseJson(json),
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

/** 한 Step 만 참조하는 규칙: 비교·단항·단어 연산자·집계·속성·범위·상수, and/or 중첩, severity 2 종. */
const MIXED_RULES: ValidateRule[] = [
  {
    name: "합계 확인",
    severity: "error",
    condition: group("and", [
      condition(ref("total"), "gte", constant("100")),
      condition(ref("memo"), "filled", null),
      condition(ref("vendor"), "contains", constant('"Upstage"')),
      condition(ref("invoice_no"), "matches", constant('"^INV-\\\\d+$"')),
      group("or", [
        condition(
          ref("items", { rowField: "amount", agg: "sum" }),
          "eq",
          ref("subtotal"),
        ),
        condition(ref("total", { attr: "confidence" }), "gt", constant("0.8")),
        condition(
          ref("items", { rowField: "qty", scope: "all" }),
          "neq",
          constant("0"),
        ),
      ]),
    ]),
  },
  {
    name: "통화 확인",
    severity: "warning",
    condition: condition(ref("currency"), "empty", null),
  },
  {
    name: "조건 없음",
    severity: "warning",
    condition: null,
  },
];

/** 둘 이상의 Step 을 참조해 필드 앞에 Step 이름이 붙는 규칙. */
const MULTI_STEP_RULES: ValidateRule[] = [
  {
    name: "분류와 금액",
    severity: "error",
    condition: condition(
      ref("label", {}, CLASSIFY),
      "eq",
      ref("vendor", { attr: "length" }),
    ),
  },
];

/** 이 화면이 모르는 연산자·집계·속성·범위(원문 표기로 남는다). */
const UNKNOWN_RULES: ValidateRule[] = [
  {
    name: "모르는 표기",
    severity: "error",
    condition: group("and", [
      condition(ref("total"), "between", constant("[1,2]")),
      condition(ref("items", { agg: "median" }), "lt", constant("5")),
      condition(ref("tax", { attr: "raw" }), "lte", constant("1")),
      condition(ref("paid", { scope: "some" }), "eq", constant("true")),
      condition(ref("memo"), "unknown_unary", null),
    ]),
  },
];

const card = () => screen.getByTestId(TEST_ID);
const lines = () =>
  Array.from(card().querySelectorAll("p.leading-6")).map(
    line => line.textContent,
  );

describe("ValidateRules", () => {
  it("빈 규칙이면 안내 문구만 보인다", () => {
    renderWithIntl(<ValidateRules rules={[]} />);
    expect(snapshotHtml(card())).toMatchSnapshot();
  });

  it("연산자·집계·속성·범위·상수가 섞인 규칙과 and/or 그룹을 그린다", () => {
    renderWithIntl(<ValidateRules rules={MIXED_RULES} />);
    expect(snapshotHtml(card())).toMatchSnapshot();
  });

  it("여러 Step 을 참조하면 필드 앞에 Step 이름을 붙인다", () => {
    renderWithIntl(<ValidateRules rules={MULTI_STEP_RULES} />);
    expect(snapshotHtml(card())).toMatchSnapshot();
    expect(lines()).toEqual([`${CLASSIFY}.label = ${EXTRACT}.vendor 길이`]);
  });

  it("한 Step 만 참조하면 필드 이름만 쓰고 칩 title 은 전체 이름이다", () => {
    renderWithIntl(<ValidateRules rules={MIXED_RULES} />);
    const chips = Array.from(card().querySelectorAll("code[title]"));
    expect(chips.map(chip => chip.textContent)).toEqual([
      "total",
      "memo",
      "vendor",
      "invoice_no",
      "items[].amount",
      "subtotal",
      "total",
      "items[].qty",
      "currency",
    ]);
    expect(chips.map(chip => chip.getAttribute("title"))).toEqual([
      `${EXTRACT}.total`,
      `${EXTRACT}.memo`,
      `${EXTRACT}.vendor`,
      `${EXTRACT}.invoice_no`,
      `${EXTRACT}.items[].amount`,
      `${EXTRACT}.subtotal`,
      `${EXTRACT}.total`,
      `${EXTRACT}.items[].qty`,
      `${EXTRACT}.currency`,
    ]);
  });

  it("규칙마다 이름과 심각도 칩을 보이고 조건이 없으면 조건 줄이 없다", () => {
    renderWithIntl(<ValidateRules rules={MIXED_RULES} />);
    const items = card().querySelectorAll(":scope > ul > li");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("오류 → red");
    expect(items[1].textContent).toContain("경고 → yellow");
    expect(items[2].textContent).toBe("조건 없음경고 → yellow");
  });

  it("모르는 연산자·집계·속성·범위는 원문 표기로 남긴다", () => {
    renderWithIntl(<ValidateRules rules={UNKNOWN_RULES} />);
    expect(lines()).toEqual([
      "total between [1,2]",
      "median(items) < 5",
      "tax.raw ≤ 1",
      "paid = true",
      "memo unknown_unary",
    ]);
  });
});
