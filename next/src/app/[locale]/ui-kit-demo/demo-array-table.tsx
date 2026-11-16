"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrayTable,
  type ArrayTableCell,
  type ArrayTableColumn,
  type ArrayTableLabels,
  type ArrayTableRow,
} from "@/components/studio-ui-kit/array-table";
import {
  ValueWidget,
  type ValueWidgetControlProps,
  type ValueWidgetDescriptor,
} from "@/components/studio-ui-kit/value-widget";
import { Button } from "@/components/ui/button";
import type { DemoScalar } from "./demo-data";
import { Section, StateLine, TEST_ID } from "./demo-section";
import { CODEC, VALUE_LABELS } from "./demo-value-widget";

const TABLE_TEST_ID = `${TEST_ID}-array-table`;

const TABLE_LABELS: ArrayTableLabels = {
  itemNumber: "Item number",
  itemActions: "Item actions",
  addCell: column => `Add ${column}`,
  revertCell: column => `Revert ${column}`,
};

const COLUMNS: readonly ArrayTableColumn[] = [
  { key: "name", title: "Item", description: "Line item name" },
  { key: "qty", title: "Quantity" },
  { key: "price", title: "Unit price" },
];

const DESCRIPTORS: Record<string, ValueWidgetDescriptor<DemoScalar>> = {
  name: { kind: "text", multiline: false },
  qty: { kind: "number", integer: true },
  price: { kind: "number", integer: false },
};

/** 표 칸 입력: 테두리 없이 칸에 녹아 있다가 가리키거나 포커스하면 테두리가 보인다. */
const CELL_CONTROL =
  "h-7 border-transparent bg-transparent px-1.5 shadow-none hover:border-input";

/** Enter 로 확정한 뒤 다음 칸을 찾는 입력 표식. */
const CELL_INPUT_PROPS: ValueWidgetControlProps = { "data-demo-cell": "" };

type Item = Readonly<Record<string, DemoScalar>>;

interface DemoRow {
  /** 처음 데이터의 행 번호(지운 뒤에도 그대로). */
  id: number;
  values: Item;
  original: Item;
}

const INITIAL_ROWS: readonly DemoRow[] = [
  {
    id: 1,
    values: { name: "Widget", qty: 2, price: 100 },
    original: { name: "Widget", qty: 2, price: 90 },
  },
  {
    id: 2,
    values: { name: "Gadget", price: 250 },
    original: { name: "Gadget", price: 250 },
  },
  {
    id: 3,
    values: { name: "", qty: 1, price: 12.5 },
    original: { name: "", qty: 1, price: 12.5 },
  },
];

/** 데모 규칙: 품명이 비면 오류, 단가가 200 을 넘으면 경고. */
function cellIssue(key: string, value: DemoScalar) {
  if (key === "name" && (value === null || value === "")) {
    return { error: "Item name is required." };
  }
  if (key === "price" && typeof value === "number" && value > 200) {
    return { warning: "Unusually high unit price." };
  }
  return {};
}

const fieldId = (rowId: number, key: string) => `row-${rowId}-${key}`;

/** 표 안 다음 칸 입력으로 포커스를 옮긴다. */
function focusNextCell(from: HTMLElement) {
  const table = from.closest(`[data-testid="${TABLE_TEST_ID}"]`);
  if (!table) return;
  const inputs = [...table.querySelectorAll<HTMLElement>("[data-demo-cell]")];
  const index = inputs.findIndex(
    input => input === from || input.contains(from),
  );
  inputs[index + 1]?.focus();
}

export function ArrayTableDemo() {
  const [items, setItems] = useState<readonly DemoRow[]>(INITIAL_ROWS);
  const [selected, setSelected] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  // "＋" 로 만든 칸: 다음 렌더 뒤 그 칸 입력으로 포커스를 옮긴다.
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const target = pendingFocus.current;
    if (target === null) return;
    pendingFocus.current = null;
    tableRef.current
      ?.querySelector<HTMLElement>(
        `[data-field-id="${target}"] [data-demo-cell]`,
      )
      ?.focus();
  }, [items]);

  const setCell = (rowIndex: number, key: string, value?: DemoScalar) =>
    setItems(rows =>
      rows.map((row, index) => {
        if (index !== rowIndex) return row;
        const values = { ...row.values };
        if (value === undefined) delete values[key];
        else values[key] = value;
        return { ...row, values };
      }),
    );

  const rows: ArrayTableRow<DemoScalar>[] = items.map((item, index) => ({
    index,
    number: index + 1,
    nodeId: `row-${item.id}`,
    cells: Object.fromEntries(
      COLUMNS.filter(column => column.key in item.values).map(column => {
        const value = item.values[column.key];
        const original = item.original[column.key];
        const changed = !(column.key in item.original) || original !== value;
        const id = fieldId(item.id, column.key);
        const cell: ArrayTableCell<DemoScalar> = {
          value,
          fieldId: id,
          changed,
          revertable: changed,
          selected: selected === id,
          highlighted: true,
          title: changed
            ? `Original value: ${original === undefined ? "(none)" : JSON.stringify(original)}`
            : undefined,
          ...cellIssue(column.key, value),
        };
        return [column.key, cell];
      }),
    ),
  }));

  return (
    <Section
      title="array-table"
      description="An array of objects as a table. The caller supplies the rows and plugs an editor into each cell — here the value-widget from above, with Enter moving to the next cell. The table draws the cell states (changed, selected), an error or a warning under a cell, “＋” for a missing field and a revert button for a changed cell. The first item's unit price starts changed, the empty item name is an error and a unit price over 200 is a warning."
      testId={`${TABLE_TEST_ID}-section`}
    >
      <ArrayTable<DemoScalar>
        ref={tableRef}
        className="max-w-2xl"
        columns={COLUMNS}
        rows={rows}
        renderCell={(row, column, cell, ctx) => (
          <ValueWidget<DemoScalar>
            id={ctx.id}
            descriptor={DESCRIPTORS[column.key]}
            value={cell.value}
            codec={CODEC}
            onCommit={next => setCell(row.index, column.key, next)}
            onError={ctx.onError}
            invalid={ctx.invalid}
            describedBy={ctx.describedBy}
            onSubmitNext={focusNextCell}
            controlClassName={CELL_CONTROL}
            controlProps={CELL_INPUT_PROPS}
            labels={VALUE_LABELS}
            testId={`${TABLE_TEST_ID}-editor-${row.index}-${column.key}`}
          />
        )}
        renderRowActions={row => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              setItems(list => list.filter((_, index) => index !== row.index))
            }
            data-testid={`${TABLE_TEST_ID}-button-remove-row`}
          >
            Remove
          </Button>
        )}
        onAddCell={(rowIndex, key) => {
          pendingFocus.current = fieldId(items[rowIndex].id, key);
          setCell(rowIndex, key, null);
        }}
        onRevertCell={(rowIndex, key) =>
          setCell(rowIndex, key, items[rowIndex].original[key])
        }
        onCellFocus={(rowIndex, key) =>
          setSelected(fieldId(items[rowIndex].id, key))
        }
        labels={TABLE_LABELS}
        testId={TABLE_TEST_ID}
      />
      <div>
        <Button
          variant="outline"
          onClick={() => {
            setItems(INITIAL_ROWS);
            setSelected(null);
          }}
          data-testid={`${TABLE_TEST_ID}-reset`}
        >
          Reset table
        </Button>
      </div>
      <StateLine testId={`${TABLE_TEST_ID}-value`}>
        {JSON.stringify(items.map(item => item.values))}
      </StateLine>
    </Section>
  );
}
