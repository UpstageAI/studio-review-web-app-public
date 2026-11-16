import type { DocumentListItem } from "@/components/studio-ui-kit/document-list/document-list";

import {
  DOCUMENT_STATUS_FILTERS,
  effectiveStatusFilter,
  filterDocumentItems,
  isFiltering,
  isSelectionHidden,
  matchesDocument,
  normalizeQuery,
  parseStatusFilter,
  statusFilterOptions,
  summarizeDocuments,
} from "@/components/studio-ui-kit/document-list/document-filter";

const UNTITLED = "(라벨 없음)";

const doc = (
  id: string,
  label: string | null,
  status?: DocumentListItem["status"],
  pageCount = 1,
): DocumentListItem => ({ id, label, pageCount, status });

const items: DocumentListItem[] = [
  doc("1", "Invoice", undefined, 3),
  doc("2", "receipt", "changed", 2),
  doc("3", null, "recheck", 5),
  doc("4", "Contract", "excluded", 1),
  doc("5", "ＩＮＶＯＩＣＥ 2", "locked", 4),
];

describe("normalizeQuery", () => {
  it("앞뒤 공백을 지우고 소문자로 만든다", () => {
    expect(normalizeQuery("  Invoice ")).toBe("invoice");
  });

  it("전각·호환 문자를 NFKC 로 맞춘다", () => {
    expect(normalizeQuery("ＩＮＶＯＩＣＥ")).toBe("invoice");
    expect(normalizeQuery("①")).toBe("1");
    expect(normalizeQuery("ｶﾅ")).toBe("カナ");
  });

  it("빈 문자열·공백만은 빈 문자열", () => {
    expect(normalizeQuery("")).toBe("");
    expect(normalizeQuery("   ")).toBe("");
  });
});

describe("matchesDocument", () => {
  it("빈 검색어는 모든 라벨에 맞는다", () => {
    expect(matchesDocument(items[0]!, "", "all", UNTITLED)).toBe(true);
    expect(matchesDocument(items[2]!, "", "all", UNTITLED)).toBe(true);
  });

  it("대소문자·전각을 가리지 않고 부분 일치", () => {
    expect(matchesDocument(items[0]!, "inv", "all", UNTITLED)).toBe(true);
    expect(matchesDocument(items[4]!, "invoice", "all", UNTITLED)).toBe(true);
    expect(
      matchesDocument(items[0]!, normalizeQuery("ＶＯＩ"), "all", UNTITLED),
    ).toBe(true);
    expect(matchesDocument(items[1]!, "inv", "all", UNTITLED)).toBe(false);
  });

  it("라벨 없는 문서는 untitled 문구로 검색된다", () => {
    expect(matchesDocument(items[2]!, "라벨", "all", UNTITLED)).toBe(true);
    expect(matchesDocument(items[2]!, "invoice", "all", UNTITLED)).toBe(false);
  });

  it("상태 필터: changed·recheck·excluded 는 그 상태만", () => {
    expect(matchesDocument(items[1]!, "", "changed", UNTITLED)).toBe(true);
    expect(matchesDocument(items[0]!, "", "changed", UNTITLED)).toBe(false);
    expect(matchesDocument(items[2]!, "", "recheck", UNTITLED)).toBe(true);
    expect(matchesDocument(items[3]!, "", "excluded", UNTITLED)).toBe(true);
    expect(matchesDocument(items[3]!, "", "recheck", UNTITLED)).toBe(false);
  });

  it("untouched 는 상태 없음과 locked", () => {
    expect(matchesDocument(items[0]!, "", "untouched", UNTITLED)).toBe(true);
    expect(matchesDocument(items[4]!, "", "untouched", UNTITLED)).toBe(true);
    expect(matchesDocument(items[1]!, "", "untouched", UNTITLED)).toBe(false);
    expect(matchesDocument(items[2]!, "", "untouched", UNTITLED)).toBe(false);
    expect(matchesDocument(items[3]!, "", "untouched", UNTITLED)).toBe(false);
  });

  it("검색어와 상태는 함께 걸린다", () => {
    expect(matchesDocument(items[4]!, "invoice", "untouched", UNTITLED)).toBe(
      true,
    );
    expect(matchesDocument(items[4]!, "invoice", "changed", UNTITLED)).toBe(
      false,
    );
    expect(matchesDocument(items[1]!, "rec", "changed", UNTITLED)).toBe(true);
  });
});

