import "server-only";

import {
  elementsOf,
  record,
  toHighlights,
  type ParseElement,
} from "@/lib/review-api/parse-highlights";
import type {
  FileHighlightsPage,
  FilePagesResponse,
} from "@/lib/review-api/types";
import { allowLoopbackImageUrls, isLoopbackHost } from "@/lib/upstage/env";

import { readTextWithin } from "./bounded-body";

export {
  HIGHLIGHT_VALUE_MAX_LENGTH,
  PARSE_CATEGORY_COLORS,
  categoryColor,
  toHighlights,
} from "@/lib/review-api/parse-highlights";

// upstream 파일 응답(`GET /v2/files/{id}?view=all&pages=all`)을 문서 뷰어가 바로 쓰는 모양으로 바꾼다.
// 페이지 이미지 URL(`toFilePagesResponse`)과 Parse 하이라이트(`toFileHighlights`, 페이지 범위 단위)를 따로
// 만들어 첫 응답이 요소 읽기를 기다리지 않게 한다.
// 요소 → 하이라이트 변환은 `lib/review-api/parse-highlights.ts` 에 있다(Job 응답의 Parse 요소도 같은 규칙).
// 페이지 번호는 `pages` 배열 순서로 정한다(요소 안 `page` 는 페이지마다 1 부터 다시 셀 수 있다).

/** URL 로 온 파싱 결과를 읽을 때 기다리는 시간. */
const ELEMENTS_FETCH_TIMEOUT_MS = 15_000;

/**
 * URL 로 온 파싱 결과 한 페이지의 최대 바이트. 한 페이지 요소(텍스트·좌표)는 보통 수백 KB 이하라
 * 여유를 두고, 페이지 수만큼 동시에 읽어도 서버 메모리가 커지지 않게 막는다.
 */
export const ELEMENTS_MAX_BYTES = 5 * 1024 * 1024;

type FilePage = {
  image_url?: unknown;
  elements?: unknown;
  elements_url?: unknown;
  elementsUrl?: unknown;
};

function isAllowedElementsUrl(url: string): boolean {
  return /^(?:https:|data:)/i.test(url);
}

/**
 * 브라우저 `<img src>` 로 넘겨도 되는 URL 만 남긴다. `https:` 는 늘 통과하고, `http:` 는
 * `allowLoopbackImageUrls()` 가 켜져 있고 호스트가 loopback 일 때만 통과한다(원격 `http:` 는 늘 거른다).
 */
export function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol === "https:") return value;
  if (
    url.protocol === "http:" &&
    isLoopbackHost(url.hostname) &&
    allowLoopbackImageUrls()
  ) {
    return value;
  }
  return null;
}

/**
 * 페이지의 파싱 결과를 요소 배열로 읽는다. 배열, JSON 문자열, 결과 JSON 을 가리키는
 * URL(`https:`·`data:`)을 모두 받는다. 읽지 못하거나 `ELEMENTS_MAX_BYTES` 를 넘으면 빈 배열
 * (하이라이트 없이 페이지만 보인다).
 */
export async function readElements(page: FilePage): Promise<ParseElement[]> {
  let payload: unknown = page.elements;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch {
      // JSON 이 아니면 결과 JSON 을 가리키는 URL 이다.
    }
  }
  if (typeof payload === "string" || payload == null) {
    const candidate =
      typeof payload === "string"
        ? payload
        : (page.elements_url ?? page.elementsUrl);
    if (typeof candidate !== "string" || !isAllowedElementsUrl(candidate)) {
      return [];
    }
    try {
      const response = await fetch(candidate, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(ELEMENTS_FETCH_TIMEOUT_MS),
      });
      // 만료된 서명 URL 등으로 읽지 못한 페이지는 하이라이트 없이 둔다.
      if (!response.ok) return [];
      // 너무 큰 결과는 하이라이트 없이 둔다.
      const text = await readTextWithin(response, ELEMENTS_MAX_BYTES);
      if (text === null) return [];
      payload = JSON.parse(text);
    } catch {
      return [];
    }
  }
  return elementsOf(payload);
}

