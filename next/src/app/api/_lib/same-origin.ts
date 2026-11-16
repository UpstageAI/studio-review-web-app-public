import { errorResponse } from "./upstream-relay";

/**
 * 상태를 바꾸는 요청이 같은 사이트의 페이지에서 왔는지 확인한다. 다른 사이트가 브라우저를 거쳐
 * 이 서버의 API 키 권한으로 호출하는 것(CSRF)을 막는다.
 *
 * - `Sec-Fetch-Site` 가 있으면 그 값만으로 판정한다(`same-origin`·`none` 통과, 그 밖은 403).
 *   브라우저가 붙이고 페이지 스크립트가 바꿀 수 없는 헤더라, 리버스 프록시가 `Host` 를 바꿔도
 *   정상 요청이 막히지 않는다.
 * - 없을 때(구형 브라우저·비브라우저)만 `Origin` 의 host 를 `Host` 와 비교한다.
 * - `Origin`·`Sec-Fetch-Site` 가 모두 없는 요청(curl·서버 간 호출)은 브라우저 경유가 아니므로
 *   허용한다.
 *
 * 통과하면 `null`, 막으면 403 응답을 돌려준다.
 */
export function assertSameOrigin(request: Request): Response | null {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null) {
    return fetchSite === "same-origin" || fetchSite === "none"
      ? null
      : forbidden();
  }

  const origin = request.headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return forbidden();
    }
    if (originHost !== request.headers.get("host")) return forbidden();
  }
  return null;
}

/**
 * 읽기 요청 중 다른 사이트 페이지가 브라우저를 거쳐 보낸 것(`<img src>` 등)만 막는다.
 * `Sec-Fetch-Site` 가 `cross-site`·`same-site` 면 403, 그 밖(헤더 없음 포함)은 `null`.
 */
export function rejectCrossSite(request: Request): Response | null {
  const fetchSite = request.headers.get("sec-fetch-site");
  return fetchSite === "cross-site" || fetchSite === "same-site"
    ? forbidden()
    : null;
}

function forbidden(): Response {
  return errorResponse(403, "forbidden", "Cross-origin request is not allowed");
}
