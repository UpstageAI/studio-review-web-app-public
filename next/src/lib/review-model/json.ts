import { ReviewModelError } from "./errors";

/**
 * 숫자를 잃지 않는 JSON 파서·직렬화기.
 *
 * JS `Number` 로 왕복되지 않는 숫자 토큰(큰 정수·고정밀 소수·지수 표기·`-0`)은
 * `ExactNumber` 로 원문을 그대로 들고 있다가 `stringifyJson` 이 그대로 낸다.
 * 검수 JSON 에는 `JSON.parse`·`JSON.stringify`·`structuredClone` 을 쓰지 않는다.
 */

export type JsonValue =
  null | boolean | number | string | ExactNumber | JsonValue[] | JsonObject;
export type JsonObject = { [key: string]: JsonValue };

/** 모듈이 두 번 로드돼도(HMR·번들 분할) 같은 브랜드로 판별되도록 전역 심볼을 쓴다. */
const EXACT_NUMBER_BRAND = Symbol.for("review-model.exact-number");
const NUMBER_TOKEN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export class ExactNumber {
  readonly raw: string;

  constructor(raw: string) {
    if (!NUMBER_TOKEN.test(raw)) {
      throw new ReviewModelError("invalid_json", {
        details: { reason: "number_token", token: raw },
      });
    }
    this.raw = raw;
    Object.defineProperty(this, EXACT_NUMBER_BRAND, { value: true });
    Object.freeze(this);
  }

  toString(): string {
    return this.raw;
  }
}

export function isExactNumber(value: unknown): value is ExactNumber {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { [EXACT_NUMBER_BRAND]?: unknown })[EXACT_NUMBER_BRAND] === true
  );
}

export function isJsonNumber(value: unknown): value is number | ExactNumber {
  return typeof value === "number" || isExactNumber(value);
}

export function isJsonObject(value: unknown): value is JsonObject {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isExactNumber(value)
  );
}

// ---------------------------------------------------------------------------
// 숫자 정규형
// ---------------------------------------------------------------------------

/** 10 진 숫자 토큰을 `[-]digits e scale` 정규형으로 접는다. 0 은 부호 없이 "0". */
function canonicalToken(token: string): string {
  let rest = token;
  const negative = rest.startsWith("-");
  if (negative) rest = rest.slice(1);
  const e = rest.search(/[eE]/);
  const coefficient = e < 0 ? rest : rest.slice(0, e);
  const exponent = e < 0 ? "0" : rest.slice(e + 1);
  const dot = coefficient.indexOf(".");
  const whole = dot < 0 ? coefficient : coefficient.slice(0, dot);
  const fraction = dot < 0 ? "" : coefficient.slice(dot + 1);
  // 0 은 인덱스 루프로 센다. 정규식 `/0+$/` 는 0 이 길게 이어지면 백트래킹으로 이차 시간이 든다.
  const all = whole + fraction;
  let start = 0;
  while (start < all.length && all.charCodeAt(start) === 48) start++;
  if (start === all.length) return "0";
  let end = all.length;
  while (end > start && all.charCodeAt(end - 1) === 48) end--;
  const trailingZeros = all.length - end;
  const digits = all.slice(start, end);
  const scale =
    BigInt(exponent) - BigInt(fraction.length) + BigInt(trailingZeros);
  return `${negative ? "-" : ""}${digits}e${scale.toString()}`;
}

function numberToken(value: number | ExactNumber): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new ReviewModelError("invalid_json", {
        details: { reason: "non_finite_number" },
      });
    }
    return String(value);
  }
  return value.raw;
}

/**
 * 같은 수를 같은 문자열로: `1`·`1.0`·`1e0`·`ExactNumber("1.00")` → 같은 값,
 * `-0`·`0` → `"0"`. "변경됨" 판정은 이 값으로 비교한다(서버 규칙과 같음).
 */
export function canonicalNumber(value: number | ExactNumber): string {
  return canonicalToken(numberToken(value));
}

/** JSON Schema `integer` 의미: 소수부가 없는 수(`1.0`·`1e3` 포함). */
export function isIntegerNumber(value: number | ExactNumber): boolean {
  if (typeof value === "number") return Number.isInteger(value);
  const canonical = canonicalToken(value.raw);
  if (canonical === "0") return true;
  return !canonical.slice(canonical.indexOf("e") + 1).startsWith("-");
}

// ---------------------------------------------------------------------------
// 파서
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_JSON_BYTES = 16 * 1024 * 1024;
export const DEFAULT_MAX_JSON_DEPTH = 64;

export type ParseJsonOptions = {
  /** UTF-8 바이트 상한. 기본 16 MiB(`review-document` 상한과 같음). */
  maxBytes?: number;
  /** 객체·배열 중첩 상한. 기본 64. */
  maxDepth?: number;
};

