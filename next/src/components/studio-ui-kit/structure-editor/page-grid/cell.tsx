import { memo, type DragEvent, type Ref } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { excludedPageMenuItems, type StructureMenuItem } from "../shared/menu";
import { tid } from "../shared/test-id";
import type {
  GridDragHandlers,
  GroupDocument,
  PageGridActions,
  PageGridLabels,
} from "./page-grid";
import { splitButtonOffset, type PageGridSize } from "./rows";
import type { StructurePage } from "../shared/types";

/** 썸네일(이미지 칸) 크기. `CELL_SIZES` 와 같은 px. */
const THUMBNAIL_CLASS: Readonly<Record<PageGridSize, string>> = {
  s: "h-20 w-16",
  m: "h-36 w-28",
};
/** 셀 한 칸의 폭(썸네일 폭과 같다). */
const COLUMN_CLASS: Readonly<Record<PageGridSize, string>> = {
  s: "w-16",
  m: "w-28",
};
/** drop 자리 막대의 높이(썸네일 높이와 같다). */
const BAR_CLASS: Readonly<Record<PageGridSize, string>> = {
  s: "h-20",
  m: "h-36",
};

/** 셀 왼쪽 틈 ✂ 칩. 평소 흐리게, hover·focus 때 진하게(필름스트립 ✂ 와 같은 표현). */
const SPLIT_BUTTON_CLASS =
  "absolute z-10 inline-flex size-5 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-xs text-muted-foreground opacity-40 shadow-xs hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden motion-reduce:transition-none";

const MENU_BUTTON_CLASS =
  "inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50";

/** 메뉴 항목이 없을 때 쓰는 빈 목록. */
const NO_ITEMS: readonly StructureMenuItem[] = [];

/**
 * 페이지 썸네일 셀: 누르면 뷰어가 그 페이지로 가고, 끌어서 같은 문서 안 순서·같은 그룹 다른 문서·
 * 제외 칸으로 옮기며, ⋯ 메뉴로 같은 일(앞으로·뒤로·다른 문서로·이 페이지 앞에서 나누기·제외)을
 * 키보드로 한다. 문서 셀 왼쪽 틈의 ✂(첫 쪽 제외, 끄는 중 숨김, Tab 정지 없음 — 키보드는 ⋯ 메뉴)로
 * 이 페이지 앞에서 나눈다. 제외 칸의 셀(`documentId: null`)은 메뉴가 "문서로 되돌리기 ▸"·"새 문서로" 다.
 * 이미지는 뷰어와 같은 페이지 이미지를 줄여 쓴다. 보이는 행만 그려지므로 부모가 다시 그려도 props 가
 * 같은 셀은 건너뛴다(`memo`) — 그래서 콜백 묶음·drag 핸들러·같은 그룹 문서 목록은 참조가 고정된
 * 객체로 받는다.
 */
