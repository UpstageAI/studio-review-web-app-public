import { describe, expect, it } from "vitest";
import type { ChangeDraft, ChangeEntry, JsonValue } from "@/lib/review-model";
import {
  clearedValue,
  originalPathOf,
  originalValueAt,
} from "../cleared-value";

let seq = 0;
function entry(draft: Partial<ChangeDraft> & { kind: ChangeDraft["kind"] }) {
  seq += 1;
  return {
    jobId: "job",
    resultId: "r1",
    path: [],
    ...draft,
    id: `change-${seq}`,
    seq,
    description: { documentIds: [] },
  } as unknown as ChangeEntry;
}

describe("clearedValue", () => {
  it("처음에 null 이던 필드를 비우면 null", () => {
    expect(clearedValue("", null)).toBeNull();
  });

  it("처음 값이 null 이 아니거나 비우지 않았으면 그대로", () => {
    expect(clearedValue("", "a")).toBe("");
    expect(clearedValue("", undefined)).toBe("");
    expect(clearedValue("b", null)).toBe("b");
  });
});

describe("originalPathOf", () => {
  const items = ["items"];

  it("구조 변경이 없으면 같은 경로", () => {
    expect(
      originalPathOf(
        [entry({ kind: "set_value", path: ["items", "0", "name"] })],
        "r1",
        ["items", "0", "name"],
      ),
    ).toEqual(["items", "0", "name"]);
  });

  it("앞에 항목을 넣으면 뒤 항목의 번호를 되돌리고, 넣은 항목은 처음 값이 없다", () => {
    const entries = [entry({ kind: "insert_item", path: items, index: 0 })];
    expect(originalPathOf(entries, "r1", ["items", "0", "name"])).toBeNull();
    expect(originalPathOf(entries, "r1", ["items", "1", "name"])).toEqual([
      "items",
      "0",
      "name",
    ]);
  });

  it("뺀 항목 뒤는 번호를 하나 늘린다", () => {
    const entries = [entry({ kind: "remove_item", path: items, index: 1 })];
    expect(originalPathOf(entries, "r1", ["items", "0"])).toEqual([
      "items",
      "0",
    ]);
    expect(originalPathOf(entries, "r1", ["items", "1"])).toEqual([
      "items",
      "2",
    ]);
  });

  it("옮긴 항목은 원래 자리로, 사이 항목은 한 칸씩 되돌린다", () => {
    // [a, b, c] 에서 0 → 2: [b, c, a]
    const entries = [entry({ kind: "move_item", path: items, from: 0, to: 2 })];
    expect(originalPathOf(entries, "r1", ["items", "2"])).toEqual([
      "items",
      "0",
    ]);
    expect(originalPathOf(entries, "r1", ["items", "0"])).toEqual([
      "items",
      "1",
    ]);
    expect(originalPathOf(entries, "r1", ["items", "1"])).toEqual([
      "items",
      "2",
    ]);
  });

  it("여러 변경을 뒤에서부터 차례로 되짚는다", () => {
    // [a, b] → 0 에 x 넣기 [x, a, b] → 2 빼기 [x, a]
    const entries = [
      entry({ kind: "insert_item", path: items, index: 0 }),
      entry({ kind: "remove_item", path: items, index: 2 }),
    ];
    expect(originalPathOf(entries, "r1", ["items", "1"])).toEqual([
      "items",
      "0",
    ]);
  });

  it("묶음을 통째로 바꾸거나 새 키를 넣었으면 그 아래는 처음 값이 없다", () => {
    expect(
      originalPathOf(
        [entry({ kind: "replace_subtree", path: ["items"] })],
        "r1",
        ["items", "0", "name"],
      ),
    ).toBeNull();
    expect(
      originalPathOf(
        [entry({ kind: "set_key", path: [], key: "note" })],
        "r1",
        ["note"],
      ),
    ).toBeNull();
  });

  it("다른 결과의 변경은 보지 않는다", () => {
    const entries = [
      entry({ kind: "insert_item", resultId: "r2", path: items, index: 0 }),
    ];
    expect(originalPathOf(entries, "r1", ["items", "0"])).toEqual([
      "items",
      "0",
    ]);
  });
});

describe("originalValueAt", () => {
  const base: JsonValue = { items: [{ name: null }] };

  it("앞에 넣은 새 항목을 비우면 빈 글자를 지킨다", () => {
    const entries = [entry({ kind: "insert_item", path: ["items"], index: 0 })];
    const original = originalValueAt(entries, base, "r1", [
      "items",
      "0",
      "name",
    ]);
    expect(original).toBeUndefined();
    expect(clearedValue("", original)).toBe("");
  });

  it("밀려난 원래 항목은 처음 값 null 을 찾아 비우면 null", () => {
    const entries = [entry({ kind: "insert_item", path: ["items"], index: 0 })];
    const original = originalValueAt(entries, base, "r1", [
      "items",
      "1",
      "name",
    ]);
    expect(original).toBeNull();
    expect(clearedValue("", original)).toBeNull();
  });
});