/** UTF-8 인코딩 길이. 버퍼를 만들지 않고 UTF-16 코드 유닛을 센다(짝 없는 서로게이트는 U+FFFD 3 바이트). */
export function utf8Length(text: string): number {
  let bytes = 0;
  const length = text.length;
  for (let i = 0; i < length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

function escapePointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}

function pointerOf(path: readonly string[]): string {
  return path.map(token => "/" + escapePointerToken(token)).join("");
}

const NUMBER_STICKY = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;
const SIMPLE_ESCAPES: Record<string, string> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t",
};

/**
 * 숫자 정밀도를 지키는 JSON 파서. 중복 키·깊이·바이트 초과·후행 문자를 거부하고
 * `__proto__` 같은 키는 데이터(own property)로 넣는다.
 */
export function parseJson(
  text: string,
  options: ParseJsonOptions = {},
): JsonValue {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_JSON_BYTES;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_JSON_DEPTH;
  if (text.length > maxBytes || utf8Length(text) > maxBytes) {
    throw new ReviewModelError("json_too_large", {
      details: { limit: maxBytes },
    });
  }

  const length = text.length;
  const path: string[] = [];
  let i = 0;

  const fail = (reason: string): never => {
    throw new ReviewModelError("invalid_json", {
      pointer: pointerOf(path),
      details: { reason, offset: i },
    });
  };

  const skipWhitespace = () => {
    while (i < length) {
      const c = text.charCodeAt(i);
      if (c === 0x20 || c === 0x0a || c === 0x0d || c === 0x09) i++;
      else break;
    }
  };

  const parseString = (): string => {
    i++; // 여는 따옴표
    let out = "";
    let chunk = i;
    for (;;) {
      if (i >= length) return fail("unterminated_string");
      const c = text.charCodeAt(i);
      if (c === 0x22) {
        out += text.slice(chunk, i);
        i++;
        return out;
      }
      if (c === 0x5c) {
        out += text.slice(chunk, i);
        const escape = text[i + 1];
        if (escape === undefined) return fail("unterminated_string");
        if (escape === "u") {
          const hex = text.slice(i + 2, i + 6);
          if (!HEX4.test(hex)) return fail("invalid_escape");
          out += String.fromCharCode(parseInt(hex, 16));
          i += 6;
        } else {
          const decoded = SIMPLE_ESCAPES[escape];
          if (decoded === undefined || !Object.hasOwn(SIMPLE_ESCAPES, escape)) {
            return fail("invalid_escape");
          }
          out += decoded;
          i += 2;
        }
        chunk = i;
        continue;
      }
      if (c < 0x20) return fail("control_character");
      i++;
    }
  };

  const parseNumber = (): number | ExactNumber => {
    NUMBER_STICKY.lastIndex = i;
    const match = NUMBER_STICKY.exec(text);
    if (!match) return fail("unexpected_token");
    const token = match[0];
    i += token.length;
    const value = Number(token);
    // 지수 표기는 값이 같아도 원문 표기를 지킨다(`1E2` 를 `100` 으로 바꿔 쓰지 않음).
    if (
      !/[eE]/.test(token) &&
      Number.isFinite(value) &&
      !Object.is(value, -0) &&
      canonicalToken(token) === canonicalToken(String(value))
    ) {
      return value;
    }
    return new ExactNumber(token);
  };

  const parseValue = (depth: number): JsonValue => {
    skipWhitespace();
    if (i >= length) return fail("unexpected_end");
    const c = text[i];
    if (c === '"') return parseString();
    if (c === "{" || c === "[") {
      if (depth + 1 > maxDepth) {
        throw new ReviewModelError("nesting_too_deep", {
          pointer: pointerOf(path),
          details: { limit: maxDepth },
        });
      }
      return c === "{" ? parseObject(depth + 1) : parseArray(depth + 1);
    }
    if (text.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (text.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (text.startsWith("null", i)) {
      i += 4;
      return null;
    }
    return parseNumber();
  };

  const parseObject = (depth: number): JsonObject => {
    i++; // {
    const out: JsonObject = {};
    skipWhitespace();
    if (text[i] === "}") {
      i++;
      return out;
    }
    for (;;) {
      skipWhitespace();
      if (text[i] !== '"') return fail("expected_key");
      const key = parseString();
      path.push(key);
      if (Object.hasOwn(out, key)) {
        throw new ReviewModelError("duplicate_key", {
          pointer: pointerOf(path),
          details: { key },
        });
      }
      skipWhitespace();
      if (text[i] !== ":") return fail("expected_colon");
      i++;
      const value = parseValue(depth);
      Object.defineProperty(out, key, {
        value,
        writable: true,
        enumerable: true,
        configurable: true,
      });
      path.pop();
      skipWhitespace();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "}") {
        i++;
        return out;
      }
      return fail("expected_comma_or_end");
    }
  };

  const parseArray = (depth: number): JsonValue[] => {
    i++; // [
    const out: JsonValue[] = [];
    skipWhitespace();
    if (text[i] === "]") {
      i++;
      return out;
    }
    for (;;) {
      path.push(String(out.length));
      out.push(parseValue(depth));
      path.pop();
      skipWhitespace();
      if (text[i] === ",") {
        i++;
        continue;
      }
      if (text[i] === "]") {
        i++;
        return out;
      }
      return fail("expected_comma_or_end");
    }
  };

  const value = parseValue(0);
  skipWhitespace();
  if (i !== length) fail("trailing_characters");
  return value;
}

// ---------------------------------------------------------------------------
// 직렬화·복제·비교
// ---------------------------------------------------------------------------

function notJson(reason: string): never {
  throw new ReviewModelError("invalid_json", { details: { reason } });
}

function writeValue(
  value: unknown,
  pretty: boolean,
  indent: string,
  out: string[],
): void {
  if (value === null) {
    out.push("null");
    return;
  }
  switch (typeof value) {
    case "boolean":
      out.push(value ? "true" : "false");
      return;
    case "number":
      out.push(numberToken(value));
      return;
    case "string":
      // 문자열 하나의 이스케이프만 맡긴다(숫자·문서 구조와 무관).
      out.push(JSON.stringify(value));
      return;
    case "object":
      break;
    default:
      notJson(`unsupported_${typeof value}`);
  }
  if (isExactNumber(value)) {
    out.push(value.raw);
    return;
  }
  const inner = pretty ? indent + "  " : "";
  const newline = pretty ? "\n" : "";
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push("[]");
      return;
    }
    out.push("[", newline);
    value.forEach((item, index) => {
      if (index > 0) out.push(",", newline);
      out.push(inner);
      if (item === undefined) notJson("undefined_in_array");
      writeValue(item, pretty, inner, out);
    });
    out.push(newline, indent, "]");
    return;
  }
  const entries = Object.keys(value as object).filter(
    key => (value as Record<string, unknown>)[key] !== undefined,
  );
  if (entries.length === 0) {
    out.push("{}");
    return;
  }
  out.push("{", newline);
  entries.forEach((key, index) => {
    if (index > 0) out.push(",", newline);
    out.push(inner, JSON.stringify(key), pretty ? ": " : ":");
    writeValue((value as Record<string, unknown>)[key], pretty, inner, out);
  });
  out.push(newline, indent, "}");
}

