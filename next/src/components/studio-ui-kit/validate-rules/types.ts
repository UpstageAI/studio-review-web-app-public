export type RuleOperand = {
  /** `extract`·`classify`·`parse`·`instruct`·`match` 등. 모르면 `null`. */
  nodeType: string | null;
  /** 참조하는 Step 이름. */
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
  /** 상수 피연산자. 상수가 아니면 `undefined`. 글자로 바꾸는 일은 `formatConstant` 가 한다. */
  constant?: unknown;
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
  /** `error`·`warning`. */
  severity: "error" | "warning";
  /** 조건을 읽지 못했으면 `null`(이름·심각도만 보인다). */
  condition: RuleNode | null;
};
