/** Upstage API 설정(환경 변수)이 없거나 형식이 잘못됐다. `variable` 은 서버 로그용이며 응답에 넣지 않는다. */
export class UpstageConfigError extends Error {
  readonly variable: string;

  constructor(variable: string, message?: string) {
    super(message ?? `${variable} is not configured`);
    this.name = "UpstageConfigError";
    this.variable = variable;
  }
}

/** upstream 에 도달하지 못했다(fetch reject). 시간 초과로 중단됐으면 `timedOut` 이 true 다. */
export class UpstreamNetworkError extends Error {
  readonly timedOut: boolean;

  constructor(cause: unknown) {
    const timedOut =
      cause instanceof Error &&
      (cause.name === "TimeoutError" || cause.name === "AbortError");
    super(timedOut ? "Upstream request timed out" : "Upstream request failed", {
      cause,
    });
    this.name = "UpstreamNetworkError";
    this.timedOut = timedOut;
  }
}

/** upstream 이 3xx 를 돌려줬다. API 키가 다른 호스트로 전달되지 않도록 redirect 는 따라가지 않는다. */
export class UpstreamRedirectError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Upstream responded with redirect status ${status}`);
    this.name = "UpstreamRedirectError";
    this.status = status;
  }
}
