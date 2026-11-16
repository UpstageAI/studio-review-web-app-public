import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type DragEvent,
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
import type {
  StructureDocument,
  StructureLoosePage,
  StructureMenuButtons,
  StructurePage,
  StructureSelectedPage,
  StructureRejectReason,
} from "../shared/types";
import {
  dropIndexAt,
  isFilmstripDrag,
  pageDropVerdict,
  type DragPayload,
} from "./drag";
import { ExcludedLane, Strip, UnplacedLane } from "./strip";
import {
  dropIndexFromX,
  hiddenCounts,
  neighborhoodStrips,
  recenterViewport,
  THUMBNAIL_CENTER,
  THUMBNAIL_PITCH,
  type StripPresentation,
} from "./window";

/**
 * 이웃 보기: 모든 띠 대신 앞 문서(끝 몇 쪽) · 선택 문서(펼침, 보이는 범위만 그림) · 뒤 문서(앞 몇 쪽)만
 * 그린다. 쪽수가 많은 Job 에서 쓴다. `focusDocumentId` 가 `documents` 에 없으면 전체 보기로 그린다.
 */
export interface FilmstripNeighborhood {
  focusDocumentId: string;
  /** 이웃 문서에서 보이는 쪽수. 기본 3. */
  neighborPages?: number;
  /** 펼친 띠에서 보이는 범위 앞·뒤에 더 그리는 칸 수. 기본 4. */
  overscan?: number;
}

/** 이웃 보기 문구. `neighborhood` 와 함께 넘긴다. */
export interface FilmstripNeighborhoodLabels {
  /** 접힌 이웃 띠의 숨은 쪽수 칩(예: n => `…${n}쪽`) */
  collapsedPages: (count: number) => string;
  /** 이웃 띠 제목 버튼 이름(그 문서를 펼친다) — 1-based */
  focusDocument: (index: number) => string;
  /** 보이는 띠 앞에 숨은 문서 수 */
  hiddenBefore: (count: number) => string;
  /** 보이는 띠 뒤에 숨은 문서 수 */
  hiddenAfter: (count: number) => string;
  /** 접힌 제외·빠진 페이지 띠 펼치기 */
  expand: string;
  /** 펼친 제외·빠진 페이지 띠 접기 */
  collapse: string;
}

/**
 * 공통 문구 + 필름스트립 전용 문구. 편집 조작부에만 쓰는 문구(`StructureEditLabelKey`·`splitAfter`·
 * `dragDocument`)는 선택이다 — 그 조작부를 켜는 콜백과 함께 넘긴다(짝은 README 표). 읽기 전용으로
 * 쓸 때는 보기 문구만 넘기면 된다.
 */
export interface FilmstripLabels
  extends
    Omit<StructureEditorLabels, StructureEditLabelKey>,
    Partial<Pick<StructureEditorLabels, StructureEditLabelKey>> {
  /** 페이지 사이 ✂ 버튼 이름(앞 페이지 뒤에서 나눈다). `onSplit` 과 함께 넘긴다. */
  splitAfter?: (page: StructurePage) => string;
  /** 띠 머리 끌기 손잡이 이름. `onReorderDocument`·`onMergeInto` 와 함께 넘긴다. */
  dragDocument?: string;
  /** 이웃 보기 문구. 없으면 숨은 문서 수·이웃 띠 펼치기 버튼·제외·빠진 띠 접기 토글을 그리지 않는다. */
  neighborhood?: FilmstripNeighborhoodLabels;
}

/**
 * 필름스트립 콜백 전체 묶음(host 가 편집 액션을 한 객체로 만들어 spread 할 때 쓰는 모양). 페이지
 * 격자와 같은 공용 콜백이다 — 썸네일 클릭도 보조 키(`modifiers`)까지 네 인자로 부른다(필름스트립은
 * 여러 장 선택을 하지 않으므로 읽지 않아도 된다). `Filmstrip` props 에서는 모두 선택이다 — 넘긴 콜백의
 * 조작부만 그린다.
 */
export type FilmstripCallbacks = StructureEditorCallbacks;

