import { describe, expect, it } from "vitest";

import { ReviewModelError } from "../errors";
import { readReviewDocument } from "../normalize";
import {
  compressPages,
  filePageCount,
  flattenPages,
  flattenSources,
  formatPageRanges,
  pageKey,
  pageSetEquals,
  parsePageKey,
  parsePageRangeText,
  rangesOverlapPages,
} from "../pages";
import type { Layout, PageRange, PageRef, SourceRange } from "../types";
import { NO_LOOKUPS, SINGLE_JOB } from "./fixtures/fixtures";

const p = (file_ref: string, page: number): PageRef => ({ file_ref, page });

describe("flattenPages", () => {
  it("source 순서·범위 순서대로 펼친다", () => {
    const job = readReviewDocument(SINGLE_JOB).jobs[0]!;
    const doc2 = (job.output[0] as Layout).content.documents[1]!;
    expect(flattenPages(doc2)).toEqual([p("job_A#0", 3), p("job_A#1", 1)]);
  });

  it("같은 파일 구간 반복 참조를 그대로 펼친다", () => {
    const sources: SourceRange[] = [
      {
        file_ref: "f#0",
        page_ranges: [
          [3, 4],
          [1, 1],
        ],
      },
      { file_ref: "g#0", page_ranges: [[2, 2]] },
      { file_ref: "f#0", page_ranges: [[2, 2]] },
    ];
    expect(flattenSources(sources)).toEqual([
      p("f#0", 3),
      p("f#0", 4),
      p("f#0", 1),
      p("g#0", 2),
      p("f#0", 2),
    ]);
  });

  const invalidRanges: [PageRange][] = [
    [[3, 2]],
    [[0, 1]],
    [[1, 10_001]],
    [[1.5, 2]],
  ];
  it.each(invalidRanges)("범위 %j 는 거부", range => {
    expect(() =>
      flattenSources([{ file_ref: "f#0", page_ranges: [range] }]),
    ).toThrow(ReviewModelError);
  });

  it("문서당 10,000 페이지는 허용, 10,001 은 펼치기 전에 거부", () => {
    expect(
      flattenSources([{ file_ref: "f#0", page_ranges: [[1, 10_000]] }]),
    ).toHaveLength(10_000);
    let error: unknown;
    try {
      flattenSources([
        { file_ref: "f#0", page_ranges: [[1, 10_000]] },
        { file_ref: "g#0", page_ranges: [[1, 1]] },
      ]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ReviewModelError);
    expect((error as ReviewModelError).details).toMatchObject({
      reason: "page_limit",
      pages: 10_001,
    });
  });
});

describe("compressPages", () => {
  it("같은 파일 오름차순 인접 페이지만 범위로 묶는다", () => {
    expect(
      compressPages([p("f#0", 1), p("f#0", 2), p("f#0", 3), p("f#0", 5)]),
    ).toEqual([
      {
        file_ref: "f#0",
        page_ranges: [
          [1, 3],
          [5, 5],
        ],
      },
    ]);
  });

  it("역순은 정렬하지 않고 나눈다", () => {
    expect(compressPages([p("f#0", 3), p("f#0", 2), p("f#0", 1)])).toEqual([
      {
        file_ref: "f#0",
        page_ranges: [
          [3, 3],
          [2, 2],
          [1, 1],
        ],
      },
    ]);
  });

  it("파일이 교차하면 source 를 나눈다", () => {
    expect(compressPages([p("f#0", 1), p("g#0", 2), p("f#0", 2)])).toEqual([
      { file_ref: "f#0", page_ranges: [[1, 1]] },
      { file_ref: "g#0", page_ranges: [[2, 2]] },
      { file_ref: "f#0", page_ranges: [[2, 2]] },
    ]);
  });

  it("flatten(compress(x)) ≡ x", () => {
    const pages = [
      p("f#0", 2),
      p("f#0", 3),
      p("g#0", 1),
      p("f#0", 1),
      p("f#0", 4),
      p("f#0", 5),
      p("f#0", 4),
    ];
    expect(flattenSources(compressPages(pages))).toEqual(pages);
    expect(compressPages([])).toEqual([]);
  });
});

describe("pageKey·pageSetEquals·filePageCount", () => {
  it("pageKey ↔ parsePageKey", () => {
    expect(pageKey(p("job_A#0", 3))).toBe("job_A#0:3");
    expect(parsePageKey("job_A#0:3")).toEqual(p("job_A#0", 3));
    expect(parsePageKey("a:b#0:12")).toEqual(p("a:b#0", 12));
    expect(parsePageKey("job_A#0")).toBeNull();
    expect(parsePageKey("job_A#0:0")).toBeNull();
  });

  it("집합 비교는 순서·반복을 보지 않는다", () => {
    expect(
      pageSetEquals([p("f#0", 1), p("f#0", 2)], [p("f#0", 2), p("f#0", 1)]),
    ).toBe(true);
    expect(pageSetEquals([p("f#0", 1), p("f#0", 1)], [p("f#0", 1)])).toBe(true);
    expect(pageSetEquals([p("f#0", 1)], [p("f#0", 1), p("f#0", 2)])).toBe(
      false,
    );
    expect(pageSetEquals([p("f#0", 1)], [p("g#0", 1)])).toBe(false);
  });

  it("num_pages 가 없거나 파일이 없으면 null", () => {
    const job = readReviewDocument(SINGLE_JOB).jobs[0]!;
    expect(filePageCount(job, "job_A#1")).toBe(2);
    expect(filePageCount(job, "job_X#0")).toBeNull();
    expect(
      filePageCount(readReviewDocument(NO_LOOKUPS).jobs[0]!, "job_N#0"),
    ).toBeNull();
  });
});

describe("parsePageRangeText·formatPageRanges", () => {
  it.each<[string, PageRange[]]>([
    [
      "1-3, 5",
      [
        [1, 3],
        [5, 5],
      ],
    ],
    ["1\u20133", [[1, 3]]],
    ["7", [[7, 7]]],
    [
      "  2 - 4 ,6  ",
      [
        [2, 4],
        [6, 6],
      ],
    ],
    [
      "5, 1-2",
      [
        [5, 5],
        [1, 2],
      ],
    ],
    [
      "3, 3",
      [
        [3, 3],
        [3, 3],
      ],
    ],
    ["4-4", [[4, 4]]],
  ])("%j → 입력 순서 그대로", (text, expected) => {
    expect(parsePageRangeText(text)).toEqual(expected);
  });

  it.each([
    "",
    "   ",
    "5-3",
    "0",
    "0-2",
    "1.5",
    "a",
    "1-",
    "1,,2",
    "1, ",
    "-3",
    "1 2",
  ])("%j → null", text => {
    expect(parsePageRangeText(text)).toBeNull();
  });

  it("formatPageRanges 는 단일 페이지를 숫자 하나로, 왕복이 같다", () => {
    const ranges: PageRange[] = [
      [1, 3],
      [5, 5],
    ];
    expect(formatPageRanges(ranges)).toBe("1-3, 5");
    expect(parsePageRangeText(formatPageRanges(ranges))).toEqual(ranges);
    expect(formatPageRanges([])).toBe("");
  });
});

describe("rangesOverlapPages", () => {
  it("범위 중 하나라도 페이지를 포함하면 겹친다", () => {
    expect(
      rangesOverlapPages(
        [
          [1, 2],
          [5, 7],
        ],
        new Set([7]),
      ),
    ).toBe(true);
    expect(rangesOverlapPages([[3, 3]], new Set([1, 3]))).toBe(true);
  });

  it("어느 범위에도 페이지가 없으면 겹치지 않는다", () => {
    expect(
      rangesOverlapPages(
        [
          [1, 2],
          [5, 7],
        ],
        new Set([3, 4, 8]),
      ),
    ).toBe(false);
    expect(rangesOverlapPages([], new Set([1]))).toBe(false);
    expect(rangesOverlapPages([[1, 3]], new Set())).toBe(false);
  });

  it("큰 범위도 범위 길이만큼 돌지 않고 바로 끝난다", () => {
    const started = performance.now();
    expect(rangesOverlapPages([[2, 1e9]], new Set([1]))).toBe(false);
    expect(rangesOverlapPages([[1, 1e9]], new Set([1e9]))).toBe(true);
    expect(performance.now() - started).toBeLessThan(50);
  });
});
