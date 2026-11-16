"use client";

import { ArrowUpDownIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ListOrder } from "@/lib/review-api/types";

/** 서버 정렬 순서(`order`) 선택. 바꾸면 목록 전체 순서가 바뀌고 1 페이지부터 다시 받는다. */
export function OrderSelect({
  value,
  onChange,
  disabled,
  id = "collections-list-order",
  testId = "collections-list-select-order",
  compact = false,
}: {
  value: ListOrder;
  onChange: (order: ListOrder) => void;
  disabled?: boolean;
  id?: string;
  testId?: string;
  /** 보이는 "정렬 순서" 글자 대신 아이콘을 둔다(글자는 화면 낭독기용으로 남김). 도구 막대용. */
  compact?: boolean;
}) {
  const t = useTranslations("collections");
  // 항목 testid 는 트리거와 같은 이름에서 element 만 바꾼다(collections-list-option-order-asc 등).
  const optionTestId = testId.replace("-select-", "-option-");
  return (
    <div className="flex items-center gap-2">
      <label
        htmlFor={id}
        className={compact ? "sr-only" : "text-sm text-muted-dark"}
      >
        {t("sort.order")}
      </label>
      <Select
        value={value}
        onValueChange={next => onChange(next === "asc" ? "asc" : "desc")}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="shadow-xs" data-testid={testId}>
          {compact ? (
            <ArrowUpDownIcon
              aria-hidden="true"
              className="size-4 text-muted-foreground"
            />
          ) : null}
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="desc" data-testid={`${optionTestId}-desc`}>
            {t("sort.newestResults")}
          </SelectItem>
          <SelectItem value="asc" data-testid={`${optionTestId}-asc`}>
            {t("sort.oldestResults")}
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
