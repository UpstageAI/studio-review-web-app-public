import "server-only";

import {
  UpstageConfigError,
  UpstreamNetworkError,
  UpstreamRedirectError,
} from "@/lib/upstage/errors";
import type { UpstageErrorEnvelope } from "@/lib/upstage/types";

import { readTextWithin } from "./bounded-body";

/**
 * upstream 응답에서 브라우저로 전달하는 헤더. `Location` 등 나머지는 버린다.
 * `Content-Length` 는 넘기지 않는다. fetch 는 gzip·br 본문을 풀어서 주지만 헤더에는 압축된
 * 길이가 남아 있어, 그대로 넘기면 브라우저가 본문을 중간에서 자른다.
 */
export const RELAYED_HEADERS = ["content-type", "etag", "retry-after"] as const;

const NO_STORE = "private, no-store";
const MAX_ERROR_MESSAGE_LENGTH = 800;
/** 오류 본문은 메시지 추출용이라 작게 읽는다. 넘으면 본문 없이 상태 코드 문구만 쓴다. */
const MAX_ERROR_BODY_BYTES = 64 * 1024;

/** upstream 과 같은 `{ error: { code, type, message, param } }` 모양의 BFF 오류 응답. */
export function errorResponse(
  status: number,
  code: string,
  message: string,
  opts: { retryAfter?: string | null; param?: string } = {},
): Response {
  const headers = new Headers({ "Cache-Control": NO_STORE });
  if (opts.retryAfter) headers.set("Retry-After", opts.retryAfter);
  const body: UpstageErrorEnvelope = {
    error: { code, type: code, message, param: opts.param ?? null },
  };
  return Response.json(body, { status, headers });
}

/** 요청 값 검증 실패(400 `invalid_value`). */
export function invalidValue(message: string, param?: string): Response {
  return errorResponse(400, "invalid_value", message, { param });
}

function relayHeaders(upstream: Response, names: readonly string[]): Headers {
  const headers = new Headers({ "Cache-Control": NO_STORE });
  for (const name of names) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return headers;
}

function pickEnvelope(value: unknown): UpstageErrorEnvelope | null {
  if (typeof value !== "object" || value === null) return null;
  const error = (value as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  const { code, type, message, param, details } = error as Record<
    string,
    unknown
  >;
  if (typeof code !== "string") return null;
  return {
    error: {
      code,
      type: typeof type === "string" ? type : code,
      message: typeof message === "string" ? message : "",
      param: typeof param === "string" ? param : null,
      ...(details !== undefined && { details }),
    },
  };
}

function plainTextMessage(text: string): string {
  const stripped = text
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${stripped.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : stripped;
}

/**
 * upstream 응답을 브라우저로 전달한다.
 * 성공 본문은 파싱하지 않고 스트림 그대로 넘긴다(검수 JSON 의 숫자 토큰 보존). 오류 본문은
 * upstream envelope 의 허용 필드만 다시 만들고, JSON 이 아니면 `upstream_error` 로 감싼다.
 */
export async function relayUpstream(upstream: Response): Promise<Response> {
  const { status } = upstream;

  if (status < 400) {
    const noBody = status === 204 || status === 304;
    if (noBody) await upstream.body?.cancel().catch(() => undefined);
    return new Response(noBody ? null : upstream.body, {
      status,
      headers: relayHeaders(upstream, RELAYED_HEADERS),
    });
  }

  const text =
    (await readTextWithin(upstream, MAX_ERROR_BODY_BYTES).catch(() => null)) ??
    "";
  let envelope: UpstageErrorEnvelope | null = null;
  if (upstream.headers.get("content-type")?.includes("json")) {
    try {
      envelope = pickEnvelope(JSON.parse(text));
    } catch {
      envelope = null;
    }
  }
  envelope ??= {
    error: {
      code: "upstream_error",
      type: "upstream_error",
      message:
        plainTextMessage(text) || `Upstream responded with status ${status}`,
      param: null,
    },
  };

  const headers = relayHeaders(upstream, ["etag", "retry-after"]);
  return Response.json(envelope, { status, headers });
}

/** `upstageFetch` 가 던진 오류를 BFF 오류 응답으로 바꾼다. 키·환경 변수 이름·upstream URL 은 응답에 넣지 않는다. */
export function mapClientError(err: unknown): Response {
  if (err instanceof UpstageConfigError) {
    console.error("[upstage] configuration error", err.name);
    return errorResponse(
      500,
      "server_misconfigured",
      "Server is missing Upstage API configuration",
    );
  }
  if (err instanceof UpstreamNetworkError) {
    console.error("[upstage] network error", err.name, {
      timedOut: err.timedOut,
    });
    return err.timedOut
      ? errorResponse(
          504,
          "upstream_timeout",
          "Upstage API did not respond in time",
        )
      : errorResponse(502, "api_unreachable", "Could not reach Upstage API");
  }
  // 헤더를 받은 뒤 본문을 읽다가 `AbortSignal.timeout` 이 끝나면 fetch 밖에서 DOMException 이 난다.
  // 브라우저가 연결을 끊어 생긴 abort 도 여기로 오지만 응답을 받을 쪽이 없어 무해하다. relay 라우트는
  // 본문을 스트림으로 넘기므로 그 도중의 타임아웃은 이미 보낸 200 이 잘린 채 끝난다(여기서 바꿀 수 없음).
  if (
    err instanceof DOMException &&
    (err.name === "TimeoutError" || err.name === "AbortError")
  ) {
    console.error("[upstage] body read timed out", err.name);
    return errorResponse(
      504,
      "upstream_timeout",
      "Upstream did not finish in time",
    );
  }
  if (err instanceof UpstreamRedirectError) {
    console.error("[upstage] unexpected redirect", err.name, err.status);
    return errorResponse(
      502,
      "upstream_redirect",
      "Upstage API responded with an unexpected redirect",
    );
  }
  console.error(
    "[upstage] unexpected error",
    err instanceof Error ? err.name : typeof err,
  );
  return errorResponse(500, "internal_error", "Internal server error");
}
