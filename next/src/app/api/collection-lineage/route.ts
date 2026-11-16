import {
  LineageListError,
  readCollectionLineage,
} from "@/app/api/_lib/collection-lineage";
import { rejectCrossSite } from "@/app/api/_lib/same-origin";
import { mapClientError, relayUpstream } from "@/app/api/_lib/upstream-relay";

/**
 * Collection 사이의 연결. upstream 여러 곳을 읽어 화면이 쓰는 필드만 담아 돌려준다.
 * 관계를 찾지 못한 Collection 은 응답에 넣지 않고 수만 센다. 탐색이 upstream 을 여러 번 부르므로
 * 다른 사이트가 `<img src>` 등으로 부르는 요청(`Sec-Fetch-Site: cross-site`·`same-site`)은 403 으로 막는다.
 */
export async function GET(request: Request) {
  const blocked = rejectCrossSite(request);
  if (blocked) return blocked;
  try {
    return Response.json(await readCollectionLineage(), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    // 동시 요청은 탐색 하나를 함께 쓰므로 같은 응답을 여러 번 전달할 수 있다.
    if (err instanceof LineageListError) {
      return relayUpstream(err.response.clone());
    }
    return mapClientError(err);
  }
}
