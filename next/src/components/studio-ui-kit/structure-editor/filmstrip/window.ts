import { clamp } from "../shared/math";

/** 펼친 띠에서 썸네일 칸(`li`) 하나의 폭(px): 분리 자리 20 + 양쪽 여백 2·2 + 썸네일 64. */
export const THUMBNAIL_PITCH = 88;
/** 칸 왼쪽에서 썸네일 가운데까지(px): 분리 자리 24 + 썸네일 폭의 절반 32. */
export const THUMBNAIL_CENTER = 56;

/**
 * 띠를 그리는 방식.
 * - `full`: 모든 페이지를 그대로(기존 필름스트립).
 * - `collapsed`: 이웃 문서. `side === "end"` 는 끝 `visible` 쪽만(앞 문서), `"start"` 는 앞 `visible` 쪽만(뒤 문서)
 *   보이고 나머지 `hidden` 쪽은 개수 칩으로 접는다. `offset` 은 보이는 첫 페이지의 띠 안 위치.
 * - `windowed`: 선택 문서. 모든 페이지가 있지만 보이는 범위만 그린다(`pageWindow`).
 */
export type StripPresentation =
  | { kind: "full" }
  | {
      kind: "collapsed";
      side: "start" | "end";
      offset: number;
      visible: number;
      hidden: number;
    }
  | { kind: "windowed" };

export interface NeighborhoodStrip {
  /** `strips` 안 위치(전역). */
  index: number;
  presentation: StripPresentation;
}

/**
 * 이웃 보기에 그릴 띠: 앞 문서(끝 `neighborPages` 쪽) · 선택 문서(펼침) · 뒤 문서(앞 `neighborPages` 쪽).
 * 선택 문서가 `strips` 에 없으면 `null`(호출하는 쪽은 전체 보기로 돌아간다).
 */
export function neighborhoodStrips(
  strips: readonly { documentId: string; pages: readonly unknown[] }[],
  focusDocumentId: string,
  neighborPages: number,
): NeighborhoodStrip[] | null {
  const focus = strips.findIndex(strip => strip.documentId === focusDocumentId);
  if (focus < 0) return null;
  const n = Math.max(0, Math.floor(neighborPages));
  const out: NeighborhoodStrip[] = [];
  const previous = strips[focus - 1];
  if (previous) {
    const length = previous.pages.length;
    const visible = Math.min(n, length);
    out.push({
      index: focus - 1,
      presentation: {
        kind: "collapsed",
        side: "end",
        offset: length - visible,
        visible,
        hidden: length - visible,
      },
    });
  }
  out.push({ index: focus, presentation: { kind: "windowed" } });
  const next = strips[focus + 1];
  if (next) {
    const length = next.pages.length;
    const visible = Math.min(n, length);
    out.push({
      index: focus + 1,
      presentation: {
        kind: "collapsed",
        side: "start",
        offset: 0,
        visible,
        hidden: length - visible,
      },
    });
  }
  return out;
}

/**
 * 보이는 띠 밖에 숨은 문서 수. `before` 는 첫 보이는 띠 앞, `after` 는 마지막 보이는 띠 뒤.
 * 보이는 띠가 없으면 전부 `before` 로 친다.
 */
export function hiddenCounts(
  total: number,
  visibleIndexes: readonly number[],
): { before: number; after: number } {
  const count = Math.max(0, total);
  if (visibleIndexes.length === 0) return { before: count, after: 0 };
  const first = clamp(Math.min(...visibleIndexes), 0, count);
  const last = clamp(Math.max(...visibleIndexes), -1, count - 1);
  return { before: first, after: Math.max(0, count - last - 1) };
}

export interface PageWindowInput {
  /** 띠의 전체 페이지 수 */
  count: number;
  /** 스크롤 창 왼쪽의 띠(`ol`) 기준 x(px). 띠가 창보다 오른쪽에서 시작하면 음수. */
  viewportStart: number;
  /** 스크롤 창 오른쪽의 띠 기준 x(px). `viewportStart` 이하(아직 재지 못함)면 칸 8 개 폭으로 본다. */
  viewportEnd: number;
  /** 칸 하나의 폭(px) */
  pitch: number;
  /** 보이는 범위 앞·뒤에 더 그리는 칸 수 */
  overscan?: number;
}

