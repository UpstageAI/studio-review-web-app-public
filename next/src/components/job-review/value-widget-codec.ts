import type {
  ValueWidgetCodec,
  ValueWidgetDescriptor,
} from "@/components/studio-ui-kit/value-widget";
import {
  isJsonObject,
  jsonEquals,
  parseJson,
  stringifyJson,
  type JsonValue,
  type Widget,
} from "@/lib/review-model";
import { coerceNumber } from "./value-fields";

/** 검수 JSON 값(`JsonValue`, 정밀 숫자는 `ExactNumber`)을 값 위젯에 잇는 codec. */
export const jsonValueCodec: ValueWidgetCodec<JsonValue> = {
  toText(value) {
    if (value === null) return "";
    return typeof value === "string" ? value : stringifyJson(value);
  },
  keyOf: value => stringifyJson(value),
  equals: (a, b) => jsonEquals(a, b),
  parseNumber: (text, integer) => coerceNumber(text, integer),
  parseScalar(text) {
    let value: JsonValue;
    try {
      value = parseJson(text);
    } catch {
      return { ok: false, reason: "invalid_json" };
    }
    if (Array.isArray(value) || isJsonObject(value)) {
      return { ok: false, reason: "not_scalar" };
    }
    return { ok: true, value };
  },
};

const JSON_DESCRIPTOR: ValueWidgetDescriptor<JsonValue> = { kind: "json" };

/**
 * schema 위젯 → 값 위젯 모양. 판정은 결과 섹션이, 객체·배열은 leaf 로 펼쳐 그리므로 여기까지 오는
 * `verdict`·`object`·`array` 는 JSON 표기 입력으로 고친다. 렌더마다 새 객체를 만들지 않도록 모양이
 * 같은 종류는 위젯을 그대로 돌려준다.
 */
export function toValueWidgetDescriptor(
  widget: Widget,
): ValueWidgetDescriptor<JsonValue> {
  switch (widget.kind) {
    case "enum":
    case "boolean":
    case "number":
    case "text":
      return widget;
    default:
      return JSON_DESCRIPTOR;
  }
}
