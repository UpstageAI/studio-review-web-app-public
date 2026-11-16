import { describe, expect, it } from "vitest";

import {
  COLUMNS_STORAGE_KEY,
  DEFAULT_HIDDEN,
  parseHiddenColumns,
  readHiddenColumns,
  serializeHiddenColumns,
  toggleHiddenColumn,
  writeHiddenColumns,
  type HideableColumn,
  type StorageLike,
} from "../column-visibility";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  const storage: StorageLike = {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
  return { storage, map };
}

const throwing: StorageLike = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const sorted = (set: ReadonlySet<HideableColumn>) => [...set].sort();

describe("parseHiddenColumns", () => {
  it("값이 없으면 Workflow·마지막 결과를 숨긴다", () => {
    expect(sorted(parseHiddenColumns(null))).toEqual(
      [...DEFAULT_HIDDEN].sort(),
    );
    expect(sorted(parseHiddenColumns(null))).toEqual([
      "lastResult",
      "workflow",
    ]);
  });

  it("깨진 JSON·배열이 아닌 값은 기본값", () => {
    expect(sorted(parseHiddenColumns("{"))).toEqual(["lastResult", "workflow"]);
    expect(sorted(parseHiddenColumns('{"a":1}'))).toEqual([
      "lastResult",
      "workflow",
    ]);
    expect(sorted(parseHiddenColumns('"jobs"'))).toEqual([
      "lastResult",
      "workflow",
    ]);
  });

  it("빈 배열은 모두 보임", () => {
    expect(parseHiddenColumns("[]").size).toBe(0);
  });

  it("모르는 이름·이름 열·문자열이 아닌 값은 버린다", () => {
    expect(
      sorted(parseHiddenColumns('["jobs","name","nope",3,null,"source"]')),
    ).toEqual(["jobs", "source"]);
  });
});

describe("serializeHiddenColumns", () => {
  it("메뉴 순서로 쓰고 다시 읽으면 같다", () => {
    const set = new Set<HideableColumn>(["lastResult", "source", "jobs"]);
    const text = serializeHiddenColumns(set);
    expect(text).toBe('["source","jobs","lastResult"]');
    expect(sorted(parseHiddenColumns(text))).toEqual(sorted(set));
  });

  it("빈 집합은 빈 배열", () => {
    expect(serializeHiddenColumns(new Set())).toBe("[]");
  });
});

describe("readHiddenColumns / writeHiddenColumns", () => {
  it("저장소가 없거나 막혀 있으면 기본값을 읽고 쓰기는 조용히 건너뛴다", () => {
    expect(sorted(readHiddenColumns(null))).toEqual(["lastResult", "workflow"]);
    expect(sorted(readHiddenColumns(throwing))).toEqual([
      "lastResult",
      "workflow",
    ]);
    expect(() => writeHiddenColumns(null, new Set())).not.toThrow();
    expect(() => writeHiddenColumns(throwing, new Set())).not.toThrow();
  });

  it("쓴 값을 같은 키에서 다시 읽는다", () => {
    const { storage, map } = memoryStorage();
    writeHiddenColumns(storage, new Set(["source"]));
    expect(map.get(COLUMNS_STORAGE_KEY)).toBe('["source"]');
    expect(sorted(readHiddenColumns(storage))).toEqual(["source"]);
  });
});

describe("toggleHiddenColumn", () => {
  it("숨김을 뒤집은 새 집합을 돌려주고 입력은 바꾸지 않는다", () => {
    const before = new Set<HideableColumn>(["workflow"]);
    const shown = toggleHiddenColumn(before, "workflow");
    expect(shown.has("workflow")).toBe(false);
    expect(before.has("workflow")).toBe(true);
    expect(toggleHiddenColumn(shown, "jobs").has("jobs")).toBe(true);
  });
});
