"use client";

import { ChevronLeftIcon, ChevronRightIcon, RefreshCwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ReviewQueueControls } from "./use-review-queue";

/**
 * 검수 큐 바(공통 상단 바 안): 이전과 다음 Job, 다음 Job 의 파일명, 남은 수. "완료하면 다음 Job 열기" 는
 * 설정 메뉴에 있다. 큐의 끝에서는 새로 고침 아이콘 버튼 "새 Job 확인" 이 생기고, 확인하는 동안 아이콘이
 * 돈다. 새 Job 이 있으면 바로 열고, 없으면 그 안내가 잠시 보였다가 사라진다. 경계의 버튼은 남겨 두고
 * `aria-disabled` 로만 막는다(포커스를 잃지 않게).
 *
 * 높이가 정해진 공통 상단 바 안이라 늘 한 줄로 둔다. 긴 다음 파일명과 안내는 말줄임하고 전체 글은
 * `title` 로 보이며, 좁은 화면(`lg` 미만)에서는 다음 파일명, 남은 수, 안내를 숨기고 버튼만 남긴다(안내는
 * 화면 낭독기로는 계속 읽힌다).
 */
export function ReviewQueueBar({
  controls,
}: {
  controls: ReviewQueueControls;
}) {
  const t = useTranslations("review.queue");
  const {
    previous,
    next,
    remaining,
    more,
    loading,
    refreshing,
    notice,
    goPrevious,
    goNext,
    refresh,
  } = controls;
  const busy = loading || refreshing;
  const canPrevious = previous !== null && !busy;
  const canNext = (next !== null || more) && !busy;
  const atEnd = next === null && !more;
  const extraFiles = next ? Math.max(next.file_count - 1, 0) : 0;
  const nextLabel = next
    ? `${t("nextJob", { name: next.filename ?? next.job_id })}${
        extraFiles > 0 ? ` ${t("nextMore", { count: extraFiles })}` : ""
      }`
    : null;
  const noticeText =
    notice?.kind === "noMore"
      ? t("noMore")
      : notice?.kind === "noNew"
        ? t("noNew")
        : notice?.kind === "revisitable"
          ? t("revisitable", { count: notice.count })
          : notice?.kind === "loadFailed"
            ? t("loadFailed")
            : null;

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="flex min-w-0 flex-nowrap items-center gap-x-3 text-sm"
      data-testid="job-review-queue"
    >
      {/* 안내는 왼쪽에 두어, 나타나고 사라져도 오른쪽 버튼 자리가 움직이지 않게 한다. */}
      <span
        role="status"
        title={noticeText ?? undefined}
        className={cn(
          "min-w-0 truncate empty:hidden max-lg:sr-only",
          notice?.kind === "loadFailed"
            ? "text-destructive"
            : "text-muted-foreground",
        )}
        data-testid="job-review-queue-notice"
      >
        {noticeText}
      </span>
      {loading ? (
        <span className="shrink-0 whitespace-nowrap text-muted-foreground">
          {t("loading")}
        </span>
      ) : null}
      {nextLabel !== null ? (
        <span
          className="min-w-0 max-w-64 truncate text-muted-dark max-lg:hidden"
          title={nextLabel}
          data-testid="job-review-queue-next-label"
        >
          {nextLabel}
        </span>
      ) : atEnd ? (
        <span
          className="min-w-0 truncate text-muted-dark max-lg:hidden"
          title={t("end")}
        >
          {t("end")}
        </span>
      ) : null}
      <span
        className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs font-medium whitespace-nowrap text-muted-dark tabular-nums max-lg:hidden"
        data-testid="job-review-queue-remaining"
      >
        {more
          ? t("remainingMore", { count: remaining })
          : t("remaining", { count: remaining })}
      </span>
      {/* 이전과 다음은 한 묶음 버튼으로 둔다. */}
      <div className="inline-flex h-8 shrink-0 items-center rounded-lg border border-border bg-background shadow-xs">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-disabled={canPrevious ? undefined : true}
          onClick={() => {
            if (canPrevious) goPrevious();
          }}
          className={cn(
            "h-full rounded-r-none px-2.5",
            !canPrevious && "cursor-not-allowed opacity-50",
          )}
          data-testid="job-review-queue-button-previous"
        >
          <ChevronLeftIcon aria-hidden="true" /> {t("previous")}
        </Button>
        <span aria-hidden="true" className="h-4 w-px bg-border" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-disabled={canNext ? undefined : true}
          onClick={() => {
            if (canNext) void goNext();
          }}
          className={cn(
            "h-full rounded-l-none px-2.5",
            !canNext && "cursor-not-allowed opacity-50",
          )}
          data-testid="job-review-queue-button-next"
        >
          {t("next")} <ChevronRightIcon aria-hidden="true" />
        </Button>
      </div>
      {atEnd ? (
        <Button
          type="button"
          variant="outline"
          size="default"
          disabled={busy}
          onClick={() => void refresh()}
          title={t("refreshHint")}
          className="shrink-0 cursor-pointer bg-background shadow-xs"
          data-testid="job-review-queue-button-refresh"
        >
          <RefreshCwIcon
            aria-hidden="true"
            className={cn(refreshing && "animate-spin")}
          />
          {refreshing ? t("refreshing") : t("refresh")}
        </Button>
      ) : null}
    </div>
  );
}
