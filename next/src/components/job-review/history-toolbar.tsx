"use client";

import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { memo } from "react";
import { Button } from "@/components/ui/button";
import type { JobRevisionType } from "@/lib/review-api/types";

export type HistorySort = "newest" | "oldest";
export type HistoryTypeFilter = JobRevisionType | null;

const SORTS: readonly HistorySort[] = ["newest", "oldest"];
const TYPES: readonly {
  key: "all" | JobRevisionType;
  value: HistoryTypeFilter;
}[] = [
  { key: "all", value: null },
  { key: "result", value: "result" },
  { key: "structure", value: "structure" },
];

/** 변경 이력 시트의 종류 필터 · 결과 칩 · 정렬. */
export const HistoryToolbar = memo(function HistoryToolbar({
  type,
  onTypeChange,
  resultName,
  onClearResult,
  sort,
  onSortChange,
}: {
  type: HistoryTypeFilter;
  onTypeChange: (type: HistoryTypeFilter) => void;
  /** 결과 하나로 좁혔을 때 그 결과 이름(없으면 `null`). */
  resultName: string | null;
  onClearResult: () => void;
  sort: HistorySort;
  onSortChange: (sort: HistorySort) => void;
}) {
  const t = useTranslations("review.history");
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-2">
      <div
        role="group"
        aria-label={t("filter.label")}
        className="flex items-center gap-1"
      >
        {TYPES.map(item => (
          <Button
            key={item.key}
            type="button"
            size="sm"
            variant={type === item.value ? "secondary" : "ghost"}
            aria-pressed={type === item.value}
            onClick={() => onTypeChange(item.value)}
            data-testid={`job-review-history-filter-button-${item.key}`}
          >
            {t(`filter.${item.key}`)}
          </Button>
        ))}
      </div>
      {resultName !== null ? (
        <span
          className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-border bg-muted/40 py-0.5 pr-0.5 pl-2 text-xs"
          data-testid="job-review-history-result-chip"
        >
          <span className="truncate">
            {t("filter.resultChip", { name: resultName })}
          </span>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t("filter.clearResult", { name: resultName })}
            onClick={onClearResult}
            data-testid="job-review-history-result-chip-clear"
          >
            <XIcon aria-hidden />
          </Button>
        </span>
      ) : null}
      <div
        role="group"
        aria-label={t("sort.label")}
        className="ml-auto flex items-center gap-1"
      >
        {SORTS.map(item => (
          <Button
            key={item}
            type="button"
            size="sm"
            variant={sort === item ? "secondary" : "ghost"}
            aria-pressed={sort === item}
            onClick={() => onSortChange(item)}
            data-testid={`job-review-history-sort-button-${item}`}
          >
            {t(`sort.${item}`)}
          </Button>
        ))}
      </div>
    </div>
  );
});
