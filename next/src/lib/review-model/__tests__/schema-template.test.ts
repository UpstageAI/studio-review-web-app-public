import { describe, expect, it } from "vitest";

import { ExactNumber, isExactNumber, type JsonValue } from "../json";
import {
  allowsNull,
  arrayBounds,
  isRequiredKey,
  missingProperties,
  schemaAt,
  templateFor,
  type SchemaNode,
} from "../schema";

/** schema 루트 노드의 템플릿. */
const template = (schema: SchemaNode, path: string[] = []): JsonValue =>
  templateFor(schemaAt(schema, path), schema);

describe("templateFor", () => {
  it.each<[string, SchemaNode, JsonValue]>([
    ["default", { type: "string", default: "N/A" }, "N/A"],
    ["const", { const: 3 }, 3],
    ["enum 첫 값", { type: "string", enum: ["a", "b"] }, "a"],
    ["null 허용 enum", { enum: ["a", null] }, null],
    ["string", { type: "string" }, ""],
    ["number", { type: "number" }, 0],
    ["integer", { type: "integer" }, 0],
    ["boolean", { type: "boolean" }, false],
    ["type 의 null", { type: ["string", "null"] }, null],
    ["nullable: true", { type: "string", nullable: true }, null],
    [
      "anyOf null 분기",
      { anyOf: [{ type: "number" }, { type: "null" }] },
      null,
    ],
    [
      "anyOf 첫 분기",
      { anyOf: [{ type: "boolean" }, { type: "string" }] },
      false,
    ],
    ["array", { type: "array", items: { type: "string" } }, []],
    ["타입 정보 없음", {}, null],
  ])("%s", (_name, schema, expected) => {
    expect(template(schema)).toEqual(expected);
  });

  it("minItems 만큼 항목 템플릿, prefixItems 는 자리마다", () => {
    expect(
      template({
        type: "array",
        minItems: 2,
        items: { type: "object", properties: { a: { type: "string" } } },
      }),
    ).toEqual([{ a: "" }, { a: "" }]);
    expect(
      template({
        type: "array",
        minItems: 3,
        prefixItems: [{ type: "string" }, { type: "boolean" }],
        items: { type: "integer" },
      }),
    ).toEqual(["", false, 0]);
  });

  it("객체는 required 키만, required 가 없으면 properties 전부(재귀)", () => {
    const properties = {
      name: { type: "string" },
      age: { type: "integer" },
      address: {
        type: "object",
        properties: { city: { type: "string" }, zip: { type: "string" } },
        required: ["city"],
      },
    };
    expect(template({ type: "object", properties })).toEqual({
      name: "",
      age: 0,
      address: { city: "" },
    });
    expect(template({ type: "object", properties, required: ["age"] })).toEqual(
      { age: 0 },
    );
  });

  it("null 허용 객체·배열도 빈 모양을 만든다(객체 배열 항목은 null 불가)", () => {
    const schema: SchemaNode = {
      type: "array",
      items: {
        anyOf: [
          { type: "object", properties: { qty: { type: "integer" } } },
          { type: "null" },
        ],
      },
    };
    expect(template(schema, ["0"])).toEqual({ qty: 0 });
    expect(template({ type: ["array", "null"], items: {} })).toEqual([]);
  });

  it("$ref 를 따라가고 default 의 ExactNumber 를 유지한다", () => {
    const big = new ExactNumber("12345678901234567890");
    const schema: SchemaNode = {
      type: "object",
      properties: { line: { $ref: "#/$defs/line" } },
      $defs: {
        line: {
          type: "object",
          properties: { amount: { type: "number", default: big } },
        },
      },
    };
    const value = template(schema) as { line: { amount: JsonValue } };
    expect(isExactNumber(value.line.amount)).toBe(true);
    expect(String(value.line.amount)).toBe("12345678901234567890");
  });

  it("schema 가 없으면 null", () => {
    expect(templateFor(null, {})).toBeNull();
  });
});

describe("missingProperties·isRequiredKey", () => {
  const schema: SchemaNode = {
    type: "object",
    properties: {
      name: { type: "string", title: "이름", description: "환자 이름" },
      memo: { $ref: "#/$defs/memo" },
      total: { type: "number" },
    },
    required: ["total"],
    $defs: { memo: { type: "string", title: "메모" } },
  };
  const match = schemaAt(schema, []);

  it("객체에 없는 properties 키를 schema 순서로", () => {
    expect(missingProperties(match, { name: "x" }, schema)).toEqual([
      { key: "memo", title: "메모", description: null, required: false },
      { key: "total", title: "total", description: null, required: true },
    ]);
    expect(missingProperties(match, {}).map(item => item.title)).toEqual([
      "이름",
      "memo",
      "total",
    ]);
  });

  it("객체가 아니거나 schema 가 없으면 빈 목록", () => {
    expect(missingProperties(match, [1])).toEqual([]);
    expect(missingProperties(null, {})).toEqual([]);
  });

  it("isRequiredKey", () => {
    expect(isRequiredKey(match, "total")).toBe(true);
    expect(isRequiredKey(match, "name")).toBe(false);
    expect(isRequiredKey(null, "total")).toBe(false);
  });
});

describe("allowsNull·arrayBounds", () => {
  it.each<[string, SchemaNode, boolean]>([
    ["type string", { type: "string" }, false],
    ["type 의 null", { type: ["string", "null"] }, true],
    ["nullable: true", { type: "string", nullable: true }, true],
    [
      "anyOf null 분기",
      { anyOf: [{ type: "string" }, { type: "null" }] },
      true,
    ],
    ["null 을 담은 enum", { enum: ["a", null] }, true],
  ])("%s", (_name, schema, expected) => {
    expect(allowsNull(schemaAt(schema, []))).toBe(expected);
  });

  it("schema 가 없으면 제약 없음", () => {
    expect(allowsNull(null)).toBe(true);
  });

  it("arrayBounds 는 음이 아닌 정수 minItems·maxItems 만", () => {
    expect(
      arrayBounds(schemaAt({ type: "array", minItems: 1, maxItems: 3 }, [])),
    ).toEqual({ min: 1, max: 3 });
    expect(
      arrayBounds(schemaAt({ type: "array", minItems: -1, maxItems: 1.5 }, [])),
    ).toEqual({});
    expect(arrayBounds(null)).toEqual({});
  });
});
