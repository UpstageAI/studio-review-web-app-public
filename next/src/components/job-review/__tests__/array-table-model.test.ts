import { describe, expect, it } from "vitest";

import { ExactNumber, LONG_TEXT_LENGTH } from "@/lib/review-model";
import {
  TABLE_MAX_COLUMNS,
  propertyOrder,
  tableColumns,
} from "../array-table-model";

describe("tableColumns", () => {
  it("평평한 객체 항목이면 처음 나온 키 순서로 열을 만든다", () => {
    expect(
      tableColumns([
        { description: "a", qty: 1 },
        { description: "b", qty: 2, amount: null },
      ]),
    ).toEqual(["description", "qty", "amount"]);
  });

  it("schema properties 순서를 먼저 따르고 항목에 없는 schema 키는 뺀다", () => {
    expect(
      tableColumns(
        [{ qty: 1, description: "a", note: "x" }],
        ["description", "missing", "qty"],
      ),
    ).toEqual(["description", "qty", "note"]);
  });

  it("빈 배열·객체가 아닌 항목·중첩 값·빈 객체만 있으면 null", () => {
    expect(tableColumns([])).toBeNull();
    expect(tableColumns(["a", "b"])).toBeNull();
    expect(tableColumns([{ a: 1 }, null])).toBeNull();
    expect(tableColumns([{ a: { b: 1 } }])).toBeNull();
    expect(tableColumns([{ a: [1] }])).toBeNull();
    expect(tableColumns([{}, {}])).toBeNull();
  });

  it("숫자 원문(ExactNumber)·불리언·null 은 칸 값이고, 아주 긴 문자열은 아니다", () => {
    expect(
      tableColumns([{ n: new ExactNumber("12345678901234567890"), b: true }]),
    ).toEqual(["n", "b"]);
    expect(
      tableColumns([{ text: "x".repeat(LONG_TEXT_LENGTH + 1) }]),
    ).toBeNull();
  });

  it("열이 상한을 넘으면 null", () => {
    const wide = Object.fromEntries(
      Array.from({ length: TABLE_MAX_COLUMNS + 1 }, (_, i) => [`k${i}`, i]),
    );
    expect(tableColumns([wide])).toBeNull();
    const exact = Object.fromEntries(
      Array.from({ length: TABLE_MAX_COLUMNS }, (_, i) => [`k${i}`, i]),
    );
    expect(tableColumns([exact])).toHaveLength(TABLE_MAX_COLUMNS);
    expect(tableColumns([{ a: 1, b: 2, c: 3 }], [], 2)).toBeNull();
  });
});

describe("propertyOrder", () => {
  it("schema 노드의 properties 키 순서, 없으면 빈 배열", () => {
    expect(
      propertyOrder({ type: "object", properties: { b: {}, a: {} } }),
    ).toEqual(["b", "a"]);
    expect(propertyOrder({ type: "object" })).toEqual([]);
    expect(propertyOrder(undefined)).toEqual([]);
    expect(propertyOrder("x")).toEqual([]);
  });
});
