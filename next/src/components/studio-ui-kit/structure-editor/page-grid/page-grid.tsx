import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/utils";
import type { StructureEditorCallbacks } from "../shared/callbacks";
import {
  EDGE_MAX_SPEED,
  EDGE_ZONE,
  edgeScrollVelocity,
  indexAfterRemoval,
  watchStaleDrag,
} from "../shared/drag-core";
import type {
  StructureEditLabelKey,
  StructureEditorLabels,
} from "../shared/labels";
import { tid } from "../shared/test-id";
import type {
  StructureMenuButtons,
  StructureSelectedPage,
  StructureDocument,
  StructureDropSpot,
  StructureLoosePage,
  StructurePage,
} from "../shared/types";
import { Cell, UnplacedCell } from "./cell";
import {
  dropVerdict,
  expandDrag,
  indexAfterRemovingPages,
  isMultiDrag,
  isPageGridDrag,
  sameTarget,
  startDrag,
  type DragPayload,
  type DropTarget,
} from "./drag";
import { BlockHeader } from "./header";
import {
  blockPages,
  buildGridRows,
  columnsFor,
  dropIndexInRow,
  gridWindow,
  rowHeightOf,
  rowOfPage,
  scrollTopToRevealSpan,
  segmentSpacers,
  windowSegments,
  type GridRow,
  type PageGridSize,
  type RowSegment,
} from "./rows";

/** 공통 편집 콜백(`StructureEditorCallbacks` 의 옛 이름). 썸네일 클릭은 보조 키를 함께 넘긴다. */
export type PageGridCallbacks = StructureEditorCallbacks;

/** 여러 장 끌기 문구. `onDropPages` 와 함께 넘긴다. */
export interface PageGridMultiDragLabels {
  /** 여러 장을 함께 끌 때 포인터 옆 배지(예: n => `${n}장`) */
  dragCount: (count: number) => string;
  /** 여러 장을 함께 끄는 동안 바닥 상태 줄(예: n => `${n}장을 함께 옮기는 중`) */
  dragging: (count: number) => string;
}

/** 크기 토글 문구. `onSizeChange` 와 함께 넘긴다. */
export interface PageGridSizeToggleLabels {
  /** 토글 묶음의 접근성 이름 */
  size: string;
  /** S 버튼 이름 */
  sizeSmall: string;
  /** M 버튼 이름 */
  sizeMedium: string;
  /** S 버튼에 보이는 짧은 글자. 없으면 기호 `S`. */
  sizeSmallShort?: string;
  /** M 버튼에 보이는 짧은 글자. 없으면 기호 `M`. */
  sizeMediumShort?: string;
}

/**
 * 공통 문구 + 페이지 격자 전용 문구. 편집 조작부에만 쓰는 문구(`StructureEditLabelKey`·`splitBefore`)는
 * 선택이다 — 그 조작부를 켜는 콜백과 함께 넘긴다. 읽기 전용으로 쓸 때는 보기 문구만 넘기면 된다.
 */
export interface PageGridLabels
  extends
    Omit<StructureEditorLabels, StructureEditLabelKey>,
    Partial<Pick<StructureEditorLabels, StructureEditLabelKey>> {
  /** ✂ 버튼·셀 메뉴 "이 페이지 앞에서 나누기". `onSplit` 과 함께 넘긴다. */
  splitBefore?: (page: StructurePage) => string;
  /** 여러 장 끌기 문구. 없으면 장 수 배지·바닥 줄을 보이지 않는다. */
  multiDrag?: PageGridMultiDragLabels;
  /** 크기 토글 문구. 없으면 `onSizeChange` 가 있어도 토글을 그리지 않는다. */
  sizeToggle?: PageGridSizeToggleLabels;
}

