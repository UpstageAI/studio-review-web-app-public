import { clamp } from "../shared/math";
import type {
  StructureDocument,
  StructureLoosePage,
  StructurePage,
} from "../shared/types";

/** 썸네일 크기 단계. */
export type PageGridSize = "s" | "m";

/** 썸네일(이미지 칸) 크기(px). */
export const CELL_SIZES: Readonly<
  Record<PageGridSize, { width: number; height: number }>
> = {
  s: { width: 64, height: 80 },
  m: { width: 112, height: 144 },
};
/** 셀 사이 간격(px). 가로는 셀 사이, 세로는 캡션 아래 여백. */
export const CELL_GAP = 8;
/** 썸네일 아래 쪽 번호 캡션 높이(px). */
export const CAPTION_HEIGHT = 20;
/** 블록 머리 행(제목·라벨·메뉴)의 높이(px). */
export const HEADER_HEIGHT = 40;
/** 빈 제외 칸 안내 행의 높이(px). */
export const EMPTY_BLOCK_HEIGHT = 48;
/** 블록 사이 여백(px). 머리 행 높이에 위 여백으로 들어간다. */
export const BLOCK_GAP = 12;
/** 머리 행의 실제 높이: 위 여백 + 머리. 첫 블록도 같아서 행 렌더가 한 가지다. */
export const HEADER_ROW_HEIGHT = HEADER_HEIGHT + BLOCK_GAP;
/** 폭을 아직 재지 못했을 때(0) 쓰는 열 수. */
export const DEFAULT_COLUMNS: Readonly<Record<PageGridSize, number>> = {
  s: 8,
  m: 5,
};

/** 셀 행 하나의 높이(px): 썸네일 + 캡션 + 아래 여백. S 108, M 172. */
export function rowHeightOf(size: PageGridSize): number {
  return CELL_SIZES[size].height + CAPTION_HEIGHT + CELL_GAP;
}

/** 셀 하나가 가로로 차지하는 폭(px): 썸네일 폭 + 셀 사이 간격. */
export function cellPitchOf(size: PageGridSize): number {
  return CELL_SIZES[size].width + CELL_GAP;
}

/** 셀 사이 ✂ 칩의 지름(px). */
export const SPLIT_BUTTON_SIZE = 20;
/** 행의 첫 셀에서 ✂ 칩을 셀 왼쪽 끝으로부터 띄우는 거리(px). */
const SPLIT_BUTTON_INSET = 2;

/**
 * 셀 왼쪽 틈 ✂ 칩의 셀 기준 위치(px). 세로는 썸네일 가운데, 가로는 앞 셀과의 틈 가운데에 칩
 * 중심을 둔다. 행의 첫 셀은 왼쪽 틈이 스크롤 창 밖이라 잘리므로 셀 안쪽에 둔다. 레이아웃에 자리를
 * 잡지 않고 겹쳐 그리므로 열 수·행 높이·drop 계산은 바뀌지 않는다.
 */
export function splitButtonOffset(
  size: PageGridSize,
  rowStart: boolean,
): { top: number; left: number } {
  const half = SPLIT_BUTTON_SIZE / 2;
  return {
    top: CELL_SIZES[size].height / 2 - half,
    left: rowStart ? SPLIT_BUTTON_INSET : -(CELL_GAP / 2) - half,
  };
}

/**
 * 스크롤 창 폭에 들어가는 열 수(최소 1). 마지막 셀 뒤 간격은 필요 없으므로 폭에 간격 하나를 더해
 * 센다. 폭을 아직 재지 못했으면(0 이하) 크기별 기본 열 수.
 */
export function columnsFor(width: number, size: PageGridSize): number {
  if (!(width > 0)) return DEFAULT_COLUMNS[size];
  return Math.max(1, Math.floor((width + CELL_GAP) / cellPitchOf(size)));
}

/**
 * 격자의 블록: 문서 하나, 제외 칸, 빠진 페이지 칸. 제외 칸은 비어도 drop 대상으로 늘 있고, 빠진
 * 칸은 페이지가 있을 때만 있다.
 */
