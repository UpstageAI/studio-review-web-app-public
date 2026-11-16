import { describe, expect, it } from "vitest";
import { ExactNumber, isExactNumber, type Widget } from "@/lib/review-model";
import { jsonValueCodec, toValueWidgetDescriptor } from "../value-widget-codec";

describe("jsonValueCodec", () => {
  it("toText: null 은 빈 글자, 문자열은 그대로, 나머지는 JSON 표기(숫자 원문 보존)", () => {
    expect(jsonValueCodec.toText(null)).toBe("");
    expect(jsonValueCodec.toText('a"b')).toBe('a"b');
    expect(jsonValueCodec.toText(true)).toBe("true");
    expect(jsonValueCodec.toText(12.5)).toBe("12.5");
    expect(jsonValueCodec.toText(new ExactNumber("1.000000000000000001"))).toBe(
      "1.000000000000000001",
    );
  });

  it("keyOf 는 JSON 표기라 문자열과 숫자가 겹치지 않는다", () => {
    expect(jsonValueCodec.keyOf("3")).toBe('"3"');
    expect(jsonValueCodec.keyOf(3)).toBe("3");
  });

  it("equals 는 JSON 값 비교(정밀 숫자 포함)", () => {
    expect(jsonValueCodec.equals(1, 1)).toBe(true);
    expect(jsonValueCodec.equals(new ExactNumber("1.0"), 1)).toBe(true);
    expect(jsonValueCodec.equals("1", 1)).toBe(false);
  });

  it("parseNumber 는 coerceNumber 와 같다", () => {
    expect(jsonValueCodec.parseNumber("7", true)).toEqual({
      ok: true,
      value: 7,
    });
    expect(jsonValueCodec.parseNumber("1.5", true)).toEqual({
      ok: false,
      reason: "not_integer",
    });
    expect(jsonValueCodec.parseNumber("1,000", false)).toEqual({
      ok: false,
      reason: "invalid_number",
    });
    const exact = jsonValueCodec.parseNumber("0.12345678901234567890", false);
    expect(exact.ok && isExactNumber(exact.value)).toBe(true);
  });

  it("parseScalar 는 JSON 값 하나만 받고 객체·배열은 거부한다", () => {
    expect(jsonValueCodec.parseScalar('"x"')).toEqual({ ok: true, value: "x" });
    expect(jsonValueCodec.parseScalar("null")).toEqual({
      ok: true,
      value: null,
    });
    expect(jsonValueCodec.parseScalar("{")).toEqual({
      ok: false,
      reason: "invalid_json",
    });
    expect(jsonValueCodec.parseScalar("[1]")).toEqual({
      ok: false,
      reason: "not_scalar",
    });
    expect(jsonValueCodec.parseScalar('{"a":1}')).toEqual({
      ok: false,
      reason: "not_scalar",
    });
  });
});

describe("toValueWidgetDescriptor", () => {
  it("모양이 같은 종류는 위젯을 그대로 돌려준다", () => {
    const widgets: Widget[] = [
      { kind: "enum", options: ["a"], nullable: true },
      { kind: "boolean" },
      { kind: "number", integer: false },
      { kind: "text", multiline: true, long: true },
    ];
    for (const widget of widgets) {
      expect(toValueWidgetDescriptor(widget)).toBe(widget);
    }
  });

  it("verdict·object·array·json 은 같은 json 모양(같은 객체)", () => {
    const kinds = ["verdict", "object", "array", "json"] as const;
    const results = kinds.map(kind => toValueWidgetDescriptor({ kind }));
    for (const result of results) {
      expect(result).toEqual({ kind: "json" });
      expect(result).toBe(results[0]);
    }
  });
});
