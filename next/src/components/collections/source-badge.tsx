"use client";

import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { SearchCollectionSummary } from "@/lib/review-api/types";
import { cn } from "@/lib/utils";
import { sourceTypeKey } from "./source-label";

/**
 * Collection 출처(`source.type`) 배지. 아는 유형이면 번역 문구, 모르는 유형이면 원문을 보인다.
 * Workflow 의 기본 Collection(`is_default`, 실행 결과가 자동으로 쌓이는 곳)이면 배지에 마우스를
 * 올리거나 키보드로 포커스했을 때 그 설명을 툴팁으로 보인다(화면 낭독기도 설명으로 읽는다). 기본
 * Collection 은 거의 모두 "Workflow 연결" 출처라 따로 "기본" 배지를 두지 않고, 출처가 없을 때만
 * "기본" 배지로 대신한다. 출처도 없고 기본도 아니면 아무것도 그리지 않는다.
 * `truncate` 면 배지가 칸 폭을 넘지 않고 글자를 말줄임한다. 이때 기본 Collection 이 아닌 배지는
 * `title` 로 전체 라벨을 보인다(기본 Collection 배지는 이미 툴팁이 있어 겹쳐 달지 않는다).
 */
export function SourceBadge({
  collection,
  truncate = false,
}: {
  collection: Pick<SearchCollectionSummary, "source" | "is_default">;
  truncate?: boolean;
}) {
  const t = useTranslations("collections");
  const type = collection.source?.type;
  const isDefault = collection.is_default === true;
  if (!type && !isDefault) return null;
  const key = type ? sourceTypeKey(type) : null;
  const label = !type ? t("defaultBadge") : key ? t(`source.${key}`) : type;
  const content = truncate ? <span className="truncate">{label}</span> : label;
  if (!isDefault) {
    return (
      <Badge
        variant="outline"
        className={cn(truncate && "max-w-full")}
        title={truncate ? label : undefined}
      >
        {content}
      </Badge>
    );
  }
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <Badge
            variant="outline"
            tabIndex={0}
            className={cn(
              "cursor-default outline-none",
              truncate && "max-w-full",
            )}
            data-testid="collection-source-badge-default"
          >
            {content}
          </Badge>
        </TooltipTrigger>
        <TooltipContent>{t("defaultCollectionHint")}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