export interface FilmstripProps
  extends Omit<ComponentProps<"div">, "children">, Partial<FilmstripCallbacks> {
  /** 문서 배치 순서대로(문서 하나 = 띠 하나). */
  documents: readonly StructureDocument[];
  excluded: readonly StructureLoosePage[];
  /** 어느 문서에도, 제외에도 없는 페이지(`page_missing`). 빨간 점선 칸으로 보인다. */
  unplaced?: readonly StructureLoosePage[];
  /** 이 띠(0-based) 뒤에 파일 그룹 경계가 있다. */
  groupBoundariesAfter?: readonly number[];
  /** 뷰어가 보고 있는 페이지. */
  selectedPage?: StructureSelectedPage | null;
  /** 모든 조작을 막는다(저장 중 등). 조작부는 그리되 비활성으로 둔다. */
  disabled?: boolean;
  /**
   * 문서 구성 보기 전용. 편집 콜백(`onReorderPage`·`onMovePage`·`onSplit`·`onMergeInto`·
   * `onReorderDocument`·`onExcludePage`·`onRestorePage`·`onLabelChange`·`onExcludeDocument`·
   * `onRestoreDocument`·`onRestoreToNewDocument`·`onRequestDocumentPosition`)이 넘어와도 없는 것으로
   * 다뤄 끌기·✂·메뉴·라벨 편집을 그리지 않는다(`disabled` 는 그리고 막는다). 썸네일 클릭·이웃 띠
   * 펼치기·제외·빠진 띠 접기는 그대로 동작한다.
   */
  readOnly?: boolean;
  /** 이웃 보기. 없으면(또는 선택 문서가 `documents` 에 없으면) 모든 띠를 그린다. */
  neighborhood?: FilmstripNeighborhood | null;
  /** 이웃 보기에서 접힌 이웃 띠의 제목을 누르면 그 문서를 펼치라고 알린다. */
  onFocusDocument?: (documentId: string) => void;
  /** 띠 메뉴 "위치 지정…". 번호를 묻는 대화상자는 호출하는 쪽이 띄운다. `index` 는 띠 위치(0-based). */
  onRequestDocumentPosition?: (documentId: string, index: number) => void;
  /**
   * 문서 띠 메뉴(⋯) 버튼을 문서 id 로 찾는 수단. "위치 지정…" 대화상자를 닫은 뒤 포커스를 돌려줄
   * 자리처럼 host 가 버튼에 `focus()` 해야 할 때 쓴다(Filmstrip 은 스스로 포커스를 옮기지 않는다).
   */
  menuButtonsRef?: Ref<StructureMenuButtons>;
  labels: FilmstripLabels;
  /** 자유 입력 라벨의 최대 길이(`<input maxLength>`). 없으면 제한하지 않는다. */
  labelMaxLength?: number;
  /**
   * 자유 입력 라벨을 고치던 중 띠가 언마운트되면(이웃 보기 창 밖 등) 그 글자를 확정할지. 기본 `false`
   * (확정하지 않고 버린다).
   */
  commitLabelOnUnmount?: boolean;
  /** 루트 `data-testid`. 하위 요소는 `<testId>-<element>-<action>`. */
  testId?: string;
}

/**
 * drop 할 수 있는 자리. `ok: false` 면 거부 표시만 한다(띠는 `reason` 별 문구). 페이지 자리에서
 * `reason` 이 없는 거부는 표시 없이 무시한다(자리가 그대로인 drop).
 */
export type DropTarget =
  | {
      kind: "pages";
      documentId: string;
      index: number;
      ok: boolean;
      reason?: StructureRejectReason;
    }
  | {
      kind: "merge";
      documentId: string;
      ok: boolean;
      reason: StructureRejectReason;
    }
  | { kind: "gap"; index: number; ok: boolean }
  | { kind: "excluded"; ok: boolean };

/** 띠·제외 띠가 쓰는 drag 처리기. */
export interface DragHandlers {
  drag: DragPayload | null;
  target: DropTarget | null;
  begin: (payload: DragPayload) => void;
  end: () => void;
  overPages: (
    event: DragEvent<HTMLElement>,
    strip: StructureDocument,
    presentation: StripPresentation,
  ) => void;
  overStrip: (event: DragEvent<HTMLElement>, strip: StructureDocument) => void;
  overGap: (event: DragEvent<HTMLElement>, gapIndex: number) => void;
  overExcluded: (event: DragEvent<HTMLElement>) => void;
  drop: (event: DragEvent<HTMLElement>) => void;
}

/** 펼친 띠의 보이는 범위(띠 `ol` 왼쪽 기준 x). */
export type WindowViewport = { start: number; end: number };

