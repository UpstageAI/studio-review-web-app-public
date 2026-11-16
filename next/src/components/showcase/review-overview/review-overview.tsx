"use client";

import { useLocale, useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type {
  ReviewProgress,
  ReviewProgressOverview,
  SearchCollectionSummary,
} from "@/lib/review-api/types";
import { reviewableJobs } from "./review-overview-model";

/**
 * 목록 위 검수 현황 카드 줄: 검수 중인 Job, 검수 완료한 Job, 검수가 진행 중인 Collection. 이 앱 DB 에
 * 남은 기록을 모든 Collection 에서 센다(로그인이 없어 이 서버를 쓰는 모든 사람의 기록).
 */
export function ReviewOverviewCards({
  overview,
}: {
  overview: ReviewProgressOverview["overview"] | null;
}) {
  const t = useTranslations("collections.overview");
  const locale = useLocale();
  const stats = [
    { key: "inProgress", value: overview?.in_progress },
    { key: "done", value: overview?.done },
    { key: "collections", value: overview?.collections_in_progress },
  ] as const;
  return (
    <section
      aria-label={t("label")}
      className="flex flex-col gap-2"
      data-testid="collections-list-overview"
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {stats.map(stat => (
          <dl
            key={stat.key}
            className="flex min-w-0 flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-xs"
          >
            <dt className="text-xs font-medium text-muted-dark">
              {t(stat.key)}
            </dt>
            <dd className="text-2xl font-semibold text-foreground">
              {stat.value === undefined ? (
                <Skeleton className="h-8 w-12" />
              ) : (
                stat.value.toLocaleString(locale)
              )}
            </dd>
          </dl>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{t("hint")}</p>
    </section>
  );
}

/**
 * "검수" 열 칸: 완료 수(분모가 있으면 "완료 n / m" 과 가는 막대)와 검수 중 수. 기록이 없으면 "검수 전".
 * `compact` 는 높이가 정해진 카드용으로, 글자를 한 줄에 줄여 넣고 막대를 칸 너비에 맞춘다.
 */
export function ReviewProgressCell({
  row,
  counts,
  loading,
  compact = false,
}: {
  row: SearchCollectionSummary;
  counts: Record<string, ReviewProgress> | null;
  loading: boolean;
  compact?: boolean;
}) {
  const t = useTranslations("collections.reviewCell");
  const locale = useLocale();
  if (loading || !counts) {
    return loading ? <Skeleton className="h-4 w-20" /> : <span>—</span>;
  }
  const progress = counts[row.id];
  if (!progress || (progress.done === 0 && progress.in_progress === 0)) {
    return <span className="text-muted-foreground">{t("none")}</span>;
  }
  const total = reviewableJobs(row);
  const percent =
    total && total > 0
      ? Math.min(100, Math.round((progress.done / total) * 100))
      : null;
  // 표의 다른 수처럼 locale 형식(천 단위 구분)으로 보인다.
  const format = (value: number) => value.toLocaleString(locale);
  const doneText =
    total !== null
      ? t("done", { done: format(progress.done), total: format(total) })
      : t("doneOnly", { done: format(progress.done) });
  const inProgressText =
    progress.in_progress > 0
      ? t("inProgress", { count: format(progress.in_progress) })
      : null;
  const bar =
    percent !== null ? (
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total ?? 0}
        aria-valuenow={Math.min(progress.done, total ?? 0)}
        aria-label={t("bar")}
        className={cn(
          "h-1 overflow-hidden rounded-full bg-muted",
          compact ? "w-full" : "w-28",
        )}
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${percent}%` }}
        />
      </div>
    ) : null;
  if (compact) {
    const summary = inProgressText
      ? `${doneText}, ${inProgressText}`
      : doneText;
    return (
      <div
        className="flex w-full min-w-0 flex-col items-end gap-1"
        data-testid="collections-list-review-progress"
      >
        <span className="max-w-full truncate text-foreground" title={summary}>
          {summary}
        </span>
        {bar}
      </div>
    );
  }
  return (
    <div
      className="flex min-w-32 flex-col gap-1.5"
      data-testid="collections-list-review-progress"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        <span className="text-foreground">{doneText}</span>
        {inProgressText ? (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-dark">
            {inProgressText}
          </span>
        ) : null}
      </div>
      {bar}
    </div>
  );
}
