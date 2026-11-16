import "server-only";

import { filePagesReady } from "@/lib/review-api/file-pages";
import { getFileWithPages } from "@/lib/upstage/files";

import { readTextWithin } from "./bounded-body";
import { createTtlCache } from "./ttl-cache";
import { errorResponse, relayUpstream } from "./upstream-relay";
import { toFilePagesResponse } from "./viewer-document";

// upstream 파일 응답(원본 JSON)을 fileId 별로 캐시해, 페이지 이미지 응답과 하이라이트 범위 조회가 같은
// 원본을 나눠 쓴다(upstream 파일 API 는 `pages=all|none` 뿐이라 범위를 서버에서 잘라야 한다).
// 원본에는 요소가 인라인으로 들어 있어 수 MB 일 수 있으므로 건수와 바이트 합계 상한을 둔다.
// 페이지 이미지 URL 은 만료되는 서명 URL 이라 만료 시각을 읽지 않고 짧은 TTL 로만 둔다.

export const FILE_JSON_CACHE_TTL_MS = 10 * 60 * 1000;
export const FILE_JSON_CACHE_MAX_ENTRIES = 50;
export const FILE_JSON_CACHE_MAX_BYTES = 256 * 1024 * 1024;
/** upstream 파일 응답 원문 상한. Job 응답과 같은 값이며, 넘으면 502 `response_too_large`. */
export const FILE_JSON_MAX_BYTES = 64 * 1024 * 1024;
/** 파싱한 객체가 heap 에서 차지하는 크기를 원문 바이트의 몇 배로 셀지(문자열·객체 오버헤드 추정). */
export const FILE_JSON_HEAP_FACTOR = 3;

/** `bytes` 는 원문 바이트 수. 캐시 크기는 이 값 × `FILE_JSON_HEAP_FACTOR` 로 센다. */
export type CachedFileJson = { json: unknown; bytes: number };

/** 라우트가 쓰는 프로세스 단위 캐시. 개발 서버 HMR 로 초기화돼도 다시 채워질 뿐이다. */
export const fileJsonCache = createTtlCache<CachedFileJson>({
  ttlMs: FILE_JSON_CACHE_TTL_MS,
  maxEntries: FILE_JSON_CACHE_MAX_ENTRIES,
  maxBytes: FILE_JSON_CACHE_MAX_BYTES,
  sizeOf: entry => entry.bytes * FILE_JSON_HEAP_FACTOR,
});

// 뷰어가 `/files/{id}` 와 `/highlights` 를 동시에 부르고 같은 파일을 여러 탭에서 열 수 있어, 같은
// fileId 의 동시 조회는 upstream 호출 하나로 묶는다. 조회가 끝나면(성공·실패·예외) 맵에서 지운다.
const inflight = new Map<string, Promise<LoadFileJsonResult>>();

export type LoadFileJsonResult =
  | { ok: true; json: unknown; cached: boolean }
  | { ok: false; response: Response };

/**
 * 파일 원본 JSON. `refresh` 가 아니면 캐시를 먼저 본다. upstream 오류는 relay 한 응답으로, 본문이
 * JSON 이 아니면 502 `upstream_error`, 원문이 `FILE_JSON_MAX_BYTES` 를 넘으면 502 `response_too_large` 로
 * 돌려준다. 뷰어에 그릴 준비가 된 파일(`READY` 이거나 모든 페이지에 이미지가 있음)만 캐시하고, 준비 중인
 * 파일은 캐시에서 지운다. 네트워크 예외·본문 읽기 시간 초과는 그대로 던진다(라우트가 `mapClientError`).
 */
export async function loadFileJson(
  fileId: string,
  opts: { refresh: boolean },
): Promise<LoadFileJsonResult> {
  if (!opts.refresh) {
    const cached = fileJsonCache.get(fileId);
    if (cached) return { ok: true, json: cached.json, cached: true };
  }

  // 진행 중인 조회가 곧 최신이므로 `refresh` 요청도 합류한다.
  let pending = inflight.get(fileId);
  if (!pending) {
    pending = fetchFileJson(fileId).finally(() => inflight.delete(fileId));
    inflight.set(fileId, pending);
  }
  return share(await pending);
}

/** 실패 응답은 합류한 호출마다 본문을 따로 읽도록 복제해 준다. 원본은 아무도 읽지 않는다. */
function share(result: LoadFileJsonResult): LoadFileJsonResult {
  return result.ok ? result : { ok: false, response: result.response.clone() };
}

async function fetchFileJson(fileId: string): Promise<LoadFileJsonResult> {
  const upstream = await getFileWithPages(fileId);
  if (!upstream.ok)
    return { ok: false, response: await relayUpstream(upstream) };

  const text = await readTextWithin(upstream, FILE_JSON_MAX_BYTES);
  if (text === null) {
    return {
      ok: false,
      response: errorResponse(
        502,
        "response_too_large",
        `File response exceeds ${FILE_JSON_MAX_BYTES} bytes`,
      ),
    };
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return {
      ok: false,
      response: errorResponse(
        502,
        "upstream_error",
        "Upstage API returned an invalid file response",
      ),
    };
  }

  if (filePagesReady(toFilePagesResponse(fileId, json))) {
    fileJsonCache.set(fileId, { json, bytes: Buffer.byteLength(text, "utf8") });
  } else {
    fileJsonCache.delete(fileId);
  }
  return { ok: true, json, cached: false };
}