export interface PageGridProps
  extends Omit<ComponentProps<"div">, "children">, Partial<PageGridCallbacks> {
  /** 문서 배치 순서대로. */
  documents: readonly StructureDocument[];
  excluded: readonly StructureLoosePage[];
  /** 어느 문서에도·제외에도 없는 페이지. 있을 때만 칸이 생긴다. */
  unplaced?: readonly StructureLoosePage[];
  /** 이 위치(0-based)의 문서 뒤에서 파일 그룹이 바뀐다. */
  groupBoundariesAfter?: readonly number[];
  /** 뷰어가 보는 페이지(`aria-current`). 바뀌면 그 행이 창 밖일 때만 창을 옮긴다. */
  selectedPage?: StructureSelectedPage | null;
  /**
   * 여러 장 선택에 든 페이지 키. 있으면 문서 셀이 `aria-pressed`·`data-selected` 와 선택 표시를 갖는다
   * (제외 칸 셀은 고를 수 없다). 선택 규칙은 밖에서 `onThumbnailClick` 의 보조 키로 정한다.
   */
  multiSelected?: ReadonlySet<string>;
  /** 썸네일 크기. 기본 S. */
  size?: PageGridSize;
  /** 있으면(`labels.sizeToggle` 과 함께) 격자 위에 S · M 토글을 그린다. */
  onSizeChange?: (size: PageGridSize) => void;
  /** 끌기·메뉴·라벨을 모두 막는다. */
  disabled?: boolean;
  /**
   * 문서 구성 보기 전용. 편집 콜백(`onReorderPage`·`onMovePage`·`onSplit`·`onMergeInto`·
   * `onReorderDocument`·`onExcludePage`·`onRestorePage`·`onLabelChange`·`onExcludeDocument`·
   * `onRestoreDocument`·`onRestoreToNewDocument`·`onRequestDocumentPosition`·`onDropPages`)이 넘어와도
   * 없는 것으로 다뤄 끌기·✂·메뉴 항목·라벨 편집을 그리지 않는다(`disabled` 는 그리고 막는다). 썸네일
   * 클릭·크기 토글은 그대로 동작한다.
   */
  readOnly?: boolean;
  /** 보이는 범위 위·아래에 더 그리는 행 수. 기본 2. */
  overscanRows?: number;
  /** 스크롤 창의 최대 높이(CSS 길이). 기본 `"60vh"`. */
  maxHeight?: string;
  /** 머리 메뉴 "위치 지정…". 대화상자는 밖에서 연다. */
  onRequestDocumentPosition?: (documentId: string, index: number) => void;
  /**
   * 문서 머리 메뉴(⋯) 버튼을 문서 id 로 찾는 수단. "위치 지정…" 대화상자를 닫은 뒤 포커스를 돌려줄
   * 자리처럼 host 가 버튼에 `focus()` 해야 할 때 쓴다(PageGrid 는 스스로 포커스를 옮기지 않는다).
   */
  menuButtonsRef?: Ref<StructureMenuButtons>;
  /**
   * 여러 장을 함께 끌어 놓았을 때(2 장 이상). `pageKeys` 는 문서 순 → 문서 안 순, `target.index` 는 끄는
   * 페이지를 모두 뺀 뒤 기준(0-based). 없으면 여러 장 선택에 든 셀을 잡아도 그 한 장만 끈다.
   */
  onDropPages?: (
    pageKeys: readonly string[],
    target: StructureDropSpot,
  ) => void;
  /** 셀을 끌기 시작할 때(제외 칸 셀은 `documentId: null`). 선택 밖 셀을 잡았을 때 선택을 비우는 등 밖의 규칙에 쓴다. */
  onPageDragStart?: (documentId: string | null, pageKey: string) => void;
  labels: PageGridLabels;
  /** 자유 입력 라벨의 최대 길이(`<input maxLength>`). 없으면 제한하지 않는다. */
  labelMaxLength?: number;
  /**
   * 자유 입력 라벨을 고치던 중 머리 행이 언마운트되면(스크롤로 창 밖) blur 와 같게 확정할지. 기본 `true`.
   */
  commitLabelOnUnmount?: boolean;
  /** 루트 `data-testid`. 창은 `-viewport`, 문서 머리는 `-header`(라벨 `-label-select`/`-label-input`, 메뉴 `-header-menu-open`·`-header-menu-<id>`), 셀은 `-cell-select`·`-cell-menu-open`·`-cell-menu-<id>`(하위 `-cell-menu-<id>-select`), 제외 칸 머리 `-excluded`, 빠진 칸 머리 `-unplaced`(셀 메뉴 `-unplaced-menu-open`), 크기 토글 `-size-s`·`-size-m`, drop 거부·끄는 장 수 줄 `-drop-rejected`. */
  testId?: string;
}

/**
 * 셀·머리가 쓰는 편집 콜백 묶음(없는 콜백은 그 조작부를 그리지 않는다). 하나의 객체로 묶어 memo 한
 * 셀이 같은 참조를 받게 한다.
 */
export type PageGridActions = Partial<PageGridCallbacks> &
  Pick<PageGridProps, "onRequestDocumentPosition">;

/** 셀이 drag 를 시작·끝낼 때 부르는 핸들러. 참조가 바뀌지 않아 memo 한 셀이 다시 그려지지 않는다. */
export interface GridDragHandlers {
  /** 셀이 만든 한 장 payload. 여러 장 선택에 든 셀이면 선택 전부로 넓혀 `dataTransfer` 에 싣는다. */
  begin: (payload: DragPayload, event: DragEvent<HTMLElement>) => void;
  end: () => void;
}

