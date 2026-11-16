export interface RowItem {
  id: string;
  /** 보이는 번호. 없으면 배열 위치 + 1. */
  ordinal?: number;
  /** 그룹 머리 문구. 직전 항목과 다르면 그 앞에 머리 행이 들어간다. */
  groupLabel?: string;
}

export type ListRow<T extends RowItem = RowItem> =
  | { kind: "header"; key: string; label: string }
  | { kind: "item"; key: string; item: T; ordinal: number }
  | { kind: "excluded"; key: string; pageCount: number };

/**
 * 문서 항목을 행 목록으로 바꾼다. `groupLabel` 이 직전 항목과 다른 자리에 머리 행을 넣고, 제외
 * 페이지가 있으면 맨 끝에 제외 행을 둔다. 키는 종류 접두를 붙여(`item:<id>`·`header:<첫 문서 id>`·
 * `excluded`) 문서 id 가 `excluded` 나 `header:…` 여도 다른 행 키와 겹치지 않는다.
 */
export function buildRows<T extends RowItem>(
  items: readonly T[],
  excluded?: { pageCount: number } | null,
): ListRow<T>[] {
  const rows: ListRow<T>[] = [];
  let lastGroup: string | undefined;
  items.forEach((item, index) => {
    if (item.groupLabel !== undefined && item.groupLabel !== lastGroup) {
      rows.push({
        kind: "header",
        key: `header:${item.id}`,
        label: item.groupLabel,
      });
    }
    lastGroup = item.groupLabel;
    rows.push({
      kind: "item",
      key: `item:${item.id}`,
      item,
      ordinal: item.ordinal ?? index + 1,
    });
  });
  if (excluded && excluded.pageCount > 0) {
    rows.push({
      kind: "excluded",
      key: "excluded",
      pageCount: excluded.pageCount,
    });
  }
  return rows;
}

export interface ListWindowInput {
  /** 전체 행 수 */
  count: number;
  /** 행 하나의 높이(px) */
  rowHeight: number;
  scrollTop: number;
  /** 스크롤 창 높이(px). 0 이하(아직 재지 못함)면 행 10 개 높이로 본다. */
  viewportHeight: number;
  /** 보이는 범위 위·아래에 더 그리는 행 수 */
  overscan?: number;
}

export interface ListWindow {
  /** 그리는 첫 행(포함) */
  start: number;
  /** 그리는 끝 행(제외) */
  end: number;
  /** 위 스페이서 높이(px) */
  topSpacer: number;
  /** 아래 스페이서 높이(px) */
  bottomSpacer: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 창 높이를 모르면(0) 행 10 개로 친다. */
function effectiveViewport(viewportHeight: number, rowHeight: number): number {
  return viewportHeight > 0 ? viewportHeight : rowHeight * 10;
}

/**
 * 지금 스크롤 위치에서 그려야 하는 행 범위와 위·아래 스페이서 높이. 행 높이는 모두 같다고 본다.
 * `scrollTop` 이 목록 끝을 넘어도(목록이 줄어든 직후) 마지막 행은 그린다.
 */
export function listWindow({
  count,
  rowHeight,
  scrollTop,
  viewportHeight,
  overscan = 5,
}: ListWindowInput): ListWindow {
  if (count <= 0 || rowHeight <= 0) {
    return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
  }
  const height = effectiveViewport(viewportHeight, rowHeight);
  const first = clamp(Math.floor(scrollTop / rowHeight), 0, count - 1);
  const visible = Math.ceil(height / rowHeight) + 1;
  const start = clamp(first - overscan, 0, count);
  const end = clamp(first + visible + overscan, 0, count);
  return {
    start,
    end,
    topSpacer: start * rowHeight,
    bottomSpacer: (count - end) * rowHeight,
  };
}

export interface RevealInput {
  /** 보이게 할 행 */
  index: number;
  rowHeight: number;
  scrollTop: number;
  viewportHeight: number;
}

/**
 * `index` 행이 창 안에 다 들어오도록 옮길 `scrollTop`. 이미 다 보이면 `null`. 위로 벗어났으면
 * 행 위를 창 위에, 아래로 벗어났으면 행 아래를 창 아래에 맞춘다(가장 가까운 쪽).
 */
export function scrollTopToReveal({
  index,
  rowHeight,
  scrollTop,
  viewportHeight,
}: RevealInput): number | null {
  if (index < 0 || rowHeight <= 0) return null;
  const height = effectiveViewport(viewportHeight, rowHeight);
  const top = index * rowHeight;
  const bottom = top + rowHeight;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + height) return Math.max(bottom - height, 0);
  return null;
}
