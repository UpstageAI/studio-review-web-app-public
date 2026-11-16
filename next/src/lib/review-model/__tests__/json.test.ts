import { describe, expect, it } from "vitest";

import { ReviewModelError } from "../errors";
import {
  ExactNumber,
  canonicalNumber,
  cloneJson,
  isExactNumber,
  isIntegerNumber,
  jsonEquals,
  parseJson,
  stringifyJson,
  utf8Length,
  type JsonObject,
} from "../json";

function errorOf(fn: () => unknown): ReviewModelError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ReviewModelError) return error;
    throw error;
  }
  throw new Error("expected ReviewModelError");
}

describe("parseJson — 숫자 보존", () => {
  it("JS Number 로 왕복되는 수는 number", () => {
    expect(parseJson("[0, 1, -1, 1.5, 1000.50, 0.1, 1.0]")).toEqual([
      0, 1, -1, 1.5, 1000.5, 0.1, 1,
    ]);
  });

  it.each([
    "9007199254740993",
    "0.1234567890123456789",
    "1e999",
    "-0",
    "1E2",
    "1e3",
    "12345678901234567890",
    "-0.0",
  ])("%s 는 ExactNumber 로 원문 그대로 다시 낸다", raw => {
    const value = parseJson(raw);
    expect(isExactNumber(value)).toBe(true);
    expect((value as ExactNumber).raw).toBe(raw);
    expect(stringifyJson({ v: value })).toBe(`{"v":${raw}}`);
  });

  it("문서 안 정밀 숫자를 compact·pretty 모두 보존한다", () => {
    const text = '{"a":9007199254740993,"b":[1e999,-0],"c":"x"}';
    expect(stringifyJson(parseJson(text))).toBe(text);
    expect(stringifyJson(parseJson(text), { pretty: true })).toBe(
      '{\n  "a": 9007199254740993,\n  "b": [\n    1e999,\n    -0\n  ],\n  "c": "x"\n}',
    );
  });

  it("문자열 이스케이프·유니코드를 디코드한다", () => {
    expect(parseJson('"a\\n\\"\\u00e9\\ud83d\\ude00/\\/"')).toBe('a\n"é😀//');
  });
});

describe("parseJson — 거부", () => {
  it("중복 키는 duplicate_key + pointer", () => {
    const error = errorOf(() => parseJson('{"a":{"b":1,"b":2}}'));
    expect(error.code).toBe("duplicate_key");
    expect(error.pointer).toBe("/a/b");
  });

  it("깊이 64 는 통과, 65 는 nesting_too_deep", () => {
    expect(() => parseJson("[".repeat(64) + "]".repeat(64))).not.toThrow();
    expect(errorOf(() => parseJson("[".repeat(65) + "]".repeat(65))).code).toBe(
      "nesting_too_deep",
    );
    expect(
      errorOf(() => parseJson('{"a":[[1]]}', { maxDepth: 2 })).pointer,
    ).toBe("/a/0");
  });

  it("바이트 상한(UTF-8 기준)을 넘으면 json_too_large", () => {
    expect(errorOf(() => parseJson('"ab"', { maxBytes: 3 })).code).toBe(
      "json_too_large",
    );
    // 3 글자지만 UTF-8 로 7 바이트
    expect(errorOf(() => parseJson('"가"', { maxBytes: 4 })).code).toBe(
      "json_too_large",
    );
    expect(parseJson('"가"', { maxBytes: 5 })).toBe("가");
  });

  it.each([
    "01",
    "[1,]",
    "1e",
    "undefined",
    "{a:1}",
    "[1] x",
    "",
    "-",
    '"a',
    "NaN",
    "'a'",
    '"\u0001"',
    '{"a" 1}',
    "tru",
  ])("%j 는 invalid_json", text => {
    expect(errorOf(() => parseJson(text)).code).toBe("invalid_json");
  });

  it("오류 위치를 pointer·offset 으로 알린다", () => {
    const error = errorOf(() => parseJson('{"a":[1,2,}'));
    expect(error.pointer).toBe("/a/2");
    expect(error.details?.offset).toBe(10);
  });
});

