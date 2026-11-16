"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { isValidateStepType } from "@/lib/review-model";
import { cn } from "@/lib/utils";
import { validationIssuesForDocument } from "./document-verdicts";
import { useJobReview } from "./job-review-context";
import { useStepTabLabel } from "./use-step-tab-label";

/**
 * 값 탭(Validate 가 아닌 Step) 결과 위 검증 요약: 선택 문서에 실패(red), 경고(yellow) 판정의 Validate
 * 결과가 있으면 그 결과와 통과하지 못한 원본 근거(규칙 이름, 심각도, 식)를 짧게 보이고, 그 Validate
 * 탭으로 옮기는 버튼을 둔다. 판정은 지금 편집본 기준이라 판정을 green 으로 고치면 사라진다.
 */
export function ValidationSummary() {
  const t = useTranslations("review.validationSummary");
  const { state, dispatch, job, selected, stepTabs, activeStepTab, saving } =
    useJobReview();
  const labelOf = useStepTabLabel();
  const steps = state.session?.current.steps;
  const documentId = selected?.document.document_id ?? null;
  const issues = useMemo(
    () =>
      documentId === null
        ? []
        : validationIssuesForDocument(job, steps, documentId),
    [job, steps, documentId],
  );

  // Validate 탭 자체와 값 탭이 아닌 탭에서는 그리지 않는다(판정 세그먼트가 이미 보인다).
  const activeStepId = activeStepTab?.stepId ?? null;
  const activeStep =
    activeStepId !== null && steps && Object.hasOwn(steps, activeStepId)
      ? steps[activeStepId]
      : undefined;
  if (
    issues.length === 0 ||
    activeStepTab?.kind !== "values" ||
    isValidateStepType(activeStep?.type)
  ) {
    return null;
  }

  // Studio 알림 상자처럼 실패가 하나라도 있으면 오류 색, 경고만 있으면 경고 색으로 칠한다.
  const failed = issues.some(issue => issue.verdict === "red");
  return (
    <section
      aria-label={t("label")}
      className={cn(
        "flex min-w-0 flex-col gap-2 rounded-lg border px-3 py-2.5 text-xs",
        failed
          ? "border-state-error/30 bg-state-error-background"
          : "border-state-warning/40 bg-state-warning-background",
      )}
      data-testid="job-review-validation-summary"
    >
      {issues.map(issue => {
        const tab = stepTabs.find(
          item => item.kind === "values" && item.stepId === issue.stepId,
        );
        const name = tab ? labelOf(tab).full : issue.stepName;
        return (
          <div key={issue.resultId} className="flex min-w-0 flex-col gap-1">
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
              <p className="min-w-0 text-foreground">
                <span
                  className={cn(
                    issue.verdict === "red"
                      ? "font-medium text-state-error-foreground"
                      : "font-medium text-state-warning-foreground",
                  )}
                >
                  {t(`verdict.${issue.verdict}`)}
                </span>{" "}
                <span className="break-words">{name}</span>
              </p>
              {tab ? (
                <Button
                  type="button"
                  variant="link"
                  size="sm"
                  disabled={saving}
                  onClick={() => dispatch({ type: "SET_STEP_TAB", tab })}
                  className="h-auto cursor-pointer p-0 text-xs"
                  data-testid="job-review-validation-summary-button-open"
                >
                  {t("open")}
                </Button>
              ) : null}
            </div>
            {issue.failedChecks.length > 0 ? (
              <ul className="flex min-w-0 flex-col gap-0.5 text-muted-foreground">
                {issue.failedChecks.map((check, index) => (
                  <li
                    key={`${check.name ?? ""}#${index}`}
                    className="break-words"
                  >
                    {[check.name, check.severity]
                      .filter(part => part !== undefined && part !== "")
                      .join(", ")}
                    {check.reason ? (
                      <span className="font-mono">
                        {check.name || check.severity ? ": " : ""}
                        {check.reason}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}
