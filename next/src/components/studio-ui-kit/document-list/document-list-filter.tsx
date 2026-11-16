import { Fragment, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  parseStatusFilter,
  type DocumentStatusFilter,
} from "./document-filter";
import { SearchIcon } from "lucide-react";

/** 거르기 전 전체 목록의 문서 수·페이지 수 합계·열어 본 문서 수(`summarizeDocuments` 결과). */
export interface DocumentListFilterSummary {
  count: number;
  pages: number;
  visited: number;
}

export interface DocumentListFilterLabels {
  /** 검색 칸 이름(`aria-label`). */
  search: string;
  /** 검색 칸 자리 표시 문구. */
  placeholder: string;
  /** 상태 선택 상자 이름(`aria-label`). */
  status: string;
  /** 상태 항목 문구. */
  options: Record<DocumentStatusFilter, string>;
  /** 요약 줄 첫 부분(문서 수, 페이지 수). */
  summary: (summary: { count: number; pages: number }) => string;
  /** 요약 줄의 열어 본 문서 수(`showVisited` 일 때). */
  visitedCount: (count: number) => string;
  /** 요약 줄의 거른 결과 수(`filteredCount` 가 있을 때). */
  filteredCount: (count: number) => string;
  /** 요약 줄 부분 사이 구분자. */
  separator: string;
  /** 고른 문서가 필터에 가려졌다는 안내. */
  selectedHidden: string;
  /** 필터 지우기 버튼(`onClearFilter` 가 있을 때). */
  clear: string;
}

export interface DocumentListFilterProps {
  /** 검색 칸 값(입력 즉시). 목록에 적용하는 시점(디바운스)은 호출자가 정한다. */
  query: string;
  onQueryChange: (query: string) => void;
  /** 지금 적용 중인 상태 필터(`effectiveStatusFilter` 결과). */
  status: DocumentStatusFilter;
  onStatusChange: (status: DocumentStatusFilter) => void;
  /** 선택 상자 항목(순서 그대로, `statusFilterOptions` 결과). `unvisited` 앞에는 구분선을 둔다. */
  statusOptions: readonly DocumentStatusFilter[];
  summary: DocumentListFilterSummary;
  /** 요약 줄에 열어 본 문서 수를 붙인다. */
  showVisited?: boolean;
  /** 거르는 중이면 거른 결과 수, 아니면 `null`. */
  filteredCount?: number | null;
  /** 고른 문서가 필터에 가려졌다(`isSelectionHidden` 결과). 안내 줄을 그린다. */
  selectionHidden?: boolean;
  /** 있으면 가려짐 안내 줄에 필터 지우기 버튼을 둔다. 지울 때 디바운스를 거칠지는 호출자가 정한다. */
  onClearFilter?: () => void;
  /** 가려짐 안내 줄 뒤에 그릴 호출자 고유 안내. */
  notices?: ReactNode;
  labels: DocumentListFilterLabels;
  /** 하위 `data-testid` 접두: `-input-search`·`-select-status`·`-option-<값>`·`-hidden`·`-button-clear`. */
  testId?: string;
  /** 요약 줄 `data-testid`(접두 규칙 밖이라 따로 받는다). */
  summaryTestId?: string;
}

const tid = (testId: string | undefined, part: string) =>
  testId ? `${testId}-${part}` : undefined;

/**
 * 문서 목록 위 검색 칸·상태 선택·요약 줄·고른 문서 가려짐 안내. 상태는 호출자가 들고 이 컴포넌트는
 * 그리기만 한다. 감싸는 요소 없이 그리므로 호출자의 세로 배치(간격) 안에 형제로 놓인다.
 */
export function DocumentListFilter({
  query,
  onQueryChange,
  status,
  onStatusChange,
  statusOptions,
  summary,
  showVisited = false,
  filteredCount = null,
  selectionHidden = false,
  onClearFilter,
  notices,
  labels,
  testId,
  summaryTestId,
}: DocumentListFilterProps) {
  return (
    <>
      <div className="flex min-w-0 gap-2">
        <div className="relative min-w-0 flex-1">
          <SearchIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={query}
            onChange={event => onQueryChange(event.target.value)}
            placeholder={labels.placeholder}
            aria-label={labels.search}
            autoComplete="off"
            className="bg-background pl-8 shadow-xs"
            data-testid={tid(testId, "input-search")}
          />
        </div>
        <Select
          value={status}
          onValueChange={value => onStatusChange(parseStatusFilter(value))}
        >
          <SelectTrigger
            className="shrink-0 bg-background shadow-xs"
            aria-label={labels.status}
            data-testid={tid(testId, "select-status")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map(value => (
              <Fragment key={value}>
                {/* 편집 상태 필터와 검수 진행(열어 봄) 필터를 선으로 나눈다. */}
                {value === "unvisited" ? <SelectSeparator /> : null}
                <SelectItem
                  value={value}
                  data-testid={tid(testId, `option-${value}`)}
                >
                  {labels.options[value]}
                </SelectItem>
              </Fragment>
            ))}
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs text-muted-foreground" data-testid={summaryTestId}>
        {[
          labels.summary({ count: summary.count, pages: summary.pages }),
          showVisited ? labels.visitedCount(summary.visited) : null,
          filteredCount !== null ? labels.filteredCount(filteredCount) : null,
        ]
          .filter(part => part !== null)
          .join(labels.separator)}
      </p>
      {selectionHidden ? (
        <div
          className="flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
          data-testid={tid(testId, "hidden")}
        >
          <p>{labels.selectedHidden}</p>
          {onClearFilter ? (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto cursor-pointer p-0 text-xs"
              onClick={onClearFilter}
              data-testid={tid(testId, "button-clear")}
            >
              {labels.clear}
            </Button>
          ) : null}
        </div>
      ) : null}
      {notices}
    </>
  );
}
