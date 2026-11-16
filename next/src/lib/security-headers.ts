/**
 * 모든 응답에 붙이는 보안 헤더(`next.config.ts` 의 `headers()`).
 *
 * 데모를 다른 페이지에 iframe 으로 넣어 보일 수 있게 프레이밍(`X-Frame-Options`·`frame-ancestors`)은 막지 않는다.
 *
 * 리소스를 제한하는 지시어(`script-src`·`img-src`·`style-src`·`connect-src` 등)는 넣지 않는다.
 * dev 서버는 `eval` 이 필요하고, mock 모드는 loopback http 이미지를 쓰며, 페이지 이미지의 서명 URL
 * 호스트는 미리 알 수 없다. nonce 는 동적 렌더가 필요해 locale 별 SSG 와 함께 쓸 수 없다.
 * 헤더는 빌드 때 고정되므로 실행 환경에 따라 값을 바꿀 수도 없다.
 *
 * 같은 키가 여러 항목에 걸리면 Next 는 뒤 항목의 값을 쓴다. `/api` 의 CSP 는 전역 CSP 를 덮어써
 * upstream 이 HTML 을 돌려줘도 브라우저가 스크립트를 실행하지 않게 한다.
 */

export const SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
] as const;

export const API_SECURITY_HEADERS = [
  {
    key: "Content-Security-Policy",
    value: "default-src 'none'",
  },
] as const;

export function securityHeaderRoutes() {
  return [
    { source: "/:path*", headers: [...SECURITY_HEADERS] },
    { source: "/api/:path*", headers: [...API_SECURITY_HEADERS] },
  ];
}
