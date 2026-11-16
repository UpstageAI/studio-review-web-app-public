"use client";

import { FunnelIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ALL_SOURCES, toggleSource, type SourceFilter } from "./list-filters";
import { KNOWN_SOURCE_TYPES } from "./source-label";

interface FilterHeadProps {
  column: "source";
  value: SourceFilter;
  onChange: (value: SourceFilter) => void;
  disabled?: boolean;
}

/**
 * 누르면 출처를 여러 개 고르는 메뉴가 열리는 열 헤더. 항목마다 설명 한 줄을 함께 보이고,
 * 출처를 고르거나 풀어도 메뉴는 열려 있다. 필터가 켜져 있으면 라벨·아이콘을 강조하고 고른 수를 붙인다.
 */
export function FilterHead(props: FilterHeadProps) {
  const t = useTranslations("collections");
  const { column, value, onChange, disabled } = props;
  const label = t("columns.source");
  const count = value.length;
  const active = count > 0;

  return (
    <TableHead>
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            className={cn(
              "inline-flex max-w-full items-center gap-1 rounded-sm outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50",
              active ? "text-foreground" : "text-muted-dark",
            )}
            aria-label={
              active
                ? t("filter.ariaFilterByCount", { column: label, count })
                : t("filter.ariaFilterBy", { column: label })
            }
            data-active={active ? "true" : "false"}
            data-testid={`collections-list-button-filter-${column}`}
          >
            <span className="truncate">{label}</span>
            {active && <span className="shrink-0 tabular-nums">({count})</span>}
            <FunnelIcon
              aria-hidden
              className={cn(
                "size-3.5 shrink-0",
                active ? "fill-current" : "opacity-60",
              )}
            />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuCheckboxItem
            checked={!active}
            onCheckedChange={() => onChange(ALL_SOURCES)}
            onSelect={event => event.preventDefault()}
            data-testid={`collections-list-filter-${column}-all`}
          >
            {t("filter.all")}
          </DropdownMenuCheckboxItem>
          <DropdownMenuSeparator />
          {KNOWN_SOURCE_TYPES.map(type => (
            <DropdownMenuCheckboxItem
              key={type}
              checked={value.includes(type)}
              onCheckedChange={() => onChange(toggleSource(value, type))}
              onSelect={event => event.preventDefault()}
              className="items-start"
              data-testid={`collections-list-filter-${column}-${type}`}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span>{t(`source.${type}`)}</span>
                <span className="text-xs whitespace-normal text-muted-foreground">
                  {t(`sourceHint.${type}`)}
                </span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TableHead>
  );
}
