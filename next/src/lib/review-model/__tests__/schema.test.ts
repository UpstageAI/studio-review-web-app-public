import { describe, expect, it } from "vitest";

import { ExactNumber, parseJson, type JsonValue } from "../json";
import { readReviewDocument } from "../normalize";
import {
  LONG_TEXT_LENGTH,
  contentLeaves,
  fieldDescription,
  fieldTitle,
  fromPointer,
  schemaAt,
  schemaProblem,
  stringBounds,
  toPointer,
  widgetFor,
  type SchemaNode,
} from "../schema";
import { SINGLE_JOB } from "./fixtures/fixtures";

const schema = (text: string) => parseJson(text) as SchemaNode;

describe("JSON Pointer", () => {
  it("RFC 6901 이스케이프 왕복", () => {
    expect(toPointer([])).toBe("");
    expect(toPointer(["a/b", "m~n", "0"])).toBe("/a~1b/m~0n/0");
    expect(fromPointer("/a~1b/m~0n/0")).toEqual(["a/b", "m~n", "0"]);
    expect(fromPointer("")).toEqual([]);
    expect(fromPointer("/")).toEqual([""]);
    expect(fromPointer("/~01")).toEqual(["~1"]);
  });

  it("형식이 틀리면 null", () => {
    expect(fromPointer("a")).toBeNull();
    expect(fromPointer("/a~2")).toBeNull();
    expect(fromPointer("/a~")).toBeNull();
  });
});

describe("contentLeaves", () => {
  it("중첩 객체·배열의 leaf 를 순서대로", () => {
    const content = parseJson('{"a":1,"b":{"c":[true,null]},"d":[],"e":{}}');
    expect(contentLeaves(content)).toEqual([
      { path: ["a"], value: 1 },
      { path: ["b", "c", "0"], value: true },
      { path: ["b", "c", "1"], value: null },
    ]);
  });

  it("scalar content 는 경로 [] 하나", () => {
    expect(contentLeaves("green")).toEqual([{ path: [], value: "green" }]);
    const big = parseJson("12345678901234567890");
    expect(contentLeaves(big)).toEqual([{ path: [], value: big }]);
  });
});

describe("schemaAt", () => {
  const extract = readReviewDocument(SINGLE_JOB).steps.st_extract!.schema!;

  it("중첩 properties·숫자 키 → items", () => {
    expect(schemaAt(extract, ["amount"])?.node).toMatchObject({
      type: "number",
    });
    expect(schemaAt(extract, ["lines", "0", "qty"])).toEqual({
      node: { type: "integer" },
      nullable: false,
    });
    expect(schemaAt(extract, [])?.node).toBe(extract);
  });

  it("anyOf 의 null 분기를 빼고 nullable", () => {
    expect(schemaAt(extract, ["memo"])).toEqual({
      node: { type: "string", maxLength: 500 },
      nullable: true,
    });
    const typed = schema(
      '{"type":"object","properties":{"n":{"type":["integer","null"]}}}',
    );
    expect(schemaAt(typed, ["n"])?.nullable).toBe(true);
  });

  it("값 타입에 맞는 분기를 고른다", () => {
    const union = schema(
      '{"properties":{"v":{"oneOf":[{"type":"string"},{"type":"number"},{"type":"null"}]}}}',
    );
    expect(schemaAt(union, ["v"], 3)?.node).toEqual({ type: "number" });
    expect(schemaAt(union, ["v"], "x")?.node).toEqual({ type: "string" });
    expect(schemaAt(union, ["v"], null)).toEqual({
      node: { type: "string" },
      nullable: true,
    });
  });

  it("anyOf 안의 객체 분기로 내려간다·로컬 $ref 를 따른다", () => {
    const nested = schema(
      '{"$defs":{"Line":{"type":"object","properties":{"sku":{"type":"string"}}}},' +
        '"properties":{"line":{"anyOf":[{"type":"null"},{"$ref":"#/$defs/Line"}]},' +
        '"lines":{"type":"array","items":{"$ref":"#/$defs/Line"}}}}',
    );
    expect(schemaAt(nested, ["line", "sku"])?.node).toEqual({ type: "string" });
    expect(schemaAt(nested, ["lines", "3", "sku"])?.node).toEqual({
      type: "string",
    });
    expect(schemaAt(nested, ["line"])?.nullable).toBe(true);
  });

  it("없는 경로는 null", () => {
    expect(schemaAt(extract, ["nope"])).toBeNull();
    expect(schemaAt(extract, ["amount", "x"])).toBeNull();
    expect(schemaAt(undefined, ["amount"])).toBeNull();
  });

  it("additionalProperties 를 따른다", () => {
    const map = schema(
      '{"type":"object","additionalProperties":{"type":"boolean"}}',
    );
    expect(schemaAt(map, ["anything"])?.node).toEqual({ type: "boolean" });
  });
});