const PAGE_SELECTOR = "[data-filmstrip-page]";
const FULL: StripPresentation = { kind: "full" };
const DEFAULT_NEIGHBOR_PAGES = 3;
const DEFAULT_OVERSCAN = 4;

/**
 * 문서 구성 편집기. 문서마다 페이지 썸네일 띠를 두고, 썸네일·띠 머리를 끌어 페이지 순서·
 * 옮기기·제외·문서 순서·합치기를, 페이지 사이 ✂ 로 분리를, 썸네일·띠 메뉴로 같은 일을
 * 키보드로 한다. 편집 결과는 콜백으로만 알리고 상태는 갖지 않는다(끄는 중 표시만 가진다).
 * 페이지는 같은 파일 그룹 문서 사이에서만 오가고, 그 밖은 drop 을 거부한다.
 *
 * `neighborhood` 를 주면 선택 문서와 양옆 문서만 그린다: 이웃은 가까운 쪽 몇 쪽만 보이고 나머지는
 * 개수 칩, 선택 문서는 모든 페이지 자리를 두되 스크롤 창에 보이는 칸만 그린다. 끌면서 창 가장자리에
 * 머물면 그쪽으로 스크롤하고, 선택 페이지가 창 밖으로 나가면 창을 그 페이지로 옮긴다.
 */
