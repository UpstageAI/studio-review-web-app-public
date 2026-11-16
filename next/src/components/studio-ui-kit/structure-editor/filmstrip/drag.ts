import type { DragEvent } from "react";
import {
  hasDragType,
  indexAfterRemoval,
  startDrag as startDragWith,
} from "../shared/drag-core";
import { pageDropRejectReason } from "../shared/drop";
import type { StructureRejectReason } from "../shared/types";

/** 필름스트립 안에서만 쓰는 drag 데이터 형식. 다른 앱으로 끌어도 의미가 없다. */
export const DRAG_MIME = "application/x-review-filmstrip";

/**
 * 끌고 있는 대상. `documentId: null` 은 제외 띠의 페이지다.
 * `dragover` 중에는 브라우저가 `dataTransfer` 값을 읽지 못하게 하므로 컴포넌트가 이 값을
 * 상태로 들고 있고, `dataTransfer` 에는 drag 를 시작하기 위한 사본만 넣는다.
 */
export type DragPayload =
  | {
      kind: "page";
      documentId: string | null;
      pageKey: string;
      groupId: string;
      /** 띠 안 위치(0-based). */
      index: number;
    }
  | { kind: "strip"; documentId: string; groupId: string; index: number };

export function startDrag(event: DragEvent<HTMLElement>, payload: DragPayload) {
  startDragWith(event, DRAG_MIME, payload);
}

/** 이 필름스트립에서 시작한 drag 인가(파일·텍스트 drop 은 받지 않는다). */
export function isFilmstripDrag(event: DragEvent<HTMLElement>): boolean {
  return hasDragType(event, DRAG_MIME);
}

/**
 * 포인터 x 로 끼워 넣을 위치를 구한다: 가운데가 포인터보다 왼쪽인 썸네일 수.
 * `items` 는 띠 안 썸네일 요소(화면 순서).
 */
export function dropIndexAt(
  clientX: number,
  items: readonly Element[],
): number {
  let index = 0;
  for (const item of items) {
    const rect = item.getBoundingClientRect();
    if (rect.left + rect.width / 2 < clientX) index += 1;
  }
  return index;
}

/**
 * 페이지를 띠에 놓을 수 있는가. 받으면 끼워 넣을 위치(`index`, 끌던 페이지가 아직 들어 있는 목록
 * 기준), 받지 않으면 사유. 사유가 없는 거부는 안내 없이 조용히 무시한다(자리가 그대로인 drop).
 */
// prettier-ignore
export type PageDropVerdict =
  { ok: true; index: number } | { ok: false; reason?: StructureRejectReason };

export interface PageDropInput {
  /** 끌고 있는 페이지. `documentId: null` 은 제외 띠의 페이지다. */
  drag: { documentId: string | null; groupId: string; index: number };
  /** 놓을 띠(문서). */
  strip: {
    documentId: string;
    groupId: string;
    locked?: boolean;
    pages: { readonly length: number };
  };
  /** 포인터가 가리키는 위치(펼친 띠·전체 보기). 접힌 띠(`side` 가 있을 때)는 쓰지 않는다. */
  index: number;
  /**
   * 접힌 이웃 띠면 어느 쪽이 보이는가. `"end"`(앞 문서)는 끝에, `"start"`(뒤 문서)는 앞에 들어간다 —
   * 포인터 위치와 무관하다.
   */
  side?: "start" | "end";
}

/**
 * 페이지 drop 판정. 잠긴 문서가 먼저, 그다음 다른 파일 그룹을 거부한다. 같은 문서 안에서는 접힌 띠면
 * 숨은 쪽으로 들어가므로(썸네일 메뉴도 같은 이유로 좌·우 이동을 뺀다), 그 밖에는 자리가 그대로면
 * 사유 없이 거부한다.
 */
export function pageDropVerdict({
  drag,
  strip,
  index,
  side,
}: PageDropInput): PageDropVerdict {
  const reason = pageDropRejectReason(strip, [drag.groupId]);
  if (reason) return { ok: false, reason };
  const at =
    side === undefined ? index : side === "end" ? strip.pages.length : 0;
  if (drag.documentId === strip.documentId) {
    if (side !== undefined) return { ok: false };
    if (indexAfterRemoval(drag.index, at) === drag.index) return { ok: false };
  }
  return { ok: true, index: at };
}
