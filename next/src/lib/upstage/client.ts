import "server-only";

import { getUpstageEnv } from "./env";
import { UpstreamNetworkError, UpstreamRedirectError } from "./errors";

const DEFAULT_TIMEOUT_MS = 60_000;

type QueryValue = string | number | boolean | readonly (string | number)[];

export interface UpstageFetchInit {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: HeadersInit;
  /** 배열은 같은 키를 반복한다(`job_ids=a&job_ids=b`). `undefined` 는 생략한다. */
  query?: Record<string, QueryValue | undefined>;
  body?: BodyInit | null;
  /** 기본 60 초 */
  timeoutMs?: number;
}

function buildUrl(
  consoleApiUrl: string,
  path: string,
  query: UpstageFetchInit["query"],
): URL {
  if (!path.startsWith("/v2/")) {
    throw new Error("Upstage API path must start with /v2/");
  }

  const base = new URL(consoleApiUrl);
  const basePath = base.pathname.replace(/\/+$/, "");
  const url = new URL(basePath + path, base.origin);
  // 인코딩되지 않은 `..` 등으로 base 밖 경로가 만들어지면 키를 보내기 전에 막는다.
  if (
    url.origin !== base.origin ||
    !url.pathname.startsWith(`${basePath}/v2/`)
  ) {
    throw new Error("Upstage API path escapes the configured base URL");
  }

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, String(item));
    } else {
      url.searchParams.append(key, String(value));
    }
  }
  return url;
}

/**
 * Upstage 콘솔 게이트웨이를 서버에서 호출한다.
 * API 키는 항상 이 함수가 `Authorization` 에 넣는다(호출자 값은 무시). 응답은 캐시하지 않고
 * redirect 는 따라가지 않는다. 2xx·304·4xx·5xx 응답은 그대로 돌려주고, 3xx 는
 * `UpstreamRedirectError`, 네트워크 실패·시간 초과는 `UpstreamNetworkError` 로 던진다.
 */
export async function upstageFetch(
  path: string,
  init: UpstageFetchInit = {},
): Promise<Response> {
  const { consoleApiUrl, apiKey } = getUpstageEnv();
  const url = buildUrl(consoleApiUrl, path, init.query);

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${apiKey}`);

  let response: Response;
  try {
    response = await fetch(url, {
      method: init.method ?? "GET",
      headers,
      body: init.body ?? null,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (err) {
    throw new UpstreamNetworkError(err);
  }

  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.status !== 304
  ) {
    // 본문은 쓰지 않으므로 연결을 정리한다.
    await response.body?.cancel().catch(() => undefined);
    throw new UpstreamRedirectError(response.status);
  }
  return response;
}
