"use client";

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
} from "@/components/ui/pagination";
import { cn } from "@/lib/utils";

/**
 * 커서 블록 목록의 이전 · 페이지 번호 · 다음.
 *
 * shadcn `PaginationPrevious`/`PaginationNext` 는 링크(`<a>`)라 비활성을 표현할 수 없어 같은 스타일의
 * `<button>` 으로 그린다. 번호는 넓은 화면에서만 보이고, 좁은 화면에서는 "N 페이지" 문구로 대신한다.
 * 넘길 페이지가 없으면(첫 페이지이자 마지막 페이지) 그리지 않는다.
 */
export function CursorPagination({
  page,
  pageNumbers,
  canGoBack,
  hasMore,
  loading,
  onPrevious,
  onNext,
  onGoTo,
  testIdPrefix,
  className,
}: {
  page: number;
  pageNumbers: number[];
  canGoBack: boolean;
  hasMore: boolean;
  /** 다른 블록을 받는 중이거나 받지 못했을 때 이동을 막는다. */
  loading: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onGoTo: (page: number) => void;
  testIdPrefix: string;
  className?: string;
}) {
  const t = useTranslations("collections.pagination");
  if (!canGoBack && !hasMore) return null;

  const stepClassName = cn(
    buttonVariants({ variant: "ghost", size: "sm" }),
    "gap-1 disabled:pointer-events-none disabled:opacity-50",
  );

  return (
    <Pagination aria-label={t("label")} className={className}>
      <PaginationContent>
        <PaginationItem>
          <button
            type="button"
            onClick={onPrevious}
            disabled={!canGoBack || loading}
            className={cn(stepClassName, "pl-2")}
            data-testid={`${testIdPrefix}-pagination-previous`}
          >
            <ChevronLeftIcon aria-hidden />
            <span>{t("previous")}</span>
          </button>
        </PaginationItem>
        {pageNumbers.map(item => (
          <PaginationItem key={item} className="hidden sm:block">
            <button
              type="button"
              onClick={() => onGoTo(item)}
              disabled={loading && item !== page}
              aria-current={item === page ? "page" : undefined}
              aria-label={t("goTo", { page: item })}
              className={cn(
                buttonVariants({
                  variant: item === page ? "outline" : "ghost",
                  size: "sm",
                }),
                "min-w-8 tabular-nums disabled:pointer-events-none disabled:opacity-50",
              )}
              data-testid={`${testIdPrefix}-pagination-page-${item}`}
            >
              {item}
            </button>
          </PaginationItem>
        ))}
        <PaginationItem className="sm:hidden">
          <span className="px-3 text-sm text-muted-foreground">
            {t("page", { page })}
          </span>
        </PaginationItem>
        <PaginationItem>
          <button
            type="button"
            onClick={onNext}
            disabled={!hasMore || loading}
            className={cn(stepClassName, "pr-2")}
            data-testid={`${testIdPrefix}-pagination-next`}
          >
            <span>{t("next")}</span>
            <ChevronRightIcon aria-hidden />
          </button>
        </PaginationItem>
      </PaginationContent>
    </Pagination>
  );
}