export type GridBlock =
  | { kind: "document"; index: number; document: StructureDocument }
  | { kind: "excluded"; pages: readonly StructureLoosePage[] }
  | { kind: "unplaced"; pages: readonly StructureLoosePage[] };

/**
 * 격자의 행. 모든 행이 `height` 를 갖고 세로로 쌓인다.
 * - `header`: 블록 머리. `boundaryBefore` 는 바로 앞 문서와 파일 그룹이 달라지는 자리.
 * - `cells`: 썸네일 한 줄. `start..end` 는 블록 페이지 배열 안 위치(`end` 제외).
 * - `empty`: 빈 제외 칸 안내.
 */
export type GridRow =
  | {
      kind: "header";
      key: string;
      block: GridBlock;
      height: number;
      boundaryBefore: boolean;
    }
  | {
      kind: "cells";
      key: string;
      block: GridBlock;
      rowIndex: number;
      start: number;
      end: number;
      height: number;
    }
  | { kind: "empty"; key: string; block: GridBlock; height: number };

export interface BuildGridRowsInput {
  documents: readonly StructureDocument[];
  excluded: readonly StructureLoosePage[];
  unplaced?: readonly StructureLoosePage[];
  /** 이 위치(0-based)의 문서 뒤에서 파일 그룹이 바뀐다. */
  groupBoundariesAfter?: readonly number[];
  columns: number;
  size: PageGridSize;
}

export interface GridRows {
  rows: GridRow[];
  /** 행 위쪽의 y(px). 길이는 `rows.length + 1` 이고 마지막 값이 전체 높이. */
  offsets: number[];
  /** 전체 높이(px). */
  total: number;
}

/** 블록의 페이지 목록. */
export function blockPages(block: GridBlock): readonly StructurePage[] {
  return block.kind === "document" ? block.document.pages : block.pages;
}

/** 한 행에 두는 셀 수. 쓸모없는 값(0 이하·NaN)은 1 로 본다. */
function perRowOf(columns: number): number {
  return Number.isFinite(columns) ? Math.max(1, Math.floor(columns)) : 1;
}

/** 행 key 의 블록 부분. 문서 id 가 `excluded`·`unplaced` 와 겹쳐도 구분된다. */
function blockKeyOf(block: GridBlock): string {
  return block.kind === "document"
    ? `document:${block.document.documentId}`
    : block.kind;
}

/**
 * 문서·제외 칸·빠진 칸을 행 목록과 높이 접두합으로 바꾼다. 문서는 배치 순서대로, 그 뒤에 제외 칸(늘),
 * 빠진 칸(페이지가 있을 때만). 각 블록은 머리 행 하나와 `columns` 개씩 끊은 셀 행들이고, 빈 제외 칸은
 * 머리 행 뒤에 안내 행 하나를 둔다. 페이지가 없는 문서는 머리 행만 있다.
 */
export function buildGridRows({
  documents,
  excluded,
  unplaced = [],
  groupBoundariesAfter = [],
  columns,
  size,
}: BuildGridRowsInput): GridRows {
  const perRow = perRowOf(columns);
  const rowHeight = rowHeightOf(size);
  const boundaries = new Set(groupBoundariesAfter);
  const rows: GridRow[] = [];
  const offsets: number[] = [0];
  let total = 0;

  const push = (row: GridRow) => {
    rows.push(row);
    total += row.height;
    offsets.push(total);
  };

  const pushBlock = (block: GridBlock, boundaryBefore: boolean) => {
    const blockKey = blockKeyOf(block);
    push({
      kind: "header",
      key: `${blockKey}#header`,
      block,
      height: HEADER_ROW_HEIGHT,
      boundaryBefore,
    });
    const pages = blockPages(block);
    if (pages.length === 0) {
      if (block.kind === "excluded") {
        push({
          kind: "empty",
          key: `${blockKey}#empty`,
          block,
          height: EMPTY_BLOCK_HEIGHT,
        });
      }
      return;
    }
    const rowCount = Math.ceil(pages.length / perRow);
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
      const start = rowIndex * perRow;
      push({
        kind: "cells",
        key: `${blockKey}#row${rowIndex}`,
        block,
        rowIndex,
        start,
        end: Math.min(start + perRow, pages.length),
        height: rowHeight,
      });
    }
  };

  documents.forEach((document, index) => {
    pushBlock(
      { kind: "document", index, document },
      index > 0 && boundaries.has(index - 1),
    );
  });
  pushBlock({ kind: "excluded", pages: excluded }, false);
  if (unplaced.length > 0) {
    pushBlock({ kind: "unplaced", pages: unplaced }, false);
  }

  return { rows, offsets, total };
}