export interface PageWindow {
  /** 그리는 첫 칸(포함) */
  start: number;
  /** 그리는 끝 칸(제외) */
  end: number;
  /** 앞 스페이서 폭(px) */
  leadWidth: number;
  /** 뒤 스페이서 폭(px) */
  trailWidth: number;
}

/**
 * 지금 스크롤 위치에서 그려야 하는 칸 범위와 앞·뒤 스페이서 폭. 칸 폭은 모두 같다고 본다.
 * 창이 띠 밖(왼쪽·오른쪽)에 있어도 가장 가까운 끝의 `overscan` 칸은 그린다.
 */
export function pageWindow({
  count,
  viewportStart,
  viewportEnd,
  pitch,
  overscan = 4,
}: PageWindowInput): PageWindow {
  if (count <= 0 || pitch <= 0) {
    return { start: 0, end: 0, leadWidth: 0, trailWidth: 0 };
  }
  const width =
    viewportEnd > viewportStart ? viewportEnd - viewportStart : pitch * 8;
  const end0 = viewportStart + width;
  const first = clamp(Math.floor(viewportStart / pitch), 0, count - 1);
  const last = clamp(Math.ceil(end0 / pitch), 0, count);
  const extra = Math.max(0, Math.floor(overscan));
  const start = clamp(first - extra, 0, count);
  const end = clamp(Math.max(last + extra, start), 0, count);
  return {
    start,
    end,
    leadWidth: start * pitch,
    trailWidth: (count - end) * pitch,
  };
}

/**
 * 띠(`ol`) 왼쪽 기준 포인터 x 로 끼워 넣을 위치: 가운데가 포인터보다 왼쪽인 썸네일 수(0‥count).
 * 칸 i 의 썸네일 가운데는 `i * pitch + center`.
 */
export function dropIndexFromX(
  x: number,
  count: number,
  pitch: number = THUMBNAIL_PITCH,
  center: number = THUMBNAIL_CENTER,
): number {
  if (count <= 0 || pitch <= 0) return 0;
  return clamp(Math.floor((x - center) / pitch) + 1, 0, count);
}

export interface RecenterInput {
  /** 선택 페이지의 펼친 띠 안 위치. */
  position: number;
  pitch?: number;
  /** 지금 창: 펼친 띠(`ol`) 왼쪽 기준 x 범위. */
  viewport: { start: number; end: number };
  /** 스크롤 내용 왼쪽에서 펼친 띠(`ol`) 왼쪽까지(px). */
  olLeft: number;
}

export interface RecenterResult {
  /** 스크롤 창에 넣을 `scrollLeft`. */
  scrollLeft: number;
  /** 그 `scrollLeft` 에서의 창(`ol` 왼쪽 기준). */
  viewport: { start: number; end: number };
}

/**
 * 선택 칸을 창 가운데로 옮길 스크롤 위치와 그때의 창. 칸 전체가 이미 창 안에 있으면 `null`(아무것도
 * 하지 않는다). 창을 다시 재지 않고 상태를 맞출 수 있게 새 창을 함께 돌려준다.
 */
export function recenterViewport({
  position,
  pitch = THUMBNAIL_PITCH,
  viewport,
  olLeft,
}: RecenterInput): RecenterResult | null {
  const cellStart = position * pitch;
  if (cellStart >= viewport.start && cellStart + pitch <= viewport.end) {
    return null;
  }
  const width = viewport.end - viewport.start;
  const scrollLeft = Math.max(0, olLeft + cellStart - width / 2 + pitch / 2);
  return {
    scrollLeft,
    viewport: {
      start: scrollLeft - olLeft,
      end: scrollLeft - olLeft + width,
    },
  };
}

export type PageMenuItemId = "left" | "right" | "move" | "exclude";

const ALL_PAGE_MENU_ITEMS: readonly PageMenuItemId[] = [
  "left",
  "right",
  "move",
  "exclude",
];
const COLLAPSED_PAGE_MENU_ITEMS: readonly PageMenuItemId[] = [
  "move",
  "exclude",
];

/**
 * 썸네일 메뉴에 둘 항목. 접힌 이웃 띠에서는 띠 안 순서 바꾸기(왼쪽·오른쪽)의 결과가 숨은 쪽으로
 * 들어갈 수 있어 다른 문서로 옮기기·제외만 둔다.
 */
export function pageMenuItems(
  kind: StripPresentation["kind"],
): readonly PageMenuItemId[] {
  return kind === "collapsed" ? COLLAPSED_PAGE_MENU_ITEMS : ALL_PAGE_MENU_ITEMS;
}