export function Filmstrip({
  documents: strips,
  excluded,
  unplaced = [],
  groupBoundariesAfter = [],
  selectedPage = null,
  disabled = false,
  readOnly = false,
  neighborhood = null,
  onFocusDocument,
  onRequestDocumentPosition: onRequestDocumentPositionProp,
  menuButtonsRef,
  labels,
  labelMaxLength,
  commitLabelOnUnmount = false,
  testId,
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
  onThumbnailClick,
  onDragLeave: onDragLeaveProp,
  className,
  ...props
}: FilmstripProps) {
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
  // 그려진 띠 메뉴 버튼(문서 id → 요소). 띠가 언마운트되면 항목을 지운다.
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
  const [drag, setDrag] = useState<DragPayload | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  // rAF 안에서 지금 끌고 있는지 보기 위한 사본(상태는 렌더용).
  const dragRef = useRef<DragPayload | null>(null);
  // `dragend` 를 놓친 끌기를 정리하는 document 리스너의 해제 함수(끄는 동안만 있다).
  const staleDragRef = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      staleDragRef.current?.();
      staleDragRef.current = null;
    },
    [],
  );

  const focusDocumentId = neighborhood?.focusDocumentId ?? null;
  const neighborPages = neighborhood?.neighborPages ?? DEFAULT_NEIGHBOR_PAGES;
  const overscan = neighborhood?.overscan ?? DEFAULT_OVERSCAN;
  const plan = useMemo(
    () =>
      focusDocumentId === null
        ? null
        : neighborhoodStrips(strips, focusDocumentId, neighborPages),
    [strips, focusDocumentId, neighborPages],
  );
  const inNeighborhood = plan !== null;

  // 이웃 보기의 스크롤 창과 펼친 띠. 보이는 범위는 스크롤·창 크기·띠 변경 때 프레임당 한 번 잰다.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const focusOlRef = useRef<HTMLOListElement>(null);
  const measureFrameRef = useRef<number | null>(null);
  const [windowViewport, setWindowViewport] = useState<WindowViewport>({
    start: 0,
    end: 0,
  });
  // 마지막으로 잰(또는 재중심이 계산한) 창과 스크롤 내용 왼쪽에서 펼친 띠까지의 거리. 재중심이
  // layout 을 읽지 않고 쓰도록 상태와 함께 갱신한다. `end <= start` 면 아직 안 잰 것이다.
  const viewportRef = useRef({ start: 0, end: 0, olLeft: 0 });
  const measure = useCallback(() => {
    const scroller = scrollerRef.current;
    const ol = focusOlRef.current;
    if (!scroller || !ol) return;
    const olLeft =
      ol.getBoundingClientRect().left -
      scroller.getBoundingClientRect().left +
      scroller.scrollLeft;
    const start = scroller.scrollLeft - olLeft;
    const end = start + scroller.clientWidth;
    viewportRef.current = { start, end, olLeft };
    setWindowViewport(current =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, []);
  const scheduleMeasure = useCallback(() => {
    if (measureFrameRef.current !== null) return;
    measureFrameRef.current = requestAnimationFrame(() => {
      measureFrameRef.current = null;
      measure();
    });
  }, [measure]);
  useEffect(
    () => () => {
      if (measureFrameRef.current !== null) {
        cancelAnimationFrame(measureFrameRef.current);
      }
    },
    [],
  );
  useEffect(() => {
    if (!inNeighborhood) return;
    measure();
    const scroller = scrollerRef.current;
    if (!scroller || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(scroller);
    return () => observer.disconnect();
    // 띠(plan)가 바뀌면 펼친 띠의 자리가 달라지므로 다시 잰다.
  }, [inNeighborhood, plan, measure, scheduleMeasure]);

  // 선택 페이지가 펼친 띠에서 창 밖에 있으면 창을 그 페이지 가운데로 옮긴다(가로만). 끄는 중에는
  // 사용자가 스크롤을 쥐고 있으므로 건드리지 않는다. 선택 자리가 바뀔 때만 돈다(스크롤로는 안 돈다).
  const selectedPosition = useMemo(() => {
    if (focusDocumentId === null || !selectedPage) return -1;
    if (selectedPage.documentId !== focusDocumentId) return -1;
    const focus = strips.find(strip => strip.documentId === focusDocumentId);
    return focus
      ? focus.pages.findIndex(page => page.key === selectedPage.pageKey)
      : -1;
  }, [strips, focusDocumentId, selectedPage]);
  useEffect(() => {
    if (!inNeighborhood || selectedPosition < 0) return;
    const frame = requestAnimationFrame(() => {
      if (dragRef.current) return;
      const scroller = scrollerRef.current;
      if (!scroller || !focusOlRef.current) return;
      // 아직 안 쟀으면(첫 마운트 직후) 한 번 잰다. 그 뒤로는 기억한 창으로 계산해 layout 을 읽지 않는다.
      if (viewportRef.current.end <= viewportRef.current.start) measure();
      const known = viewportRef.current;
      if (known.end <= known.start) return;
      const next = recenterViewport({
        position: selectedPosition,
        viewport: known,
        olLeft: known.olLeft,
      });
      // 선택 칸이 이미 창 안이면 아무것도 하지 않는다.
      if (!next) return;
      scroller.scrollLeft = next.scrollLeft;
      // 스크롤 이벤트의 재측정은 같은 값이면 상태를 바꾸지 않는다. 끝에서 브라우저가 scrollLeft 를
      // 줄였을 때만 한 번 더 맞춘다.
      viewportRef.current = { ...next.viewport, olLeft: known.olLeft };
      setWindowViewport(current =>
        current.start === next.viewport.start &&
        current.end === next.viewport.end
          ? current
          : next.viewport,
      );
    });
    return () => cancelAnimationFrame(frame);
  }, [inNeighborhood, focusDocumentId, selectedPosition, measure]);

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
  const onEdgeDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const edge = edgeRef.current;
    edge.velocity = edgeScrollVelocity(
      event.clientX,
      rect.left,
      rect.right,
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
      const scroller = scrollerRef.current;
      const velocity = edgeRef.current.velocity;
      if (scroller && velocity !== 0) scroller.scrollLeft += velocity;
      edgeRef.current.frame = requestAnimationFrame(tick);
    };
    edge.frame = requestAnimationFrame(tick);
  };

  /** drop 자리를 정한다. 받을 수 있으면 `preventDefault` 로 drop 을 허용한다. */
  const accept = (event: DragEvent<HTMLElement>, next: DropTarget) => {
    if (!drag || !isFilmstripDrag(event)) return;
    event.stopPropagation();
    if (next.ok) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    } else {
      event.dataTransfer.dropEffect = "none";
    }
    setTarget(current =>
      current && sameTarget(current, next) ? current : next,
    );
  };

  /** 받을 콜백이 없는 자리: drop 을 허용하지 않고 표시도 지운다. */
  const clearTarget = (event: DragEvent<HTMLElement>) => {
    if (!drag || !isFilmstripDrag(event)) return;
    event.stopPropagation();
    setTarget(null);
  };

  /** 페이지를 띠의 `index`(접힌 띠면 `side` 쪽 끝)에 놓는 자리. 판정은 `pageDropVerdict`. */
  const acceptPages = (
    event: DragEvent<HTMLElement>,
    strip: StructureDocument,
    index: number,
    side?: "start" | "end",
  ) => {
    if (!drag || drag.kind !== "page") return;
    // 그 drop 을 받을 콜백이 없으면 자리로 보지 않는다(제외 페이지 → 되돌리기, 같은 문서 → 순서,
    // 다른 문서 → 옮기기).
    const handler =
      drag.documentId === null
        ? onRestorePage
        : drag.documentId === strip.documentId
          ? onReorderPage
          : onMovePage;
    if (!handler) {
      clearTarget(event);
      return;
    }
    const verdict = pageDropVerdict({ drag, strip, index, side });
    accept(
      event,
      verdict.ok
        ? {
            kind: "pages",
            documentId: strip.documentId,
            index: verdict.index,
            ok: true,
          }
        : {
            kind: "pages",
            documentId: strip.documentId,
            index,
            ok: false,
            reason: verdict.reason,
          },
    );
  };

  const handlers: DragHandlers = {
    drag,
    target,
    begin: payload => {
      dragRef.current = payload;
      setDrag(payload);
      setTarget(null);
      // 끌던 썸네일이 자동 스크롤로 그려지는 범위 밖에 나가면 언마운트돼 `dragend` 가 오지 않는다.
      // 그 뒤 첫 포인터 이벤트에서 끌기를 정리한다.
      staleDragRef.current?.();
      staleDragRef.current = watchStaleDrag(document, handlers.end);
    },
    end: () => {
      staleDragRef.current?.();
      staleDragRef.current = null;
      dragRef.current = null;
      stopEdgeScroll();
      setDrag(null);
      setTarget(null);
    },
    overPages: (event, strip, presentation) => {
      if (!drag) return;
      if (drag.kind === "strip") {
        handlers.overStrip(event, strip);
        return;
      }
      // 접힌 이웃 띠는 포인터와 무관하게 앞 문서면 끝에, 뒤 문서면 앞에 들어간다(판정이 정한다).
      let index = 0;
      if (presentation.kind === "windowed") {
        // 펼친 띠는 칸 폭이 고정이라 DOM 을 재지 않고 x 로 계산한다(그리지 않은 칸도 포함).
        const rect = event.currentTarget.getBoundingClientRect();
        index = dropIndexFromX(
          event.clientX - rect.left,
          strip.pages.length,
          THUMBNAIL_PITCH,
          THUMBNAIL_CENTER,
        );
      } else if (presentation.kind === "full") {
        const items = Array.from(
          event.currentTarget.querySelectorAll(PAGE_SELECTOR),
        );
        index = dropIndexAt(event.clientX, items);
      }
      acceptPages(
        event,
        strip,
        index,
        presentation.kind === "collapsed" ? presentation.side : undefined,
      );
    },
    overStrip: (event, strip) => {
      if (!drag) return;
      if (drag.kind === "page") {
        // 띠 머리 위에 놓은 페이지는 그 문서 끝으로 간다.
        acceptPages(event, strip, strip.pages.length);
        return;
      }
      if (!onMergeInto) {
        clearTarget(event);
        return;
      }
      accept(event, {
        kind: "merge",
        documentId: strip.documentId,
        ok:
          !strip.locked &&
          strip.documentId !== drag.documentId &&
          strip.groupId === drag.groupId,
        reason: stripRejectReason(strip),
      });
    },
    overGap: (event, gapIndex) => {
      if (!drag || drag.kind !== "strip") return;
      if (!onReorderDocument) {
        clearTarget(event);
        return;
      }
      const before = strips[gapIndex - 1];
      const after = strips[gapIndex];
      // 자기 양옆 틈은 순서가 그대로이고, 다른 그룹 사이로는 옮기지 않는다.
      const moves = gapIndex !== drag.index && gapIndex !== drag.index + 1;
      const sameGroup =
        (before !== undefined &&
          before.documentId !== drag.documentId &&
          before.groupId === drag.groupId) ||
        (after !== undefined &&
          after.documentId !== drag.documentId &&
          after.groupId === drag.groupId);
      accept(event, { kind: "gap", index: gapIndex, ok: moves && sameGroup });
    },
    overExcluded: event => {
      if (!drag) return;
      if (!onExcludePage) {
        clearTarget(event);
        return;
      }
      accept(event, {
        kind: "excluded",
        ok: drag.kind === "page" && drag.documentId !== null,
      });
    },
    drop: event => {
      const payload = drag;
      const at = target;
      handlers.end();
      if (!payload || !at || !at.ok || !isFilmstripDrag(event)) return;
      event.preventDefault();
      event.stopPropagation();
      // 자리는 받을 콜백이 있을 때만 생긴다(`accept` 앞의 확인).
      if (payload.kind === "strip") {
        if (at.kind === "merge") {
          onMergeInto?.(payload.documentId, at.documentId);
        } else if (at.kind === "gap") {
          onReorderDocument?.(
            payload.documentId,
            indexAfterRemoval(payload.index, at.index),
          );
        }
        return;
      }
      if (at.kind === "excluded") {
        if (payload.documentId !== null) {
          onExcludePage?.(payload.documentId, payload.pageKey);
        }
        return;
      }
      if (at.kind !== "pages") return;
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
    },
  };

  // 이웃 보기에서 제외·빠진 페이지 띠는 접혀 있다가 펼친다.
  const [lanesOpen, setLanesOpen] = useState({
    excluded: false,
    unplaced: false,
  });
  // 빠진 페이지가 새로 생기면(0 → 1 이상) 빠진 띠를 펼친다. 저장 전에 고쳐야 하는 자리라서다.
  // 처음 그릴 때 이미 있던 빠진 페이지나 사용자가 접은 뒤 늘어난 경우는 그대로 둔다.
  // 이전 개수를 state 로 들고 렌더 중에 비교해, 개수가 바뀐 그 렌더에서 바로 펼친다(effect 없음).
  const [previousUnplaced, setPreviousUnplaced] = useState(unplaced.length);
  if (previousUnplaced !== unplaced.length) {
    setPreviousUnplaced(unplaced.length);
    if (previousUnplaced === 0 && !lanesOpen.unplaced) {
      setLanesOpen(open => ({ ...open, unplaced: true }));
    }
  }

  const boundaries = new Set(groupBoundariesAfter);
  const gapTarget = target?.kind === "gap" ? target : null;

  const gap = (index: number, boundary: boolean) => (
    <Gap
      index={index}
      boundary={boundary}
      active={gapTarget?.index === index ? gapTarget.ok : null}
      handlers={handlers}
      boundaryLabel={labels.groupBoundary}
    />
  );

  const renderStrip = (
    strip: StructureDocument,
    index: number,
    presentation: StripPresentation,
  ) => {
    const windowed = presentation.kind === "windowed";
    return (
      <div key={strip.documentId} className="flex shrink-0 items-stretch">
        {gap(index, index > 0 && boundaries.has(index - 1))}
        <Strip
          strip={strip}
          index={index}
          strips={strips}
          presentation={presentation}
          windowViewport={windowed ? windowViewport : undefined}
          overscan={overscan}
          olRef={windowed ? focusOlRef : undefined}
          selectedPageKey={
            selectedPage?.documentId === strip.documentId
              ? selectedPage.pageKey
              : null
          }
          disabled={disabled}
          labels={labels}
          labelMaxLength={labelMaxLength}
          commitLabelOnUnmount={commitLabelOnUnmount}
          testId={testId}
          handlers={handlers}
          onReorderPage={onReorderPage}
          onMovePage={onMovePage}
          onSplit={onSplit}
          onMergeInto={onMergeInto}
          onReorderDocument={onReorderDocument}
          onExcludePage={onExcludePage}
          onLabelChange={onLabelChange}
          onExcludeDocument={onExcludeDocument}
          onRestoreDocument={onRestoreDocument}
          onThumbnailClick={onThumbnailClick}
          onFocusDocument={onFocusDocument}
          onRequestDocumentPosition={onRequestDocumentPosition}
          registerMenuButton={registerMenuButton}
        />
      </div>
    );
  };

  const lanes = (collapsed: boolean) => (
    <>
      {unplaced.length > 0 ? (
        <UnplacedLane
          pages={unplaced}
          disabled={disabled}
          labels={labels}
          testId={testId}
          collapsed={collapsed && !lanesOpen.unplaced}
          onToggle={
            collapsed
              ? () =>
                  setLanesOpen(open => ({ ...open, unplaced: !open.unplaced }))
              : undefined
          }
          onRestoreToNewDocument={onRestoreToNewDocument}
        />
      ) : null}
      <ExcludedLane
        pages={excluded}
        strips={strips}
        disabled={disabled}
        labels={labels}
        testId={testId}
        handlers={handlers}
        collapsed={collapsed && !lanesOpen.excluded}
        onToggle={
          collapsed
            ? () =>
                setLanesOpen(open => ({ ...open, excluded: !open.excluded }))
            : undefined
        }
        onRestorePage={onRestorePage}
        onRestoreToNewDocument={onRestoreToNewDocument}
        onThumbnailClick={onThumbnailClick}
      />
    </>
  );

  const hidden = plan
    ? hiddenCounts(
        strips.length,
        plan.map(item => item.index),
      )
    : null;
  const lastVisible = plan ? (plan[plan.length - 1]?.index ?? -1) : -1;

  return (
    <div
      {...props}
      role="region"
      aria-label={labels.region}
      data-testid={testId}
      className={cn("min-w-0", className)}
      onDragLeave={event => {
        // 필름스트립 밖으로 나가면 drop 자리 표시를 지우고 가장자리 스크롤을 멈춘다.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setTarget(null);
          stopEdgeScroll();
        }
        // host 핸들러는 내부 정리 뒤에 부른다.
        onDragLeaveProp?.(event);
      }}
    >
      {plan && hidden ? (
        <div
          ref={scrollerRef}
          data-testid={testId ? `${testId}-scroller` : undefined}
          onScroll={scheduleMeasure}
          onDragOverCapture={onEdgeDragOver}
          className="relative flex items-stretch overflow-x-auto pb-2"
        >
          {hidden.before > 0 && labels.neighborhood ? (
            <HiddenCount
              text={labels.neighborhood.hiddenBefore(hidden.before)}
            />
          ) : null}
          {plan.map(({ index, presentation }) => {
            const strip = strips[index];
            return strip ? renderStrip(strip, index, presentation) : null;
          })}
          {gap(lastVisible + 1, false)}
          {hidden.after > 0 && labels.neighborhood ? (
            <HiddenCount text={labels.neighborhood.hiddenAfter(hidden.after)} />
          ) : null}
          {lanes(true)}
        </div>
      ) : (
        <div className="flex items-stretch overflow-x-auto pb-2">
          {strips.map((strip, index) => renderStrip(strip, index, FULL))}
          {gap(strips.length, false)}
          {lanes(false)}
        </div>
      )}
    </div>
  );
}

