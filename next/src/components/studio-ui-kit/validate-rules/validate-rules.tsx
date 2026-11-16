import { Fragment, useMemo, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  AGGREGATES,
  ATTRIBUTES,
  SCOPES,
  UNARY_OPERATORS,
  WORD_OPERATORS,
  formatCondition,
  needsStepNames,
  type RuleFormat,
} from "./rule-text";
import type { RuleNode, ValidateRule } from "./types";

type Operator = "filled" | "empty" | "contains" | "matches";
type Aggregate = "sum" | "count" | "min" | "max";
type Attribute = "confidence" | "length";
type Scope = "all" | "any";

export interface ValidateRulesLabels {
  /** 규칙이 하나도 없을 때의 안내. */
  empty: string;
  /** 심각도 칩. */
  severity: Record<ValidateRule["severity"], string>;
  /** 그룹 머리("모두 만족"·"하나 이상 만족"). */
  logic: Record<"and" | "or", string>;
  /** 단항(`filled`·`empty` — `right` 는 `null`)·단어 연산자 문구. 피연산자 노드를 문구 안 자리에 넣는다. */
  operator: Record<
    Operator,
    (left: ReactNode, right: ReactNode | null) => ReactNode
  >;
  /** 집계 문구. */
  agg: Record<Aggregate, (target: ReactNode) => ReactNode>;
  /** 속성 문구. */
  attr: Record<Attribute, (target: ReactNode) => ReactNode>;
  /** 범위 문구. */
  scope: Record<Scope, (target: ReactNode) => ReactNode>;
}

export type ValidateRulesProps = Omit<
  ComponentProps<"div">,
  "children" | "ref"
> & {
  rules: readonly ValidateRule[];
  /**
   * 상수 피연산자를 글자로(JSON 표기). 호출자의 JSON 표현(큰 정수 원문 보존 등)을 그대로 쓰려고 받는다.
   * 던지면 `String(value)` 로 쓴다.
   */
  formatConstant: (value: unknown) => string;
  labels: ValidateRulesLabels;
  /** 루트 `data-testid`. */
  testId?: string;
};

/**
 * Validate 판정 아래에 Config 에 설정된 규칙을 연한 카드로 보인다. 규칙마다 이름·심각도 칩, 그 아래
 * 조건을 한 줄씩 쓰고 그룹("모두 만족"·"하나 이상 만족")은 세로선으로 들여 쓴다. 필드는 코드 칩으로,
 * Step 이름은 여러 Step 을 참조할 때만 붙인다(칩 `title` 은 전체 이름).
 * 모르는 연산자·집계·속성·범위는 문구 없이 원문 표기로 남긴다. `rules` 가 빈 목록이면 안내만 보인다.
 */
export function ValidateRules({
  rules,
  formatConstant,
  labels,
  testId,
  className,
  ...props
}: ValidateRulesProps) {
  const showStep = useMemo(() => needsStepNames(rules), [rules]);
  const format = useMemo<RuleFormat<ReactNode>>(
    () => ({
      formatConstant,
      reference: (label, full) => (
        <code
          title={full}
          className="rounded-[0.25rem] border border-border bg-background px-1 py-px font-mono text-[0.6875rem] text-foreground"
        >
          {label}
        </code>
      ),
      constant: text => (
        <code className="font-mono text-[0.6875rem] text-foreground">
          {text}
        </code>
      ),
      compare: (left, symbol, right) => (
        <>
          {left} <span className="font-medium text-foreground">{symbol}</span>{" "}
          {right}
        </>
      ),
      operator: (operator, left, right) =>
        UNARY_OPERATORS.includes(operator) || WORD_OPERATORS.includes(operator)
          ? labels.operator[operator as Operator](left, right)
          : [left, operator, right]
              .filter(part => part !== null)
              .map((part, index) => (
                <Fragment key={index}>
                  {index > 0 ? " " : null}
                  {part}
                </Fragment>
              )),
      agg: (agg, target) =>
        AGGREGATES.includes(agg) ? (
          labels.agg[agg as Aggregate](target)
        ) : (
          <>
            {agg}({target})
          </>
        ),
      attr: (attr, target) =>
        ATTRIBUTES.includes(attr)
          ? labels.attr[attr as Attribute](target)
          : target,
      scope: (scope, target) =>
        SCOPES.includes(scope) ? labels.scope[scope as Scope](target) : target,
    }),
    [formatConstant, labels],
  );

  return (
    <div
      {...props}
      className={cn(
        "rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground",
        className,
      )}
      data-testid={testId}
    >
      {rules.length === 0 ? (
        <p>{labels.empty}</p>
      ) : (
        <ul className="flex flex-col [&>li:not(:last-child)]:border-b [&>li:not(:last-child)]:border-border">
          {rules.map(rule => (
            <li
              key={rule.name}
              className="flex flex-col gap-1.5 py-2 first:pt-0.5 last:pb-0.5"
            >
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="font-medium break-all text-foreground">
                  {rule.name}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-1.5 leading-4",
                    rule.severity === "error"
                      ? "border-destructive/30 text-destructive"
                      : "border-border",
                  )}
                >
                  {labels.severity[rule.severity]}
                </span>
              </div>
              {rule.condition ? (
                <RuleNodeView
                  node={rule.condition}
                  format={format}
                  showStep={showStep}
                  logic={labels.logic}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RuleNodeView({
  node,
  format,
  showStep,
  logic,
}: {
  node: RuleNode;
  format: RuleFormat<ReactNode>;
  showStep: boolean;
  logic: ValidateRulesLabels["logic"];
}) {
  if (node.kind === "condition") {
    return (
      <p className="leading-6 break-all">
        {formatCondition(node, format, showStep)}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[0.6875rem] font-medium tracking-wide uppercase">
        {logic[node.logic]}
      </p>
      <ul className="flex flex-col gap-0.5 border-l-2 border-border pl-2.5">
        {node.conditions.map((child, index) => (
          <li key={index}>
            <RuleNodeView
              node={child}
              format={format}
              showStep={showStep}
              logic={logic}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
