"use client";

import { SlidersHorizontalIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * Job 표 "표시 옵션" 메뉴: 이전 실행도 보기(끄면 같은 입력 파일 묶음당 마지막 실행만), 최신 설정 결과만
 * 보기. 항목마다 지금 상태를 알리는 한 줄 설명을 붙이고, 체크 항목을 눌러도 메뉴가 닫히지 않아 둘을
 * 이어서 바꿀 수 있으며, 기본값(`JOB_VIEW_DEFAULTS`)과 다른 옵션 수를 버튼에 보인다. 한 줄 설명은 항목
 * 안의 글이라 항목 이름과 함께 읽히므로 `aria-describedby` 로 다시 잇지 않는다.
 *
 * 이전 실행도 보기가 꺼져 있으면 파일 묶음당 최신 실행을 먼저 고른 뒤 최신 설정 필터를 적용하므로,
 * 최신 설정 결과만 보기를 꺼도 다시 실행되기 전 설정의 Job 이 보이지 않는다. 그때만 그 항목에 툴팁으로
 * 알린다.
 */
/** 표시 옵션의 처음 값. 버튼의 숫자는 이것과 다른 옵션만 센다. */
export const JOB_VIEW_DEFAULTS = {
  allHistory: false,
  latestOnly: true,
} as const;

export function JobViewOptions({
  allHistory,
  onAllHistoryChange,
  latestOnly,
  onLatestOnlyChange,
}: {
  allHistory: boolean;
  onAllHistoryChange: (value: boolean) => void;
  latestOnly: boolean;
  onLatestOnlyChange: (value: boolean) => void;
}) {
  const t = useTranslations("collections.jobs");
  const changed =
    Number(allHistory !== JOB_VIEW_DEFAULTS.allHistory) +
    Number(latestOnly !== JOB_VIEW_DEFAULTS.latestOnly);
  const [latestTipOpen, setLatestTipOpen] = useState(false);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="default"
          className="shadow-xs"
          data-testid="collection-detail-button-view-options"
        >
          <SlidersHorizontalIcon aria-hidden="true" />
          {t("viewOptions")}
          {changed > 0 ? (
            <Badge data-testid="collection-detail-view-options-count">
              {changed}
            </Badge>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuCheckboxItem
          checked={allHistory}
          onCheckedChange={value => onAllHistoryChange(value === true)}
          onSelect={event => event.preventDefault()}
          data-testid="collection-detail-switch-all-history"
        >
          <span className="flex flex-col gap-0.5">
            <span>{t("allHistory")}</span>
            <span className="text-xs text-muted-foreground">
              {t(allHistory ? "allHistoryHintOn" : "allHistoryHintOff")}
            </span>
          </span>
        </DropdownMenuCheckboxItem>
        <TooltipProvider delayDuration={200}>
          <Tooltip
            open={!allHistory && latestTipOpen}
            onOpenChange={setLatestTipOpen}
          >
            <TooltipTrigger asChild>
              <DropdownMenuCheckboxItem
                checked={latestOnly}
                onCheckedChange={value => onLatestOnlyChange(value === true)}
                onSelect={event => event.preventDefault()}
                data-testid="collection-detail-switch-latest-only"
              >
                <span className="flex flex-col gap-0.5">
                  <span>{t("latestOnly")}</span>
                  <span className="text-xs text-muted-foreground">
                    {t(latestOnly ? "latestOnlyHintOn" : "latestOnlyHintOff")}
                  </span>
                  {/* 툴팁 안내는 마우스로만 보이므로 화면 낭독기에는 항목 안 글로 함께 읽힌다. */}
                  {allHistory ? null : (
                    <span className="sr-only">
                      {t("latestOnlyGroupedTooltip")}
                    </span>
                  )}
                </span>
              </DropdownMenuCheckboxItem>
            </TooltipTrigger>
            {allHistory ? null : (
              <TooltipContent
                side="bottom"
                className="max-w-80"
                data-testid="collection-detail-tooltip-latest-only"
              >
                {t("latestOnlyGroupedTooltip")}
              </TooltipContent>
            )}
          </Tooltip>
        </TooltipProvider>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
