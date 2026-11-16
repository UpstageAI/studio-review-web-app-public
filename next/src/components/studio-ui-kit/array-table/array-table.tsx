import { useId, useState, type ComponentProps, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PlusIcon, RotateCcwIcon } from "lucide-react";

/** 열 하나(항목 객체의 필드 하나). */
export interface ArrayTableColumn {
  key: string;
  /** 열 머리 글자. 칸 입력의 접근성 이름(sr-only `<label>`)으로도 쓴다. */
  title: string;
  /** 열 머리의 `title`(도움말). */
  description?: string;
}

/** 칸 하나. 행의 `cells` 에 없는 열은 "＋" 칸이 된다. */
export interface ArrayTableCell<V = unknown> {
  value: V;
  /** 칸 `td` 의 `data-field-id`(편집 뒤 포커스를 찾는 호출자 표식). */
  fieldId?: string;
  /** 칸 `td` 의 `data-pointer`. */
  pointer?: string;
  /** 뷰어에서 고른 칸(진한 바탕, `data-selected="true"`). */
  selected?: boolean;
  /** 원본과 다른 칸(옅은 바탕, `data-changed="true"`). `selected` 가 바탕을 이긴다. */
  changed?: boolean;
  /** 필터 조건 밖 칸(흐리게). */
  dimmed?: boolean;
  /** 칸 `td` 의 `title`(예: 원본 값). */
  title?: string;
  /** 밖에서 온 오류. 편집기가 거부한 입력의 오류가 먼저다. */
  error?: string | null;
  /** 밖에서 온 경고. 오류가 없을 때만 보인다. */
  warning?: string | null;
  /** 되돌리기 버튼을 그린다. */
  revertable?: boolean;
  /** 참이면 칸에 `onCellFocus`·`onCellHover` 를 건다. */
  highlighted?: boolean;
}

/** 행 하나(배열 항목 하나). */
export interface ArrayTableRow<V = unknown> {
  /** 행 key 이자 콜백 인자(배열 안 위치). */
  index: number;
  /** 행 머리에 보이는 번호. */
  number: number;
  /** 행 `tr` 의 `data-node-id`. */
  nodeId?: string;
  /** 열 키 → 칸. 없는 열은 "＋" 칸. */
  cells: Readonly<Record<string, ArrayTableCell<V> | undefined>>;
}

/** `renderCell` 이 편집기에 이어 줄 값. */
export interface ArrayTableCellContext {
  /** 편집기 요소의 `id`(sr-only `<label htmlFor>` 가 가리킨다). */
  id: string;
  /** 칸에 오류가 있다(`aria-invalid`). */
  invalid: boolean;
  /** 칸 오류·경고 문구의 id(`aria-describedby`). 없으면 `undefined`. */
  describedBy: string | undefined;
  /** 편집기가 입력을 거부했을 때 문구, 풀렸으면 `null`. 그때의 칸 값에 묶어 둔다. */
  onError: (message: string | null) => void;
}

export interface ArrayTableLabels {
  /** 번호 열 머리(화면 낭독기용). */
  itemNumber: string;
  /** 동작 열 머리(화면 낭독기용). */
  itemActions: string;
  /** 기본 "＋" 버튼 이름(`onAddCell` 의 짝). */
  addCell?: (column: string) => string;
  /** 기본 되돌리기 버튼 이름(`onRevertCell` 의 짝). */
  revertCell?: (column: string) => string;
}

export interface ArrayTableProps<V = unknown> extends Omit<
  ComponentProps<"div">,
  "children"
