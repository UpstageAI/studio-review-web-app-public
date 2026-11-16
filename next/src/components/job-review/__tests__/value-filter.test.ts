import { describe, expect, it, vi } from "vitest";

import {
  NO_VALUE_FILTER,
  VALUE_FILTER_KEY,
  countHidden,
  isFiltering,
  parseValueFilter,
  readValueFilter,
  visibleNodeSet,
  visiblePointerFor,
  writeValueFilter,
} from "../value-filter";

describe("parseValueFilter", () => {
  it("없음·깨진 JSON·모르는 모양은 필터 없음(공유 상수)", () => {
    expect(parseValueFilter(null)).toBe(NO_VALUE_FILTER);
    expect(parseValueFilter("{oops")).toBe(NO_VALUE_FILTER);
    expect(parseValueFilter("[true]")).toBe(NO_VALUE_FILTER);
    expect(parseValueFilter("null")).toBe(NO_VALUE_FILTER);
    expect(parseValueFilter('"changedOnly"')).toBe(NO_VALUE_FILTER);
    expect(parseValueFilter('{"changedOnly":false}')).toBe(NO_VALUE_FILTER);
  });

  it("boolean true 만 켠 것으로 읽고 다른 타입은 끈다", () => {
    expect(parseValueFilter('{"changedOnly":true}')).toEqual({
      changedOnly: true,
      currentPageOnly: false,
      emptyOnly: false,
    });
    expect(parseValueFilter('{"emptyOnly":true}')).toEqual({
      changedOnly: false,
      currentPageOnly: false,
      emptyOnly: true,
    });
    expect(parseValueFilter('{"changedOnly":"true","currentPageOnly":1}')).toBe(
      NO_VALUE_FILTER,
    );
    expect(
      parseValueFilter('{"changedOnly":true,"currentPageOnly":true,"x":1}'),
    ).toEqual({ changedOnly: true, currentPageOnly: true, emptyOnly: false });
  });
});

