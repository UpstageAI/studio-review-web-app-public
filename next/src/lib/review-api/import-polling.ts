// 가져오기(`review-imports`)가 끝날 때까지 상태를 조회하는 helper. React·타이머 구현과
// 분리해 두어 가짜 타이머로 종료 조건을 고정한다.

import {
  parseImportOutcome,
  retryAfterMs,
  type ImportOutcome,
} from "@/lib/review-model";
import { isAbortError, type ReviewImportResponse } from "./client";
import { apiErrorInfo } from "./error-info";

/** 종료된 가져오기의 결과(`pending` 제외). */
export type FinishedImportOutcome = Exclude<ImportOutcome, { kind: "pending" }>;

export type PollImportResult =
  | { kind: "finished"; outcome: FinishedImportOutcome }
  /** 제한 시간 안에 끝나지 않았다. `status` 는 마지막으로 본 상태. */
  | { kind: "timeout"; status: string | null }
  | { kind: "aborted" }
  /** 연속 오류 한도에 닿았거나 다시 시도해도 바뀌지 않을 오류. */
  | { kind: "error"; error: unknown };

export interface PollImportOptions {
  /** 상태 한 번 조회. `signal` 을 fetch 에 넘긴다. */
  fetchStatus: (signal: AbortSignal) => Promise<ReviewImportResponse>;
  signal: AbortSignal;
  /** 첫 조회 전 대기(가져오기를 만든 응답의 `Retry-After`). 없으면 기본 간격. */
  initialRetryAfter?: string | null;
  /** 전체 제한 시간. 기본 10 분. */
  timeoutMs?: number;
  /** 연속 오류 허용 횟수. 기본 3 — 세 번째 연속 오류에서 멈춘다. */
  maxConsecutiveErrors?: number;
  /** `Retry-After` 가 없을 때 간격. 기본 2 초. */
  fallbackMs?: number;
  /** 간격 상한. 기본 10 초. */
  capMs?: number;
  /** 간격 하한. 기본 1 초. */
  minIntervalMs?: number;
  now?: () => number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** 끝나지 않은 상태를 읽을 때마다. */
  onPending?: (status: string) => void;
}

export const IMPORT_POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** `signal` 이 끊기면 바로 끝나는 대기. 타이머·리스너를 남기지 않는다. */
export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** 다시 조회해 볼 만한 오류인가: 연결 실패·5xx·429·408. 그 밖의 4xx 는 바로 멈춘다. */
export function isRetryableError(err: unknown): boolean {
  const { status } = apiErrorInfo(err);
  if (status === null) return true;
  return status === 0 || status >= 500 || status === 429 || status === 408;
}

/**
 * 가져오기가 종료 상태가 될 때까지 `Retry-After` 간격(하한 1 초, 상한 10 초)으로 조회한다.
 * 멈추는 조건은 네 가지다: 종료 상태, 제한 시간, `signal` 취소, 연속 오류(또는 재시도해도 같을 오류).
 */
export async function pollImport(
  options: PollImportOptions,
): Promise<PollImportResult> {
  const {
    fetchStatus,
    signal,
    timeoutMs = IMPORT_POLL_TIMEOUT_MS,
    maxConsecutiveErrors = 3,
    fallbackMs = 2000,
    capMs = 10_000,
    minIntervalMs = 1000,
    now = Date.now,
    sleep = abortableSleep,
    onPending,
  } = options;
  const interval = (header: string | null | undefined) =>
    Math.max(retryAfterMs(header, { fallbackMs, capMs }), minIntervalMs);

  const start = now();
  let wait = interval(options.initialRetryAfter);
  let errors = 0;
  let lastStatus: string | null = null;

  for (;;) {
    if (signal.aborted) return { kind: "aborted" };
    const remaining = timeoutMs - (now() - start);
    if (remaining <= 0) return { kind: "timeout", status: lastStatus };
    await sleep(Math.min(wait, remaining), signal);
    if (signal.aborted) return { kind: "aborted" };
    if (now() - start >= timeoutMs) {
      return { kind: "timeout", status: lastStatus };
    }

    let response: ReviewImportResponse;
    try {
      response = await fetchStatus(signal);
    } catch (err) {
      if (signal.aborted || isAbortError(err)) return { kind: "aborted" };
      errors += 1;
      if (errors >= maxConsecutiveErrors || !isRetryableError(err)) {
        return { kind: "error", error: err };
      }
      wait = interval(apiErrorInfo(err).retryAfter);
      continue;
    }
    if (signal.aborted) return { kind: "aborted" };
    errors = 0;
    const outcome = parseImportOutcome(response.resource);
    if (outcome.kind !== "pending") return { kind: "finished", outcome };
    lastStatus = outcome.status;
    onPending?.(outcome.status);
    wait = interval(response.retryAfter);
  }
}
