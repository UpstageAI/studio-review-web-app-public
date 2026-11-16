"use client";

import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  DocumentListFilter as CoreDocumentListFilter,
  type DocumentListFilterLabels,
  type DocumentListFilterSummary,
  type DocumentStatusFilter,
} from "@/components/studio-ui-kit/document-list";

export interface DocumentListFilterProps {
  /** 검색 입력 칸 값(입력 즉시). 목록에 적용하는 시점(디바운스)은 호출자가 정한다. */
  query: string;
  onQueryChange: (query: string) => void;
  /** 지금 적용 중인 상태 필터(`effectiveStatusFilter` 결과). */
  status: DocumentStatusFilter;
  onStatusChange: (status: DocumentStatusFilter) => void;
  /** 선택 상자 항목(순서 그대로). `unvisited` 앞에는 구분선을 둔다. */
  statusOptions: readonly DocumentStatusFilter[];
  /** 거르기 전 전체 목록의 문서 수·페이지 수·열어 본 문서 수. */
  summary: DocumentListFilterSummary;
  /** 요약에 열어 본 문서 수를 붙인다. */
  showVisited?: boolean;
  /** 거르는 중이면 거른 결과 수, 아니면 `null`. */
  filteredCount?: number | null;
  /** 고른 문서가 필터에 가려졌다. */
  selectionHidden?: boolean;
  /** 있으면 가려짐 안내 줄에 "필터 지우기" 버튼을 둔다. */
  onClearFilter?: () => void;
}

/**
 * 문서 목록 위 검색 칸·상태 필터·요약 줄·고른 문서 가려짐 안내. 이 앱 문구와 testid 로 Core 필터 바를
 * 그린다. 상태는 호출자가 들고, 감싸는 요소 없이 칼럼의 형제로 그린다.
 */
export function DocumentListFilter(props: DocumentListFilterProps) {
  const labels = useDocumentListFilterLabels();
  return (
    <CoreDocumentListFilter
      {...props}
      labels={labels}
      testId="job-review-document-filter"
      summaryTestId="job-review-document-summary"
    />
  );
}

function useDocumentListFilterLabels(): DocumentListFilterLabels {
  const t = useTranslations("review.documents");
  return useMemo(
    () => ({
      search: t("filter.search"),
      placeholder: t("filter.placeholder"),
      status: t("filter.status"),
      options: {
        all: t("filter.all"),
        flagged: t("filter.flagged"),
        changed: t("filter.changed"),
        recheck: t("filter.recheck"),
        excluded: t("filter.excluded"),
        untouched: t("filter.untouched"),
        unvisited: t("filter.unvisited"),
      },
      summary: summary => t("summary", summary),
      visitedCount: count => t("summaryVisited", { count }),
      filteredCount: count => t("filtered", { count }),
      separator: t("summarySeparator"),
      selectedHidden: t("selectedHidden"),
      clear: t("filter.clear"),
    }),
    [t],
  );
}