describe("parseJson — 프로토타입 안전", () => {
  it("__proto__ 는 own property 데이터", () => {
    const value = parseJson(
      '{"__proto__":{"x":1},"constructor":2}',
    ) as JsonObject;
    expect(Object.hasOwn(value, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(stringifyJson(value)).toBe('{"__proto__":{"x":1},"constructor":2}');
    expect(Object.hasOwn(cloneJson(value), "__proto__")).toBe(true);
  });
});

describe("ExactNumber", () => {
  it("브랜드는 데이터 객체 {raw} 와 구분된다", () => {
    expect(isExactNumber(new ExactNumber("1.5"))).toBe(true);
    expect(isExactNumber({ raw: "1.5" })).toBe(false);
    expect(() => new ExactNumber("01")).toThrow(ReviewModelError);
  });
});

describe("canonicalNumber·jsonEquals", () => {
  it("1·1.0·1e0·ExactNumber('1.00') 은 같다", () => {
    const one = canonicalNumber(1);
    expect(canonicalNumber(new ExactNumber("1.0"))).toBe(one);
    expect(canonicalNumber(new ExactNumber("1e0"))).toBe(one);
    expect(canonicalNumber(new ExactNumber("1.00"))).toBe(one);
    expect(canonicalNumber(new ExactNumber("10e-1"))).toBe(one);
    expect(jsonEquals(1, new ExactNumber("1.00"))).toBe(true);
    expect(jsonEquals(new ExactNumber("1e0"), new ExactNumber("1.0"))).toBe(
      true,
    );
  });

  it("-0 ≡ 0, 다른 수는 다르다", () => {
    expect(canonicalNumber(new ExactNumber("-0"))).toBe("0");
    expect(jsonEquals(new ExactNumber("-0"), 0)).toBe(true);
    expect(jsonEquals(1, 2)).toBe(false);
    expect(
      jsonEquals(new ExactNumber("9007199254740993"), 9007199254740992),
    ).toBe(false);
  });

  it("객체 키 순서는 무시, 배열 순서는 본다, 타입이 다르면 다르다", () => {
    expect(jsonEquals({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toBe(true);
    expect(jsonEquals([1, 2], [2, 1])).toBe(false);
    expect(jsonEquals({ a: 1 }, { a: 1, b: null })).toBe(false);
    expect(jsonEquals("1", 1)).toBe(false);
    expect(jsonEquals(null, {})).toBe(false);
    expect(jsonEquals([], {})).toBe(false);
  });

  it("isIntegerNumber 는 JSON Schema integer 의미", () => {
    expect(isIntegerNumber(2)).toBe(true);
    expect(isIntegerNumber(2.5)).toBe(false);
    expect(isIntegerNumber(new ExactNumber("1e3"))).toBe(true);
    expect(isIntegerNumber(new ExactNumber("12345678901234567890"))).toBe(true);
    expect(isIntegerNumber(new ExactNumber("1.5"))).toBe(false);
    expect(isIntegerNumber(new ExactNumber("-0"))).toBe(true);
  });

  it("0 이 길게 이어진 토큰도 토큰 길이에 선형으로 정규화한다", () => {
    const zeros = "0".repeat(200_000);

    let started = performance.now();
    const parsed = parseJson(`[1.${zeros}1]`) as unknown[];
    expect(performance.now() - started).toBeLessThan(500);
    expect(isExactNumber(parsed[0])).toBe(true);
    expect(stringifyJson(parsed)).toBe(`[1.${zeros}1]`);

    const long = new ExactNumber(`1${zeros}.5`);
    started = performance.now();
    const canonical = canonicalNumber(long);
    expect(performance.now() - started).toBeLessThan(500);
    // 작은 입력과 같은 규칙: 뒤 0 은 지수로, 소수부 길이만큼 지수를 뺀다.
    expect(canonicalNumber(new ExactNumber("1000.5"))).toBe("10005e-1");
    expect(canonical).toBe(`1${zeros}5e-1`);

    started = performance.now();
    expect(isIntegerNumber(long)).toBe(false);
    expect(isIntegerNumber(new ExactNumber(`1${zeros}`))).toBe(true);
    expect(performance.now() - started).toBeLessThan(500);

    expect(canonicalNumber(new ExactNumber(`0.${zeros}`))).toBe("0");
    expect(canonicalNumber(new ExactNumber(`1${zeros}`))).toBe("1e200000");
    expect(canonicalNumber(new ExactNumber(`0.${zeros}1`))).toBe("1e-200001");
  });
});

describe("cloneJson·stringifyJson", () => {
  it("cloneJson 은 ExactNumber 를 유지한 깊은 복사", () => {
    const source = parseJson(
      '{"a":{"n":9007199254740993},"b":[1]}',
    ) as JsonObject;
    const copy = cloneJson(source);
    expect(copy).not.toBe(source);
    expect(copy.a).not.toBe(source.a);
    expect(isExactNumber((copy.a as JsonObject).n)).toBe(true);
    expect(stringifyJson(copy)).toBe(stringifyJson(source));
  });

  it("undefined 키는 생략, 배열 안 undefined·비유한 수·함수는 거부", () => {
    expect(stringifyJson({ a: undefined, b: 1 })).toBe('{"b":1}');
    expect(cloneJson({ a: undefined, b: 1 })).toEqual({ b: 1 });
    expect(() => stringifyJson([undefined])).toThrow(ReviewModelError);
    expect(() => stringifyJson(undefined)).toThrow(ReviewModelError);
    expect(() => stringifyJson({ a: Infinity })).toThrow(ReviewModelError);
    expect(() => stringifyJson({ a: () => 1 })).toThrow(ReviewModelError);
  });
});

describe("utf8Length", () => {
  it("멀티바이트·서로게이트 쌍·짝 없는 서로게이트", () => {
    expect(utf8Length("abc")).toBe(3);
    expect(utf8Length("é")).toBe(2);
    expect(utf8Length("가")).toBe(3);
    expect(utf8Length("😀")).toBe(4);
    expect(utf8Length("\ud83d")).toBe(3);
    const sample = "a é 가 😀 \ud800x";
    expect(utf8Length(sample)).toBe(new TextEncoder().encode(sample).length);
  });
});