describe("readValueFilter · writeValueFilter", () => {
  it("저장소 값을 읽고, 저장소가 없거나 던지면 필터 없음", () => {
    const store = new Map<string, string>([
      [VALUE_FILTER_KEY, '{"currentPageOnly":true}'],
    ]);
    expect(readValueFilter({ getItem: key => store.get(key) ?? null })).toEqual(
      { changedOnly: false, currentPageOnly: true, emptyOnly: false },
    );
    expect(readValueFilter({ getItem: () => null })).toBe(NO_VALUE_FILTER);
    expect(readValueFilter(null)).toBe(NO_VALUE_FILTER);
    expect(
      readValueFilter({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(NO_VALUE_FILTER);
  });

  it("세 플래그만 JSON 으로 쓰고, 저장소가 없거나 던져도 예외가 나지 않는다", () => {
    const setItem = vi.fn();
    writeValueFilter(
      { setItem },
      { changedOnly: true, currentPageOnly: false, emptyOnly: false },
    );
    expect(setItem).toHaveBeenCalledWith(
      VALUE_FILTER_KEY,
      '{"changedOnly":true,"currentPageOnly":false,"emptyOnly":false}',
    );
    expect(() => writeValueFilter(null, NO_VALUE_FILTER)).not.toThrow();
    expect(() =>
      writeValueFilter(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        NO_VALUE_FILTER,
      ),
    ).not.toThrow();
  });

  it("쓴 값을 다시 읽으면 같다", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const filter = {
      changedOnly: true,
      currentPageOnly: true,
      emptyOnly: false,
    };
    writeValueFilter(storage, filter);
    expect(readValueFilter(storage)).toEqual(filter);
  });
});

describe("isFiltering", () => {
  it("하나라도 켜져 있으면 참", () => {
    expect(isFiltering(NO_VALUE_FILTER)).toBe(false);
    expect(
      isFiltering({
        changedOnly: false,
        currentPageOnly: false,
        emptyOnly: true,
      }),
    ).toBe(true);
    expect(
      isFiltering({
        changedOnly: true,
        currentPageOnly: false,
        emptyOnly: false,
      }),
    ).toBe(true);
    expect(
      isFiltering({
        changedOnly: false,
        currentPageOnly: true,
        emptyOnly: false,
      }),
    ).toBe(true);
  });
});

describe("visiblePointerFor", () => {
  const changed = new Set(["/a", "/items/1/qty"]);
  const highlights = new Map([
    ["/a", { viewerIndex: 0 }],
    ["/b", { viewerIndex: 2 }],
    ["/items/1/qty", { viewerIndex: 2 }],
  ]);

  it("모두 꺼져 있으면 undefined", () => {
    expect(
      visiblePointerFor({
        filter: NO_VALUE_FILTER,
        changed,
        highlights,
        pageIndex: 0,
      }),
    ).toBeUndefined();
  });

  it("바뀐 값만: changed 집합", () => {
    const visible = visiblePointerFor({
      filter: { changedOnly: true, currentPageOnly: false, emptyOnly: false },
      changed,
      highlights,
      pageIndex: 5,
    })!;
    expect(visible("/a")).toBe(true);
    expect(visible("/items/1/qty")).toBe(true);
    expect(visible("/b")).toBe(false);
    expect(visible("/nope")).toBe(false);
  });

  it("현재 페이지 값만: 하이라이트가 그 페이지를 가리킬 때만(없으면 숨김)", () => {
    const visible = visiblePointerFor({
      filter: { changedOnly: false, currentPageOnly: true, emptyOnly: false },
      changed,
      highlights,
      pageIndex: 2,
    })!;
    expect(visible("/b")).toBe(true);
    expect(visible("/items/1/qty")).toBe(true);
    expect(visible("/a")).toBe(false);
    expect(visible("/no-highlight")).toBe(false);
  });

  it("둘 다 켜져 있으면 AND", () => {
    const visible = visiblePointerFor({
      filter: { changedOnly: true, currentPageOnly: true, emptyOnly: false },
      changed,
      highlights,
      pageIndex: 2,
    })!;
    expect(visible("/items/1/qty")).toBe(true);
    expect(visible("/a")).toBe(false);
    expect(visible("/b")).toBe(false);
  });

  it("빈 값만: empty 집합, 없으면 아무것도 보이지 않는다", () => {
    const empty = new Set(["/b", "/items/1/qty"]);
    const visible = visiblePointerFor({
      filter: { changedOnly: false, currentPageOnly: false, emptyOnly: true },
      changed,
      empty,
      highlights,
      pageIndex: 0,
    })!;
    expect(visible("/b")).toBe(true);
    expect(visible("/a")).toBe(false);
    const none = visiblePointerFor({
      filter: { changedOnly: false, currentPageOnly: false, emptyOnly: true },
      changed,
      highlights,
      pageIndex: 0,
    })!;
    expect(none("/b")).toBe(false);
  });

  it("셋 다 켜져 있으면 모두 만족해야 한다", () => {
    const visible = visiblePointerFor({
      filter: { changedOnly: true, currentPageOnly: true, emptyOnly: true },
      changed,
      empty: new Set(["/items/1/qty", "/b"]),
      highlights,
      pageIndex: 2,
    })!;
    expect(visible("/items/1/qty")).toBe(true);
    expect(visible("/b")).toBe(false);
    expect(visible("/a")).toBe(false);
  });
});

describe("countHidden", () => {
  it("거른 leaf 수, 필터가 없으면 0", () => {
    const pointers = ["/a", "/b", "/c"];
    expect(countHidden(pointers, undefined)).toBe(0);
    expect(countHidden(pointers, pointer => pointer === "/b")).toBe(2);
    expect(countHidden([], () => false)).toBe(0);
  });
});

describe("visibleNodeSet", () => {
  it("보이는 leaf 와 그 조상 전부, 루트는 빼고", () => {
    const leaves = ["/a", "/items/0/qty", "/items/1/qty", "/items/1/name"];
    const nodes = visibleNodeSet(leaves, pointer => pointer === "/items/1/qty");
    expect([...nodes].sort()).toEqual(["/items", "/items/1", "/items/1/qty"]);
  });

  it("선택·오류 pointer 는 필터와 무관하게 조상과 함께 넣고 null 은 무시한다", () => {
    const nodes = visibleNodeSet(["/a", "/0/b/c"], () => false, [
      "/0/b/c",
      null,
    ]);
    expect([...nodes].sort()).toEqual(["/0", "/0/b", "/0/b/c"]);
    expect(visibleNodeSet(["/a"], () => false).size).toBe(0);
  });

  it("오류 pointer 여러 개와 컨테이너 pointer(필수 필드의 객체)도 조상과 함께, 루트는 빼고", () => {
    const nodes = visibleNodeSet(["/a", "/items/0/qty"], () => false, [
      "/items/3",
      "/items/5/qty",
      "",
    ]);
    expect([...nodes].sort()).toEqual([
      "/items",
      "/items/3",
      "/items/5",
      "/items/5/qty",
    ]);
  });
});
