"use client";

import { PlusIcon, RotateCcwIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import {
  ArrayTable as CoreArrayTable,
  type ArrayTableCell,
  type ArrayTableColumn,
  type ArrayTableLabels,
  type ArrayTableRow,
} from "@/components/studio-ui-kit/array-table";
import { Button } from "@/components/ui/button";
import {
  fieldDescription,
  fieldTitle,
  isJsonObject,
  jsonEquals,
  missingProperties,
  toPointer,
  widgetFor,
  type JsonObject,
  type JsonPath,
  type JsonValue,
  type PairedHighlight,
  type SchemaMatch,
  type Widget,
} from "@/lib/review-model";
import { nodeId, useTree } from "./content-tree-context";
import { AddFieldMenu, NodeError, NodeMenu } from "./content-tree-menus";
import type { FieldError } from "./field-errors";
import { displayValue, valueAt } from "./value-fields";
import { ValueWidget } from "./value-widget";
import { clearedValue } from "./cleared-value";

/** 표 칸 입력: 테두리 없이 칸에 녹아 있다가 가리키거나 포커스하면 테두리가 보인다. */
const CELL_CONTROL =
  "h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-input";

const TEST_ID = "job-review-tree-table";

/** 칸 편집기·칸 메뉴·버튼이 쓰는 칸 재료(표에 넘기는 표시 값 밖의 것). */
type CellSource = {
  path: JsonPath;
  match: SchemaMatch | null;
  widget: Widget;
  machine: JsonValue | undefined;
  highlight: PairedHighlight | null;
};

/** 행 동작·행 오류·칸 메뉴가 쓰는 행 재료. */
type RowSource = {
  itemPath: JsonPath;
  item: JsonObject;
  match: SchemaMatch | null;
  missing: ReturnType<typeof missingProperties>;
  /** 이 행에 칸이 있는 열 키(열 순서). 칸 필드를 지운 뒤 포커스를 줄 이웃을 고른다. */
  cellKeys: readonly string[];
  error: FieldError | null;
  cells: ReadonlyMap<string, CellSource>;
};

/**
 * 객체 배열을 표로 그린다(행 = 항목, 열 = 필드). 칸에서 바로 고치고(Enter 는 다음 칸), 칸을 가리키거나
 * 포커스하면 뷰어의 원본 위치를 보인다. 바뀐 칸은 옅은 바탕과 되돌리기 버튼, 원본 값은 `title`.
 * 행 끝 메뉴는 항목 위로, 아래로, 삭제, 칸 메뉴는 값 행과 같은 비우기, 필드 삭제, 어떤 항목에 없는 열의 칸은
 * "+" 로 그 필드를 넣는다. 머리 행은
 * 표 안에서 세로로 스크롤할 때 위에 남는다. 그릴 항목(`indexes`)과 "더 보기", "항목 추가" 는 배열
 * 묶음(`ArrayNode`)이 정한다. 표 모양은 Core `ArrayTable` 이 그리고, 이 래퍼는 값 트리 context 에서
 * 행·칸 재료를 만들어 칸 편집기·메뉴를 끼운다.
 */
export function ArrayTable({
  path,
  value,
  indexes,
  columns,
  min,
}: {
  path: JsonPath;
  value: readonly JsonValue[];
  /** 그릴 항목 index(필터, 묶음 한도를 거친 것). */
  indexes: readonly number[];
  /** 열 키(`tableColumns`). */
  columns: readonly string[];
  /** schema `minItems`(항목 삭제 메뉴가 쓴다). */
  min: number | undefined;
}) {
  const t = useTranslations("review.values");
  const tt = useTranslations("review.values.tree");
  const tree = useTree();
  const { matchAt } = tree;
  const { result, locked } = tree.props;
  // 열 머리: 그 키가 있는 첫 항목 자리의 schema 제목, 도움말.
  const heads = useMemo<ArrayTableColumn[]>(
    () =>
      columns.map(key => {
        const index = value.findIndex(
          item => isJsonObject(item) && Object.hasOwn(item, key),
        );
        const item = value[index];
        const at: JsonPath = [...path, String(Math.max(index, 0)), key];
        const match = matchAt(
          at,
          isJsonObject(item) ? (item[key] ?? null) : undefined,
        );
        return {
          key,
          title: fieldTitle(match?.node ?? null, [key]),
          description: fieldDescription(match?.node ?? null) ?? undefined,
        };
      }),
    [columns, value, path, matchAt],
  );

  const labels = useMemo<ArrayTableLabels>(
    () => ({ itemNumber: tt("itemNumber"), itemActions: tt("itemActions") }),
    [tt],
  );

  const { rows, sources } = useMemo(() => {
    const rows: ArrayTableRow<JsonValue>[] = [];
    const sources = new Map<number, RowSource>();
    const { highlights, errors, step } = tree.props;
    for (const index of indexes) {
      const item = value[index];
      if (!isJsonObject(item)) continue;
      const itemPath: JsonPath = [...path, String(index)];
      const match = tree.matchAt(itemPath, item);
      // 열에 없는 schema 필드는 행 끝 "+" 메뉴로 넣는다(넣으면 열이 생긴다).
      const missing = missingProperties(
        match,
        item,
        tree.schema ?? undefined,
      ).filter(property => !heads.some(head => head.key === property.key));
      const cellKeys = heads
        .map(head => head.key)
        .filter(key => Object.hasOwn(item, key));
      const cells: Record<string, ArrayTableCell<JsonValue>> = {};
      const cellSources = new Map<string, CellSource>();
      for (const head of heads) {
        if (!Object.hasOwn(item, head.key)) continue;
        const cellPath: JsonPath = [...itemPath, head.key];
        const cellValue = item[head.key] ?? null;
        const pointer = toPointer(cellPath);
        const cellMatch = tree.matchAt(cellPath, cellValue);
        // 값 행과 같은 규칙: 이 칸을 가리키는 서버, schema 오류. 경고는 흐린 문구.
        const fieldError = errors.get(pointer) ?? null;
        const machine =
          tree.baseContent === undefined
            ? undefined
            : valueAt(tree.baseContent, cellPath);
        const changed = !jsonEquals(machine, cellValue);
        const highlight = highlights.get(pointer) ?? null;
        cells[head.key] = {
          value: cellValue,
          fieldId: nodeId(result.id, cellPath),
          pointer,
          selected: tree.selectedPointer === pointer,
          changed,
          // 필터 중에도 행은 통째로 보이고, 조건에 맞지 않는 칸만 흐리게 둔다.
          dimmed: tree.filtering && !tree.isVisible(cellPath),
          title:
            changed && machine !== undefined
              ? tt("original", { value: displayValue(machine) || t("empty") })
              : undefined,
          error: fieldError?.severity === "error" ? fieldError.message : null,
          warning:
            fieldError?.severity === "warning" ? fieldError.message : null,
          revertable: changed && machine !== undefined,
          highlighted: highlight !== null,
        };
        cellSources.set(head.key, {
          path: cellPath,
          match: cellMatch,
          widget: widgetFor(step, cellMatch, cellValue),
          machine,
          highlight,
        });
      }
      rows.push({
        index,
        number: index + 1,
        nodeId: nodeId(result.id, itemPath),
        cells,
      });
      sources.set(index, {
        itemPath,
        item,
        match,
        missing,
        cellKeys,
        error: tree.errorAt(toPointer(itemPath)),
        cells: cellSources,
      });
    }
    return { rows, sources };
  }, [tree, result.id, indexes, value, path, heads, t, tt]);

  const rowOf = (row: ArrayTableRow<JsonValue>) => sources.get(row.index)!;
  const cellOf = (row: ArrayTableRow<JsonValue>, column: ArrayTableColumn) =>
    rowOf(row).cells.get(column.key)!;

  return (
    <CoreArrayTable<JsonValue>
      columns={heads}
      rows={rows}
      valueEquals={jsonEquals}
      disabled={locked}
      labels={labels}
      testId={TEST_ID}
      renderCell={(row, column, cell, ctx) => {
        const source = cellOf(row, column);
        return (
          <ValueWidget
            id={ctx.id}
            widget={source.widget}
            value={cell.value}
            disabled={locked}
            invalid={ctx.invalid}
            describedBy={ctx.describedBy}
            onCommit={next =>
              tree.props.onApply(
                result.id,
                source.path,
                clearedValue(
                  next,
                  tree.props.originalValueAt
                    ? tree.props.originalValueAt(result.id, source.path)
                    : source.machine,
                ),
              )
            }
            onError={ctx.onError}
            onEditJson={tree.props.onEditJson}
            controlClassName={CELL_CONTROL}
            testId="job-review-field"
          />
        );
      }}
      renderRevertButton={(row, column) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={locked}
          aria-label={tt("revertCell", { field: column.title })}
          onClick={() =>
            tree.props.onRevert(result.id, cellOf(row, column).path)
          }
          data-testid={`${TEST_ID}-button-revert`}
          className="shrink-0 cursor-pointer text-muted-foreground"
        >
          <RotateCcwIcon aria-hidden="true" />
        </Button>
      )}
      // 값 행과 같은 칸 메뉴(비우기, 필드 삭제). 할 수 있는 조작이 없으면 그리지 않는다.
      renderCellActions={(row, column, cell) => {
        const source = rowOf(row);
        return (
          <NodeMenu
            path={cellOf(row, column).path}
            value={cell.value}
            match={cellOf(row, column).match}
            parent={{
              kind: "object",
              path: source.itemPath,
              match: source.match,
              key: column.key,
              siblings: source.cellKeys,
            }}
            title={column.title}
          />
        );
      }}
      renderAddCellButton={(row, column) => (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          disabled={locked}
          aria-label={tt("addCellField", { field: column.title })}
          onClick={() => {
            const { itemPath } = rowOf(row);
            const at: JsonPath = [...itemPath, column.key];
            tree.edit(
              {
                kind: "set_key",
                path: itemPath,
                key: column.key,
                value: tree.templateAt(at),
              },
              at,
            );
          }}
          data-testid={`${TEST_ID}-button-add-cell`}
          className="cursor-pointer text-muted-foreground"
        >
          <PlusIcon aria-hidden="true" />
        </Button>
      )}
      renderRowActions={row => {
        const source = rowOf(row);
        return (
          <>
            {source.missing.length > 0 ? (
              <AddFieldMenu
                path={source.itemPath}
                missing={source.missing}
                compact
              />
            ) : null}
            <NodeMenu
              path={source.itemPath}
              value={source.item}
              match={null}
              parent={{
                kind: "array",
                path,
                index: row.index,
                length: value.length,
                min,
              }}
              title={String(row.number)}
            />
          </>
        );
      }}
      renderRowError={row => {
        const { error } = rowOf(row);
        return error ? <NodeError error={error} /> : null;
      }}
      onCellFocus={(rowIndex, columnKey) => {
        const highlight = sources
          .get(rowIndex)
          ?.cells.get(columnKey)?.highlight;
        if (highlight) tree.props.onSelectHighlight(highlight);
      }}
      onCellHover={(rowIndex, columnKey, hovered) => {
        const highlight = sources
          .get(rowIndex)
          ?.cells.get(columnKey)?.highlight;
        if (highlight)
          tree.props.onHoverHighlight(hovered ? highlight.id : null);
      }}
    />
  );
}
