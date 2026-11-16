import "server-only";

import { UpstageConfigError } from "./errors";

/** `UPSTAGE_CONSOLE_API_URL` 을 비웠을 때 쓰는 공개 게이트웨이 origin. */
export const DEFAULT_CONSOLE_API_URL = "https://api.upstage.ai";

/** `http:` 를 허용하는 loopback 호스트. `URL.hostname` 은 IPv6 를 대괄호째(`[::1]`) 준다. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "localhost",
  "[::1]",
]);

/** `URL.hostname` 값이 loopback(127.0.0.1·localhost·[::1])인지. */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname);
}

export interface UpstageEnv {
  /** 게이트웨이 base URL. 끝 `/` 는 제거되며 `/v2` 는 붙지 않는다. */
  consoleApiUrl: string;
  apiKey: string;
}

/**
 * Upstage API 환경 변수를 호출 시점에 읽고 검증한다.
 * 모듈 로드 시점에 읽지 않으므로 키 없이도 `next build` 가 돈다.
 * 게이트웨이에는 `Authorization: Bearer` 로 키를 보내므로, 키가 평문으로 네트워크에 나가지 않도록
 * `http:` 는 loopback(로컬 mock upstream)만 허용하고 주소에 든 자격증명은 거부한다.
 */
export function getUpstageEnv(): UpstageEnv {
  const apiKey = process.env.UPSTAGE_API_KEY?.trim() ?? "";
  if (!apiKey) {
    throw new UpstageConfigError("UPSTAGE_API_KEY");
  }

  const rawUrl = process.env.UPSTAGE_CONSOLE_API_URL?.trim() ?? "";
  if (!rawUrl) {
    return { consoleApiUrl: DEFAULT_CONSOLE_API_URL, apiKey };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UpstageConfigError(
      "UPSTAGE_CONSOLE_API_URL",
      "UPSTAGE_CONSOLE_API_URL is not a valid URL",
    );
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new UpstageConfigError(
      "UPSTAGE_CONSOLE_API_URL",
      "UPSTAGE_CONSOLE_API_URL must be an http(s) URL",
    );
  }
  if (parsed.protocol === "http:" && !isLoopbackHost(parsed.hostname)) {
    throw new UpstageConfigError(
      "UPSTAGE_CONSOLE_API_URL",
      "UPSTAGE_CONSOLE_API_URL must use https (http is allowed only for 127.0.0.1, localhost, [::1])",
    );
  }
  if (parsed.username || parsed.password) {
    throw new UpstageConfigError(
      "UPSTAGE_CONSOLE_API_URL",
      "UPSTAGE_CONSOLE_API_URL must not contain credentials",
    );
  }

  return { consoleApiUrl: rawUrl.replace(/\/+$/, ""), apiKey };
}

/**
 * `UPSTAGE_ALLOW_HTTP_IMAGE_URLS=1` 이면 loopback 호스트(127.0.0.1·localhost·[::1])의 `http:`
 * 페이지 이미지 URL 도 브라우저에 넘긴다. 로컬 mock upstream 전용 개발 플래그로, 기본은 꺼져 있고
 * 운영에서는 켜지 않는다. 호출 시점에 읽으며 던지지 않는다.
 */
export function allowLoopbackImageUrls(): boolean {
  return process.env.UPSTAGE_ALLOW_HTTP_IMAGE_URLS?.trim() === "1";
}