describe("filterDocumentItems", () => {
  it("거르지 않으면 같은 순서의 복사본", () => {
    const out = filterDocumentItems(items, "  ", "all", UNTITLED);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });

  it("검색어는 원문을 받아 정규화하고 순서를 지킨다", () => {
    expect(
      filterDocumentItems(items, " INVOICE ", "all", UNTITLED).map(i => i.id),
    ).toEqual(["1", "5"]);
    expect(
      filterDocumentItems(items, "라벨", "all", UNTITLED).map(i => i.id),
    ).toEqual(["3"]);
  });

  it("상태 조합", () => {
    expect(
      filterDocumentItems(items, "", "untouched", UNTITLED).map(i => i.id),
    ).toEqual(["1", "5"]);
    expect(
      filterDocumentItems(items, "", "excluded", UNTITLED).map(i => i.id),
    ).toEqual(["4"]);
    expect(
      filterDocumentItems(items, "x", "excluded", UNTITLED).map(i => i.id),
    ).toEqual([]);
    expect(
      filterDocumentItems(items, "c", "changed", UNTITLED).map(i => i.id),
    ).toEqual(["2"]);
  });

  it("flagged 는 글자 표시(검증 실패·경고)가 있는 문서만, 편집 상태와 무관", () => {
    const flagged: DocumentListItem[] = [
      { ...items[0]!, flag: "danger" },
      items[1]!,
      { ...items[2]!, flag: "warning" },
      { ...items[3]!, flag: "warning" },
      items[4]!,
    ];
    expect(
      filterDocumentItems(flagged, "", "flagged", UNTITLED).map(i => i.id),
    ).toEqual(["1", "3", "4"]);
    expect(
      filterDocumentItems(flagged, "inv", "flagged", UNTITLED).map(i => i.id),
    ).toEqual(["1"]);
    // 다른 상태 필터는 flag 를 보지 않는다.
    expect(
      filterDocumentItems(flagged, "", "untouched", UNTITLED).map(i => i.id),
    ).toEqual(["1", "5"]);
  });

  it("빈 목록은 빈 목록", () => {
    expect(filterDocumentItems([], "a", "changed", UNTITLED)).toEqual([]);
  });
});

describe("unvisited 필터", () => {
  const tracked: DocumentListItem[] = [
    { ...items[0]!, visited: true },
    { ...items[1]!, visited: false },
    { ...items[2]!, visited: false },
    { ...items[3]!, visited: true },
    { ...items[4]!, visited: false },
  ];

  it("열어 보지 않은 문서(visited === false)만, 편집 상태와 무관", () => {
    expect(
      filterDocumentItems(tracked, "", "unvisited", UNTITLED).map(i => i.id),
    ).toEqual(["2", "3", "5"]);
  });

  it("열어 본 문서를 구분하지 않는 항목(visited 없음)은 걸리지 않는다", () => {
    expect(filterDocumentItems(items, "", "unvisited", UNTITLED)).toEqual([]);
  });

  it("지금 고른 문서는 열어 봤어도 남긴다", () => {
    expect(
      filterDocumentItems(tracked, "", "unvisited", UNTITLED, "1").map(
        i => i.id,
      ),
    ).toEqual(["1", "2", "3", "5"]);
    expect(matchesDocument(tracked[3]!, "", "unvisited", UNTITLED, "4")).toBe(
      true,
    );
    expect(matchesDocument(tracked[3]!, "", "unvisited", UNTITLED, "1")).toBe(
      false,
    );
  });

  it("고른 문서를 남기는 규칙은 unvisited 에만 쓰고 검색어는 그대로 걸린다", () => {
    expect(
      filterDocumentItems(tracked, "", "changed", UNTITLED, "1").map(i => i.id),
    ).toEqual(["2"]);
    expect(
      filterDocumentItems(tracked, "inv", "unvisited", UNTITLED, "2").map(
        i => i.id,
      ),
    ).toEqual(["5"]);
    expect(
      filterDocumentItems(tracked, "inv", "unvisited", UNTITLED, "1").map(
        i => i.id,
      ),
    ).toEqual(["1", "5"]);
  });

  it("고른 문서가 가려지지 않으므로 가려짐 안내가 뜨지 않는다", () => {
    const visible = filterDocumentItems(
      tracked,
      "",
      "unvisited",
      UNTITLED,
      "1",
    );
    expect(isSelectionHidden(tracked, visible, "1")).toBe(false);
  });
});

