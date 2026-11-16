import "server-only";

import { invalidValue } from "./upstream-relay";

/** 쿼리 하나의 검증 규칙. */
export type QueryRule =
  /** 나열한 값 중 하나 */
  | { enum: readonly string[] }
  /** `true`·`false` → boolean */
  | { bool: true }
  /** 10 진 정수 범위 → number */
  | { int: { min: number; max: number } }
  /** 문자 수(코드 포인트) 범위 */
  | { length: { min: number; max: number } }
  /** 형식을 모르는 페이지 커서: 1..4096 자, 공백·제어 문자 없음. upstream 커서는 서명된 토큰이라 수백 자를 넘는다 */
  | { cursor: true }
  /** 정규식과 일치 */
  | { pattern: RegExp };

export type QuerySpec = Record<string, QueryRule>;

type RuleValue<R> = R extends { enum: readonly (infer E)[] }
  ? E
  : R extends { bool: true }
    ? boolean
    : R extends { int: unknown }
      ? number
      : string;

/** spec 이 허용한 쿼리 중 요청에 있던 값만 담는다. */
export type QueryValues<S extends QuerySpec> = {
  -readonly [K in keyof S]?: RuleValue<S[K]>;
};

export type PickQueryResult<S extends QuerySpec> =
  | { values: QueryValues<S>; error?: undefined }
  | { values?: undefined; error: Response };

const CURSOR_PATTERN = /^[^\s\p{Cc}]{1,4096}$/u;
const INTEGER_PATTERN = /^\d{1,9}$/;

function check(
  rule: QueryRule,
  raw: string,
):
  | { ok: true; value: string | number | boolean }
  | { ok: false; message: string } {
  if ("enum" in rule) {
    return rule.enum.includes(raw)
      ? { ok: true, value: raw }
      : { ok: false, message: `must be one of ${rule.enum.join(", ")}` };
  }
  if ("bool" in rule) {
    if (raw === "true") return { ok: true, value: true };
    if (raw === "false") return { ok: true, value: false };
    return { ok: false, message: "must be true or false" };
  }
  if ("int" in rule) {
    const { min, max } = rule.int;
    const value = INTEGER_PATTERN.test(raw) ? Number(raw) : Number.NaN;
    return value >= min && value <= max
      ? { ok: true, value }
      : { ok: false, message: `must be an integer between ${min} and ${max}` };
  }
  if ("length" in rule) {
    const { min, max } = rule.length;
    const length = Array.from(raw).length;
    return length >= min && length <= max
      ? { ok: true, value: raw }
      : {
          ok: false,
          message: `must be between ${min} and ${max} characters`,
        };
  }
  if ("cursor" in rule) {
    return CURSOR_PATTERN.test(raw)
      ? { ok: true, value: raw }
      : { ok: false, message: "is not a valid cursor" };
  }
  return rule.pattern.test(raw)
    ? { ok: true, value: raw }
    : { ok: false, message: "is invalid" };
}

/**
 * 요청 쿼리를 spec 화이트리스트로 검증한다. spec 에 없는 이름은 무시하고(upstream 으로 보내지 않음),
 * 같은 이름이 여러 번 오면 첫 값만 쓴다. 빈 값(`?q=`)은 보내지 않은 것으로 본다.
 * 첫 위반에서 400 `invalid_value`(`param` = 쿼리 이름) 응답을 돌려준다.
 */
export function pickQuery<S extends QuerySpec>(
  searchParams: URLSearchParams,
  spec: S,
): PickQueryResult<S> {
  const values: Record<string, string | number | boolean> = {};
  for (const [name, rule] of Object.entries(spec)) {
    const raw = searchParams.get(name);
    if (raw === null || raw === "") continue;
    const result = check(rule, raw);
    if (!result.ok) {
      return { error: invalidValue(`${name} ${result.message}`, name) };
    }
    values[name] = result.value;
  }
  return { values: values as QueryValues<S> };
}
