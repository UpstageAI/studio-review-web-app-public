import { defineRouting } from "next-intl/routing";
import { defaultLocale, locales } from "./config";

/**
 * URL 기반 locale 라우팅 — 모든 경로에 `/{locale}` prefix 가 붙는다 (예: `/ko/guide`).
 * prefix 없는 요청은 proxy 가 NEXT_LOCALE 쿠키 → Accept-Language → 기본 locale 순으로
 * 판단해 redirect 한다.
 */
export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "always",
});