/**
 * `ExactNumber.raw` 를 그대로 내는 직렬화. 객체의 `undefined` 값 키는 생략하고
 * (JSON 과 같음) 배열 안 `undefined`·함수·비유한 수는 거부한다.
 */
export function stringifyJson(
  value: unknown,
  options: { pretty?: boolean } = {},
): string {
  if (value === undefined) notJson("undefined");
  const out: string[] = [];
  writeValue(value, options.pretty ?? false, "", out);
  return out.join("");
}

function cloneValue(value: unknown): unknown {
  if (value === null) return null;
  switch (typeof value) {
    case "boolean":
    case "string":
      return value;
    case "number":
      if (!Number.isFinite(value)) notJson("non_finite_number");
      return value;
    case "object":
      break;
    default:
      notJson(`unsupported_${typeof value}`);
  }
  // ExactNumber 는 불변(freeze)이라 그대로 공유한다.
  if (isExactNumber(value)) return value;
  if (Array.isArray(value)) {
    return value.map(item => {
      if (item === undefined) notJson("undefined_in_array");
      return cloneValue(item);
    });
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as object)) {
    const item = (value as Record<string, unknown>)[key];
    if (item === undefined) continue;
    Object.defineProperty(out, key, {
      value: cloneValue(item),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * JSON 의미 그대로의 깊은 복사 — `parseJson(stringifyJson(v))` 와 같은 결과를
 * 중간 문자열 없이 만든다. `ExactNumber` 를 유지하고 `undefined` 키는 버린다.
 */
export function cloneJson<T>(value: T): T {
  return cloneValue(value) as T;
}

/** JSON 의미 동치: 숫자는 정규형, 객체 키 순서 무시(`undefined` 값 키는 없는 것), 배열 순서 있음. */
export function jsonEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (isJsonNumber(a) && isJsonNumber(b)) {
    if (typeof a === "number" && typeof b === "number") return a === b;
    return canonicalNumber(a) === canonicalNumber(b);
  }
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null ||
    isExactNumber(a) ||
    isExactNumber(b)
  ) {
    return false;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    return a.every((item, index) => jsonEquals(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left).filter(key => left[key] !== undefined);
  const rightKeys = Object.keys(right).filter(key => right[key] !== undefined);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    key => Object.hasOwn(right, key) && jsonEquals(left[key], right[key]),
  );
}
