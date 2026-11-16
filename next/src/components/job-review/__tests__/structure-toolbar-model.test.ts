import { describe, expect, it } from "vitest";

import type { LocatedDocument, PageRef } from "@/lib/review-model";

import {
  neighborsOf,
  pagesInRange,
  parsePositiveInt,
} from "../structure-toolbar-model";

const doc = (
  id: string,
  group: string,
  range: [number, number],
  index: number,
  label: string | null = id,
): LocatedDocument => ({
  stepId: "st_c",
  index,
  document: {
    document_id: id,
    group_id: group,
    label,
    source_files: [{ file_ref: "job_1#0", page_ranges: [range] }],
  },
});

// a(1–2)·b(3–5) 는 g1, c(6) 는 g2. d 는 읽을 수 없는 범위.
const a = doc("a", "g1", [1, 2], 0);
const b = doc("b", "g1", [3, 5], 1, null);
const c = doc("c", "g2", [6, 6], 2);
const d = doc("d", "g1", [2, 1], 3);
const documents = [a, b, c];
const select = (documentId: string) => ({ stepId: "st_c", documentId });

describe("neighborsOf", () => {
  it("첫 문서는 앞이 없고 뒤 문서의 수·첫·끝 페이지를 요약한다", () => {
    const result = neighborsOf(documents, select("a"));
    expect(result.previous).toBeNull();
    expect(result.next).toEqual({
      stepId: "st_c",
      documentId: "b",
      index: 1,
      label: null,
      pageCount: 3,
      sameGroup: true,
      firstPage: { file_ref: "job_1#0", page: 3 },
      lastPage: { file_ref: "job_1#0", page: 5 },
    });
    expect(result.position).toBe(0);
    expect(result.total).toBe(3);
  });

  it("마지막 문서는 뒤가 없고, 그룹 경계를 넘는 이웃은 sameGroup=false", () => {
    const last = neighborsOf(documents, select("c"));
    expect(last.next).toBeNull();
    expect(last.previous).toMatchObject({
      documentId: "b",
      index: 1,
      sameGroup: false,
    });
    expect(last.position).toBe(2);
    const middle = neighborsOf(documents, select("b"));
    expect(middle.previous).toMatchObject({
      documentId: "a",
      sameGroup: true,
      lastPage: { file_ref: "job_1#0", page: 2 },
    });
    expect(middle.next).toMatchObject({ documentId: "c", sameGroup: false });
  });

  it("선택이 없거나 목록에 없으면 이웃이 없고 position 은 -1", () => {
    expect(neighborsOf(documents, null)).toEqual({
      previous: null,
      next: null,
      position: -1,
      total: 3,
    });
    expect(neighborsOf(documents, select("zzz")).position).toBe(-1);
    expect(
      neighborsOf(documents, { stepId: "other", documentId: "a" }).next,
    ).toBeNull();
  });

  it("페이지 범위를 읽을 수 없는 이웃은 pageCount 0·페이지 null", () => {
    const result = neighborsOf([c, d], select("c"));
    expect(result.next).toEqual({
      stepId: "st_c",
      documentId: "d",
      index: 1,
      label: "d",
      pageCount: 0,
      sameGroup: false,
      firstPage: null,
      lastPage: null,
    });
  });
});

describe("pagesInRange", () => {
  const pages: PageRef[] = [1, 2, 3, 4, 5].map(page => ({
    file_ref: "job_1#0",
    page,
  }));

  it("1-based 양끝 포함 범위를 자른다", () => {
    expect(pagesInRange(pages, 1, 5)).toEqual(pages);
    expect(pagesInRange(pages, 2, 3)).toEqual([pages[1], pages[2]]);
    expect(pagesInRange(pages, 5, 5)).toEqual([pages[4]]);
  });

  it("경계 밖·역순·정수 아님은 null", () => {
    expect(pagesInRange(pages, 0, 1)).toBeNull();
    expect(pagesInRange(pages, 1, 6)).toBeNull();
    expect(pagesInRange(pages, 3, 2)).toBeNull();
    expect(pagesInRange(pages, 1.5, 2)).toBeNull();
    expect(pagesInRange([], 1, 1)).toBeNull();
  });
});

describe("parsePositiveInt", () => {
  it("1 이상의 정수만(공백 허용)", () => {
    expect(parsePositiveInt("3")).toBe(3);
    expect(parsePositiveInt(" 12 ")).toBe(12);
    expect(parsePositiveInt("0")).toBeNull();
    expect(parsePositiveInt("-1")).toBeNull();
    expect(parsePositiveInt("1e3")).toBeNull();
    expect(parsePositiveInt("a")).toBeNull();
    expect(parsePositiveInt("")).toBeNull();
    expect(parsePositiveInt("1.5")).toBeNull();
  });
});
