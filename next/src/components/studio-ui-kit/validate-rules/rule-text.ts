import type {
  RuleCondition,
  RuleNode,
  RuleOperand,
  ValidateRule,
} from "./types";

// Validate 규칙(조건·피연산자)을 사람이 읽는 한 줄로 만든다. 결과 모양(`T`)과 문구는 호출하는 쪽이
// 정한다 — 화면은 필드를 칩으로 그리는 React 노드, 테스트는 문자열. 비교 연산자는 기호(=, ≠, >, ≥, <, ≤)
// 로 쓰고, 나머지 연산자·집계·속성·범위는 번역 문구로 감싼다.

export const COMPARE_SYMBOLS: Readonly<Record<string, string>> = {
  eq: "=",
  neq: "≠",
  gt: ">",
  gte: "≥",
  lt: "<",
  lte: "≤",
};

/** 번역 문구로 감싸는 연산자·집계·속성·범위. 모르는 값은 호출하는 쪽이 원문으로 쓴다. */
export const UNARY_OPERATORS: readonly string[] = ["filled", "empty"];
export const WORD_OPERATORS: readonly string[] = ["contains", "matches"];
export const AGGREGATES: readonly string[] = ["sum", "count", "min", "max"];
export const ATTRIBUTES: readonly string[] = ["confidence", "length"];
export const SCOPES: readonly string[] = ["all", "any"];

export type RuleFormat<T> = {
  /** 상수 값을 글자로(JSON 표기). 던지면 `String(value)` 로 쓴다. */
  formatConstant: (value: unknown) => string;
  /** 필드 참조. `label` 은 보일 이름, `full` 은 Step 이름까지 붙인 전체 이름(툴팁용). */
  reference: (label: string, full: string) => T;
  /** 상수(JSON 표기). */
  constant: (text: string) => T;
  /** 비교: `left 기호 right`. */
  compare: (left: T, symbol: string, right: T) => T;
  /** `filled`·`empty`(right 는 `null`)·`contains`·`matches`. 모르는 연산자도 여기로 온다. */
  operator: (operator: string, left: T, right: T | null) => T;
  /** `sum`·`count`·`min`·`max`. 모르는 집계도 여기로 온다. */
  agg: (agg: string, target: T) => T;
  /** `confidence`·`length`. */
  attr: (attr: string, target: T) => T;
  /** `all`·`any`. */
  scope: (scope: string, target: T) => T;
};

/** 상수: 문자열은 따옴표로, 그 외는 JSON 그대로. */
function constantText(
  value: RuleOperand["constant"],
  formatConstant: (value: unknown) => string,
): string {
  if (value === undefined) return "";
  try {
    return formatConstant(value);
  } catch {
    return String(value);
  }
}

/** 필드 이름: `field`, 배열 항목 필드는 `field[].row`, Match 결과는 `.key (side)`. */
function fieldText(operand: RuleOperand): string {
  if (operand.path !== null && operand.field === null) return operand.path;
  const field = operand.field ?? "";
  const withRow =
    operand.rowField !== null ? `${field}[].${operand.rowField}` : field;
  const outputKey =
    operand.matchOutputKey !== null ? `.${operand.matchOutputKey}` : "";
  const side = operand.matchSide !== null ? ` (${operand.matchSide})` : "";
  return `${withRow}${outputKey}${side}`;
}

function referenceNames(
  operand: RuleOperand,
  showStep: boolean,
): { label: string; full: string } {
  const field = fieldText(operand);
  const step = operand.nodeName;
  const full = step === null ? field : field ? `${step}.${field}` : step;
  return { label: showStep || !field ? full : field, full };
}

export function formatOperand<T>(
  operand: RuleOperand,
  format: RuleFormat<T>,
  showStep: boolean,
): T {
  if (operand.constant !== undefined) {
    return format.constant(
      constantText(operand.constant, format.formatConstant),
    );
  }
  const { label, full } = referenceNames(operand, showStep);
  let out: T;
  if (operand.attr === null || operand.attr === "value") {
    out = format.reference(label, full);
  } else if (ATTRIBUTES.includes(operand.attr)) {
    out = format.attr(operand.attr, format.reference(label, full));
  } else {
    out = format.reference(
      `${label}.${operand.attr}`,
      `${full}.${operand.attr}`,
    );
  }
  if (operand.agg !== null) out = format.agg(operand.agg, out);
  if (operand.scope !== null && SCOPES.includes(operand.scope)) {
    out = format.scope(operand.scope, out);
  }
  return out;
}

export function formatCondition<T>(
  condition: RuleCondition,
  format: RuleFormat<T>,
  showStep: boolean,
): T {
  const left = formatOperand(condition.left, format, showStep);
  const right = condition.right
    ? formatOperand(condition.right, format, showStep)
    : null;
  const symbol = COMPARE_SYMBOLS[condition.operator];
  if (symbol !== undefined && right !== null) {
    return format.compare(left, symbol, right);
  }
  return format.operator(condition.operator, left, right);
}

function collectSteps(node: RuleNode | null, out: Set<string>): void {
  if (node === null) return;
  if (node.kind === "group") {
    for (const child of node.conditions) collectSteps(child, out);
    return;
  }
  for (const operand of [node.left, node.right]) {
    if (operand?.nodeName) out.add(operand.nodeName);
  }
}

/**
 * 필드 앞에 Step 이름을 붙여야 하는지. 규칙 전체가 한 Step 만 참조하면 필드 이름만으로 충분하고,
 * 여러 Step 을 참조하면 같은 필드 이름이 겹칠 수 있어 붙인다.
 */
export function needsStepNames(rules: readonly ValidateRule[]): boolean {
  const steps = new Set<string>();
  for (const rule of rules) collectSteps(rule.condition, steps);
  return steps.size > 1;
}
