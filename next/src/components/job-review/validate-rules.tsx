"use client";

import { useTranslations } from "next-intl";
import { useMemo, type ReactNode } from "react";
import {
  ValidateRules as CoreValidateRules,
  type ValidateRulesLabels,
} from "@/components/studio-ui-kit/validate-rules";
import type { ValidateRule } from "@/lib/review-api/validate-rules";
import { stringifyJson } from "@/lib/review-model";

/**
 * Validate 판정 아래에 Config 에 설정된 규칙을 연한 카드로 보인다(Core `ValidateRules` 에 문구·상수 표기·
 * testid 를 넘기는 래퍼). 상수는 모델 JSON 표기(`stringifyJson`)로 쓴다.
 * `rules` 가 빈 목록이면(Job 응답에 규칙이 없음) 안내만 보인다.
 */
export function ValidateRules({ rules }: { rules: readonly ValidateRule[] }) {
  const t = useTranslations("review.validateRules");
  const labels = useMemo<ValidateRulesLabels>(() => {
    const slot = (node: ReactNode) => () => node;
    const unary =
      (key: "operator.filled" | "operator.empty") =>
      (left: ReactNode, right: ReactNode | null) =>
        t.rich(key, { left: slot(left), right: slot(right) });
    const word =
      (key: "operator.contains" | "operator.matches") =>
      (left: ReactNode, right: ReactNode | null) =>
        t.rich(key, { left: slot(left), right: slot(right) });
    const wrap =
      (
        key:
          | "agg.sum"
          | "agg.count"
          | "agg.min"
          | "agg.max"
          | "attr.confidence"
          | "attr.length"
          | "scope.all"
          | "scope.any",
      ) =>
      (target: ReactNode) =>
        t.rich(key, { target: slot(target) });
    return {
      empty: t("empty"),
      severity: { error: t("severity.error"), warning: t("severity.warning") },
      logic: { and: t("logic.and"), or: t("logic.or") },
      operator: {
        filled: unary("operator.filled"),
        empty: unary("operator.empty"),
        contains: word("operator.contains"),
        matches: word("operator.matches"),
      },
      agg: {
        sum: wrap("agg.sum"),
        count: wrap("agg.count"),
        min: wrap("agg.min"),
        max: wrap("agg.max"),
      },
      attr: {
        confidence: wrap("attr.confidence"),
        length: wrap("attr.length"),
      },
      scope: { all: wrap("scope.all"), any: wrap("scope.any") },
    };
  }, [t]);

  return (
    <CoreValidateRules
      rules={rules}
      formatConstant={stringifyJson}
      labels={labels}
      testId="job-review-validate-rules"
    />
  );
}
