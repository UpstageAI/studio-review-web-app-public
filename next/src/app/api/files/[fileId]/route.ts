import type { NextRequest } from "next/server";

import { RESOURCE_ID_PATTERN } from "@/lib/upstage/review";

import { loadFileJson } from "@/app/api/_lib/file-source";
import { pickQuery } from "@/app/api/_lib/query";
import { rejectCrossSite } from "@/app/api/_lib/same-origin";
import { invalidValue, mapClientError } from "@/app/api/_lib/upstream-relay";
import { toFilePagesResponse } from "@/app/api/_lib/viewer-document";

const FILE_QUERY = {
  /** `1` 이면 캐시를 건너뛰고 다시 조회한다(서명 URL 만료 대응). */
  refresh: { enum: ["1"] },
} as const;

const NO_STORE = { headers: { "Cache-Control": "private, no-store" } };

/**
 * 파일 한 건의 페이지 이미지 URL. upstream 응답을 그대로 넘기지 않고 뷰어용으로 바꿔 돌려준다
 * (원본 파일 링크·요소 원문은 빼고). Parse 요소는 읽지 않으므로 페이지 수에 관계없이 바로 응답한다 —
 * 하이라이트는 `/api/files/{fileId}/highlights?pages=a-b` 가 범위 단위로 준다. 원본 JSON 은
 * 뷰어에 그릴 준비가 된 파일만 10 분 캐시한다(`file-source.ts`). 원본 JSON 이 클 수 있어 다른 사이트가
 * `<img src>` 등으로 부르는 요청(`Sec-Fetch-Site: cross-site`·`same-site`)은 403 으로 막는다.
 */
export async function GET(
  request: NextRequest,
  ctx: RouteContext<"/api/files/[fileId]">,
) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  const { fileId } = await ctx.params;
  if (!RESOURCE_ID_PATTERN.test(fileId)) {
    return invalidValue("file_id is invalid", "file_id");
  }

  const query = pickQuery(request.nextUrl.searchParams, FILE_QUERY);
  if (query.error) return query.error;

  try {
    const loaded = await loadFileJson(fileId, {
      refresh: query.values.refresh === "1",
    });
    if (!loaded.ok) return loaded.response;
    return Response.json(toFilePagesResponse(fileId, loaded.json), NO_STORE);
  } catch (err) {
    return mapClientError(err);
  }
}
