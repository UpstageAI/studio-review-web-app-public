import { useCallback, type MouseEvent, type ReactNode, type Ref } from "react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { LabelField, LabelText } from "../shared/label-field";
import {
  documentMenuItems,
  excludedPageMenuItems,
  type StructureMenuItem,
} from "../shared/menu";
import { tid } from "../shared/test-id";
import { startDrag } from "./drag";
import type {
  DragHandlers,
  FilmstripCallbacks,
  FilmstripLabels,
  FilmstripProps,
  WindowViewport,
} from "./filmstrip";
import { Thumbnail } from "./thumbnail";
import {
  pageMenuItems,
  pageWindow,
  THUMBNAIL_PITCH,
  type StripPresentation,
} from "./window";
import type {
  StructureClickModifiers,
  StructureDocument,
  StructureLoosePage,
  StructurePage,
} from "../shared/types";

/** 썸네일 클릭의 보조 키(페이지 격자와 같은 규칙: shift, ⌘ 또는 Ctrl). */
function clickModifiers(event: MouseEvent): StructureClickModifiers {
  return { shift: event.shiftKey, toggle: event.metaKey || event.ctrlKey };
}

type StripProps = Partial<
  Pick<
    FilmstripCallbacks,
    | "onReorderPage"
    | "onMovePage"
    | "onSplit"
    | "onMergeInto"
    | "onReorderDocument"
    | "onExcludePage"
    | "onLabelChange"
    | "onExcludeDocument"
    | "onRestoreDocument"
    | "onThumbnailClick"
  >
> &
  Pick<FilmstripProps, "onFocusDocument" | "onRequestDocumentPosition"> & {
    strip: StructureDocument;
    index: number;
    strips: readonly StructureDocument[];
    /** 띠를 그리는 방식(전체 · 접힌 이웃 · 펼침). */
    presentation: StripPresentation;
    /** 펼친 띠에서 스크롤 창이 보고 있는 범위(`ol` 왼쪽 기준 x). 없으면 앞쪽 몇 칸만 그린다. */
    windowViewport?: WindowViewport;
    /** 펼친 띠에서 보이는 범위 앞·뒤에 더 그리는 칸 수. */
    overscan?: number;
    /** 펼친 띠의 `ol`. 부모가 스크롤 위치를 재는 데 쓴다. */
    olRef?: Ref<HTMLOListElement>;
    selectedPageKey: string | null;
    disabled: boolean;
    labels: FilmstripLabels;
    labelMaxLength?: number;
    commitLabelOnUnmount: boolean;
    testId?: string;
    handlers: DragHandlers;
    /** 띠 메뉴 버튼을 문서 id 로 등록한다. 돌려준 함수는 등록을 지운다. */
    registerMenuButton: (
      documentId: string,
      element: HTMLElement,
    ) => () => void;
  };

/** 작은 글자 버튼(띠 제목 · 접기/펼치기). */
const TEXT_BUTTON =
  "cursor-pointer rounded-md text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden";

/**
 * 문서 하나의 띠: 머리(끌기 손잡이·제목·라벨·메뉴)와 페이지 썸네일 줄. 접힌 이웃 띠는 가까운 쪽
 * 몇 쪽과 숨은 쪽수 칩만, 펼친 띠는 칸 폭을 고정하고 보이는 범위만 그린다(나머지는 스페이서).
 * 콜백에 넘기는 페이지 위치는 어느 방식이든 띠 안 전체 기준(0-based)이다.
 */
