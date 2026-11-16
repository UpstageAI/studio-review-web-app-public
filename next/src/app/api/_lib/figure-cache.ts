import "server-only";

import { createTtlCache } from "./ttl-cache";

// Job 응답에서 떼어 낸 Parse 그림 요소 이미지의 프로세스 메모리 캐시. `source-jobs/{jobId}/response` 가 채우고
// `source-jobs/{jobId}/figures/{key}` 가 읽는다. 바이트 합계 상한을 넘으면 오래된 그림부터 밀려나고, 밀려난
// 그림은 404 가 되어 화면에서 숨겨진다(Job 응답을 다시 받으면 다시 채워진다).

export const FIGURE_CACHE_TTL_MS = 10 * 60 * 1000;
export const FIGURE_CACHE_MAX_ENTRIES = 20_000;
export const FIGURE_CACHE_MAX_BYTES = 128 * 1024 * 1024;

export type CachedFigure = {
  bytes: Uint8Array<ArrayBuffer>;
  /** `image/png` 등. 바이트 앞머리로 가린 값. */
  contentType: string;
};

/** 라우트가 쓰는 프로세스 단위 캐시. */
export const figureCache = createTtlCache<CachedFigure>({
  ttlMs: FIGURE_CACHE_TTL_MS,
  maxEntries: FIGURE_CACHE_MAX_ENTRIES,
  maxBytes: FIGURE_CACHE_MAX_BYTES,
  sizeOf: figure => figure.bytes.byteLength,
});

/** 캐시 키. Collection·Job 이 다르면 같은 그림 키(`f1` …)도 다른 항목이다. */
export function figureCacheKey(
  collectionId: string,
  jobId: string,
  figureKey: string,
): string {
  return `${collectionId}\u0000${jobId}\u0000${figureKey}`;
}
