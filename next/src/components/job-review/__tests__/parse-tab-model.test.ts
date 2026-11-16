import { describe, expect, it } from "vitest";

import { PARSE_PAGE_FILTER_ABOVE } from "../large-job";
import {
  PARSE_PAGE_FILTER_STORAGE_KEY,
  defaultCurrentPageOnly,
  itemsOnPage,
  readStoredFlag,
  storedFlagValue,
} from "../parse-tab-model";

describe("parse-tab-model", () => {
  it("문서가 임계치보다 길면 현재 페이지만 보기가 기본", () => {
    expect(defaultCurrentPageOnly(PARSE_PAGE_FILTER_ABOVE)).toBe(false);
    expect(defaultCurrentPageOnly(PARSE_PAGE_FILTER_ABOVE + 1)).toBe(true);
    expect(defaultCurrentPageOnly(0)).toBe(false);
  });

  it("저장 값은 1·0 만 읽고 나머지는 null", () => {
    expect(readStoredFlag("1")).toBe(true);
    expect(readStoredFlag("0")).toBe(false);
    expect(readStoredFlag(null)).toBeNull();
    expect(readStoredFlag("true")).toBeNull();
    expect(readStoredFlag(storedFlagValue(true))).toBe(true);
    expect(readStoredFlag(storedFlagValue(false))).toBe(false);
    expect(PARSE_PAGE_FILTER_STORAGE_KEY).toBe("review:parse-current-page");
  });

  it("뷰어 페이지의 항목만 남긴다", () => {
    const items = [
      { id: "a", page: 1 },
      { id: "b", page: 2 },
      { id: "c", page: 2 },
    ];
    expect(itemsOnPage(items, 2).map(item => item.id)).toEqual(["b", "c"]);
    expect(itemsOnPage(items, 3)).toEqual([]);
  });
});
