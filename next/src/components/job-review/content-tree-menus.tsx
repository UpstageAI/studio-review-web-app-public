"use client";

// 값 트리의 노드 조각: 묶음, 항목 오류 문구, 필드 추가 메뉴, 노드 메뉴(비우기, 필드 삭제, 항목 이동, 삭제).
// 트리(`content-tree.tsx`)와 배열 표(`array-table.tsx`)가 함께 쓴다.

import { EllipsisVerticalIcon, PlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  allowsNull,
  isJsonObject,
  isRequiredKey,
  missingProperties,
  toPointer,
  type JsonPath,
  type JsonValue,
  type SchemaMatch,
} from "@/lib/review-model";
import { useTree, type Parent } from "./content-tree-context";
import { removalFocusPath } from "./content-tree-focus";
import type { FieldError } from "./field-errors";

/** 묶음, 항목, 루트 객체를 가리키는 오류 문구. 경고(항목 수)는 흐린 색으로, 읽어 주지 않는다. */
export function NodeError({ error }: { error: FieldError }) {
  const isError = error.severity === "error";
  return (
    <p
      role={isError ? "alert" : undefined}
      data-testid="job-review-field-group-error"
      className={cn(
        "px-2 pb-1 text-xs break-words",
        isError ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {error.message}
    </p>
  );
}

export function AddFieldMenu({
  path,
  missing,
  compact = false,
}: {
  path: JsonPath;
  missing: ReturnType<typeof missingProperties>;
  /** 표 행처럼 좁은 자리: 글자 없이 "+" 아이콘 버튼(이름은 `aria-label`). */
  compact?: boolean;
}) {
  const t = useTranslations("review.values.tree");
  const tree = useTree();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={tree.props.locked}>
        {compact ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={t("addField", { count: missing.length })}
            data-testid="job-review-tree-button-add-field"
            className="shrink-0 cursor-pointer text-muted-foreground"
          >
            <PlusIcon aria-hidden="true" />
          </Button>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-testid="job-review-tree-button-add-field"
            className="cursor-pointer self-start"
          >
            + {t("addField", { count: missing.length })}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 max-w-sm"
        onCloseAutoFocus={event => {
          // 새 필드 입력으로 포커스를 옮길 때는 메뉴 버튼으로 돌려보내지 않는다.
          if (tree.hasPendingFocus()) event.preventDefault();
        }}
      >
        {missing.map(item => {
          const at: JsonPath = [...path, item.key];
          return (
            <DropdownMenuItem
              key={item.key}
              onSelect={() =>
                tree.edit(
                  {
                    kind: "set_key",
                    path,
                    key: item.key,
                    value: tree.templateAt(at),
                  },
                  at,
                )
              }
              data-testid="job-review-tree-menu-add-field"
              className="flex-col items-start gap-0.5"
            >
              <span className="text-sm">
                {item.title}
                {item.required ? (
                  <span className="text-muted-foreground"> *</span>
                ) : null}
              </span>
              {item.description ? (
                <span className="text-xs text-muted-foreground">
                  {item.description}
                </span>
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

type MenuItem = {
  key: string;
  label: string;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
};

/**
 * 노드 메뉴: 비우기(null 허용 scalar), 필드 삭제(required 가 아닌 객체 키), 배열 항목의
 * 위로, 아래로, 삭제. 할 수 있는 조작이 없으면 그리지 않는다.
 */
export function NodeMenu({
  path,
  value,
  match,
  parent,
  title,
}: {
  path: JsonPath;
  value: JsonValue;
  match: SchemaMatch | null;
  parent: Parent | null;
  title: string;
}) {
  const t = useTranslations("review.values.tree");
  const tree = useTree();
  const { result, locked, onApply } = tree.props;
  const items: MenuItem[] = [];
  const scalar = !Array.isArray(value) && !isJsonObject(value);
  if (scalar && value !== null && allowsNull(match)) {
    items.push({
      key: "clear",
      label: t("clearValue"),
      onSelect: () => onApply(result.id, path, null),
    });
  }
  if (parent?.kind === "object" && !isRequiredKey(parent.match, parent.key)) {
    items.push({
      key: "remove-field",
      label: t("removeField"),
      destructive: true,
      onSelect: () =>
        tree.edit(
          { kind: "remove_key", path: parent.path, key: parent.key },
          removalFocusPath(parent, tree.isVisible),
        ),
    });
  }
  if (parent?.kind === "array") {
    const { index, length, min } = parent;
    const atMin = min !== undefined && length <= min;
    items.push(
      {
        key: "up",
        label: t("moveUp"),
        disabled: index === 0,
        onSelect: () =>
          tree.edit(
            {
              kind: "move_item",
              path: parent.path,
              from: index,
              to: index - 1,
            },
            [...parent.path, String(index - 1)],
          ),
      },
      {
        key: "down",
        label: t("moveDown"),
        disabled: index >= length - 1,
        onSelect: () => {
          // 옮긴 자리가 묶음 한도 밖이면 포커스를 줄 DOM 이 생기도록 한도를 늘린다.
          tree.extendItems(toPointer(parent.path), index + 2);
          tree.edit(
            {
              kind: "move_item",
              path: parent.path,
              from: index,
              to: index + 1,
            },
            [...parent.path, String(index + 1)],
          );
        },
      },
      {
        key: "remove-item",
        label: atMin ? t("removeItemMin", { min: min ?? 0 }) : t("removeItem"),
        disabled: atMin,
        destructive: true,
        onSelect: () =>
          tree.edit(
            { kind: "remove_item", path: parent.path, index },
            removalFocusPath(parent, tree.isVisible),
          ),
      },
    );
  }
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={locked}>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t("menu", { field: title })}
          data-testid="job-review-tree-button-menu"
          className="shrink-0 cursor-pointer text-muted-foreground"
        >
          <EllipsisVerticalIcon aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={event => {
          if (tree.hasPendingFocus()) event.preventDefault();
        }}
      >
        {items.map(item => (
          <DropdownMenuItem
            key={item.key}
            disabled={item.disabled}
            variant={item.destructive ? "destructive" : "default"}
            onSelect={item.onSelect}
            data-testid={`job-review-tree-menu-${item.key}`}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