describe("statusFilterOptions", () => {
  it("열어 본 문서를 구분하면 unvisited 를 맨 끝에 둔다", () => {
    expect(statusFilterOptions(true)).toEqual(DOCUMENT_STATUS_FILTERS);
    expect(statusFilterOptions(true).at(-1)).toBe("unvisited");
  });

  it("구분하지 않으면 unvisited 를 빼고 나머지 순서는 그대로", () => {
    expect(statusFilterOptions(false)).toEqual([
      "all",
      "flagged",
      "changed",
      "recheck",
      "excluded",
      "untouched",
    ]);
  });
});

describe("effectiveStatusFilter", () => {
  it("구분하지 않는데 unvisited 를 골라 두었으면 all", () => {
    expect(effectiveStatusFilter("unvisited", false)).toBe("all");
    expect(effectiveStatusFilter("unvisited", true)).toBe("unvisited");
  });

  it("다른 값은 그대로", () => {
    expect(effectiveStatusFilter("changed", false)).toBe("changed");
    expect(effectiveStatusFilter("all", true)).toBe("all");
  });
});

describe("isFiltering", () => {
  it("공백만인 검색어와 all 은 거르지 않는 것", () => {
    expect(isFiltering("", "all")).toBe(false);
    expect(isFiltering("   ", "all")).toBe(false);
    expect(isFiltering("a", "all")).toBe(true);
    expect(isFiltering("", "changed")).toBe(true);
  });
});

describe("parseStatusFilter", () => {
  it("아는 값은 그대로, 모르는 값은 all", () => {
    for (const value of DOCUMENT_STATUS_FILTERS) {
      expect(parseStatusFilter(value)).toBe(value);
    }
    expect(parseStatusFilter("locked")).toBe("all");
    expect(parseStatusFilter("")).toBe("all");
  });
});

describe("summarizeDocuments", () => {
  it("문서 수와 페이지 합", () => {
    expect(summarizeDocuments(items)).toEqual({
      count: 5,
      pages: 15,
      visited: 0,
    });
    expect(summarizeDocuments([])).toEqual({ count: 0, pages: 0, visited: 0 });
  });

  it("열어 본 문서는 visited === true 만 센다", () => {
    const marked: DocumentListItem[] = [
      { ...items[0]!, visited: true },
      { ...items[1]!, visited: false },
      { ...items[2]!, visited: true },
      items[3]!,
    ];
    expect(summarizeDocuments(marked).visited).toBe(2);
  });
});

describe("isSelectionHidden", () => {
  const visible = filterDocumentItems(items, "invoice", "all", UNTITLED);

  it("거른 목록에서 빠진 선택이면 true", () => {
    expect(isSelectionHidden(items, visible, "2")).toBe(true);
  });

  it("거른 목록에 있는 선택이면 false", () => {
    expect(isSelectionHidden(items, visible, "1")).toBe(false);
    expect(isSelectionHidden(items, items, "2")).toBe(false);
  });

  it("선택이 없거나 전체 목록에도 없으면 false", () => {
    expect(isSelectionHidden(items, visible, null)).toBe(false);
    expect(isSelectionHidden(items, visible, "other")).toBe(false);
  });
});
