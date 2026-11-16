import {
  hasDragType,
  startDrag as startDragWith,
  type DragEventLike,
} from "../shared/drag-core";
import { pageDropRejectReason } from "../shared/drop";
import type { StructureDocument, StructureDropSpot } from "../shared/types";

/** 페이지 격자 안에서만 쓰는 drag 데이터 형식. 필름스트립 등 다른 곳의 drop 과 섞이지 않는다. */
export const DRAG_MIME = "application/x-review-page-grid";

/**
 * 끌고 있는 페이지. `documentId: null` 은 제외 칸의 페이지다. 문서(머리 행)는 끌지 않는다.
 * `dragover` 중에는 브라우저가 `dataTransfer` 값을 읽지 못하게 하므로 컴포넌트가 이 값을
 * 상태로 들고 있고, `dataTransfer` 에는 drag 를 시작하기 위한 사본만 넣는다.
 */
export interface DragPayload {
  kind: "page";
  documentId: string | null;
  pageKey: string;
  groupId: string;
  /** 블록 페이지 배열 안 위치(0-based). */
  index: number;
  /**
   * 2 장 이상 함께 끌 때만: 끄는 문서 페이지 전부(잡은 페이지 포함, 문서 순 → 문서 안 순). 없으면 잡은
   * 한 장(`documentId`·`pageKey`·`index`)만 끈다. 그룹이 섞일 수 있고(그룹 섞인 선택) 그때는 어느
   * 문서에도 놓을 수 없다.
   */
  multi?: readonly DraggedPage[];
}

/** 함께 끄는 문서 페이지 하나. `index` 는 그 문서 페이지 배열 안 위치(0-based). */
export interface DraggedPage {
  documentId: string;
  pageKey: string;
  groupId: string;
  index: number;
}

/** 2 장 이상을 함께 끄는가. */
export function isMultiDrag(
  drag: DragPayload,
): drag is DragPayload & { multi: readonly DraggedPage[] } {
  return drag.multi !== undefined && drag.multi.length > 1;
}

/**
 * 잡은 문서 셀이 여러 장 선택(`selected`)에 들어 있으면 선택한 문서 페이지 전부를 문서 순 → 문서 안
 * 순으로 모아 `multi` 로 붙인다. 같은 키가 두 문서에 있으면 앞 문서 것만 센다. 선택 밖 셀·제외 칸 셀·
 * 모은 페이지가 1 장뿐이면 `drag` 를 그대로 돌려준다. 어떤 페이지를 선택에 넣을지는 밖의 규칙이다.
 */
export function expandDrag(
  drag: DragPayload,
  selected: ReadonlySet<string> | undefined,
  documents: readonly StructureDocument[],
): DragPayload {
  if (drag.documentId === null || !selected?.has(drag.pageKey)) return drag;
  const seen = new Set<string>();
  const multi: DraggedPage[] = [];
  for (const document of documents) {
    document.pages.forEach((page, index) => {
      if (!selected.has(page.key) || seen.has(page.key)) return;
      seen.add(page.key);
      multi.push({
        documentId: document.documentId,
        pageKey: page.key,
        groupId: document.groupId,
        index,
      });
    });
  }
  return multi.length > 1 ? { ...drag, multi } : drag;
}

export function startDrag(event: DragEventLike, payload: DragPayload): void {
  startDragWith(event, DRAG_MIME, payload);
}

/** 이 격자에서 시작한 drag 인가(파일·텍스트·다른 컴포넌트의 drop 은 받지 않는다). */
export function isPageGridDrag(event: DragEventLike): boolean {
  return hasDragType(event, DRAG_MIME);
}

/**
 * 화면 위치 `at`(끄는 페이지가 아직 들어 있는 목록 기준)를 같은 목록에서 `positions` 의 페이지를 모두
 * 뺀 뒤 기준 위치로 바꾼다. `indexAfterRemoval(from, to)` 는 `indexAfterRemovingPages(to, [from])` 과 같다.
 */
