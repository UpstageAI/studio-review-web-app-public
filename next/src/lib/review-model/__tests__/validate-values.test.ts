import { describe, expect, it } from "vitest";

import type { JsonObject, JsonValue } from "../json";
import { isResult, type ReviewDocument, type ReviewJob } from "../types";
import { hasBlockingIssues, validateValues } from "../validate";
import { singleJob } from "./fixtures/builders";

const R = "occ_extract_1";

/** single-job 의 Extract Step schema 와 결과 content 를 바꾼 문서. */
function withExtract(
  schema: JsonObject,
  content: JsonValue,
): { doc: ReviewDocument; job: ReviewJob } {
  const { doc, job } = singleJob();
  const step = doc.steps.st_extract!;
  const edited: ReviewJob = {
    ...job,
    output: job.output.map(item =>
      isResult(item) && item.id === R ? { ...item, content } : item,
    ),
  };
  return {
    doc: {
      ...doc,
      steps: { ...doc.steps, st_extract: { ...step, schema } },
      jobs: [edited],
    },
    job: edited,
  };
}

const check = (schema: JsonObject, content: JsonValue) => {
  const { doc, job } = withExtract(schema, content);
  return validateValues(doc, job, [R]).map(item => ({
    pointer: item.where.kind === "field" ? item.where.pointer : null,
    severity: item.severity,
    detail: item.detail,
  }));
};

const object = (
  properties: JsonObject,
  extra: JsonObject = {},
): JsonObject => ({ type: "object", properties, ...extra });

describe("validateValues — 서버 규칙", () => {
  it("schema properties 에 없는 키는 그 키 pointer 로 known_key", () => {
    expect(
      check(object({ a: { type: "string" } }), { a: "x", extra: 1 }),
    ).toEqual([
      {
        pointer: "/extra",
        severity: "error",
        detail: { expected: "known_key" },
      },
    ]);
  });

  it("중첩 객체 배열 항목의 모르는 키도", () => {
    const schema = object({
      lines: {
        type: "array",
        items: object({ qty: { type: "integer" } }),
      },
    });
    expect(
      check(schema, { lines: [{ qty: 1 }, { qty: 2, note: "" }] }).map(
        item => item.pointer,
      ),
    ).toEqual(["/lines/1/note"]);
  });

  it("required 누락은 객체 pointer 와 missing 키", () => {
    expect(
      check(
        object(
          { a: { type: "string" }, b: { type: "string" } },
          {
            required: ["a", "b"],
          },
        ),
        { a: "x" },
      ),
    ).toEqual([
      {
        pointer: "",
        severity: "error",
        detail: { expected: "required", missing: "b" },
      },
    ]);
  });

  it("null 은 허용될 때만(nullable: true 포함)", () => {
    const schema = object({
      a: { type: "string" },
      b: { type: "string", nullable: true },
      c: { type: ["string", "null"] },
    });
    expect(check(schema, { a: null, b: null, c: null })).toEqual([
      { pointer: "/a", severity: "error", detail: { expected: "string" } },
    ]);
  });

  it("null 을 허용하는 필드의 타입 위반은 허용 형식에 null 도 보인다", () => {
    const schema = object({
      a: { anyOf: [{ type: "string" }, { type: "null" }] },
      b: { type: "integer", nullable: true },
    });
    expect(check(schema, { a: 1, b: "x" })).toEqual([
      {
        pointer: "/a",
        severity: "error",
        detail: { expected: "string | null" },
      },
      {
        pointer: "/b",
        severity: "error",
        detail: { expected: "integer | null" },
      },
    ]);
  });

  it("객체 배열 항목의 null 은 schema 가 null 을 허용해도 위반", () => {
    const schema = object({
      lines: {
        type: "array",
        items: {
          anyOf: [object({ qty: { type: "integer" } }), { type: "null" }],
        },
      },
    });
    expect(check(schema, { lines: [null] })).toEqual([
      {
        pointer: "/lines/0",
        severity: "error",
        detail: { expected: "object" },
      },
    ]);
  });

  it("scalar 자리에 객체가 오면 그 자리 위반(안으로는 내려가지 않음)", () => {
    expect(
      check(object({ a: { type: "number" } }), { a: { b: { c: 1 } } }),
    ).toEqual([
      { pointer: "/a", severity: "error", detail: { expected: "number" } },
    ]);
  });

  it("minItems·maxItems 위반은 경고라 저장을 막지 않는다", () => {
    const schema = object({
      few: { type: "array", minItems: 2, items: { type: "string" } },
      many: { type: "array", maxItems: 1, items: { type: "string" } },
    });
    const { doc, job } = withExtract(schema, { few: ["a"], many: ["a", "b"] });
    const issues = validateValues(doc, job, [R]);
    expect(issues.map(item => [item.severity, item.detail])).toEqual([
      ["warning", { expected: "min_items", limit: 2, count: 1 }],
      ["warning", { expected: "max_items", limit: 1, count: 2 }],
    ]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("minLength·maxLength 위반은 글자 수와 함께 경고라 저장을 막지 않는다", () => {
    const schema = object({
      short: { type: "string", minLength: 3 },
      long: { type: "string", maxLength: 2 },
      fine: { type: "string", minLength: 1, maxLength: 3 },
    });
    const { doc, job } = withExtract(schema, {
      short: "ab",
      long: "abcd",
      fine: "abc",
    });
    const issues = validateValues(doc, job, [R]);
    expect(
      issues.map(item => [
        item.where.kind === "field" ? item.where.pointer : null,
        item.severity,
        item.detail,
      ]),
    ).toEqual([
      ["/short", "warning", { expected: "min_length", limit: 3, count: 2 }],
      ["/long", "warning", { expected: "max_length", limit: 2, count: 4 }],
    ]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("글자 수는 code point 로 센다(서로게이트 쌍은 한 글자)", () => {
    const schema = object({ a: { type: "string", maxLength: 2 } });
    expect(check(schema, { a: "😀😀" })).toEqual([]);
    expect(check(schema, { a: "😀😀😀" })).toEqual([
      {
        pointer: "/a",
        severity: "warning",
        detail: { expected: "max_length", limit: 2, count: 3 },
      },
    ]);
  });

  it("maxLength 가 음이 아닌 정수가 아니면 보지 않는다", () => {
    const schema = object({
      a: { type: "string", maxLength: 1.5 },
      b: { type: "string", maxLength: "2" },
    });
    expect(check(schema, { a: "abcd", b: "abcd" })).toEqual([]);
  });

  it("항목 하나짜리 배열 래퍼 안의 위반은 /0 을 붙인다", () => {
    expect(
      check(object({ a: { type: "string" } }, { required: ["a"] }), [
        { b: 1 },
      ]).map(item => [item.pointer, item.detail]),
    ).toEqual([
      ["/0", { expected: "required", missing: "a" }],
      ["/0/b", { expected: "known_key" }],
    ]);
  });

  it("properties 가 없는 객체 schema 는 키를 제한하지 않는다", () => {
    expect(check({ type: "object" }, { anything: 1 })).toEqual([]);
  });
});
