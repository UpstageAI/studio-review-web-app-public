import {
  isValidateStepType,
  parseJson,
  type JsonValue,
} from "@/lib/review-model";
import { record } from "./parse-highlights";

// Job 응답의 Validate Step 출력에서 Config 에 설정된 규칙(check)을 읽는다. 화면은 보기만 한다.
// - `content[i].additional_values`: JSON 문자열(또는 객체) `{verdict, checks[]}`.
// - `checks[i]`: `{name, severity, passed, reason, conditions}`. `conditions` 는 Config 의 조건 트리를
//   그대로 옮긴 trace 트리(그룹 `{kind:"group", logic, conditions[]}` · 조건 `{kind:"condition", left,
//   operator, right}`)이고, 피연산자에는 실행 때 읽은 값(`value`)이 덧붙어 있다.
// 규칙은 Step 이 같으면 문서마다 같으므로 Step 별로 이름 기준 한 번씩 모은다. 문서마다 다른 실행 값
// (`value`·`passed`)은 버리고 설정 모양만 남긴다.

/** 피연산자(설정 필드만). 모르는 필드는 버린다. */
export type RuleOperand = {
  /** `extract`·`classify`·`parse`·`instruct`·`match` 등. 이전 형식(`node`)이면 `null`. */
  nodeType: string | null;
  /** 참조하는 Step 이름. 이전 형식이면 `node` 값. */
  nodeName: string | null;
  field: string | null;
  /** 배열 필드 안 항목의 필드(`items[].amount` 의 `amount`). */
  rowField: string | null;
  /** `value`·`confidence`·`length`. 없으면 값 자체. */
  attr: string | null;
  /** `sum`·`count`·`min`·`max`. */
  agg: string | null;
  /** 여러 값일 때 `all`·`any`. */
  scope: string | null;
  /** 결과 JSON 경로로 참조할 때. */
  path: string | null;
  /** 상수 피연산자. 상수가 아니면 `undefined`. */
  constant?: JsonValue;
  /** Match 결과 참조: `anchor`·`target`. */
  matchSide: string | null;
  matchOutputKey: string | null;
};

export type RuleCondition = {
  kind: "condition";
  left: RuleOperand;
  /** `eq neq gt gte lt lte filled empty contains matches`. 모르는 값도 그대로 둔다. */
  operator: string;
  /** 단항 연산자(`filled`·`empty`)면 `null`. */
  right: RuleOperand | null;
};

export type RuleGroup = {
  kind: "group";
  logic: "and" | "or";
  conditions: RuleNode[];
};

export type RuleNode = RuleCondition | RuleGroup;

export type ValidateRule = {
  name: string;
  /** `error`(실패하면 red) · `warning`(실패하면 yellow). 모르는 값은 `error`. */
  severity: "error" | "warning";
  /** 조건을 읽지 못했으면 `null`(이름·심각도만 보인다). */
  condition: RuleNode | null;
};

/** Step id → 그 Step 의 규칙(응답에 처음 나온 순서). */
export type ValidateRulesByStep = Readonly<
  Record<string, readonly ValidateRule[]>
>;

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

function readOperand(raw: unknown): RuleOperand | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const item = record(raw);
  const operand: RuleOperand = {
    nodeType: text(item.nodeType),
    nodeName: text(item.nodeName) ?? text(item.node),
    field: text(item.field),
    rowField: text(item.rowField),
    attr: text(item.attr),
    agg: text(item.agg),
    scope: text(item.scope),
    path: text(item.path),
    matchSide: text(item.matchSide),
    matchOutputKey: text(item.matchOutputKey),
  };
  const isReference =
    operand.nodeName !== null ||
    operand.field !== null ||
    operand.path !== null;
  if (!isReference) {
    if (!Object.hasOwn(item, "const")) return null;
    operand.constant = item.const as JsonValue;
  }
  return operand;
}

/** 조건 트리 노드. 깊이는 설정 빌더가 막지만 깨진 응답에 대비해 제한한다. */
function readNode(raw: unknown, depth = 0): RuleNode | null {
  if (depth > 20) return null;
  const item = record(raw);
  const isGroup =
    item.kind === "group" ||
    (item.kind === undefined && Array.isArray(item.conditions));
  if (isGroup) {
    if (!Array.isArray(item.conditions)) return null;
    const logic = item.logic === "or" ? "or" : "and";
    const conditions = item.conditions
      .map(child => readNode(child, depth + 1))
      .filter((child): child is RuleNode => child !== null);
    return conditions.length > 0 ? { kind: "group", logic, conditions } : null;
  }
  const operator = text(item.operator);
  const left = readOperand(item.left);
  if (operator === null || left === null) return null;
  return {
    kind: "condition",
    left,
    operator,
    right: item.right == null ? null : readOperand(item.right),
  };
}

function readRule(raw: unknown): ValidateRule | null {
  const item = record(raw);
  const name = text(item.name);
  if (name === null) return null;
  return {
    name,
    severity: item.severity === "warning" ? "warning" : "error",
    condition: readNode(item.conditions),
  };
}

function readAdditional(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return parseJson(value);
  } catch {
    return undefined;
  }
}

/**
 * Job 응답 → Validate Step 별 규칙. 같은 이름의 규칙은 처음 것을 쓰되, 앞 문서에서 조건을 읽지
 * 못했으면 뒤 문서의 조건으로 채운다. 규칙이 하나도 없는 Step 은 넣지 않는다.
 */
export function validateRulesFromResponse(
  response: unknown,
): ValidateRulesByStep {
  const output = record(response).output;
  if (!Array.isArray(output)) return {};
  const byStep = new Map<string, Map<string, ValidateRule>>();
  for (const raw of output) {
    const message = record(raw);
    if (!isValidateStepType(message.step_type)) continue;
    const stepId = text(message.step_id);
    if (stepId === null || !Array.isArray(message.content)) continue;
    for (const content of message.content) {
      const checks = record(
        readAdditional(record(content).additional_values),
      ).checks;
      if (!Array.isArray(checks)) continue;
      let rules = byStep.get(stepId);
      if (!rules) {
        rules = new Map();
        byStep.set(stepId, rules);
      }
      for (const check of checks) {
        const rule = readRule(check);
        if (!rule) continue;
        const known = rules.get(rule.name);
        if (!known || (known.condition === null && rule.condition !== null)) {
          rules.set(rule.name, rule);
        }
      }
    }
  }
  // step id 는 Config 작성자가 정하는 문자열이라 `__proto__`·`constructor` 여도 own 키로 둔다.
  const out = Object.create(null) as Record<string, readonly ValidateRule[]>;
  for (const [stepId, rules] of byStep) {
    if (rules.size > 0) out[stepId] = [...rules.values()];
  }
  return out;
}
