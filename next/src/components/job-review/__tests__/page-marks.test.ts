import { describe, expect, it } from "vitest";

import type {
  ChangeDraft,
  PageRef,
  PairedHighlight,
  ValidationIssue,
} from "@/lib/review-model";

import {
  changedPageIndexes,
  issuePageIndexes,
  missingImageIndexes,
  pageMarksFor,
} from "../page-marks";

const box = [
  { x: 0.1, y: 0.1 },
  { x: 0.2, y: 0.1 },
  { x: 0.2, y: 0.2 },
];

function paired(
  resultId: string,
  pointer: string,
  viewerIndex: number,
): PairedHighlight {
  return {
    id: `${resultId}#${pointer}`,
    pointer,
    viewerIndex,
    page: viewerIndex + 1,
    _value: "",
    coordinates: box,
    value: "",
  };
}

const highlights: PairedHighlight[] = [
  paired("r1", "/amount", 0),
  paired("r1", "/items/0/qty", 2),
  paired("r1", "/items/1/qty", 3),
  paired("r10", "/amount", 7),
  paired("r10", "/items/0/qty", 8),
];

const setValue = (resultId: string, path: readonly string[]): ChangeDraft => ({
  kind: "set_value",
  jobId: "job_1",
  resultId,
  path,
  value: 1,
});

describe("changedPageIndexes", () => {
  it("값 항목의 pointer 와 같은 하이라이트의 페이지", () => {
    expect(
      changedPageIndexes([setValue("r1", ["amount"])], highlights),
    ).toEqual([0]);
  });

  it("하위 pointer 의 하이라이트도 포함한다(배열 항목 조작·subtree 교체)", () => {
    expect(changedPageIndexes([setValue("r1", ["items"])], highlights)).toEqual(
      [2, 3],
    );
    expect(
      changedPageIndexes(
        [
          {
            kind: "remove_item",
            jobId: "job_1",
            resultId: "r1",
            path: ["items"],
            index: 0,
          },
        ],
        highlights,
      ),
    ).toEqual([2, 3]);
    // 빈 경로(content 전체)는 그 결과의 모든 하이라이트.
    expect(changedPageIndexes([setValue("r1", [])], highlights)).toEqual([
      0, 2, 3,
    ]);
  });

  it("결과 id 는 접두사 `${id}#` 로 정확히 비교한다(r1 ≠ r10)", () => {
    expect(
      changedPageIndexes([setValue("r1", ["amount"])], highlights),
    ).toEqual([0]);
    expect(
      changedPageIndexes([setValue("r10", ["amount"])], highlights),
    ).toEqual([7]);
    // `/items` 는 `/items_total` 같은 형제와 섞이지 않는다.
    expect(
      changedPageIndexes(
        [setValue("r1", ["item"])],
        [...highlights, paired("r1", "/item_total", 5)],
      ),
    ).toEqual([]);
  });

  it("구성 변경 항목·하이라이트 없는 값은 건너뛰고, 중복 페이지는 하나로", () => {
    expect(
      changedPageIndexes(
        [
          {
            kind: "set_label",
            jobId: "job_1",
            stepId: null,
            documentId: "doc_1",
            label: "x",
          },
          setValue("r1", ["memo"]),
          setValue("r1", ["items", "0", "qty"]),
          setValue("r1", ["items", "0"]),
        ],
        highlights,
      ),
    ).toEqual([2]);
  });
});

const docPages: PageRef[] = [
  { file_ref: "f#0", page: 5 },
  { file_ref: "f#0", page: 6 },
  { file_ref: "f#1", page: 1 },
];

const issue = (where: ValidationIssue["where"]): ValidationIssue => ({
  code: "page_out_of_range",
  severity: "error",
  jobId: "job_1",
  where,
});

describe("issuePageIndexes", () => {
  it("페이지 문제는 이 문서에 해당할 때 그 페이지, 값 문제는 하이라이트 위치", () => {
    const issues = [
      issue({
        kind: "page",
        stepId: null,
        groupId: "grp_1",
        page: { file_ref: "f#0", page: 6 },
        documentIds: ["doc_1", "doc_2"],
      }),
      issue({
        kind: "page",
        stepId: null,
        groupId: "grp_1",
        page: { file_ref: "f#1", page: 1 },
        documentIds: ["doc_9"],
      }),
      issue({
        kind: "page",
        stepId: null,
        groupId: "grp_1",
        page: { file_ref: "f#0", page: 99 },
        documentIds: ["doc_1"],
      }),
      issue({ kind: "field", resultId: "r1", pointer: "/items" }),
      issue({ kind: "field", resultId: "r10", pointer: "/memo" }),
      issue({ kind: "document", stepId: null, documentId: "doc_1" }),
      issue({ kind: "job" }),
    ];
    expect(issuePageIndexes(issues, docPages, "doc_1", highlights)).toEqual([
      1, 2, 3,
    ]);
    expect(issuePageIndexes(issues, docPages, "doc_9", highlights)).toEqual([
      2, 3,
    ]);
    expect(issuePageIndexes(issues, docPages, null, highlights)).toEqual([
      2, 3,
    ]);
  });
});

describe("missingImageIndexes · pageMarksFor", () => {
  it("빈 URL 의 위치를 모은다", () => {
    expect(missingImageIndexes(["a", "", "b", ""])).toEqual([1, 3]);
    expect(missingImageIndexes([])).toEqual([]);
  });

  it("세 종류를 합치고 같은 (위치, 종류) 는 하나만 둔다", () => {
    const marks = pageMarksFor({
      entries: [setValue("r1", ["amount"]), setValue("r1", ["amount"])],
      highlights,
      issues: [
        issue({ kind: "field", resultId: "r1", pointer: "/amount" }),
        issue({
          kind: "page",
          stepId: null,
          groupId: "grp_1",
          page: { file_ref: "f#0", page: 5 },
          documentIds: ["doc_1"],
        }),
      ],
      docPages,
      documentId: "doc_1",
      imageUrls: ["", "x", ""],
    });
    expect(marks).toEqual([
      { index: 0, kind: "changed" },
      { index: 0, kind: "issue" },
      { index: 0, kind: "noImage" },
      { index: 2, kind: "noImage" },
    ]);
  });
});