export function Strip({
  strip,
  index,
  strips,
  presentation,
  windowViewport,
  overscan,
  olRef,
  selectedPageKey,
  disabled,
  labels,
  labelMaxLength,
  commitLabelOnUnmount,
  testId,
  handlers,
  onReorderPage,
  onMovePage,
  onSplit,
  onMergeInto,
  onReorderDocument,
  onExcludePage,
  onLabelChange,
  onExcludeDocument,
  onRestoreDocument,
  onThumbnailClick,
  onFocusDocument,
  onRequestDocumentPosition,
  registerMenuButton,
}: StripProps) {
  const inert = disabled || Boolean(strip.locked);
  const { documentId } = strip;
  const menuButtonRef = useCallback(
    (element: HTMLButtonElement | null) =>
      element ? registerMenuButton(documentId, element) : undefined,
    [registerMenuButton, documentId],
  );
  const menuIds: readonly string[] = pageMenuItems(presentation.kind);
  // 콜백(과 그 문구)이 있는 조작부만 그린다.
  const canDragDocument =
    Boolean(onReorderDocument || onMergeInto) &&
    labels.dragDocument !== undefined;
  const canDragPage = Boolean(onReorderPage || onMovePage || onExcludePage);
  const splitAfter = onSplit ? labels.splitAfter : undefined;
  const labelFieldLabels =
    onLabelChange &&
    labels.label !== undefined &&
    labels.noLabel !== undefined &&
    labels.notInConfigOption
      ? {
          label: labels.label,
          noLabel: labels.noLabel,
          notInConfigOption: labels.notInConfigOption,
          untitled: labels.untitled,
        }
      : null;
  const documentMenu = documentMenuItems({
    document: strip,
    index,
    documents: strips,
    labels,
    actions: {
      onMergeInto,
      onReorderDocument,
      onExcludeDocument,
      onRestoreDocument,
      onRequestDocumentPosition,
    },
  });
  const others = strips
    .map((item, position) => ({ item, position }))
    .filter(
      ({ item }) =>
        item.documentId !== strip.documentId &&
        item.groupId === strip.groupId &&
        !item.locked,
    );
  const target = handlers.target;
  const pageTarget =
    target?.kind === "pages" && target.documentId === strip.documentId
      ? target
      : null;
  const mergeTarget =
    target?.kind === "merge" && target.documentId === strip.documentId
      ? target
      : null;
  // 사유 없는 페이지 거부(자리가 그대로인 drop)는 표시하지 않는다.
  const rejectedTarget =
    pageTarget?.ok === false && pageTarget.reason !== undefined
      ? pageTarget
      : mergeTarget?.ok === false
        ? mergeTarget
        : null;
  const rejected = rejectedTarget !== null;
  const dragging =
    handlers.drag?.kind === "strip" &&
    handlers.drag.documentId === strip.documentId;
  const rejectedText = rejectedTarget
    ? rejectedTarget.reason === "locked"
      ? labels.dropRejectedLocked
      : labels.dropRejected
    : undefined;

  /** 썸네일 앞 분리 자리: 앞 페이지가 있고 `onSplit`·`labels.splitAfter` 가 있으면 ✂. */
  const splitSlot = (position: number, slot: PageSlot): ReactNode => {
    if (slot === "none") return null;
    const before = position > 0 ? strip.pages[position - 1] : undefined;
    if (before && onSplit && splitAfter) {
      return (
        <SplitButton
          disabled={inert}
          label={splitAfter(before)}
          testId={tid(testId, "split-button")}
          onClick={() => onSplit(strip.documentId, before.key)}
        />
      );
    }
    // 펼친 띠의 첫 칸과 나누기가 없는 띠의 칸은 분리 자리를 빈칸으로 채워 폭·간격을 맞춘다.
    return slot === "fixed" || position > 0 ? (
      <span aria-hidden="true" className="mx-0.5 w-5 shrink-0" />
    ) : null;
  };

  /** 썸네일 메뉴 항목(왼쪽으로·오른쪽으로·다른 문서로 ▸·제외). 콜백과 문구가 있는 항목만. */
  const pageMenu = (
    page: StructurePage,
    position: number,
  ): StructureMenuItem[] => {
    const items: StructureMenuItem[] = [];
    if (onReorderPage && labels.movePageEarlier !== undefined) {
      items.push({
        id: "left",
        label: labels.movePageEarlier,
        disabled: position === 0,
        onSelect: () => onReorderPage(strip.documentId, page.key, position - 1),
      });
    }
    if (onReorderPage && labels.movePageLater !== undefined) {
      items.push({
        id: "right",
        label: labels.movePageLater,
        disabled: position === strip.pages.length - 1,
        onSelect: () => onReorderPage(strip.documentId, page.key, position + 1),
      });
    }
    const option = labels.documentOption;
    if (
      onMovePage &&
      option &&
      labels.moveToDocument !== undefined &&
      labels.noOtherDocument !== undefined
    ) {
      items.push({
        id: "move",
        label: labels.moveToDocument,
        empty: labels.noOtherDocument,
        children: others.map(({ item, position: at }) => ({
          id: item.documentId,
          label: option(at + 1, item.label),
          onSelect: () =>
            onMovePage(
              strip.documentId,
              page.key,
              item.documentId,
              item.pages.length,
            ),
        })),
      });
    }
    if (onExcludePage && labels.excludePage !== undefined) {
      items.push({
        id: "exclude",
        label: labels.excludePage,
        onSelect: () => onExcludePage(strip.documentId, page.key),
      });
    }
    return items;
  };

  return (
    <section
      aria-label={labels.document(index + 1)}
      data-document-id={strip.documentId}
      className={cn(
        "flex min-w-40 shrink-0 flex-col gap-2 rounded-lg border bg-card p-2",
        rejected
          ? "border-destructive"
          : mergeTarget?.ok
            ? "border-primary bg-accent"
            : "border-border",
        (strip.locked || strip.excluded) && "opacity-60",
        dragging && "opacity-50",
      )}
      onDragOver={event => handlers.overStrip(event, strip)}
      onDrop={handlers.drop}
    >
      <header
        className={cn(
          "flex min-w-0 items-center gap-1.5",
          // 펼친 띠는 창보다 훨씬 길어 머리(제목·라벨·메뉴)가 스크롤을 따라오게 한다.
          presentation.kind === "windowed" && "sticky left-2 w-fit max-w-full",
        )}
      >
        {canDragDocument ? (
          <span
            draggable={!inert}
            onDragStart={event => {
              const payload = {
                kind: "strip" as const,
                documentId: strip.documentId,
                groupId: strip.groupId,
                index,
              };
              startDrag(event, payload);
              handlers.begin(payload);
            }}
            onDragEnd={handlers.end}
            title={labels.dragDocument}
            aria-hidden="true"
            data-testid={tid(testId, "strip-handle")}
            className={cn(
              "shrink-0 px-0.5 text-sm leading-none text-muted-foreground select-none",
              inert ? "cursor-not-allowed" : "cursor-grab",
            )}
          >
            ⠿
          </span>
        ) : null}
        {presentation.kind === "collapsed" &&
        onFocusDocument &&
        labels.neighborhood ? (
          <button
            type="button"
            aria-label={labels.neighborhood.focusDocument(index + 1)}
            title={labels.neighborhood.focusDocument(index + 1)}
            onClick={() => onFocusDocument(strip.documentId)}
            data-testid={tid(testId, "strip-focus")}
            className={cn(TEXT_BUTTON, "shrink-0 font-medium")}
          >
            {labels.document(index + 1)}
          </button>
        ) : (
          <span className="shrink-0 text-xs font-medium text-muted-foreground">
            {labels.document(index + 1)}
          </span>
        )}
        {onLabelChange && labelFieldLabels ? (
          <LabelField
            document={strip}
            disabled={inert}
            labels={labelFieldLabels}
            maxLength={labelMaxLength}
            testId={testId}
            onLabelChange={onLabelChange}
            commitOnUnmount={commitLabelOnUnmount}
          />
        ) : (
          <LabelText label={strip.label} untitled={labels.untitled} />
        )}
        {documentMenu.length > 0 && labels.documentMenu ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild disabled={inert}>
              <button
                ref={menuButtonRef}
                type="button"
                aria-label={labels.documentMenu(index + 1)}
                data-testid={tid(testId, "strip-menu-open")}
                className="ml-auto inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50"
              >
                ⋯
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {documentMenu.map(item => (
                <DropdownMenuItem
                  key={item.id}
                  disabled={item.disabled}
                  onSelect={item.onSelect}
                  data-testid={tid(testId, `strip-menu-${item.id}`)}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      {strip.labelNotInConfig ||
      (strip.excluded && labels.documentExclusion) ? (
        <div className="flex flex-wrap gap-1">
          {strip.excluded && labels.documentExclusion ? (
            <Badge variant="secondary">{labels.documentExclusion.badge}</Badge>
          ) : null}
          {strip.labelNotInConfig ? (
            <Badge variant="outline" title={labels.notInConfigHint}>
              {labels.notInConfigBadge}
            </Badge>
          ) : null}
        </div>
      ) : null}
      <ol
        ref={olRef}
        role="list"
        data-testid={tid(testId, "strip-pages")}
        className={cn(
          "flex min-h-24 items-start",
          presentation.kind === "collapsed" && "gap-1",
        )}
        onDragOver={event => handlers.overPages(event, strip, presentation)}
        onDrop={handlers.drop}
      >
        {pageItems({
          strip,
          presentation,
          windowViewport,
          overscan,
          labels,
          testId,
          renderPage: (page, position, slot) => (
            <li
              // 같은 페이지가 한 문서에 두 번 있을 수 있어(겹침) 위치를 키에 더한다.
              key={`${page.key}#${position}`}
              className="flex shrink-0 items-start"
              // 펼친 띠는 칸 폭을 고정해 x 좌표로 drop 위치를 계산할 수 있게 한다.
              style={slot === "none" ? undefined : { width: THUMBNAIL_PITCH }}
            >
              {splitSlot(position, slot)}
              <Thumbnail
                page={page}
                selected={selectedPageKey === page.key}
                insertBefore={
                  pageTarget?.ok === true && pageTarget.index === position
                }
                insertAfter={
                  pageTarget?.ok === true &&
                  position === strip.pages.length - 1 &&
                  pageTarget.index === strip.pages.length
                }
                disabled={inert}
                draggable={canDragPage}
                labels={labels}
                testId={testId}
                onClick={
                  onThumbnailClick
                    ? event =>
                        onThumbnailClick(
                          strip.documentId,
                          page.key,
                          position,
                          clickModifiers(event),
                        )
                    : undefined
                }
                onDragStart={event => {
                  const payload = {
                    kind: "page" as const,
                    documentId: strip.documentId,
                    pageKey: page.key,
                    groupId: strip.groupId,
                    index: position,
                  };
                  startDrag(event, payload);
                  handlers.begin(payload);
                }}
                onDragEnd={handlers.end}
                menu={pageMenu(page, position).filter(item =>
                  menuIds.includes(item.id),
                )}
              />
            </li>
          ),
        })}
      </ol>
      <p
        className={cn(
          "flex items-center justify-between gap-2 text-xs text-muted-foreground",
          presentation.kind === "windowed" && "sticky left-2 w-fit max-w-full",
        )}
      >
        <span className="tabular-nums">
          {labels.pageCount(strip.pages.length)}
        </span>
        {rejectedText !== undefined ? (
          <span role="status" className="text-destructive">
            {rejectedText}
          </span>
        ) : null}
      </p>
    </section>
  );
}

/**
 * 썸네일 칸의 모양. `auto` 는 전체 보기(앞 칸에 ✂, 폭은 내용대로), `fixed` 는 펼친 띠(폭을
 * `THUMBNAIL_PITCH` 로 고정, 첫 칸은 빈 자리로 맞춤), `none` 은 접힌 이웃 띠(✂ 없음).
 */
type PageSlot = "auto" | "fixed" | "none";

/**
 * 띠의 `ol` 안 항목. 접힌 이웃 띠는 가까운 쪽 페이지와 숨은 쪽수 칩(앞 문서는 칩이 앞에, 뒤 문서는
 * 뒤에), 펼친 띠는 보이는 범위의 칸과 앞·뒤 스페이서, 전체 보기는 모든 페이지. `renderPage` 에
 * 넘기는 `position` 은 띠 안 전체 기준이다.
 */
function pageItems({
  strip,
  presentation,
  windowViewport,
  overscan,
  labels,
  testId,
  renderPage,
}: {
  strip: StructureDocument;
  presentation: StripPresentation;
  windowViewport?: WindowViewport;
  overscan?: number;
  labels: FilmstripLabels;
  testId?: string;
  renderPage: (
    page: StructurePage,
    position: number,
    slot: PageSlot,
  ) => ReactNode;
}): ReactNode[] {
  const pages = strip.pages;
  if (presentation.kind === "collapsed") {
    const { side, offset, visible, hidden } = presentation;
    const chip =
      hidden > 0 ? (
        <li key="collapsed-chip" className="flex h-20 shrink-0 items-center">
          <Badge
            variant="secondary"
            className="tabular-nums"
            data-testid={tid(testId, "strip-collapsed-chip")}
          >
            {labels.neighborhood?.collapsedPages(hidden) ??
              labels.pageCount(hidden)}
          </Badge>
        </li>
      ) : null;
    const items = pages
      .slice(offset, offset + visible)
      .map((page, i) => renderPage(page, offset + i, "none"));
    return side === "end" ? [chip, ...items] : [...items, chip];
  }
  if (presentation.kind === "windowed") {
    const window = pageWindow({
      count: pages.length,
      viewportStart: windowViewport?.start ?? 0,
      viewportEnd: windowViewport?.end ?? 0,
      pitch: THUMBNAIL_PITCH,
      overscan,
    });
    // 스페이서는 flex 안에서 줄어들지 않아야 띠 전체 폭이 페이지 수 × 칸 폭으로 유지된다.
    return [
      window.leadWidth > 0 ? (
        <li
          key="lead"
          aria-hidden="true"
          className="shrink-0"
          style={{ width: window.leadWidth }}
        />
      ) : null,
      ...pages
        .slice(window.start, window.end)
        .map((page, i) => renderPage(page, window.start + i, "fixed")),
      window.trailWidth > 0 ? (
        <li
          key="trail"
          aria-hidden="true"
          className="shrink-0"
          style={{ width: window.trailWidth }}
        />
      ) : null,
    ];
  }
  return pages.map((page, position) => renderPage(page, position, "auto"));
}

/** 페이지 사이 ✂ — 앞 페이지 뒤에서 자른다. 포인터를 올리거나 포커스하면 보인다. */
function SplitButton({
  disabled,
  label,
  testId,
  onClick,
}: {
  disabled: boolean;
  label: string;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className="mx-0.5 mt-8 inline-flex h-6 w-5 shrink-0 cursor-pointer items-center justify-center rounded-md text-xs text-muted-foreground opacity-40 hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-0 motion-reduce:transition-none"
    >
      ✂
    </button>
  );
}

/**
 * 어느 문서에도·제외에도 없는 페이지. 저장 전에 고쳐야 하는 자리라 빨간 점선 칸으로 보인다.
 * `onRestoreToNewDocument` 가 있으면 칸을 눌러 그 페이지로 새 문서를 만든다.
 */
export function UnplacedLane({
  pages,
  disabled,
  labels,
  testId,
  collapsed = false,
  onToggle,
  onRestoreToNewDocument,
}: {
  pages: readonly StructureLoosePage[];
  disabled: boolean;
  labels: FilmstripLabels;
  testId?: string;
  /** 페이지 대신 개수 칩만 보인다(`onToggle` 과 `labels.neighborhood` 가 있을 때만). */
  collapsed?: boolean;
  /** 접기·펼치기 버튼. 없으면 늘 펼쳐 있다. */
  onToggle?: () => void;
  onRestoreToNewDocument?: FilmstripCallbacks["onRestoreToNewDocument"];
}) {
  // 메뉴 항목 하나("새 문서로")는 콜백과 문구가 함께 있을 때만(`shared/menu.ts` 의 짝 판정과 같은 truthy).
  const menuLabel =
    onRestoreToNewDocument && labels.restoreToNewDocument
      ? labels.restoreToNewDocument
      : undefined;
  const box =
    "flex h-20 w-16 items-center justify-center rounded-md border-2 border-dashed border-destructive text-xs text-destructive";
  const folded = collapsed && Boolean(onToggle && labels.neighborhood);
  return (
    <section
      aria-label={labels.unplaced}
      data-testid={tid(testId, "unplaced")}
      className="mr-3 flex min-w-32 shrink-0 flex-col gap-2 rounded-lg border border-dashed border-destructive p-2"
    >
      <h3 className="text-xs font-medium text-destructive">
        {labels.unplaced}
      </h3>
      {folded ? (
        <LaneFolded
          count={pages.length}
          labels={labels}
          testId={tid(testId, "unplaced-expand")}
          onToggle={onToggle}
        />
      ) : (
        <ol role="list" className="flex min-h-24 items-start gap-2">
          {pages.map((page, position) => {
            const menuName = menuLabel
              ? (labels.unplacedMenu?.(page) ?? labels.pageMenu?.(page))
              : undefined;
            return (
              <li
                key={`${page.key}#${position}`}
                title={labels.missing}
                className="flex w-16 shrink-0 flex-col items-center gap-1"
              >
                {onRestoreToNewDocument &&
                menuLabel &&
                menuName !== undefined ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild disabled={disabled}>
                      <button
                        type="button"
                        aria-label={menuName}
                        data-testid={tid(testId, "unplaced-menu-open")}
                        className={cn(
                          box,
                          "cursor-pointer bg-background hover:bg-muted focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
                        )}
                      >
                        ?
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem
                        onSelect={() => onRestoreToNewDocument(page.key)}
                        data-testid={tid(testId, "unplaced-menu-new-document")}
                      >
                        {menuLabel}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : (
                  <span className={box}>?</span>
                )}
                <span className="w-full truncate text-center text-xs text-muted-foreground">
                  {labels.page(page)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {!folded && onToggle && labels.neighborhood ? (
        <LaneToggle
          label={labels.neighborhood.collapse}
          testId={tid(testId, "unplaced-collapse")}
          onClick={onToggle}
        />
      ) : null}
    </section>
  );
}

/** 접힌 제외·빠진 페이지 띠의 내용: 쪽수 칩과 펼치기 버튼. */
function LaneFolded({
  count,
  labels,
  testId,
  onToggle,
}: {
  count: number;
  labels: FilmstripLabels;
  testId?: string;
  onToggle?: () => void;
}) {
  return (
    <div className="flex min-h-24 flex-col items-start gap-2">
      <Badge variant="secondary" className="tabular-nums">
        {labels.pageCount(count)}
      </Badge>
      {onToggle && labels.neighborhood ? (
        <LaneToggle
          label={labels.neighborhood.expand}
          testId={testId}
          onClick={onToggle}
        />
      ) : null}
    </div>
  );
}

function LaneToggle({
  label,
  testId,
  onClick,
}: {
  label: string;
  testId?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(TEXT_BUTTON, "self-start px-1")}
    >
      {label}
    </button>
  );
}

/**
 * 맨 끝 제외 띠: 페이지를 놓으면 제외되고, 메뉴나 문서 띠로 끌어 되돌린다. 접혀 있어도 drop 은
 * 받는다(되돌리기 메뉴는 펼친 뒤에).
 */
export function ExcludedLane({
  pages,
  strips,
  disabled,
  labels,
  testId,
  handlers,
  collapsed = false,
  onToggle,
  onRestorePage,
  onRestoreToNewDocument,
  onThumbnailClick,
}: {
  pages: readonly StructureLoosePage[];
  strips: readonly StructureDocument[];
  disabled: boolean;
  labels: FilmstripLabels;
  testId?: string;
  handlers: DragHandlers;
  /** 페이지 대신 개수 칩만 보인다(`onToggle` 과 `labels.neighborhood` 가 있을 때만). */
  collapsed?: boolean;
  /** 접기·펼치기 버튼. 없으면 늘 펼쳐 있다. */
  onToggle?: () => void;
  onRestorePage?: FilmstripCallbacks["onRestorePage"];
  onRestoreToNewDocument?: FilmstripCallbacks["onRestoreToNewDocument"];
  onThumbnailClick?: FilmstripCallbacks["onThumbnailClick"];
}) {
  const target = handlers.target?.kind === "excluded" ? handlers.target : null;
  const folded = collapsed && Boolean(onToggle && labels.neighborhood);
  return (
    <section
      aria-label={labels.excluded}
      data-testid={tid(testId, "excluded")}
      className={cn(
        "flex min-w-32 shrink-0 flex-col gap-2 rounded-lg border border-dashed bg-muted/50 p-2",
        target
          ? target.ok
            ? "border-primary"
            : "border-destructive"
          : "border-border",
      )}
      onDragOver={handlers.overExcluded}
      onDrop={handlers.drop}
    >
      <h3 className="text-xs font-medium text-muted-foreground">
        {labels.excluded}
      </h3>
      {folded ? (
        <LaneFolded
          count={pages.length}
          labels={labels}
          testId={tid(testId, "excluded-expand")}
          onToggle={onToggle}
        />
      ) : pages.length === 0 ? (
        <p className="flex min-h-24 max-w-40 items-center text-xs text-muted-foreground">
          {labels.excludedEmpty}
        </p>
      ) : (
        <ol role="list" className="flex min-h-24 items-start gap-2 opacity-70">
          {pages.map((page, position) => {
            const targets = strips
              .map((document, at) => ({ index: at, document }))
              .filter(
                ({ document }) =>
                  document.groupId === page.groupId && !document.locked,
              );
            return (
              <li key={`${page.key}#${position}`} className="flex shrink-0">
                <Thumbnail
                  page={page}
                  selected={false}
                  insertBefore={false}
                  insertAfter={false}
                  disabled={disabled}
                  draggable={Boolean(onRestorePage)}
                  labels={labels}
                  testId={testId}
                  onClick={
                    onThumbnailClick
                      ? event =>
                          onThumbnailClick(
                            null,
                            page.key,
                            position,
                            clickModifiers(event),
                          )
                      : undefined
                  }
                  onDragStart={event => {
                    const payload = {
                      kind: "page" as const,
                      documentId: null,
                      pageKey: page.key,
                      groupId: page.groupId,
                      index: position,
                    };
                    startDrag(event, payload);
                    handlers.begin(payload);
                  }}
                  onDragEnd={handlers.end}
                  menu={excludedPageMenuItems({
                    pageKey: page.key,
                    targets,
                    labels,
                    actions: { onRestorePage, onRestoreToNewDocument },
                  })}
                />
              </li>
            );
          })}
        </ol>
      )}
      {!folded && onToggle && labels.neighborhood ? (
        <LaneToggle
          label={labels.neighborhood.collapse}
          testId={tid(testId, "excluded-collapse")}
          onClick={onToggle}
        />
      ) : null}
    </section>
  );
}
