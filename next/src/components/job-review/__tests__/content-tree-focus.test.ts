import { describe, expect, it } from "vitest";
import type { JsonPath } from "@/lib/review-model";
import { removalFocusPath } from "../content-tree-focus";

const array = (index: number, length: number) =>
  ({
    kind: "array",
    path: ["items"],
    index,
    length,
    min: undefined,
  }) as const;

const object = (key: string, siblings: string[]) =>
  ({
    kind: "object",
    path: ["item"],
    match: null,
    key,
    siblings,
  }) as const;

describe("removalFocusPath", () => {
  it("배열: 다음 항목(지운 자리로 당겨진 번호) → 없으면 이전 → 없으면 배열", () => {
    expect(removalFocusPath(array(1, 3))).toEqual(["items", "1"]);
    expect(removalFocusPath(array(2, 3))).toEqual(["items", "1"]);
    expect(removalFocusPath(array(0, 1))).toEqual(["items"]);
  });

  it("배열: 숨긴 항목은 건너뛴다", () => {
    const hidden = (path: JsonPath) => path[1] !== "2";
    // 다음(2)이 숨겨져 3 → 지운 뒤 2
    expect(removalFocusPath(array(1, 4), hidden)).toEqual(["items", "2"]);
    // 뒤가 모두 숨겨져 이전 0
    expect(removalFocusPath(array(1, 3), hidden)).toEqual(["items", "0"]);
  });

  it("객체: 다음 형제 → 없으면 이전 → 없으면 부모", () => {
    expect(removalFocusPath(object("b", ["a", "b", "c"]))).toEqual([
      "item",
      "c",
    ]);
    expect(removalFocusPath(object("c", ["a", "b", "c"]))).toEqual([
      "item",
      "b",
    ]);
    expect(removalFocusPath(object("a", ["a"]))).toEqual(["item"]);
  });

  it("객체: 숨긴 형제는 건너뛰고, 목록에 없는 키는 부모", () => {
    const shown = (path: JsonPath) => path[1] !== "c";
    expect(removalFocusPath(object("b", ["a", "b", "c"]), shown)).toEqual([
      "item",
      "a",
    ]);
    expect(removalFocusPath(object("z", ["a", "b"]))).toEqual(["item"]);
  });
});