export interface GridWindowInput {
  /** `buildGridRows` 의 접두합. */
  offsets: readonly number[];
  scrollTop: number;
  /** 스크롤 창 높이(px). 0 이하(아직 재지 못함)면 S 셀 행 10 개 높이로 본다. */
  viewportHeight: number;
  /** 보이는 범위 위·아래에 더 그리는 높이(px). */
  overscanPx?: number;
}

export interface GridWindow {
  /** 그리는 첫 행(포함) */
  start: number;
  /** 그리는 끝 행(제외) */
  end: number;
  /** 위 스페이서 높이(px) */
  topSpacer: number;
  /** 아래 스페이서 높이(px) */
  bottomSpacer: number;
}

/** 창 높이를 모르면(0) S 셀 행 10 개로 친다. */
function effectiveViewport(viewportHeight: number): number {
  return viewportHeight > 0 ? viewportHeight : rowHeightOf("s") * 10;
}

/** `values[i] >= target` 인 첫 i(없으면 `values.length`). `values` 는 오름차순. */
function lowerBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** `values[i] > target` 인 첫 i(없으면 `values.length`). `values` 는 오름차순. */
function upperBound(values: readonly number[], target: number): number {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid]! <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** y(px) 가 든 행. 위로 벗어나면 0, 아래로 벗어나면 마지막 행. */
function rowAtY(offsets: readonly number[], count: number, y: number): number {
  return clamp(upperBound(offsets, y) - 1, 0, count - 1);
}

/**
 * 지금 스크롤 위치에서 그려야 하는 행 범위와 위·아래 스페이서 높이. `scrollTop - overscanPx` 가 든
 * 행부터 `scrollTop + viewportHeight + overscanPx` 앞에서 시작하는 행까지 그린다. `scrollTop` 이 끝을
 * 넘어도(격자가 줄어든 직후) 마지막 행은 그린다. 행이 없거나 전체 높이가 0 이면 전부 0.
 */
export function gridWindow({
  offsets,
  scrollTop,
  viewportHeight,
  overscanPx = 0,
}: GridWindowInput): GridWindow {
  const count = offsets.length - 1;
  const total = count > 0 ? offsets[count]! : 0;
  if (count <= 0 || total <= 0) {
    return { start: 0, end: 0, topSpacer: 0, bottomSpacer: 0 };
  }
  const extra = Math.max(0, overscanPx);
  const from = scrollTop - extra;
  const to = scrollTop + effectiveViewport(viewportHeight) + extra;
  const start = rowAtY(offsets, count, from);
  // 위쪽이 `to` 보다 앞에 있는 행까지. 정확히 `to` 에서 시작하는 행은 아직 보이지 않는다.
  const end = clamp(lowerBound(offsets, to), start + 1, count);
  return {
    start,
    end,
    topSpacer: offsets[start]!,
    bottomSpacer: total - offsets[end]!,
  };
}

/** 이어서 그리는 행 구간(`end` 제외). */
export interface RowSegment {
  start: number;
  end: number;
}

/**
 * 창 범위에 더해 `pinnedRow` 를 제자리에 그리기 위한 행 구간 목록. 끌고 있는 페이지의 행이 가장자리
 * 자동 스크롤로 창 밖에 나가도 그 요소가 남아 있어야 `dragend` 가 돌아오므로, 창 밖이면 그 행 하나를
 * 창 앞이나 뒤에 따로 둔다. 창 안이거나 없으면(-1·범위 밖) 창 범위 하나.
 */
