// 값 패널 행 오류의 순수 계산. 편집한 결과를 schema 로 바로 검사한 문제(`validateValues`)와 저장이
// 거부된 서버 오류를 pointer → 문구 하나로 모은다. 문구 자체는 host 가 next-intl 로 만든다.

import {
  jsonEquals,
  type JsonValue,
  type Result,
  type ValidationIssue,
} from "@/lib/review-model";

export type FieldError = {
  readonly message: string;
  readonly severity: "error" | "warning";
};

export type SchemaMessageKey =
  | "type"
  | "enum"
  | "required"
  | "known_key"
  | "min_items"
  | "max_items"
  | "min_length"
  | "max_length";

export type SchemaMessage = {
  readonly key: SchemaMessageKey;
  readonly values: Readonly<Record<string, string | number>>;
};

export const EMPTY_FIELD_ERRORS: ReadonlyMap<string, FieldError> = new Map();

function numberOf(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

/**
 * schema 검사 문제를 행 문구 재료로. `schema_violation` 만 다룬다(`result_not_editable` 은 결과
 * 머리의 잠금 칩이 이미 보이므로 `null`).
 */
export function schemaIssueMessage(
  issue: ValidationIssue,
): SchemaMessage | null {
  if (issue.code !== "schema_violation") return null;
  const detail = issue.detail ?? {};
  const expected = detail.expected;
  switch (expected) {
    case "enum":
      return { key: "enum", values: {} };
    case "required":
      return { key: "required", values: { missing: String(detail.missing) } };
    case "known_key":
      return { key: "known_key", values: {} };
    case "min_items":
    case "max_items":
    case "min_length":
    case "max_length":
      return {
        key: expected,
        values: {
          limit: numberOf(detail.limit),
          count: numberOf(detail.count),
        },
      };
    default:
      return { key: "type", values: { expected: String(expected ?? "") } };
  }
}

/**
 * 결과 `resultId` 의 schema 문제를 pointer 별 행 오류로 모은다. 같은 pointer 의 필수 필드 누락은
 * 빠진 키를 ", " 로 이어 한 문구로, 서로 다른 문구는 " · " 로 잇는다. 하나라도 오류면 오류,
 * 모두 경고면 경고.
 */
export function fieldErrorsFrom(
  issues: readonly ValidationIssue[],
  resultId: string,
  format: (message: SchemaMessage) => string,
): ReadonlyMap<string, FieldError> {
  type Bucket = {
    missing: string[];
    others: string[];
    error: boolean;
  };
  const buckets = new Map<string, Bucket>();
  for (const issue of issues) {
    if (issue.where.kind !== "field" || issue.where.resultId !== resultId) {
      continue;
    }
    const message = schemaIssueMessage(issue);
    if (!message) continue;
    const pointer = issue.where.pointer;
    let bucket = buckets.get(pointer);
    if (!bucket) {
      bucket = { missing: [], others: [], error: false };
      buckets.set(pointer, bucket);
    }
    if (issue.severity === "error") bucket.error = true;
    if (message.key === "required") {
      bucket.missing.push(String(message.values.missing));
    } else {
      const text = format(message);
      if (!bucket.others.includes(text)) bucket.others.push(text);
    }
  }
  if (buckets.size === 0) return EMPTY_FIELD_ERRORS;
  const out = new Map<string, FieldError>();
  for (const [pointer, bucket] of buckets) {
    const parts =
      bucket.missing.length > 0
        ? [
            format({
              key: "required",
              values: { missing: bucket.missing.join(", ") },
            }),
            ...bucket.others,
          ]
        : bucket.others;
    out.set(pointer, {
      message: parts.join(" · "),
      severity: bucket.error ? "error" : "warning",
    });
  }
  return out;
}

/**
 * 로컬 schema 오류에 서버 오류를 덮어쓴다. 서버 오류에 pointer 가 있으면 그 행의 문구가 된다
 * (서버 오류가 로컬 검사보다 앞선다). pointer 가 없으면 결과 머리에만 보이므로 그대로 둔다.
 */
export function withServerError(
  local: ReadonlyMap<string, FieldError>,
  server: { message: string; pointer: string | null } | null,
): ReadonlyMap<string, FieldError> {
  if (!server || server.pointer === null) return local;
  const out = new Map(local);
  out.set(server.pointer, { message: server.message, severity: "error" });
  return out;
}

type SchemaErrorCache = {
  readonly steps: unknown;
  readonly locale: string;
  readonly errors: ReadonlyMap<string, FieldError>;
};

// 결과 객체 → 그 값의 schema 오류. 결과 값은 바뀔 때 새 객체가 되므로 같은 객체·같은 Step schema·같은
// locale 이면 같은 결과다. 결과가 버려지면 함께 사라진다(WeakMap).
const schemaErrorCache = new WeakMap<Result, SchemaErrorCache>();

/**
 * 결과의 schema 행 오류를 결과 객체마다 한 번만 계산한다. 편집하지 않은 결과는 구조 공유로 같은
 * 객체라 같은 Map 을 돌려받아, 받는 쪽이 다시 그려지지 않는다.
 */
export function schemaErrorsFor(
  result: Result,
  steps: unknown,
  locale: string,
  compute: () => ReadonlyMap<string, FieldError>,
): ReadonlyMap<string, FieldError> {
  const hit = schemaErrorCache.get(result);
  if (hit && hit.steps === steps && hit.locale === locale) return hit.errors;
  const errors = compute();
  schemaErrorCache.set(result, { steps, locale, errors });
  return errors;
}

/**
 * 입력 위젯이 커밋을 거부한 오류. 배열 행은 `key={index}` 라 삭제·이동 뒤 같은 컴포넌트가 다른
 * 항목을 그리므로, 오류를 낸 그때의 값과 함께 둔다.
 */
export type ValueBoundError = {
  readonly value: JsonValue;
  readonly message: string;
};

/**
 * 행이 지금 그리는 값이 오류를 낸 값과 같을 때만 문구를 돌려준다(입력 draft 가 `base` 로 비교하는
 * 것과 같은 방식). 같은 값이 연속된 배열(`[1, 1]`)에서 앞 항목을 지우면 뒤 항목이 오류를 이어받는데,
 * draft 와 같은 한계로 둔다.
 */
export function boundErrorMessage(
  error: ValueBoundError | null,
  current: JsonValue,
): string | null {
  return error !== null && jsonEquals(error.value, current)
    ? error.message
    : null;
}