/** 띠가 drop 을 받지 않을 때 보일 사유. 잠긴 문서가 먼저다. */
function stripRejectReason(strip: { locked?: boolean }): StructureRejectReason {
  return strip.locked ? "locked" : "group";
}

function sameTarget(a: DropTarget, b: DropTarget): boolean {
  if (a.kind !== b.kind || a.ok !== b.ok) return false;
  switch (a.kind) {
    case "pages":
      return (
        b.kind === "pages" &&
        a.documentId === b.documentId &&
        a.index === b.index &&
        a.reason === b.reason
      );
    case "merge":
      return (
        b.kind === "merge" &&
        a.documentId === b.documentId &&
        a.reason === b.reason
      );
    case "gap":
      return b.kind === "gap" && a.index === b.index;
    default:
      return true;
  }
}

/** 이웃 보기에서 보이는 띠 앞·뒤에 숨은 문서 수. */
function HiddenCount({ text }: { text: string }) {
  return (
    <p className="flex shrink-0 items-center px-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
      {text}
    </p>
  );
}

/** 띠 사이 틈: 띠 머리를 놓으면 문서 순서가 바뀐다. 그룹 경계면 구분선을 그린다. */
function Gap({
  index,
  boundary,
  active,
  handlers,
  boundaryLabel,
}: {
  index: number;
  boundary: boolean;
  /** drop 자리 표시: true 받음 · false 거부 · null 아님. */
  active: boolean | null;
  handlers: DragHandlers;
  boundaryLabel: string;
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 items-stretch justify-center",
        boundary ? "w-6" : "w-3",
      )}
      onDragOver={event => handlers.overGap(event, index)}
      onDrop={handlers.drop}
    >
      {boundary ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={boundaryLabel}
          title={boundaryLabel}
          className={cn(
            "w-0 border-l-2 border-dashed",
            active === true ? "border-primary" : "border-border",
          )}
        />
      ) : (
        <div
          aria-hidden="true"
          className={cn(
            "w-1 rounded-full",
            active === true ? "bg-primary" : "bg-transparent",
          )}
        />
      )}
    </div>
  );
}
