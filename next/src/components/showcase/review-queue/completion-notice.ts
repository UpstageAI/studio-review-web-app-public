/**
 * 방금 검수 완료한 Job 안내. 완료 뒤 다음 Job 으로 넘어가도 헤더가 "검수 완료: 파일명" 을 잠깐
 * 보이도록 화면 밖(모듈)에 둔다. 같은 탭 안에서만 쓰고 저장하지 않는다.
 */

/** 안내를 보이는 시간. */
export const COMPLETION_NOTICE_MS = 6000;

export interface CompletionNotice {
  /** 완료한 Job 의 이름(첫 파일명, 없으면 Job ID). */
  name: string;
  /** 같은 이름을 연달아 완료해도 구독자가 바뀐 것을 알도록 매번 새로 매기는 번호. */
  seq: number;
}

let current: CompletionNotice | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeCompletionNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCompletionNotice(): CompletionNotice | null {
  return current;
}

/** 서버 렌더와 첫 하이드레이션에는 안내가 없다. */
export function getServerCompletionNotice(): CompletionNotice | null {
  return null;
}

/** 완료 안내를 띄우고 `COMPLETION_NOTICE_MS` 뒤 내린다. 새 안내가 오면 앞의 것을 바꾼다. */
export function announceCompletion(name: string): void {
  seq += 1;
  current = { name, seq };
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    current = null;
    emit();
  }, COMPLETION_NOTICE_MS);
  emit();
}
