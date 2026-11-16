"use client";

import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { SortColumn, SortState } from "./sort-rows";

const ARIA_SORT = {
  asc: "ascending",
  desc: "descending",
} as const;

/** 누르면 정렬 상태를 바꾸는 열 헤더. 현재 정렬을 `aria-sort` 와 아이콘으로 보인다. */
export function SortableHead({
  column,
  label,
  sort,
  onSort,
  align = "left",
  describedBy,
}: {
  column: SortColumn;
  label: string;
  sort: SortState | null;
  onSort: (column: SortColumn) => void;
  align?: "left" | "right";
  /** 정렬 범위 안내처럼 버튼에 덧붙여 읽을 설명의 id. */
  describedBy?: string;
}) {
  const t = useTranslations("collections");
  const direction = sort?.column === column ? sort.direction : null;
  const Icon =
    direction === "asc"
      ? ArrowUpIcon
      : direction === "desc"
        ? ArrowDownIcon
        : ArrowUpDownIcon;

  return (
    <TableHead
      aria-sort={direction ? ARIA_SORT[direction] : "none"}
      className={cn(align === "right" && "text-right")}
    >
      <button
        type="button"
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50",
          align === "right" && "flex-row-reverse",
          direction ? "text-foreground" : "text-muted-dark",
        )}
        aria-label={t("sort.ariaSortBy", { column: label })}
        aria-describedby={describedBy}
        data-testid={`collections-list-button-sort-${column}`}
        onClick={() => onSort(column)}
      >
        <span className="truncate">{label}</span>
        <Icon
          aria-hidden
          className={cn("size-3.5 shrink-0", !direction && "opacity-60")}
        />
      </button>
    </TableHead>
  );
}