describe("widgetFor", () => {
  const doc = readReviewDocument(SINGLE_JOB);
  const extractStep = doc.steps.st_extract!;
  const extract = extractStep.schema!;
  const widget = (path: string[], value: JsonValue) =>
    widgetFor(extractStep, schemaAt(extract, path, value), value);

  it("schema 기반 8 종", () => {
    expect(widget(["currency"], "USD")).toEqual({
      kind: "enum",
      options: ["KRW", "USD"],
      nullable: false,
    });
    expect(widgetFor(doc.steps.st_validate, null, "green")).toEqual({
      kind: "verdict",
    });
    expect(widget(["paid"], true)).toEqual({ kind: "boolean" });
    expect(widget(["lines", "0", "qty"], 2)).toEqual({
      kind: "number",
      integer: true,
    });
    expect(widget(["amount"], 1)).toEqual({ kind: "number", integer: false });
    expect(widget(["invoice_no"], "INV-1")).toEqual({
      kind: "text",
      multiline: false,
    });
    expect(widget(["memo"], null)).toEqual({ kind: "text", multiline: true });
    expect(widget(["lines", "0"], {})).toEqual({ kind: "object" });
    expect(widget(["lines"], [])).toEqual({ kind: "array" });
    const multi = schema('{"type":["string","number"]}');
    expect(widgetFor(extractStep, schemaAt(multi, []), "x")).toEqual({
      kind: "json",
    });
    // schema 와 값 타입이 다르면 json
    expect(widget(["amount"], "abc")).toEqual({ kind: "json" });
  });

  it("enum 에 null 이 있으면 nullable", () => {
    const withNull = schema('{"enum":["a",null]}');
    expect(widgetFor(extractStep, schemaAt(withNull, []), "a")).toEqual({
      kind: "enum",
      options: ["a"],
      nullable: true,
    });
  });

  it("긴 값·줄바꿈은 multiline", () => {
    expect(widget(["invoice_no"], "x".repeat(81))).toEqual({
      kind: "text",
      multiline: true,
    });
    expect(widget(["invoice_no"], "a\nb")).toEqual({
      kind: "text",
      multiline: true,
    });
  });

  it("한도를 넘는 문자열은 long 요약", () => {
    expect(LONG_TEXT_LENGTH).toBe(10_000);
    expect(widget(["invoice_no"], "x".repeat(10_001))).toEqual({
      kind: "text",
      multiline: true,
      long: true,
    });
    const exact = widget(["invoice_no"], "x".repeat(10_000));
    expect(exact).toEqual({ kind: "text", multiline: true });
    expect("long" in exact).toBe(false);
    expect(
      widgetFor({ type: "information-extract" }, null, "x".repeat(10_001)),
    ).toEqual({ kind: "text", multiline: true, long: true });
  });

  it("schema 가 없으면 값 타입으로 추론", () => {
    const step = { type: "information-extract" };
    expect(widgetFor(step, null, "x")).toEqual({
      kind: "text",
      multiline: false,
    });
    expect(widgetFor(step, null, 3)).toEqual({
      kind: "number",
      integer: false,
    });
    expect(widgetFor(step, null, new ExactNumber("1e999"))).toEqual({
      kind: "number",
      integer: false,
    });
    expect(widgetFor(step, null, false)).toEqual({ kind: "boolean" });
    expect(widgetFor(step, null, null)).toEqual({
      kind: "text",
      multiline: false,
    });
    expect(widgetFor(step, null, [])).toEqual({ kind: "array" });
    expect(widgetFor(step, null, {})).toEqual({ kind: "object" });
    expect(widgetFor({ type: "validate" }, null, "red")).toEqual({
      kind: "verdict",
    });
  });
});