export const Cell = memo(function Cell({
  page,
  documentId,
  groupId,
  pages,
  position,
  groupDocuments,
  size,
  selected,
  multiSelected,
  disabled,
  draggable,
  dragging,
  insertBefore,
  insertAfter,
  splitShown,
  rowStart,
  labels,
  testId,
  actions,
  drag,
}: {
  page: StructurePage;
  /** 제외 칸의 페이지는 `null`. */
  documentId: string | null;
  /** 이 페이지의 파일 그룹(문서 셀은 문서의, 제외 칸 셀은 페이지의 그룹). */
  groupId: string;
  /** 블록의 페이지 목록(메뉴 비활성·나누기 기준 자리). */
  pages: readonly StructurePage[];
  /** 블록 페이지 배열 안 위치(0-based). */
  position: number;
  /** 같은 그룹에서 페이지를 받을 수 있는 문서(잠기지 않음, 자기 문서 포함). */
  groupDocuments: readonly GroupDocument[];
  size: PageGridSize;
  /** 뷰어가 보는 페이지(`aria-current`). */
  selected: boolean;
  /** 여러 장 선택에 든 페이지(`aria-pressed`). 격자가 여러 장 선택을 쓰지 않으면 `undefined`. */
  multiSelected?: boolean;
  disabled: boolean;
  /** 끌 수 있다(막히지 않았고 그 셀을 받을 콜백이 있다 — 격자가 정한다). */
  draggable: boolean;
  /** 지금 끌고 있는 셀(흐리게). */
  dragging: boolean;
  /** drop 자리 표시(앞·뒤 세로 막대). */
  insertBefore: boolean;
  insertAfter: boolean;
  /**
   * 셀 왼쪽 틈 ✂ 를 그린다 — 문서 셀·첫 쪽 아님·잠기지 않음·끄는 중 아님일 때 격자가 정한다.
   */
  splitShown: boolean;
  /** 행의 첫 셀이면 ✂ 를 셀 안쪽에 둔다(스크롤 창에 잘리지 않게). */
  rowStart: boolean;
  labels: PageGridLabels;
  testId?: string;
  actions: PageGridActions;
  drag: GridDragHandlers;
}) {
  const name = labels.page(page);
  const issue =
    page.issue === "overlap"
      ? labels.overlap
      : page.issue === "missing"
        ? labels.missing
        : null;
  const menu = cellMenuItems({
    page,
    documentId,
    pages,
    position,
    groupDocuments,
    labels,
    actions,
  });

  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    const payload = {
      kind: "page" as const,
      documentId,
      pageKey: page.key,
      groupId,
      index: position,
    };
    drag.begin(payload, event);
  };
  const previous = position > 0 ? pages[position - 1] : undefined;
  const split = actions.onSplit;
  const splitLabel = labels.splitBefore;
  const click = actions.onThumbnailClick;
  // 썸네일 칸 class. 버튼(누를 수 있음)과 그림(`onThumbnailClick` 없음)이 앞부분만 다르다.
  const thumbnailClass = (base: string) =>
    cn(
      base,
      THUMBNAIL_CLASS[size],
      multiSelected &&
        "ring-2 ring-primary ring-offset-2 ring-offset-background",
      page.issue === "missing"
        ? "border-2 border-dashed border-destructive"
        : page.issue === "overlap"
          ? "border-2 border-destructive"
          : selected
            ? "border-2 border-primary"
            : "border border-border",
    );
  const thumbnail = (
    <>
      {page.thumbnailUrl ? (
        // 원본 페이지 이미지를 CSS 로 줄인다(썸네일 API 가 따로 없다). 창 밖 행은 그리지 않으므로
        // 브라우저는 보이는 셀 근처의 이미지만 받는다.
        <img
          src={page.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          className="size-full object-contain"
        />
      ) : (
        <span className="px-1 text-center text-xs text-muted-foreground">
          {labels.noImage}
        </span>
      )}
      {multiSelected ? (
        <span
          aria-hidden="true"
          className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-primary text-xs leading-none text-primary-foreground"
        >
          ✓
        </span>
      ) : null}
    </>
  );

  return (
    <div
      data-page-grid-page={page.key}
      draggable={draggable}
      onDragStart={draggable ? onDragStart : undefined}
      onDragEnd={drag.end}
      className={cn(
        "relative flex shrink-0 flex-col items-center gap-1",
        COLUMN_CLASS[size],
        draggable && "cursor-grab",
        dragging && "opacity-50",
      )}
    >
      {insertBefore ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-0 -left-1.5 w-0.5 rounded-full bg-primary",
            BAR_CLASS[size],
          )}
        />
      ) : null}
      {insertAfter ? (
        <span
          aria-hidden="true"
          className={cn(
            "absolute top-0 -right-1.5 w-0.5 rounded-full bg-primary",
            BAR_CLASS[size],
          )}
        />
      ) : null}
      {splitShown && split && splitLabel && documentId !== null && previous ? (
        <CellSplitButton
          label={splitLabel(page)}
          size={size}
          rowStart={rowStart}
          testId={tid(testId, "cell-split")}
          onClick={() => split(documentId, previous.key)}
        />
      ) : null}
      {click ? (
        <button
          type="button"
          aria-label={issue ? `${name} · ${issue}` : name}
          aria-current={selected ? "true" : undefined}
          aria-pressed={multiSelected}
          data-selected={multiSelected ? "true" : undefined}
          title={issue ?? name}
          onClick={event =>
            click(documentId, page.key, position, {
              shift: event.shiftKey,
              toggle: event.metaKey || event.ctrlKey,
            })
          }
          data-testid={tid(testId, "cell-select")}
          className={thumbnailClass(
            "relative flex cursor-pointer items-center justify-center overflow-hidden rounded-md bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden",
          )}
        >
          {thumbnail}
        </button>
      ) : (
        <div
          role="img"
          aria-label={issue ? `${name} · ${issue}` : name}
          aria-current={selected ? "true" : undefined}
          data-selected={multiSelected ? "true" : undefined}
          title={issue ?? name}
          className={thumbnailClass(
            "relative flex items-center justify-center overflow-hidden rounded-md bg-muted",
          )}
        >
          {thumbnail}
        </div>
      )}
      <div className="flex w-full min-w-0 items-center gap-0.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {name}
        </span>
        {labels.pageMenu ? (
          <CellMenu
            name={labels.pageMenu(page)}
            items={menu}
            disabled={disabled}
            testId={tid(testId, "cell-menu")}
          />
        ) : null}
      </div>
    </div>
  );
});