export function indexAfterRemovingPages(
  at: number,
  positions: readonly number[],
): number {
  return at - positions.filter(position => position < at).length;
}

/**
 * 같은 목록의 `positions` 페이지를 화면 위치 `at` 에 모아도 목록이 그대로인가 — 이어진 한 덩어리이고
 * 뺀 뒤 기준 위치가 덩어리의 첫 자리와 같을 때. 빈 목록은 참.
 */
export function gatherUnchanged(
  positions: readonly number[],
  at: number,
): boolean {
  if (positions.length === 0) return true;
  const sorted = [...positions].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i] !== sorted[i - 1] + 1) return false;
  }
  return indexAfterRemovingPages(at, sorted) === sorted[0];
}

/**
 * drop 을 받지 않는 사유. `unchanged` 는 자리가 그대로, `group` 은 다른 파일 그룹(또는 그룹이 섞인
 * 선택), `locked` 는 잠겼거나 없는 문서, `excluded` 는 이미 제외된 페이지를 제외 칸에 놓을 때.
 */
export type DropRejectReason = "unchanged" | "group" | "locked" | "excluded";

/** drop 을 받을 수 있는지. 받지 않으면 사유를 함께 둔다. */
// prettier-ignore
export type DropVerdict =
  { ok: true } | { ok: false; reason: DropRejectReason };

/** drop 자리와 판정. 거부면 자리 표시 대신 사유별 문구를 보이거나(`unchanged`·`excluded` 는) 조용히 무시한다. */
export type DropTarget = StructureDropSpot & DropVerdict;

/** `dropVerdict` 가 보는 문서의 최소 모양. */
export type DropDocument = {
  documentId: string;
  groupId: string;
  locked?: boolean;
};

const ACCEPT: DropVerdict = { ok: true };

function reject(reason: DropRejectReason): DropVerdict {
  return { ok: false, reason };
}

/**
 * 끌고 있는 페이지(여러 장이면 전부)를 `spot` 에 놓을 수 있는가와 없으면 그 사유. 문서로는 끄는 페이지가
 * 모두 같은 파일 그룹이고 잠기지 않은 문서에만, 끄는 페이지가 모두 그 문서 안에 있으면 자리가 실제로
 * 바뀔 때만 놓을 수 있다. 제외 칸은 아직 제외가 아닌(문서에 든) 페이지만 받는다. 없는 문서는 받지 않는다.
 */
export function dropVerdict(
  drag: DragPayload,
  spot: StructureDropSpot,
  documents: readonly DropDocument[],
): DropVerdict {
  if (spot.kind === "excluded") {
    return drag.documentId !== null ? ACCEPT : reject("excluded");
  }
  const document = documents.find(item => item.documentId === spot.documentId);
  const pages: readonly {
    documentId: string | null;
    groupId: string;
    index: number;
  }[] = isMultiDrag(drag) ? drag.multi : [drag];
  const reason = pageDropRejectReason(
    document,
    pages.map(page => page.groupId),
  );
  if (reason) return reject(reason);
  if (pages.some(page => page.documentId !== spot.documentId)) return ACCEPT;
  return gatherUnchanged(
    pages.map(page => page.index),
    spot.index,
  )
    ? reject("unchanged")
    : ACCEPT;
}

/** `dropVerdict` 의 `ok` 만. */
export function dropOk(
  drag: DragPayload,
  spot: StructureDropSpot,
  documents: readonly DropDocument[],
): boolean {
  return dropVerdict(drag, spot, documents).ok;
}

/** 같은 drop 자리(종류·문서·위치·판정·사유)인가. 같으면 상태를 바꾸지 않아 다시 그리지 않는다. */
export function sameTarget(a: DropTarget, b: DropTarget): boolean {
  if (a.kind !== b.kind || a.ok !== b.ok) return false;
  if (!a.ok && !b.ok && a.reason !== b.reason) return false;
  if (a.kind === "pages" && b.kind === "pages") {
    return a.documentId === b.documentId && a.index === b.index;
  }
  return true;
}
