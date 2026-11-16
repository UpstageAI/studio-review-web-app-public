import { describe, expect, it } from "vitest";

import { parseJson, type JsonValue } from "@/lib/review-model";

import { ARRAY_MATCH_LIMIT, diffValues } from "../diff-values";

const rows = (before: JsonValue, after: JsonValue) =>
  diffValues(before, after).changes.map(change => [
    change.kind,
    change.path.join("/"),
  ]);

describe("diffValues", () => {
  it("같으면 차이가 없다", () => {
    const value = parseJson('{"a": 1, "b": [1, {"c": null}]}');
    expect(
      diffValues(value, parseJson('{"a": 1, "b": [1, {"c": null}]}')),
    ).toEqual({
      changes: [],
      reorderedArrays: [],
    });
  });

  it("숫자 표기만 다른 값은 같다(1 과 ExactNumber)", () => {
    const exact = parseJson('{"n": 1E0}');
    expect(rows({ n: 1 }, exact)).toEqual([]);
    expect(rows(parseJson("1.00"), 1)).toEqual([]);
  });

  it("키 추가·삭제는 leaf 마다 added/removed, 경로는 각자 쪽", () => {
    const diff = diffValues(
      { a: 1, gone: { x: 1, y: 2 } },
      { a: 1, extra: "n" },
    );
    expect(diff.changes).toEqual([
      {
        kind: "removed",
        path: ["gone", "x"],
        beforePath: ["gone", "x"],
        afterPath: null,
        before: 1,
      },
      {
        kind: "removed",
        path: ["gone", "y"],
        beforePath: ["gone", "y"],
        afterPath: null,
        before: 2,
      },
      {
        kind: "added",
        path: ["extra"],
        beforePath: null,
        afterPath: ["extra"],
        after: "n",
      },
    ]);
  });

  it("scalar ↔ object 는 그 경로에 changed 하나", () => {
    expect(diffValues({ a: "x" }, { a: { b: 1 } }).changes).toEqual([
      {
        kind: "changed",
        path: ["a"],
        beforePath: ["a"],
        afterPath: ["a"],
        before: "x",
        after: { b: 1 },
      },
    ]);
    expect(rows({ a: [] }, { a: {} })).toEqual([["changed", "a"]]);
  });

  it("items 중간 항목 삭제는 그 항목의 removed 만", () => {
    const item = (n: number) => ({ description: `line ${n}`, qty: n });
    const diff = diffValues(
      { items: [item(1), item(2), item(3)] },
      { items: [item(1), item(3)] },
    );
    expect(diff.changes.every(change => change.kind === "removed")).toBe(true);
    expect(diff.changes.map(change => change.path.join("/"))).toEqual([
      "items/1/description",
      "items/1/qty",
    ]);
    expect(diff.reorderedArrays).toEqual([]);
    expect(rows(["a", "b", "c"], ["a", "c"])).toEqual([["removed", "1"]]);
  });

  it("순서만 바뀌면 차이 없이 reorderedArrays", () => {
    const diff = diffValues(
      { tags: ["a", "b", "c"] },
      { tags: ["c", "a", "b"] },
    );
    expect(diff.changes).toEqual([]);
    expect(diff.reorderedArrays).toEqual([["tags"]]);
  });

  it("빈 배열 → 값이면 항목마다 added, 반대면 빈 배열 자리에 1 행", () => {
    expect(rows({ items: [] }, { items: [1, 2] })).toEqual([
      ["added", "items/0"],
      ["added", "items/1"],
    ]);
    expect(diffValues({ a: 1 }, { a: 1, list: [] }).changes).toEqual([
      {
        kind: "added",
        path: ["list"],
        beforePath: null,
        afterPath: ["list"],
        after: [],
      },
    ]);
  });

  it("큰 배열은 같은 항목 짝 찾기 없이 위치별로만 비교한다", () => {
    const size = Math.ceil(Math.sqrt(ARRAY_MATCH_LIMIT)) + 1;
    const before = Array.from({ length: size }, (_, i) => i);
    const after = [...before.slice(1), before[0]!];
    const diff = diffValues(before, after);
    expect(diff.reorderedArrays).toEqual([]);
    expect(diff.changes).toHaveLength(size);
    expect(diff.changes.every(change => change.kind === "changed")).toBe(true);
    // 작은 배열이면 같은 회전은 순서 변경 하나로 끝난다.
    expect(diffValues([0, 1, 2], [1, 2, 0])).toEqual({
      changes: [],
      reorderedArrays: [[]],
    });
  });

  it("Validate 판정(scalar content)은 경로 [] 의 changed", () => {
    expect(diffValues("green", "yellow").changes).toEqual([
      {
        kind: "changed",
        path: [],
        beforePath: [],
        afterPath: [],
        before: "green",
        after: "yellow",
      },
    ]);
  });

  it("중첩 객체는 바뀐 leaf 경로만", () => {
    const before = parseJson(
      '[{"vendor": "A", "total": 1000, "meta": {"pages": [1, 2], "note": "x"}}]',
    );
    const after = parseJson(
      '[{"vendor": "B", "total": 1000.0, "meta": {"pages": [1, 2], "note": "y"}}]',
    );
    expect(rows(before, after)).toEqual([
      ["changed", "0/vendor"],
      ["changed", "0/meta/note"],
    ]);
  });
});
