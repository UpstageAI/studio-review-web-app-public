"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { ReviewStatusValue } from "@/lib/review-api/types";

export type ReviewFilterValue = "all" | ReviewStatusValue;

const VALUES: readonly ReviewFilterValue[] = [
  "all",
  "pending",
  "in_progress",
  "done",
];

/**
 * Job 표의 검수 상태 필터(전체, 검수 전, 검수 중, 검수 완료). Studio 탭 목록처럼 회색 바탕 띠 위에서
 * 고른 항목만 흰 바탕으로 떠 보인다. 묶음 이름은 화면 낭독기로만 읽히고, 누름 상태는 `aria-pressed` 로 알린다.
 */
export function ReviewStatusFilter({
  value,
  onChange,
}: {
  value: ReviewFilterValue;
  onChange: (value: ReviewFilterValue) => void;
}) {
  const t = useTranslations("collections.reviewFilter");
  const labelId = useId();

  return (
    <div className="flex items-center gap-2">
      <span id={labelId} className="sr-only">
        {t("label")}
      </span>
      <div
        role="group"
        aria-labelledby={labelId}
        // 아주 좁은 화면에서 줄이 바뀌어도 회색 띠가 항목을 감싸도록 높이는 최솟값으로만 둔다.
        className="inline-flex min-h-8 flex-wrap items-center gap-0.5 rounded-lg bg-muted p-1"
        data-testid="collection-detail-filter-review-status"
      >
        {VALUES.map(item => (
          <button
            key={item}
            type="button"
            aria-pressed={item === value}
            onClick={() => onChange(item)}
            className="h-6 cursor-pointer rounded-md px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
            data-testid={`collection-detail-filter-review-status-${item}`}
          >
            {t(item)}
          </button>
        ))}
      </div>
    </div>
  );
}
