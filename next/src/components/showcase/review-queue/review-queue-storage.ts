// 검수 큐를 탭 sessionStorage 에 둔다(새로 고침에 살아남고 새 탭에는 없다). 서버 렌더·저장소 차단에서는
// 예외 대신 `null`·`false` 를 돌려준다(큐가 없으면 Job 화면은 단일 보기로 동작한다).

import { sessionStore } from "@/lib/browser-storage";

import {
  parseQueue,
  queueStorageKey,
  type ReviewQueue,
  serializeQueue,
} from "./review-queue";

/** 저장된 큐 문자열 그대로(없거나 읽지 못하면 `null`). 값이 같으면 같은 문자열이라 구독 스냅숏으로 쓴다. */
export function readQueueText(collectionId: string): string | null {
  try {
    return sessionStore()?.getItem(queueStorageKey(collectionId)) ?? null;
  } catch {
    return null;
  }
}

/** 저장된 문자열에서 이 Collection 의 큐를 읽는다(모양이 깨졌거나 다른 Collection 이면 `null`). */
export function queueFromText(
  collectionId: string,
  text: string | null,
): ReviewQueue | null {
  const queue = parseQueue(text);
  return queue?.collectionId === collectionId ? queue : null;
}

export function readQueue(collectionId: string): ReviewQueue | null {
  return queueFromText(collectionId, readQueueText(collectionId));
}

export function writeQueue(queue: ReviewQueue): boolean {
  try {
    const store = sessionStore();
    if (!store) return false;
    store.setItem(queueStorageKey(queue.collectionId), serializeQueue(queue));
    return true;
  } catch {
    return false;
  }
}

export function clearQueue(collectionId: string): void {
  try {
    sessionStore()?.removeItem(queueStorageKey(collectionId));
  } catch {
    // 막힌 저장소에는 지울 것도 없다.
  }
}
