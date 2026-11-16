import type { DragEvent } from "react";
import { clamp } from "./math";

/** 끌면서 포인터가 스크롤 창 가장자리 이 폭(px) 안에 들면 자동으로 스크롤한다. */
export const EDGE_ZONE = 40;
/** 가장자리 자동 스크롤의 최대 속도(px/frame). */
export const EDGE_MAX_SPEED = 16;

/** `dataTransfer` 만 쓰는 drag 이벤트(테스트에서 가짜로 만들 수 있게 좁힌 모양). */
export type DragEventLike = Pick<DragEvent<HTMLElement>, "dataTransfer">;

/**
 * drag 를 시작한다: 이동만 허용하고 `mime` 에 payload 사본(JSON)을, `text/plain` 에 문서 id(없으면 빈
 * 문자열)를 넣는다. `dragover` 중에는 브라우저가 `dataTransfer` 값을 읽지 못하게 하므로 컴포넌트는
 * payload 를 상태로 따로 들고 있다.
 */
export function startDrag(
  event: DragEventLike,
  mime: string,
  payload: { documentId: string | null },
): void {
  event.dataTransfer.effectAllowed = "move";
  // Firefox 는 데이터가 없으면 drag 를 시작하지 않는다.
  event.dataTransfer.setData(mime, JSON.stringify(payload));
  event.dataTransfer.setData("text/plain", payload.documentId ?? "");
}

/** `mime` 형식으로 시작한 drag 인가(파일·텍스트·다른 view 의 drop 은 받지 않는다). */
export function hasDragType(event: DragEventLike, mime: string): boolean {
  return Array.from(event.dataTransfer.types).includes(mime);
}

/**
 * 화면 위치(끌던 항목이 아직 들어 있는 목록 기준)를 "뺀 뒤 기준" 위치로 바꾼다.
 * 편집 연산은 대상을 먼저 빼고 끼워 넣는다.
 */
export function indexAfterRemoval(from: number, to: number): number {
  return from < to ? to - 1 : to;
}

/**
 * 끌면서 포인터가 스크롤 창 가장자리 `zone` 안에 있을 때의 스크롤 속도(px/frame). 축은 하나로, 필름스트립은
 * x(왼쪽·오른쪽), 페이지 격자는 y(위·아래)를 넘긴다. 시작 쪽은 음수, 끝 쪽은 양수, 가장자리에 가까울수록
 * `max` 에 다가간다. 창 밖이면 `±max`. 창이 좁으면 가장자리 폭을 창 길이의 반으로 줄인다. 그 밖(가운데·
 * 쓸모없는 입력)은 0.
 */
export function edgeScrollVelocity(
  position: number,
  start: number,
  end: number,
  zone: number = EDGE_ZONE,
  max: number = EDGE_MAX_SPEED,
): number {
  if (zone <= 0 || max <= 0 || end <= start) return 0;
  const band = Math.min(zone, (end - start) / 2);
  if (position < start + band) {
    return -max * clamp((start + band - position) / band, 0, 1);
  }
  if (position > end - band) {
    return max * clamp((position - (end - band)) / band, 0, 1);
  }
  return 0;
}

/** `watchStaleDrag` 가 쓰는 이벤트 대상(보통 `document`). */
export type ListenerTarget = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

/**
 * 끌기를 시작한 뒤 `target` 에 포인터 이벤트(`pointermove`·`pointerdown`)가 오면 `onStale` 을 한 번
 * 부른다. 네이티브 DnD 동안에는 포인터 이벤트가 오지 않으므로, 왔다는 것은 끌기가 끝났는데
 * `dragend` 를 놓쳤다는 뜻이다(끌던 요소가 창 밖에서 언마운트된 경우 등). 반환 함수로 해제한다.
 */
export function watchStaleDrag(
  target: ListenerTarget,
  onStale: () => void,
): () => void {
  let active = true;
  const dispose = () => {
    if (!active) return;
    active = false;
    target.removeEventListener("pointermove", handle, true);
    target.removeEventListener("pointerdown", handle, true);
  };
  function handle() {
    if (!active) return;
    dispose();
    onStale();
  }
  target.addEventListener("pointermove", handle, true);
  target.addEventListener("pointerdown", handle, true);
  return dispose;
}
