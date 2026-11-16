import { describe, expect, it } from "vitest";

import {
  appendUnique,
  CURSOR_BLOCK_PAGES,
  getCursorBlockPage,
  nextCursorOf,
  PAGE_SIZE,
} from "../cursor-block";

describe("getCursorBlockPage", () => {
  it("한 블록은 20 행 × 5 페이지다", () => {
    expect(PAGE_SIZE).toBe(20);
    expect(CURSOR_BLOCK_PAGES).toBe(5);
  });

  it("받은 블록이 없으면 가려는 페이지를 그대로 보인다", () => {
    expect(getCursorBlockPage(0, 0, null, 20)).toMatchObject({
      page: 1,
      pageNumbers: [1],
      start: 0,
      end: 20,
    });
    expect(getCursorBlockPage(2, 0, null, 20)).toMatchObject({
      page: 3,
      pageNumbers: [1, 2, 3],
    });
  });

  it("100 행 블록 0 의 네 번째 페이지", () => {
    expect(getCursorBlockPage(3, 0, 100, 20)).toEqual({
      page: 4,
      pageNumbers: [1, 2, 3, 4, 5],
      start: 60,
      end: 80,
      isFirstInBlock: false,
      isLastInBlock: false,
    });
  });

  it("블록의 첫·마지막 페이지를 알려 준다", () => {
    const first = getCursorBlockPage(0, 0, 100, 20);
    expect(first.isFirstInBlock).toBe(true);
    expect(first.isLastInBlock).toBe(false);
    const last = getCursorBlockPage(4, 0, 100, 20);
    expect(last).toMatchObject({ page: 5, start: 80, end: 100 });
    expect(last.isLastInBlock).toBe(true);
  });

  it("45 행 블록 1 은 6~8 페이지다", () => {
    const view = getCursorBlockPage(6, 1, 45, 20);
    expect(view.pageNumbers).toEqual([6, 7, 8]);
    expect(view).toMatchObject({ page: 7, start: 20, end: 40 });
    expect(getCursorBlockPage(7, 1, 45, 20).isLastInBlock).toBe(true);
  });

  it("다음 블록을 받는 동안에는 받아 둔 블록의 마지막 페이지를 유지한다", () => {
    expect(getCursorBlockPage(5, 0, 100, 20)).toMatchObject({
      page: 5,
      pageNumbers: [1, 2, 3, 4, 5],
      start: 80,
      isLastInBlock: true,
    });
  });

  it("앞 블록을 받는 동안에는 받아 둔 블록의 첫 페이지를 유지한다", () => {
    expect(getCursorBlockPage(4, 1, 100, 20)).toMatchObject({
      page: 6,
      pageNumbers: [6, 7, 8, 9, 10],
      start: 0,
      isFirstInBlock: true,
    });
  });

  it("다시 읽어 행이 줄면 남은 마지막 페이지로 당긴다", () => {
    expect(getCursorBlockPage(4, 0, 30, 20)).toMatchObject({
      page: 2,
      pageNumbers: [1, 2],
      start: 20,
      end: 40,
      isLastInBlock: true,
    });
  });

  it("행이 없어도 한 페이지로 본다", () => {
    expect(getCursorBlockPage(0, 0, 0, 20)).toEqual({
      page: 1,
      pageNumbers: [1],
      start: 0,
      end: 20,
      isFirstInBlock: true,
      isLastInBlock: true,
    });
  });

  it("20 의 배수가 아닌 행 수는 올림으로 페이지를 센다", () => {
    expect(getCursorBlockPage(0, 0, 21, 20).pageNumbers).toEqual([1, 2]);
    expect(getCursorBlockPage(0, 0, 20, 20).pageNumbers).toEqual([1]);
  });
});

describe("nextCursorOf", () => {
  it("has_more 이고 커서가 있을 때만 커서를 준다", () => {
    expect(nextCursorOf({ has_more: true, last_cursor: "c1" })).toBe("c1");
    expect(nextCursorOf({ has_more: false, last_cursor: "c1" })).toBeNull();
    expect(nextCursorOf({ last_cursor: "c1" })).toBeNull();
  });

  it("has_more 라도 커서가 없으면 다음이 없다", () => {
    expect(nextCursorOf({ has_more: true })).toBeNull();
    expect(nextCursorOf({ has_more: true, last_cursor: null })).toBeNull();
    expect(nextCursorOf({ has_more: true, last_cursor: "" })).toBeNull();
  });
});

describe("appendUnique", () => {
  const keyOf = (row: { id: string }) => row.id;

  it("이어 받은 행 중 이미 있는 키는 빼고 순서대로 붙인다", () => {
    const items = [{ id: "a" }, { id: "b" }];
    const more = [{ id: "b", v: 2 }, { id: "c" }, { id: "d" }];
    expect(appendUnique(items, more, keyOf).map(keyOf)).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    // 이미 있던 행은 원래 것을 유지한다.
    expect(appendUnique(items, more, keyOf)[1]).toBe(items[1]);
  });

  it("겹치는 행이 없으면 그대로 이어 붙이고 원본은 바꾸지 않는다", () => {
    const items = [{ id: "a" }];
    const result = appendUnique(items, [{ id: "b" }], keyOf);
    expect(result.map(keyOf)).toEqual(["a", "b"]);
    expect(items).toHaveLength(1);
  });
});