describe("schemaProblem", () => {
  const extract = readReviewDocument(SINGLE_JOB).steps.st_extract!.schema!;
  const problem = (path: string[], value: JsonValue) =>
    schemaProblem(schemaAt(extract, path, value), value);

  it("enum 밖", () => {
    expect(problem(["currency"], "EUR")).toEqual({
      expected: "enum",
      allowed: ["KRW", "USD"],
    });
    expect(problem(["currency"], "KRW")).toBeNull();
  });

  it("integer 에 ExactNumber('1.5') 는 위반, ExactNumber('1e3') 는 통과", () => {
    expect(problem(["lines", "0", "qty"], new ExactNumber("1.5"))).toEqual({
      expected: "integer",
    });
    expect(problem(["lines", "0", "qty"], new ExactNumber("1e3"))).toBeNull();
    expect(
      problem(["amount"], new ExactNumber("12345678901234567890")),
    ).toBeNull();
  });

  it("null 은 nullable 일 때만 허용", () => {
    expect(problem(["memo"], null)).toBeNull();
    expect(problem(["amount"], null)).toEqual({ expected: "number" });
  });

  it("타입 위반·schema 없는 경로·match 없음", () => {
    expect(problem(["paid"], "yes")).toEqual({ expected: "boolean" });
    expect(problem(["nope"], 1)).toBeNull();
    expect(schemaProblem(null, 1)).toBeNull();
    const verdict = schema('{"type":"string","enum":["green","yellow","red"]}');
    expect(schemaProblem(schemaAt(verdict, []), "blue")).toMatchObject({
      expected: "enum",
    });
  });
});

describe("schemaProblem — null 허용 필드의 문구", () => {
  const check = (text: string, value: JsonValue) =>
    schemaProblem(schemaAt(schema(text), [], value), value);

  it("anyOf 의 null 분기·nullable: true 면 허용 형식에 null 을 함께 보인다", () => {
    expect(check('{"anyOf":[{"type":"string"},{"type":"null"}]}', 1)).toEqual({
      expected: "string | null",
    });
    expect(check('{"type":"string","nullable":true}', 1)).toEqual({
      expected: "string | null",
    });
  });

  it("type 에 이미 null 이 있으면 한 번만, null 을 허용하지 않으면 그대로", () => {
    expect(check('{"type":["string","null"]}', 1)).toEqual({
      expected: "string | null",
    });
    expect(check('{"type":"string"}', 1)).toEqual({ expected: "string" });
  });
});

describe("stringBounds", () => {
  it("minLength·maxLength 를 음이 아닌 정수일 때만 읽는다", () => {
    const at = (text: string) => stringBounds(schemaAt(schema(text), []));
    expect(at('{"type":"string","minLength":1,"maxLength":5}')).toEqual({
      min: 1,
      max: 5,
    });
    expect(at('{"type":"string","maxLength":2.5,"minLength":-1}')).toEqual({});
    expect(stringBounds(null)).toEqual({});
  });
});

describe("fieldTitle·fieldDescription", () => {
  const extract = readReviewDocument(SINGLE_JOB).steps.st_extract!.schema!;

  it("title 이 있으면 title, 없으면 마지막 토큰", () => {
    expect(fieldTitle(schemaAt(extract, ["amount"])!.node, ["amount"])).toBe(
      "Amount",
    );
    expect(fieldTitle(schemaAt(extract, ["rate"])!.node, ["rate"])).toBe(
      "rate",
    );
    expect(fieldTitle(null, ["lines", "0", "qty"])).toBe("qty");
    expect(fieldTitle(null, [])).toBe("");
  });

  it("description", () => {
    expect(fieldDescription(schemaAt(extract, ["invoice_no"])!.node)).toBe(
      "Invoice number",
    );
    expect(fieldDescription(schemaAt(extract, ["rate"])!.node)).toBeNull();
    expect(fieldDescription(null)).toBeNull();
  });
});