/**
 * 셀 왼쪽 틈의 ✂: 이 페이지 앞에서 나눈다(⋯ 메뉴 "앞에서 나누기" 와 같은 콜백). 레이아웃 자리를
 * 차지하지 않게 겹쳐 그린다. 칸마다 Tab 이 멈추지 않게 `tabIndex={-1}` 이고 키보드 경로는 ⋯ 메뉴다.
 * 썸네일 버튼과 형제라 눌러도 선택·뷰어 이동이 없다. 셀이 `draggable` 이라 그대로 두면 ✂ 위에서
 * 누른 채 끌 때 셀 drag 가 시작되므로, 버튼을 가장 가까운 draggable 로 만들고 그 끌기를 취소한다.
 */
function CellSplitButton({
  label,
  size,
  rowStart,
  testId,
  onClick,
}: {
  label: string;
  size: PageGridSize;
  rowStart: boolean;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      draggable
      onDragStart={event => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={onClick}
      data-testid={testId}
      style={splitButtonOffset(size, rowStart)}
      className={SPLIT_BUTTON_CLASS}
    >
      ✂
    </button>
  );
}

/**
 * 셀 ⋯ 메뉴 항목. 문서 셀은 앞으로·뒤로·다른 문서로 ▸·이 페이지 앞에서 나누기·제외(필름스트립과
 * 같은 콜백), 제외 칸 셀은 문서로 되돌리기 ▸(같은 그룹 문서 끝에)·새 문서로. 항목마다 콜백과 문구가
 * 함께 있을 때만 넣는다.
 */
function cellMenuItems({
  page,
  documentId,
  pages,
  position,
  groupDocuments,
  labels,
  actions,
}: {
  page: StructurePage;
  documentId: string | null;
  pages: readonly StructurePage[];
  position: number;
  groupDocuments: readonly GroupDocument[];
  labels: PageGridLabels;
  actions: PageGridActions;
}): readonly StructureMenuItem[] {
  if (documentId === null) {
    return excludedPageMenuItems({
      pageKey: page.key,
      targets: groupDocuments,
      labels,
      actions,
    });
  }
  const previous = position > 0 ? pages[position - 1] : undefined;
  const items: StructureMenuItem[] = [];
  const reorder = actions.onReorderPage;
  if (reorder && labels.movePageEarlier !== undefined) {
    items.push({
      id: "earlier",
      label: labels.movePageEarlier,
      disabled: position === 0,
      onSelect: () => reorder(documentId, page.key, position - 1),
    });
  }
  if (reorder && labels.movePageLater !== undefined) {
    items.push({
      id: "later",
      label: labels.movePageLater,
      disabled: position >= pages.length - 1,
      onSelect: () => reorder(documentId, page.key, position + 1),
    });
  }
  const move = actions.onMovePage;
  const option = labels.documentOption;
  if (
    move &&
    option &&
    labels.moveToDocument !== undefined &&
    labels.noOtherDocument !== undefined
  ) {
    items.push({
      id: "move",
      label: labels.moveToDocument,
      empty: labels.noOtherDocument,
      children: groupDocuments
        .filter(({ document }) => document.documentId !== documentId)
        .map(({ index, document }) => ({
          id: document.documentId,
          label: option(index + 1, document.label),
          onSelect: () =>
            move(
              documentId,
              page.key,
              document.documentId,
              document.pages.length,
            ),
        })),
    });
  }
  const split = actions.onSplit;
  if (split && labels.splitBefore) {
    items.push({
      id: "split",
      label: labels.splitBefore(page),
      disabled: previous === undefined,
      onSelect: () => {
        if (previous) split(documentId, previous.key);
      },
    });
  }
  const exclude = actions.onExcludePage;
  if (exclude && labels.excludePage !== undefined) {
    items.push({
      id: "exclude",
      label: labels.excludePage,
      onSelect: () => exclude(documentId, page.key),
    });
  }
  return items;
}

/**
 * 어느 문서에도·제외에도 없는 페이지의 칸. 저장 전에 고쳐야 하는 자리라 빨간 점선 칸으로 보이고,
 * 누르거나 끌 수 없다. 메뉴("새 문서로", 콜백이 있을 때)만 둔다.
 */
export function UnplacedCell({
  page,
  size,
  disabled,
  labels,
  testId,
  actions,
}: {
  page: StructurePage;
  size: PageGridSize;
  disabled: boolean;
  labels: PageGridLabels;
  testId?: string;
  actions: PageGridActions;
}) {
  const toNew = actions.onRestoreToNewDocument;
  const menu: readonly StructureMenuItem[] =
    toNew && labels.restoreToNewDocument
      ? [
          {
            id: "new-document",
            label: labels.restoreToNewDocument,
            onSelect: () => toNew(page.key),
          },
        ]
      : NO_ITEMS;
  const menuName = labels.unplacedMenu?.(page) ?? labels.pageMenu?.(page);
  return (
    <div
      data-page-grid-page={page.key}
      title={labels.missing}
      className={cn(
        "flex shrink-0 flex-col items-center gap-1",
        COLUMN_CLASS[size],
      )}
    >
      <span
        className={cn(
          "flex items-center justify-center rounded-md border-2 border-dashed border-destructive text-xs text-destructive",
          THUMBNAIL_CLASS[size],
        )}
      >
        ?
      </span>
      <div className="flex w-full min-w-0 items-center gap-0.5">
        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground tabular-nums">
          {labels.page(page)}
        </span>
        {menuName !== undefined ? (
          <CellMenu
            name={menuName}
            items={menu}
            disabled={disabled}
            testId={tid(testId, "unplaced-menu")}
          />
        ) : null}
      </div>
    </div>
  );
}

/**
 * ⋯ 메뉴(`dropdown-menu` adapter). 항목이 없으면 버튼만 비활성으로 둔다. testid 는
 * `<testId>-open`, 항목은 `<testId>-<id>`, 하위 항목은 `<testId>-<id>-select`.
 */
export function CellMenu({
  name,
  items,
  disabled,
  testId,
  align = "start",
  className,
  triggerRef,
}: {
  name: string;
  items: readonly StructureMenuItem[];
  disabled: boolean;
  testId?: string;
  align?: "start" | "end";
  className?: string;
  /** ⋯ 버튼 요소(문서 머리 메뉴를 `menuButtonsRef` 로 찾게 할 때). */
  triggerRef?: Ref<HTMLButtonElement>;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled || items.length === 0}>
        <button
          ref={triggerRef}
          type="button"
          aria-label={name}
          data-testid={tid(testId, "open")}
          className={cn(MENU_BUTTON_CLASS, className)}
        >
          ⋯
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        {items.map(item =>
          item.children ? (
            <DropdownMenuSub key={item.id}>
              <DropdownMenuSubTrigger
                disabled={item.disabled}
                data-testid={tid(testId, item.id)}
              >
                {item.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                {item.children.length === 0 ? (
                  <DropdownMenuItem disabled>{item.empty}</DropdownMenuItem>
                ) : (
                  item.children.map(child => (
                    <DropdownMenuItem
                      key={child.id}
                      onSelect={child.onSelect}
                      data-testid={tid(testId, `${item.id}-select`)}
                    >
                      {child.label}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          ) : (
            <DropdownMenuItem
              key={item.id}
              disabled={item.disabled}
              onSelect={item.onSelect}
              data-testid={tid(testId, item.id)}
            >
              {item.label}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
