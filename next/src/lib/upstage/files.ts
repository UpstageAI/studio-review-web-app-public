import "server-only";

import { upstageFetch } from "./client";
import { upstageEndpoints } from "./endpoints";

/**
 * 파일 한 건을 페이지 이미지·파싱 결과까지 포함해 조회한다
 * (`view=all&pages=all`). 응답의 `image_url`·`file_url` 은 만료되는 서명 URL 이다.
 */
export function getFileWithPages(fileId: string): Promise<Response> {
  return upstageFetch(upstageEndpoints.files.file(fileId), {
    query: { view: "all", pages: "all" },
  });
}