export function windowSegments(
  window: GridWindow,
  pinnedRow: number,
  rowCount: number,
): RowSegment[] {
  const { start, end } = window;
  if (end <= start) return [];
  const pinned = Number.isInteger(pinnedRow) ? pinnedRow : -1;
  if (pinned < 0 || pinned >= rowCount || (pinned >= start && pinned < end)) {
    return [{ start, end }];
  }
  const alone = { start: pinned, end: pinned + 1 };
  return pinned < start ? [alone, { start, end }] : [{ start, end }, alone];
}

/**
 * 구간 사이를 채우는 스페이서 높이. 길이는 `segments.length + 1`: 첫 구간 위, 구간 사이, 마지막 구간
 * 아래 순. 구간이 없으면 전체 높이 하나.
 */
export function segmentSpacers(
  offsets: readonly number[],
  segments: readonly RowSegment[],
): number[] {
  const total = offsets.length > 0 ? offsets[offsets.length - 1]! : 0;
  if (segments.length === 0) return [total];
  const spacers: number[] = [offsets[segments[0]!.start]!];
  for (let i = 1; i < segments.length; i += 1) {
    spacers.push(offsets[segments[i]!.start]! - offsets[segments[i - 1]!.end]!);
  }
  spacers.push(total - offsets[segments[segments.length - 1]!.end]!);
  return spacers;
}

/**
 * 페이지가 든 셀 행의 index. `documentId` 가 `null` 이면 제외 칸에서 찾는다. 없으면 -1.
 * 빠진 페이지 칸은 뷰어가 가리킬 수 없으므로 찾지 않는다.
 */
export function rowOfPage(
  rows: readonly GridRow[],
  documentId: string | null,
  pageKey: string,
): number {
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.kind !== "cells") continue;
    const { block } = row;
    const matches =
      documentId === null
        ? block.kind === "excluded"
        : block.kind === "document" && block.document.documentId === documentId;
    if (!matches) continue;
    const pages = blockPages(block);
    for (let position = row.start; position < row.end; position += 1) {
      if (pages[position]!.key === pageKey) return index;
    }
  }
  return -1;
}

export interface RevealSpanInput {
  /** 보이게 할 구간의 위쪽 y(px). */
  top: number;
  /** 구간의 높이(px). */
  height: number;
  scrollTop: number;
  viewportHeight: number;
}

/**
 * `top..top+height` 구간이 창 안에 다 들어오도록 옮길 `scrollTop`. 이미 다 보이면 `null`. 위로
 * 벗어났으면 구간 위를 창 위에, 아래로 벗어났으면 구간 아래를 창 아래에 맞춘다(가장 가까운 쪽).
 */
export function scrollTopToRevealSpan({
  top,
  height,
  scrollTop,
  viewportHeight,
}: RevealSpanInput): number | null {
  const viewport = effectiveViewport(viewportHeight);
  const bottom = top + height;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewport) return Math.max(bottom - viewport, 0);
  return null;
}

export interface DropIndexInput {
  clientX: number;
  /** 행의 첫 셀 왼쪽 x(px, 화면 기준). */
  rowLeft: number;
  columns: number;
  size: PageGridSize;
  /** 이 행의 첫 셀이 블록 페이지 배열에서 갖는 위치. */
  rowStart: number;
  /** 블록의 전체 페이지 수. */
  count: number;
}

/**
 * 셀 행 위의 포인터 x 로 끼워 넣을 위치(블록 페이지 배열 기준, 0‥count). 포인터가 셀 가운데보다
 * 오른쪽이면 그 셀 뒤, 아니면 앞. 행의 마지막 셀보다 오른쪽(빈 자리)이면 그 행의 끝.
 */
export function dropIndexInRow({
  clientX,
  rowLeft,
  columns,
  size,
  rowStart,
  count,
}: DropIndexInput): number {
  const perRow = perRowOf(columns);
  const inRow = clamp(count - rowStart, 0, perRow);
  if (inRow <= 0) return clamp(rowStart, 0, count);
  const x = clientX - rowLeft;
  const pitch = cellPitchOf(size);
  const column = Math.floor(x / pitch);
  if (column >= inRow) return clamp(rowStart + inRow, 0, count);
  if (column < 0) return clamp(rowStart, 0, count);
  const center = column * pitch + CELL_SIZES[size].width / 2;
  return clamp(rowStart + column + (x > center ? 1 : 0), 0, count);
}
