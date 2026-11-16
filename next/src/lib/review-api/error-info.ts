import { ApiError } from "./client";

/** 오류에서 분기에 쓰는 값. `ApiError` 가 아니면 `unknown_error` 이고 상태·`Retry-After` 는 `null`. */
export interface ApiErrorInfo {
  code: string;
  status: number | null;
  retryAfter: string | null;
}

/** 오류에서 코드·HTTP 상태·`Retry-After` 원문을 읽는다. 문구로 바꾸는 일은 호출처가 한다. */
export function apiErrorInfo(err: unknown): ApiErrorInfo {
  if (err instanceof ApiError) {
    return { code: err.code, status: err.status, retryAfter: err.retryAfter };
  }
  return { code: "unknown_error", status: null, retryAfter: null };
}
