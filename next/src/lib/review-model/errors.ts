export type ReviewModelErrorCode =
  | "invalid_json"
  | "json_too_large"
  | "nesting_too_deep"
  | "duplicate_key"
  | "unsupported_review_format"
  | "invalid_document";

/**
 * 검수 JSON 을 읽거나 펼칠 수 없을 때 던지는 오류.
 * 문구는 만들지 않는다 — host 가 `code`·`pointer`·`details` 로 번역한다.
 */
export class ReviewModelError extends Error {
  readonly code: ReviewModelErrorCode;
  readonly pointer?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ReviewModelErrorCode,
    options: {
      pointer?: string;
      details?: Record<string, unknown>;
      message?: string;
    } = {},
  ) {
    super(
      options.message ??
        (options.pointer === undefined
          ? code
          : `${code} at ${options.pointer}`),
    );
    this.name = "ReviewModelError";
    this.code = code;
    if (options.pointer !== undefined) this.pointer = options.pointer;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function isReviewModelError(value: unknown): value is ReviewModelError {
  return value instanceof ReviewModelError;
}
