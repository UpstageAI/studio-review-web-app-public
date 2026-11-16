"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { getReviewProgress } from "@/lib/review-api/client";
import { useResource } from "@/lib/use-resource";
import { cn } from "@/lib/utils";
import type { SearchCollectionDetail } from "@/lib/review-api/types";
import { reviewableJobs } from "./review-overview-model";

/**
 * 검수 진행 현황 카드: "검수 완료 N / M" + 막대 + "검수 중 K" + 분모 기준 안내. 열 때마다 앱 DB 에서 다시 센다.
 * Collection 요약 카드 줄에 들어가며, 줄 안 너비는 `className` 으로 정한다. `action` 은 카드 오른쪽
 * 끝에 세로 가운데로 붙고, 불러오는 중이나 오류일 때도 보인다. `action` 안에서 `absolute` 로 띄운
 * 안내는 그 아래에 놓인다.
 */
export function ReviewProgress({
  collection,
  collectionId,
  className,
  action,
}: {
  collection: SearchCollectionDetail;
  collectionId: string;
  className?: string;
  action?: ReactNode;
}) {
  const t = useTranslations("collections.progress");
  const locale = useLocale();
  const state = useResource(collectionId, signal =>
    getReviewProgress(collectionId, { signal }),
  );

  const total = reviewableJobs(collection);
  const number = (value: number) => value.toLocaleString(locale);

  return (
    <section
      className={cn(
        "flex min-w-0 items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-xs",
        className,
      )}
      aria-labelledby="review-progress-title"
      data-testid="collection-detail-progress"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2
          id="review-progress-title"
          className="text-xs font-medium text-muted-dark"
        >
          {t("label")}
        </h2>
        {state.phase === "loading" && (
          <p className="text-sm text-muted-foreground">{t("loading")}</p>
        )}
        {/* 실패는 문구만 보인다 — 오류 값은 들고 있지만 코드·재시도를 내지 않는다. 다시 세려면 화면을 다시 연다. */}
        {state.phase === "error" && (
          <p role="status" className="text-sm text-destructive">
            {t("error")}
          </p>
        )}
        {state.phase === "ready" && (
          <ProgressCounts
            done={state.data.done}
            total={total}
            label={t("label")}
            doneText={
              total === null
                ? t("doneOnly", { done: number(state.data.done) })
                : t("done", {
                    done: number(state.data.done),
                    total: number(total),
                  })
            }
            inProgressText={t("inProgress", {
              count: number(state.data.in_progress),
            })}
          />
        )}
        {/* 분모는 Collection 의 Job 수에서 센 값이라 아래 표의 기본 보기("차례로 검수하기" 대상)와
            다를 수 있다. 그 기준을 막대 밑에 적는다. */}
        {total !== null && (
          <p
            className="text-xs text-muted-foreground"
            data-testid="collection-detail-progress-basis"
          >
            {t("basis")}
          </p>
        )}
      </div>
      {action ? (
        <div className="relative flex shrink-0 flex-col items-end">
          {action}
        </div>
      ) : null}
    </section>
  );
}

function ProgressCounts({
  done,
  total,
  label,
  doneText,
  inProgressText,
}: {
  done: number;
  total: number | null;
  label: string;
  doneText: string;
  inProgressText: string;
}) {
  const value = total === null ? done : Math.min(done, total);
  const percent = total ? (value / total) * 100 : 0;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-lg font-semibold text-foreground">
          {doneText}
        </span>
        <span className="text-sm text-muted-dark">{inProgressText}</span>
      </div>
      {total !== null && (
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={value}
          aria-valuetext={doneText}
          className="h-2 w-full overflow-hidden rounded-full bg-muted"
          data-testid="collection-detail-progress-bar"
        >
          <div
            className="h-full rounded-full bg-primary transition-[width]"
            style={{ width: `${percent}%` }}
          />
        </div>
      )}
    </div>
  );
}