/** 하이라이트 범위 조회 한 번에 받을 수 있는 최대 페이지 수. */
export const HIGHLIGHT_RANGE_MAX_PAGES = 50;

/** 한 범위 안에서 요소(URL)를 동시에 읽는 수. 페이지 수만큼 한꺼번에 fetch 하지 않는다. */
export const ELEMENTS_CONCURRENCY = 6;

/** upstream 파일 응답에서 파일 객체를 찾는다. `data`·`file` 로 감싸여 와도 읽는다. */
function fileRecordOf(fileJson: unknown): Record<string, unknown> {
  const body = record(fileJson);
  return (
    [body, record(body.data), record(body.file)].find(candidate =>
      Array.isArray(candidate.pages),
    ) ?? body
  );
}

/** upstream 파일 응답의 `pages` 배열(없으면 빈 배열). 순서가 파일 로컬 페이지 번호다. */
export function filePagesOf(fileJson: unknown): FilePage[] {
  const file = fileRecordOf(fileJson);
  return (Array.isArray(file.pages) ? file.pages : []) as FilePage[];
}

/** upstream 파일 응답의 파일 id. 없으면 요청에 쓴 id. */
export function fileIdOf(fileId: string, fileJson: unknown): string {
  const { id } = fileRecordOf(fileJson);
  return typeof id === "string" && id ? id : fileId;
}

/**
 * upstream 파일 응답 → `FilePagesResponse`(페이지 이미지 URL 만). 요소는 읽지 않으므로 동기이고
 * 빠르다 — 하이라이트는 `toFileHighlights` 가 범위 단위로 따로 만든다.
 * 원본 링크(`file_url`), 요소 원문·요소 이미지 URL 은 결과에 넣지 않는다.
 */
export function toFilePagesResponse(
  fileId: string,
  fileJson: unknown,
): FilePagesResponse {
  const file = fileRecordOf(fileJson);
  const pages = filePagesOf(fileJson);
  const numPages = file.num_pages;
  return {
    id: fileIdOf(fileId, fileJson),
    status: typeof file.status === "string" ? file.status : "",
    ...(typeof file.filename === "string" && { filename: file.filename }),
    num_pages:
      typeof numPages === "number" && Number.isInteger(numPages)
        ? numPages
        : null,
    pages: pages.map(page => ({
      image_url: safeImageUrl(record(page).image_url),
    })),
  };
}

/**
 * `items` 를 순서대로 최대 `limit` 개씩 동시에 `fn` 에 넘기고 결과를 입력 순서로 돌려준다.
 * 하나라도 거부되면 전체가 거부된다(`Promise.all` 과 같다).
 */
export async function mapWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let index = next++; index < items.length; index = next++) {
      results[index] = await fn(items[index] as T, index);
    }
  };
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    worker,
  );
  await Promise.all(workers);
  return results;
}

/**
 * 파일 로컬 페이지 `from`..`to`(1-based, 양끝 포함) 의 Parse 하이라이트. 파일에 없는 페이지는
 * 빼고, 요소 URL 은 `ELEMENTS_CONCURRENCY` 개씩 읽는다. 요소가 없는 페이지는 빈 배열로 들어간다.
 */
export async function toFileHighlights(
  fileJson: unknown,
  from: number,
  to: number,
): Promise<FileHighlightsPage[]> {
  const pages = filePagesOf(fileJson);
  const first = Math.max(1, from);
  const last = Math.min(to, pages.length);
  if (last < first) return [];
  const numbers = Array.from(
    { length: last - first + 1 },
    (_, offset) => first + offset,
  );
  return mapWithLimit(numbers, ELEMENTS_CONCURRENCY, async page => ({
    page,
    highlights: toHighlights(await readElements(record(pages[page - 1])), page),
  }));
}