/** 페이지를 받을 수 있는(잠기지 않은) 문서와 그 배치 순 위치(0-based). 그룹마다 하나의 배열. */
export interface GroupDocument {
  index: number;
  document: StructureDocument;
}

const DEFAULT_OVERSCAN_ROWS = 2;
const NO_GROUP_DOCUMENTS: readonly GroupDocument[] = [];

/**
 * drop 자리를 어떻게 보일까: true 받음 · false 거부(사유 문구) · null 표시 없음. 자리가 그대로이거나
 * 이미 제외된 페이지를 제외 칸에 놓는 drop 은 아무것도 바뀌지 않으므로 거부 안내 없이 무시한다.
 */
function dropShown(target: DropTarget): boolean | null {
  if (target.ok) return true;
  return target.reason === "unchanged" || target.reason === "excluded"
    ? null
    : false;
}

/**
 * 문서별 묶음(머리 행 + 썸네일 여러 줄)을 세로 스크롤 창에 그리는 격자(제어형). 창 폭으로 열 수를,
 * 창 높이와 스크롤 위치로 그릴 행을 정해 보이는 행(위·아래 `overscanRows` 포함)만 그리고 나머지는
 * 스페이서로 채운다. 썸네일은 뷰어와 같은 페이지 이미지를 줄여 쓴다. 뷰어가 보는 페이지가 창 밖으로
 * 가면 그 행이 보이도록 창만 옮긴다(창 안이거나 끄는 중이면 아무것도 하지 않는다).
 *
 * 셀을 끌어 같은 문서 안 자리·같은 파일 그룹의 다른 문서(머리 행에 놓으면 끝)·제외 칸에 놓고, 셀·머리
 * ⋯ 메뉴로 같은 일을 키보드로 한다. 다른 그룹·잠긴 문서로의 drop 은 거부하고 바닥 줄에 사유별
 * 문구를 보이며, 자리가 그대로인 drop 은 안내 없이 무시한다. 여러 장 선택(`multiSelected`)에 든 셀을 잡으면 선택한 문서 페이지 전부를 함께 끌고
 * (`onDropPages` 가 있을 때) 포인터 옆 배지·바닥 줄에 장 수를 보인다. 끌면서 창 위·아래 가장자리에
 * 머물면 그쪽으로 스크롤하고, 끌던 셀의 행은 창 밖으로 나가도 제자리에 남겨 둔다(요소가 사라지면
 * `dragend` 가 돌아오지 않는다). 편집은 모두 콜백으로 나간다.
 */