> {
  columns: readonly ArrayTableColumn[];
  rows: readonly ArrayTableRow<V>[];
  /** 칸 편집기. `ctx.id` 를 편집기 요소의 `id` 로 둔다. */
  renderCell: (
    row: ArrayTableRow<V>,
    column: ArrayTableColumn,
    cell: ArrayTableCell<V>,
    ctx: ArrayTableCellContext,
  ) => ReactNode;
  /** 칸 끝 메뉴 등(되돌리기 버튼 뒤). */
  renderCellActions?: (
    row: ArrayTableRow<V>,
    column: ArrayTableColumn,
    cell: ArrayTableCell<V>,
  ) => ReactNode;
  /** 행 끝 동작 칸 내용(필드 추가·행 메뉴 등). */
  renderRowActions?: (row: ArrayTableRow<V>) => ReactNode;
  /** 행 아래 오류 줄 내용. `null`·`undefined`·`false` 면 줄을 그리지 않는다. */
  renderRowError?: (row: ArrayTableRow<V>) => ReactNode;
  onAddCell?: (rowIndex: number, columnKey: string) => void;
  onRevertCell?: (rowIndex: number, columnKey: string) => void;
  /** 기본 "＋" 버튼 대신 그린다(있으면 `onAddCell`·`labels.addCell` 없이도 그린다). */
  renderAddCellButton?: (
    row: ArrayTableRow<V>,
    column: ArrayTableColumn,
  ) => ReactNode;
  /** 기본 되돌리기 버튼 대신 그린다(`revertable` 칸에만, `onRevertCell`·`labels.revertCell` 없이도). */
  renderRevertButton?: (
    row: ArrayTableRow<V>,
    column: ArrayTableColumn,
    cell: ArrayTableCell<V>,
  ) => ReactNode;
  onCellFocus?: (rowIndex: number, columnKey: string) => void;
  onCellHover?: (rowIndex: number, columnKey: string, hovered: boolean) => void;
  /** 편집기 오류를 묶은 값과 지금 값의 비교. 기본 `Object.is`. */
  valueEquals?: (a: V, b: V) => boolean;
  /** 기본 버튼 둘을 비활성으로(편집기·slot 은 호출자가 막는다). */
  disabled?: boolean;
  labels: ArrayTableLabels;
  /** 루트 `div` 의 `data-testid`. 하위는 `-button-add-cell`·`-button-revert`·`-cell-error`·`-cell-warning`. */
  testId?: string;
}

const tid = (testId: string | undefined, suffix: string) =>
  testId ? `${testId}-${suffix}` : undefined;

/**
 * 객체 배열을 표로 그린다(행 = 항목, 열 = 필드). 칸 편집기·메뉴는 호출자가 slot 으로 끼우고, 표는
 * 칸 상태(고름·바뀜·흐림), 오류·경고 문구와 그 id, "＋"·되돌리기 버튼, 행 오류 줄을 그린다. 머리 행은
 * 표 안에서 세로로 스크롤할 때 위에 남는다. 열 도출·행 추가·"더 보기" 는 호출자가 한다.
 */
