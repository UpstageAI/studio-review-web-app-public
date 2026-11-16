"use client";

import { EllipsisIcon, EyeIcon, EyeOffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TableHead } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { HIDEABLE_COLUMNS, type HideableColumn } from "./column-visibility";

/**
 * 표 헤더 마지막 칸의 `…` 메뉴. 열마다 눈(보임)·빗금 눈(숨김) 아이콘 항목이 있고, 바꿔도 메뉴가
 * 닫히지 않아 여러 열을 연달아 켜고 끌 수 있다. 체크 항목 의미(`aria-checked`)는 그대로 두고 기본 체크
 * 표시만 숨긴다.
 */
export function ColumnMenu({
  hidden,
  onToggle,
}: {
  hidden: ReadonlySet<HideableColumn>;
  onToggle: (column: HideableColumn) => void;
}) {
  const t = useTranslations("collections");

  return (
    <TableHead className="w-10 text-right">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={t("columns.menu")}
            data-testid="collections-list-button-columns"
          >
            <EllipsisIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-44">
          <DropdownMenuLabel>{t("columns.menuLabel")}</DropdownMenuLabel>
          {HIDEABLE_COLUMNS.map(column => {
            const visible = !hidden.has(column);
            const Icon = visible ? EyeIcon : EyeOffIcon;
            return (
              <DropdownMenuCheckboxItem
                key={column}
                checked={visible}
                onCheckedChange={() => onToggle(column)}
                onSelect={event => event.preventDefault()}
                className={cn(
                  "pr-2 *:data-[slot=dropdown-menu-checkbox-item-indicator]:hidden",
                  !visible && "text-muted-foreground",
                )}
                data-testid={`collections-list-columns-${column}`}
              >
                <Icon aria-hidden />
                {t(`columns.${column}`)}
              </DropdownMenuCheckboxItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </TableHead>
  );
}
