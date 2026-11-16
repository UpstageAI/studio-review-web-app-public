import { describe, expect, it } from "vitest";

import { readUrlSelection, withUrlSelection } from "../url-state";

describe("readUrlSelection", () => {
  it("doc 과 1-based page 를 읽어 뷰어 위치로 바꾼다", () => {
    expect(readUrlSelection("?doc=doc_long&page=12")).toEqual({
      documentId: "doc_long",
      pageIndex: 11,
    });
    expect(readUrlSelection("doc=doc_1&page=1")).toEqual({
      documentId: "doc_1",
      pageIndex: 0,
    });
  });

  it("없거나 빈 값은 null", () => {
    expect(readUrlSelection("")).toEqual({ documentId: null, pageIndex: null });
    expect(readUrlSelection("?other=1")).toEqual({
      documentId: null,
      pageIndex: null,
    });
    expect(readUrlSelection("?doc=&page=")).toEqual({
      documentId: null,
      pageIndex: null,
    });
  });

  it("page 는 1 이상의 정수(앞 0 없음)만 인정한다", () => {
    for (const page of ["0", "-1", "007", "1.5", "abc", "1e3", " 3"]) {
      expect(readUrlSelection(`?doc=d&page=${page}`).pageIndex).toBeNull();
    }
    expect(readUrlSelection("?page=10").pageIndex).toBe(9);
    expect(readUrlSelection("?page=99999999999999999999").pageIndex).toBeNull();
  });

  it("문서 id 의 특수 문자를 되살린다", () => {
    expect(readUrlSelection("?doc=review-doc%20a%26b").documentId).toBe(
      "review-doc a&b",
    );
  });
});

describe("withUrlSelection", () => {
  it("다른 파라미터를 보존하며 doc·page 를 적는다", () => {
    expect(
      withUrlSelection("?tab=values", { documentId: "doc_2", pageIndex: 4 }),
    ).toBe("?tab=values&doc=doc_2&page=5");
    expect(
      withUrlSelection("?doc=doc_1&page=1&x=y", {
        documentId: "doc_2",
        pageIndex: 0,
      }),
    ).toBe("?doc=doc_2&page=1&x=y");
    expect(withUrlSelection("", { documentId: "a b", pageIndex: 0 })).toBe(
      "?doc=a+b&page=1",
    );
  });

  it("선택이 없으면 두 파라미터만 지우고, 비면 빈 문자열", () => {
    expect(withUrlSelection("?doc=doc_1&page=3&x=y", null)).toBe("?x=y");
    expect(withUrlSelection("?doc=doc_1&page=3", null)).toBe("");
    expect(withUrlSelection("", null)).toBe("");
  });

  it("음수 위치는 1 쪽으로 적고, 읽으면 같은 선택이 된다", () => {
    expect(withUrlSelection("", { documentId: "d", pageIndex: -2 })).toBe(
      "?doc=d&page=1",
    );
    const search = withUrlSelection("?k=v", {
      documentId: "review-doc a&b",
      pageIndex: 41,
    });
    expect(readUrlSelection(search)).toEqual({
      documentId: "review-doc a&b",
      pageIndex: 41,
    });
  });
});