export function ArrayTable<V = unknown>({
  columns,
  rows,
  renderCell,
  renderCellActions,
  renderRowActions,
  renderRowError,
  onAddCell,
  onRevertCell,
  renderAddCellButton,
  renderRevertButton,
  onCellFocus,
  onCellHover,
  valueEquals,
  disabled,
  labels,
  testId,
  className,
  ...props
}: ArrayTableProps<V>) {
  const shared: RowShared<V> = {
    columns,
    renderCell,
    renderCellActions,
    renderRowActions,
    renderRowError,
    onAddCell,
    onRevertCell,
    renderAddCellButton,
    renderRevertButton,
    onCellFocus,
    onCellHover,
    valueEquals: valueEquals ?? Object.is,
    disabled,
    labels,
    testId,
  };

  return (
    <div
      {...props}
      className={cn("relative max-h-[60vh] min-w-0 overflow-auto", className)}
      data-testid={testId}
    >
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background">
          <tr className="border-b border-border text-left text-xs text-muted-foreground">
            <th scope="col" className="w-8 px-2 py-1.5 font-medium">
              <span aria-hidden="true">#</span>
              <span className="sr-only">{labels.itemNumber}</span>
            </th>
            {columns.map(column => (
              <th
                key={column.key}
                scope="col"
                title={column.description}
                className="min-w-24 px-2 py-1.5 font-medium whitespace-nowrap"
              >
                {column.title}
              </th>
            ))}
            <th scope="col" className="w-8 px-1 py-1.5">
              <span className="sr-only">{labels.itemActions}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => (
            <ArrayTableRowView key={row.index} row={row} shared={shared} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

type RowShared<V> = Pick<
  ArrayTableProps<V>,
  | "columns"
  | "renderCell"
  | "renderCellActions"
  | "renderRowActions"
  | "renderRowError"
  | "onAddCell"
  | "onRevertCell"
  | "renderAddCellButton"
  | "renderRevertButton"
  | "onCellFocus"
  | "onCellHover"
  | "disabled"
  | "labels"
  | "testId"
> & { valueEquals: (a: V, b: V) => boolean };

function ArrayTableRowView<V>({
  row,
  shared,
}: {
  row: ArrayTableRow<V>;
  shared: RowShared<V>;
}) {
  const { columns, labels, disabled, testId } = shared;
  const rowError = shared.renderRowError?.(row);

  return (
    <>
      <tr
        data-node-id={row.nodeId}
        className="border-b border-border align-top last:border-b-0"
      >
        <th
          scope="row"
          className="px-2 py-2 text-left text-xs font-medium text-muted-foreground"
        >
          {row.number}
        </th>
        {columns.map(column => {
          const cell = row.cells[column.key];
          return cell ? (
            <ArrayTableCellView
              key={column.key}
              row={row}
              column={column}
              cell={cell}
              shared={shared}
            />
          ) : (
            <td key={column.key} className="px-1 py-1">
              {shared.renderAddCellButton ? (
                shared.renderAddCellButton(row, column)
              ) : shared.onAddCell && labels.addCell ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={labels.addCell(column.title)}
                  onClick={() => shared.onAddCell?.(row.index, column.key)}
                  data-testid={tid(testId, "button-add-cell")}
                  className="cursor-pointer text-muted-foreground"
                >
                  <PlusIcon aria-hidden="true" />
                </Button>
              ) : null}
            </td>
          );
        })}
        <td className="px-1 py-1">
          <div className="flex items-center justify-end">
            {shared.renderRowActions?.(row)}
          </div>
        </td>
      </tr>
      {rowError != null && rowError !== false ? (
        <tr>
          <td colSpan={columns.length + 2}>{rowError}</td>
        </tr>
      ) : null}
    </>
  );
}

function ArrayTableCellView<V>({
  row,
  column,
  cell,
  shared,
}: {
  row: ArrayTableRow<V>;
  column: ArrayTableColumn;
  cell: ArrayTableCell<V>;
  shared: RowShared<V>;
}) {
  const { labels, disabled, testId, onCellFocus, onCellHover } = shared;
  const id = useId();
  const errorId = `${id}-error`;
  const warningId = `${id}-warning`;
  // 편집기가 거부한 입력의 오류는 그때의 값에 묶는다. 행은 `key={index}` 라 항목을 지우거나 옮기면
  // 이 칸이 다른 항목을 그리는데, 그 항목에 오류가 넘어가지 않게 한다.
  const [bound, setBound] = useState<{ value: V; message: string } | null>(
    null,
  );
  const cellError =
    (bound !== null && shared.valueEquals(bound.value, cell.value)
      ? bound.message
      : null) ??
    cell.error ??
    null;
  const cellWarning = cellError === null ? (cell.warning ?? null) : null;
  const highlighted = cell.highlighted === true;
  const ctx: ArrayTableCellContext = {
    id,
    invalid: cellError !== null,
    describedBy: cellError ? errorId : cellWarning ? warningId : undefined,
    onError: message =>
      setBound(message === null ? null : { value: cell.value, message }),
  };

  return (
    <td
      data-field-id={cell.fieldId}
      data-pointer={cell.pointer}
      data-selected={cell.selected ? "true" : undefined}
      data-changed={cell.changed ? "true" : undefined}
      title={cell.title}
      onFocusCapture={
        highlighted && onCellFocus
          ? () => onCellFocus(row.index, column.key)
          : undefined
      }
      onPointerEnter={
        highlighted && onCellHover
          ? () => onCellHover(row.index, column.key, true)
          : undefined
      }
      onPointerLeave={
        highlighted && onCellHover
          ? () => onCellHover(row.index, column.key, false)
          : undefined
      }
      className={cn(
        "min-w-24 px-1 py-1 align-top transition-colors motion-reduce:transition-none",
        // 바뀐 칸은 옅은 바탕(칸마다 띠를 두면 세로 구분선처럼 보인다), 고른 칸은 더 진하게.
        cell.selected ? "bg-muted/70" : cell.changed && "bg-primary/5",
        cell.dimmed && "opacity-50",
      )}
    >
      <div className="flex min-w-0 items-center gap-0.5">
        <label htmlFor={id} className="sr-only">
          {column.title}
        </label>
        <div className="min-w-0 flex-1">
          {shared.renderCell(row, column, cell, ctx)}
        </div>
        {cell.revertable ? (
          shared.renderRevertButton ? (
            shared.renderRevertButton(row, column, cell)
          ) : shared.onRevertCell && labels.revertCell ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              disabled={disabled}
              aria-label={labels.revertCell(column.title)}
              onClick={() => shared.onRevertCell?.(row.index, column.key)}
              data-testid={tid(testId, "button-revert")}
              className="shrink-0 cursor-pointer text-muted-foreground"
            >
              <RotateCcwIcon aria-hidden="true" />
            </Button>
          ) : null
        ) : null}
        {shared.renderCellActions?.(row, column, cell)}
      </div>
      {cellError ? (
        <p
          id={errorId}
          role="alert"
          className="px-1.5 pt-1 text-xs break-words text-destructive"
          data-testid={tid(testId, "cell-error")}
        >
          {cellError}
        </p>
      ) : cellWarning ? (
        <p
          id={warningId}
          className="px-1.5 pt-1 text-xs break-words text-muted-foreground"
          data-testid={tid(testId, "cell-warning")}
        >
          {cellWarning}
        </p>
      ) : null}
    </td>
  );
}
