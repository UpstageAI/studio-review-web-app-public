"use client";

import { ListChecksIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { fieldTitle, schemaAt, type SchemaNode } from "@/lib/review-model";
import { toggleField } from "./field-filter";

/**
 * 값 필터 줄 끝의 "필드" 메뉴: Step 결과의 맨 위 필드를 schema 순서로 체크 항목으로 보이고, 끈 필드는
 * 값 패널과 뷰어에서 숨긴다. 항목을 눌러도 메뉴가 닫히지 않아 여럿을 이어서 고를 수 있고, 마지막 남은
 * 필드는 끌 수 없다. 일부를 숨기면 버튼에 "보이는 수 / 전체 수" 를 보인다.
 */
export function FieldsMenu({
  fields,
  visible,
  schema,
  onChange,
}: {
  /** 맨 위 필드 키(schema 순서). */
  fields: readonly string[];
  /** 보이는 키. `null` 이면 모두 보임. */
  visible: readonly string[] | null;
  /** 필드 이름(`title`)을 읽을 Step schema. */
  schema: SchemaNode | null;
  onChange: (visible: readonly string[] | null) => void;
}) {
  const t = useTranslations("review.values.fields");
  const shownSet = useMemo(() => new Set(visible ?? fields), [visible, fields]);
  const options = useMemo(
    () =>
      fields.map(key => ({
        key,
        title: fieldTitle(schemaAt(schema, [key])?.node ?? null, [key]),
      })),
    [fields, schema],
  );
  const shown = shownSet.size;
  const total = fields.length;
  const partial = visible !== null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="default"
          variant={partial ? "secondary" : "outline"}
          aria-label={partial ? t("countLabel", { shown, total }) : undefined}
          data-testid="job-review-values-filter-fields"
          className="cursor-pointer"
        >
          <ListChecksIcon aria-hidden="true" />
          {t("label")}
          {partial ? (
            <span className="text-xs font-normal text-muted-foreground">
              {t("count", { shown, total })}
            </span>
          ) : null}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>{t("menuLabel")}</DropdownMenuLabel>
        <DropdownMenuItem
          disabled={!partial}
          onSelect={event => {
            event.preventDefault();
            onChange(null);
          }}
          data-testid="job-review-values-fields-item-show-all"
        >
          {t("showAll")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {options.map(option => {
          const checked = shownSet.has(option.key);
          const named = option.title !== option.key;
          return (
            <DropdownMenuCheckboxItem
              key={option.key}
              checked={checked}
              disabled={checked && shown === 1}
              onCheckedChange={on =>
                onChange(toggleField(fields, visible, option.key, on === true))
              }
              onSelect={event => event.preventDefault()}
              data-testid="job-review-values-fields-item-toggle"
              data-field-key={option.key}
            >
              <span className="flex min-w-0 flex-col gap-0.5">
                <span
                  className={cn(
                    "min-w-0",
                    named ? "break-words" : "font-mono text-xs break-all",
                  )}
                >
                  {option.title}
                </span>
                {named ? (
                  <span className="min-w-0 font-mono text-xs break-all text-muted-foreground">
                    {option.key}
                  </span>
                ) : null}
              </span>
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 필드를 숨겼을 때 필터 줄 아래의 짧은 안내와 "모두 보기". */
export function HiddenFieldsNotice({
  count,
  onShowAll,
}: {
  count: number;
  onShowAll: () => void;
}) {
  const t = useTranslations("review.values.fields");
  return (
    <p
      className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground"
      data-testid="job-review-values-fields-hidden"
    >
      <span>{t("hidden", { count })}</span>
      <Button
        type="button"
        variant="link"
        size="xs"
        onClick={onShowAll}
        data-testid="job-review-values-fields-button-show-all"
        className="h-auto cursor-pointer px-0 text-xs"
      >
        {t("showAll")}
      </Button>
    </p>
  );
}