export function PageGrid({
  documents,
  excluded,
  unplaced = [],
  groupBoundariesAfter = [],
  selectedPage = null,
  multiSelected,
  size = "s",
  onSizeChange,
  disabled = false,
  readOnly = false,
  overscanRows = DEFAULT_OVERSCAN_ROWS,
  maxHeight = "60vh",
  labels,
  labelMaxLength,
  commitLabelOnUnmount = true,
  testId,
  className,
  onReorderPage: onReorderPageProp,
  onMovePage: onMovePageProp,
  onSplit: onSplitProp,
  onMergeInto: onMergeIntoProp,
  onReorderDocument: onReorderDocumentProp,
  onExcludePage: onExcludePageProp,
  onRestorePage: onRestorePageProp,
  onLabelChange: onLabelChangeProp,
  onExcludeDocument: onExcludeDocumentProp,
  onRestoreDocument: onRestoreDocumentProp,
  onRestoreToNewDocument: onRestoreToNewDocumentProp,
  onRequestDocumentPosition: onRequestDocumentPositionProp,
  onThumbnailClick,
  onDropPages: onDropPagesProp,
  onPageDragStart,
  onDragLeave: onDragLeaveProp,
  menuButtonsRef,
  ...props
}: PageGridProps) {
  // 읽기 전용이면 편집 콜백을 없는 것으로 다룬다. 아래는 이 값만 보고 조작부를 그린다.
  const edit = <T,>(callback: T | undefined): T | undefined =>
    readOnly ? undefined : callback;
  const onReorderPage = edit(onReorderPageProp);
  const onMovePage = edit(onMovePageProp);
  const onSplit = edit(onSplitProp);
  const onMergeInto = edit(onMergeIntoProp);
  const onReorderDocument = edit(onReorderDocumentProp);
  const onExcludePage = edit(onExcludePageProp);
  const onRestorePage = edit(onRestorePageProp);
  const onLabelChange = edit(onLabelChangeProp);
  const onExcludeDocument = edit(onExcludeDocumentProp);
  const onRestoreDocument = edit(onRestoreDocumentProp);
  const onRestoreToNewDocument = edit(onRestoreToNewDocumentProp);
  const onRequestDocumentPosition = edit(onRequestDocumentPositionProp);
  const onDropPages = edit(onDropPagesProp);
  // 셀을 끌 수 있는가: 문서 셀은 받을 콜백(순서·옮기기·제외·여러 장) 중 하나라도 있을 때, 제외 칸
  // 셀은 되돌리기가 있을 때.
  const documentPageDraggable = Boolean(
    onReorderPage || onMovePage || onExcludePage || onDropPages,
  );
  const loosePageDraggable = Boolean(onRestorePage);
  // 그려진 문서 머리 메뉴 버튼(문서 id → 요소). 머리 행이 언마운트되면 항목을 지운다.
  const menuButtons = useRef(new Map<string, HTMLElement>());
  const registerMenuButton = useCallback(
    (documentId: string, element: HTMLElement) => {
      const map = menuButtons.current;
      map.set(documentId, element);
      return () => {
        if (map.get(documentId) === element) map.delete(documentId);
      };
    },
    [],
  );
  useImperativeHandle(
    menuButtonsRef,
    () => ({
      get: documentId => menuButtons.current.get(documentId) ?? null,
    }),
    [],
  );
  const viewportRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });

  // 스크롤 이벤트는 프레임당 한 번만 상태로 옮긴다.
  const onScroll = () => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      const element = viewportRef.current;
      if (element) setScrollTop(element.scrollTop);
    });
  };
  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  // 창 폭(→ 열 수)·높이(→ 보이는 행)는 붙을 때 한 번 재고 그 뒤 변화는 ResizeObserver 로 따라간다.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setViewport(previous =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = columnsFor(viewport.width, size);
  const grid = useMemo(
    () =>
      buildGridRows({
        documents,
        excluded,
        unplaced,
        groupBoundariesAfter,
        columns,
        size,
      }),
    [documents, excluded, unplaced, groupBoundariesAfter, columns, size],
  );

  const actions = useMemo<PageGridActions>(
    () => ({
      onReorderPage,
      onMovePage,
      onSplit,
      onMergeInto,
      onReorderDocument,
      onExcludePage,
      onRestorePage,
      onLabelChange,
      onExcludeDocument,
      onRestoreDocument,
      onRestoreToNewDocument,
      onRequestDocumentPosition,
      onThumbnailClick,
    }),
    [
      onReorderPage,
      onMovePage,
      onSplit,
      onMergeInto,
      onReorderDocument,
      onExcludePage,
      onRestorePage,
      onLabelChange,
      onExcludeDocument,
      onRestoreDocument,
      onRestoreToNewDocument,
      onRequestDocumentPosition,
      onThumbnailClick,
    ],
  );

  // 그룹마다 페이지를 받을 수 있는 문서 목록(셀 메뉴 "다른 문서로"·"문서로 되돌리기"). 문서가 바뀔 때만
  // 새로 만들어 memo 한 셀이 같은 참조를 받는다.
  const groupDocuments = useMemo(() => {
    const byGroup = new Map<string, GroupDocument[]>();
    documents.forEach((document, index) => {
      if (document.locked) return;
      const list = byGroup.get(document.groupId);
      if (list) list.push({ index, document });
      else byGroup.set(document.groupId, [{ index, document }]);
    });
    return byGroup;
  }, [documents]);

  // ── drag & drop ──────────────────────────────────────────────────────────
  // `dragover` 중에는 dataTransfer 를 읽을 수 없어 끌고 있는 페이지를 ref(이벤트용)와 상태(그리기용)로
  // 함께 든다. drop 자리도 같은 식이다.
  const dragRef = useRef<DragPayload | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  // 여러 장 drag 이미지(화면 밖에 그려 둔 배지).
  const ghostRef = useRef<HTMLDivElement>(null);
  // dragstart 에서 읽는 매 렌더 값. `dragHandlers` 참조를 고정한 채 최신 값을 쓰려고 ref 로 든다
  // (dragstart 는 commit 뒤에 오므로 effect 동기화로 충분하다).
  const latestRef = useRef({
    multiSelected,
    documents,
    onDropPages,
    onPageDragStart,
  });
  useEffect(() => {
    latestRef.current = {
      multiSelected,
      documents,
      onDropPages,
      onPageDragStart,
    };
  });

  // 끌면서 창 가장자리에 머물면 그쪽으로 스크롤한다. 속도는 dragover 마다 갱신하고(멈춰 있어도
  // ~50 ms 마다 온다) rAF 루프가 적용한다. 루프는 drop·dragend·창 밖으로 나갈 때·언마운트에 멈춘다.
  const edgeRef = useRef<{ velocity: number; frame: number | null }>({
    velocity: 0,
    frame: null,
  });
  const stopEdgeScroll = useCallback(() => {
    const edge = edgeRef.current;
    if (edge.frame !== null) cancelAnimationFrame(edge.frame);
    edge.frame = null;
    edge.velocity = 0;
  }, []);
  useEffect(() => stopEdgeScroll, [stopEdgeScroll]);
  // `dragend` 를 놓친 끌기를 정리하는 document 리스너의 해제 함수(끄는 동안만 있다).
  const staleDragRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      staleDragRef.current?.();
      staleDragRef.current = null;
    },
    [],
  );
  const onEdgeDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = edgeRef.current;
    edge.velocity = edgeScrollVelocity(
      event.clientY,
      rect.top,
      rect.bottom,
      EDGE_ZONE,
      EDGE_MAX_SPEED,
    );
    if (edge.frame !== null) return;
    const tick = () => {
      // drag 가 끝났는데 루프가 남아 있으면(끝 이벤트를 놓친 경우) 여기서 멈춘다.
      if (!dragRef.current) {
        stopEdgeScroll();
        return;
      }
      const element = viewportRef.current;
      const velocity = edgeRef.current.velocity;
      if (element && velocity !== 0) element.scrollTop += velocity;
      edgeRef.current.frame = requestAnimationFrame(tick);
    };
    edge.frame = requestAnimationFrame(tick);
  };

  const dragHandlers = useMemo<GridDragHandlers>(() => {
    const end = () => {
      staleDragRef.current?.();
      staleDragRef.current = null;
      dragRef.current = null;
      targetRef.current = null;
      stopEdgeScroll();
      setDrag(null);
      setTarget(null);
    };
    return {
      begin: (payload, event) => {
        const latest = latestRef.current;
        const expanded = latest.onDropPages
          ? expandDrag(payload, latest.multiSelected, latest.documents)
          : payload;
        startDrag(event, expanded);
        const ghost = ghostRef.current;
        if (
          isMultiDrag(expanded) &&
          ghost &&
          typeof event.dataTransfer.setDragImage === "function"
        ) {
          event.dataTransfer.setDragImage(ghost, 16, 16);
        }
        latest.onPageDragStart?.(payload.documentId, payload.pageKey);
        dragRef.current = expanded;
        targetRef.current = null;
        setDrag(expanded);
        setTarget(null);
        // 끌던 셀이 어떤 이유로 DOM 에서 빠지면 `dragend` 가 오지 않는다(남은 `dragRef` 는 ✂ 를 숨기고
        // 선택 행 따라가기를 멈춘다). 그 뒤 첫 포인터 이벤트에서 끌기를 정리한다.
        staleDragRef.current?.();
        staleDragRef.current = watchStaleDrag(document, end);
      },
      end,
    };
  }, [stopEdgeScroll]);

  /** drop 자리를 정한다. 받을 수 있으면 `preventDefault` 로 drop 을 허용한다. 자리가 같으면 상태를 두지 않는다. */
  const accept = (event: DragEvent<HTMLElement>, spot: StructureDropSpot) => {
    const payload = dragRef.current;
    if (!payload || !isPageGridDrag(event)) return;
    // 그 drop 을 받을 콜백이 없으면 자리로 보지 않는다(drop 을 허용하지 않고 표시도 지운다).
    if (!receiver(payload, spot)) {
      if (targetRef.current !== null) {
        targetRef.current = null;
        setTarget(null);
      }
      return;
    }
    const next: DropTarget = {
      ...spot,
      ...dropVerdict(payload, spot, documents),
    };
    if (next.ok) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    } else {
      event.dataTransfer.dropEffect = "none";
    }
    const current = targetRef.current;
    if (current && sameTarget(current, next)) return;
    targetRef.current = next;
    setTarget(next);
  };

  /**
   * drop 을 받을 콜백: 여러 장 → `onDropPages`, 제외 칸 → `onExcludePage`, 제외 칸 셀 → `onRestorePage`,
   * 같은 문서 → `onReorderPage`, 다른 문서 → `onMovePage`.
   */
  const receiver = (payload: DragPayload, spot: StructureDropSpot) => {
    if (isMultiDrag(payload)) return onDropPages;
    if (spot.kind === "excluded") return onExcludePage;
    if (payload.documentId === null) return onRestorePage;
    return payload.documentId === spot.documentId ? onReorderPage : onMovePage;
  };

  const drop = (event: DragEvent<HTMLElement>) => {
    const payload = dragRef.current;
    const at = targetRef.current;
    dragHandlers.end();
    if (!payload || !at || !at.ok || !isPageGridDrag(event)) return;
    event.preventDefault();
    if (isMultiDrag(payload)) {
      const pageKeys = payload.multi.map(page => page.pageKey);
      if (at.kind === "excluded") {
        onDropPages?.(pageKeys, { kind: "excluded" });
        return;
      }
      const positions = payload.multi
        .filter(page => page.documentId === at.documentId)
        .map(page => page.index);
      onDropPages?.(pageKeys, {
        kind: "pages",
        documentId: at.documentId,
        index: indexAfterRemovingPages(at.index, positions),
      });
      return;
    }
    if (at.kind === "excluded") {
      if (payload.documentId !== null) {
        onExcludePage?.(payload.documentId, payload.pageKey);
      }
      return;
    }
    if (payload.documentId === null) {
      onRestorePage?.(payload.pageKey, at.documentId, at.index);
    } else if (payload.documentId === at.documentId) {
      const to = indexAfterRemoval(payload.index, at.index);
      if (to !== payload.index) {
        onReorderPage?.(payload.documentId, payload.pageKey, to);
      }
    } else {
      onMovePage?.(
        payload.documentId,
        payload.pageKey,
        at.documentId,
        at.index,
      );
    }
  };

  const overExcluded = (event: DragEvent<HTMLElement>) =>
    accept(event, { kind: "excluded" });

  // 뷰어가 보는 페이지가 든 행. 행 자리가 바뀔 때(선택·열 수·크기·문서 배치)만 창을 옮기고,
  // 썸네일 URL 같은 다른 변화에는 움직이지 않는다. 스크롤 위치는 상태 대신 DOM 에서 읽는다.
  const selectedDocumentId = selectedPage?.documentId ?? null;
  const selectedKey = selectedPage?.pageKey ?? null;
  const selectedRow =
    selectedKey === null
      ? -1
      : rowOfPage(grid.rows, selectedDocumentId, selectedKey);
  const selectedTop = selectedRow >= 0 ? grid.offsets[selectedRow]! : 0;
  const selectedHeight = selectedRow >= 0 ? grid.rows[selectedRow]!.height : 0;
  useEffect(() => {
    // 끄는 중에는 창을 옮기지 않는다(drop 자리가 손 밑에서 달아난다).
    if (selectedRow < 0 || dragRef.current) return;
    const element = viewportRef.current;
    if (!element) return;
    const next = scrollTopToRevealSpan({
      top: selectedTop,
      height: selectedHeight,
      scrollTop: element.scrollTop,
      viewportHeight: element.clientHeight,
    });
    if (next !== null) {
      element.scrollTop = next;
      setScrollTop(next);
    }
  }, [selectedKey, selectedRow, selectedTop, selectedHeight]);

  const visible = gridWindow({
    offsets: grid.offsets,
    scrollTop,
    viewportHeight: viewport.height,
    overscanPx: Math.max(0, overscanRows) * rowHeightOf(size),
  });
  // 끌던 페이지의 행은 창 밖으로 나가도 제자리에 남긴다.
  const pinnedRow = drag
    ? rowOfPage(grid.rows, drag.documentId, drag.pageKey)
    : -1;
  const segments = windowSegments(visible, pinnedRow, grid.rows.length);
  // 여러 장을 끄는 중이면 끄는 문서 셀을 모두 흐리게 한다.
  const draggedKeys = useMemo(
    () =>
      drag && isMultiDrag(drag)
        ? new Set(drag.multi.map(page => page.pageKey))
        : null,
    [drag],
  );
  const spacers = segmentSpacers(grid.offsets, segments);

  const renderRow = (row: GridRow): ReactNode => {
    const { block } = row;
    if (row.kind === "header") {
      if (block.kind === "document") {
        const { documentId } = block.document;
        const count = block.document.pages.length;
        const pageTarget =
          target?.kind === "pages" && target.documentId === documentId
            ? target
            : null;
        return (
          <BlockHeader
            key={row.key}
            row={row}
            documents={documents}
            disabled={disabled}
            labels={labels}
            labelMaxLength={labelMaxLength}
            commitLabelOnUnmount={commitLabelOnUnmount}
            testId={testId}
            actions={actions}
            registerMenuButton={registerMenuButton}
            dropState={pageTarget ? dropShown(pageTarget) : null}
            // 머리 행에 놓은 페이지는 그 문서 끝으로 간다.
            onDragOver={event =>
              accept(event, { kind: "pages", documentId, index: count })
            }
            onDrop={drop}
          />
        );
      }
      const excludedTarget = block.kind === "excluded";
      return (
        <BlockHeader
          key={row.key}
          row={row}
          documents={documents}
          disabled={disabled}
          labels={labels}
          commitLabelOnUnmount={commitLabelOnUnmount}
          testId={testId}
          actions={actions}
          dropState={
            excludedTarget && target?.kind === "excluded"
              ? dropShown(target)
              : null
          }
          onDragOver={excludedTarget ? overExcluded : undefined}
          onDrop={excludedTarget ? drop : undefined}
        />
      );
    }
    if (row.kind === "empty") {
      return (
        <p
          key={row.key}
          style={{ height: row.height }}
          className="flex items-center px-2 text-xs text-muted-foreground"
          onDragOver={overExcluded}
          onDrop={drop}
        >
          {labels.excludedEmpty}
        </p>
      );
    }
    const pages = blockPages(block);
    const documentId =
      block.kind === "document" ? block.document.documentId : null;
    const inert =
      disabled || (block.kind === "document" && Boolean(block.document.locked));
    const dimmed =
      block.kind === "excluded" ||
      (block.kind === "document" &&
        Boolean(block.document.locked || block.document.excluded));
    const pageTarget =
      documentId !== null &&
      target?.kind === "pages" &&
      target.ok &&
      target.documentId === documentId
        ? target
        : null;
    const onDragOver =
      block.kind === "document"
        ? (event: DragEvent<HTMLDivElement>) => {
            // 행의 첫 셀이 x=0 이고 칸 폭이 고정이라 포인터 x 로 자리를 계산한다.
            const rect = event.currentTarget.getBoundingClientRect();
            accept(event, {
              kind: "pages",
              documentId: block.document.documentId,
              index: dropIndexInRow({
                clientX: event.clientX,
                rowLeft: rect.left,
                columns,
                size,
                rowStart: row.start,
                count: pages.length,
              }),
            });
          }
        : block.kind === "excluded"
          ? overExcluded
          : undefined;
    return (
      <div
        key={row.key}
        role="presentation"
        data-document-id={documentId ?? undefined}
        style={{ height: row.height }}
        className={cn("flex items-start gap-2", dimmed && "opacity-70")}
        onDragOver={onDragOver}
        onDrop={onDragOver ? drop : undefined}
      >
        {pages.slice(row.start, row.end).map((page, offset) => {
          const position = row.start + offset;
          // 같은 페이지가 한 문서에 두 번 있을 수 있어(겹침) 위치를 키에 더한다.
          const key = `${page.key}#${position}`;
          if (block.kind === "unplaced") {
            return (
              <UnplacedCell
                key={key}
                page={page}
                size={size}
                disabled={disabled}
                labels={labels}
                testId={testId}
                actions={actions}
              />
            );
          }
          const groupId =
            block.kind === "document"
              ? block.document.groupId
              : block.pages[position]!.groupId;
          return (
            <Cell
              key={key}
              page={page}
              documentId={documentId}
              groupId={groupId}
              pages={pages}
              position={position}
              groupDocuments={groupDocuments.get(groupId) ?? NO_GROUP_DOCUMENTS}
              size={size}
              selected={
                documentId !== null &&
                documentId === selectedDocumentId &&
                page.key === selectedKey
              }
              multiSelected={
                multiSelected === undefined || documentId === null
                  ? undefined
                  : multiSelected.has(page.key)
              }
              disabled={inert}
              draggable={
                !inert &&
                (documentId === null
                  ? loosePageDraggable
                  : documentPageDraggable)
              }
              dragging={
                draggedKeys
                  ? documentId !== null && draggedKeys.has(page.key)
                  : drag !== null &&
                    drag.documentId === documentId &&
                    drag.pageKey === page.key &&
                    drag.index === position
              }
              insertBefore={pageTarget?.index === position}
              insertAfter={
                pageTarget !== null &&
                position === pages.length - 1 &&
                pageTarget.index === pages.length
              }
              splitShown={
                block.kind === "document" &&
                !inert &&
                position > 0 &&
                drag === null
              }
              rowStart={position === row.start}
              labels={labels}
              testId={testId}
              actions={actions}
              drag={dragHandlers}
            />
          );
        })}
      </div>
    );
  };

  const rejectedText =
    target && !target.ok && dropShown(target) === false
      ? ((target.reason === "locked"
          ? labels.dropRejectedLocked
          : labels.dropRejected) ?? null)
      : null;
  const rejected = rejectedText !== null;
  const draggingText =
    drag && isMultiDrag(drag) && labels.multiDrag
      ? labels.multiDrag.dragging(drag.multi.length)
      : null;
  const statusShown = rejected || draggingText !== null;
  const ghostCount =
    onDropPages && labels.multiDrag && multiSelected && multiSelected.size >= 2
      ? multiSelected.size
      : 0;

  return (
    <div
      {...props}
      role="region"
      aria-label={labels.region}
      data-testid={testId}
      className={cn("flex min-w-0 flex-col gap-2", className)}
      onDragLeave={event => {
        onDragLeaveProp?.(event);
        // 격자 밖으로 나가면 drop 자리 표시를 지우고 가장자리 스크롤을 멈춘다.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          targetRef.current = null;
          setTarget(null);
          stopEdgeScroll();
        }
      }}
    >
      {onSizeChange && labels.sizeToggle ? (
        <div
          role="group"
          aria-label={labels.sizeToggle.size}
          className="flex shrink-0 items-center gap-1"
        >
          <SizeButton
            pressed={size === "s"}
            label={labels.sizeToggle.sizeSmall}
            testId={tid(testId, "size-s")}
            onClick={() => onSizeChange("s")}
          >
            {/* 기호이며 host 가 labels 로 덮는다. */}
            {labels.sizeToggle.sizeSmallShort ?? "S"}
          </SizeButton>
          <SizeButton
            pressed={size === "m"}
            label={labels.sizeToggle.sizeMedium}
            testId={tid(testId, "size-m")}
            onClick={() => onSizeChange("m")}
          >
            {labels.sizeToggle.sizeMediumShort ?? "M"}
          </SizeButton>
        </div>
      ) : null}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={viewportRef}
          onScroll={onScroll}
          onDragOverCapture={onEdgeDragOver}
          style={{ maxHeight }}
          data-testid={tid(testId, "viewport")}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          <GridRows
            segments={segments}
            spacers={spacers}
            rows={grid.rows}
            renderRow={renderRow}
          />
        </div>
        {/* 거부 사유·끄는 장 수는 창 바닥에 겹쳐 보여 행 자리가 흔들리지 않게 한다. 거부가 먼저다. */}
        <p
          role="status"
          data-testid={tid(testId, "drop-rejected")}
          className={cn(
            "text-xs",
            rejected ? "text-destructive" : "text-muted-foreground",
            statusShown
              ? "absolute inset-x-0 bottom-0 bg-background/90 px-2 py-1"
              : "sr-only",
          )}
        >
          {rejectedText ?? draggingText}
        </p>
      </div>
      {ghostCount > 0 && labels.multiDrag ? (
        // 여러 장 drag 이미지. `setDragImage` 가 그리려면 DOM 에 있어야 해서 화면 밖에 둔다.
        <div
          ref={ghostRef}
          aria-hidden="true"
          style={{ position: "fixed", top: -1000, left: -1000 }}
          className="rounded-md border border-primary bg-background px-2 py-1 text-xs font-medium text-foreground shadow-xs"
        >
          {labels.multiDrag.dragCount(ghostCount)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 구간마다 스페이서와 행을 viewport 바로 아래 한 목록으로 그린다(마지막 스페이서 포함). 끌던 행을 창
 * 밖에 따로 둘 때 구간이 둘이 된다. 구간 래퍼가 없고 행 key(`row.key`)가 그대로라 끌던 행이 창 안 →
 * 창 밖(고정)으로 바뀌어도 같은 요소가 남아 `dragend` 가 돌아온다. 스페이서 key 는 자리(앞·사이·뒤)라
 * 구간 수가 바뀌어도 행은 다시 마운트되지 않는다.
 */
function GridRows({
  segments,
  spacers,
  rows,
  renderRow,
}: {
  segments: readonly RowSegment[];
  spacers: readonly number[];
  rows: readonly GridRow[];
  renderRow: (row: GridRow) => ReactNode;
}) {
  const spacer = (key: string, height: number | undefined) => (
    <div key={key} aria-hidden="true" style={{ height }} />
  );
  return [
    ...segments.flatMap((segment, at) => [
      spacer(at === 0 ? "sp:lead" : "sp:mid", spacers[at]),
      ...rows.slice(segment.start, segment.end).map(renderRow),
    ]),
    spacer("sp:trail", spacers[spacers.length - 1]),
  ];
}

/** 크기 토글 한 칸(S · M). 눌린 쪽이 `aria-pressed`. */
function SizeButton({
  pressed,
  label,
  testId,
  onClick,
  children,
}: {
  pressed: boolean;
  label: string;
  testId?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      title={label}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "inline-flex size-7 cursor-pointer items-center justify-center rounded-md border text-xs font-medium focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-hidden",
        pressed
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}
