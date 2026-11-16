import type { NextRequest } from "next/server";

import type { FileHighlightsResponse } from "@/lib/review-api/types";
import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import { loadFileJson } from "@/app/api/_lib/file-source";
import { pickQuery } from "@/app/api/_lib/query";
import { rejectCrossSite } from "@/app/api/_lib/same-origin";
import { invalidValue, mapClientError } from "@/app/api/_lib/upstream-relay";
import {
  HIGHLIGHT_RANGE_MAX_PAGES,
  fileIdOf,
  toFileHighlights,
} from "@/app/api/_lib/viewer-document";

const HIGHLIGHTS_QUERY = {
  /** 파일 로컬 페이지 범위 `a-b`(1-based, 양끝 포함). */
  pages: { pattern: /^[1-9]\d{0,4}-[1-9]\d{0,4}$/ },
} as const;

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

/**
 * 파일 한 건의 페이지 범위 Parse 하이라이트. `pages=a-b` 가 필수이고 한 번에 최대
 * `HIGHLIGHT_RANGE_MAX_PAGES` 쪽이다. 원본 JSON 은 `/api/files/{fileId}` 와 같은 캐시를 쓰므로
 * 이미지 응답 뒤의 범위 조회는 보통 upstream 을 다시 부르지 않는다. 파일에 없는 페이지는 응답에서 뺀다.
 * 다른 사이트가 브라우저를 거쳐 부르는 요청(`Sec-Fetch-Site: cross-site`·`same-site`)은 403 으로 막는다.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/files/[fileId]/highlights">,
) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { fileId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(fileId)) {
    return invalidValue("file_id is invalid", "file_id");
  }

  const query = pickQuery(request.nextUrl.searchParams, HIGHLIGHTS_QUERY);
  if (query.error) return query.error;
  const range = query.values.pages;
  if (range === undefined) return invalidValue("pages is required", "pages");
  const [from, to] = range.split("-").map(Number) as [number, number];
  if (from > to) {
    return invalidValue("pages must be a non-decreasing range", "pages");
  }
  if (to - from + 1 > HIGHLIGHT_RANGE_MAX_PAGES) {
    return invalidValue(
      `pages must cover at most ${HIGHLIGHT_RANGE_MAX_PAGES} pages`,
      "pages",
    );
  }

  try {
    const loaded = await loadFileJson(fileId, { refresh: false });
    if (!loaded.ok) return loaded.response;
    const body: FileHighlightsResponse = {
      id: fileIdOf(fileId, loaded.json),
      pages: await toFileHighlights(loaded.json, from, to),
    };
    return Response.json(body, NO_STORE);
  } catch (err) {
    return mapClientError(err);
  }
}
