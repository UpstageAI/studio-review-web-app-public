// 요청 취소 판별. 층 밖 공용 유틸이라 어느 층에서든 쓴다(`review-api/client` 는 이것을 다시 내보낸다).

/** 요청이 `AbortSignal` 로 취소됐는지. 취소는 오류로 보여 주지 않는다. */
export function isAbortError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { name?: unknown }).name === "AbortError"
  );
}
