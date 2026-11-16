import { describe, expect, it } from "vitest";

import { readReviewDocument, validateJob } from "@/lib/review-model";
import { MULTI_LAYOUT } from "@/lib/review-model/__tests__/fixtures/fixtures";

import type { FileEntry } from "../job-review-state";
import {
  buildStructureView,
  fileMoveOptions,
  groupBlockOf,
  pageRangeRows,
  sourcesFromRows,
} from "../structure-view";

// 테스트 리터럴만 담으므로 JSON.stringify 로 만들어도 정밀도 손실이 없다.
function doc() {
  return readReviewDocument(
    JSON.stringify({
      format: "collection-results/11",
      collection_id: "scol_1",
      configs: { cfg_1: { agent_id: null } },
      steps: {
        st_c: {
          config_id: "cfg_1",
          name: "Classify",
          type: "document-classify",
          labels: ["invoice", "receipt"],
        },
      },
      jobs: [
        {
          id: "job_1",
          file_groups: {
            base_version: 1,
            excluded_pages: [{ file_ref: "job_1#0", page_ranges: [[3, 3]] }],
            groups: [
              {
                group_id: "g1",
                layout_step_id: "st_c",
                files: [
                  {
                    file_ref: "job_1#0",
                    file_id: "file_a",
                    name: "a.pdf",
                    num_pages: 3,
                  },
                ],
              },
              {
                group_id: "g2",
                layout_step_id: "st_c",
                files: [
                  {
                    file_ref: "job_1#1",
                    file_id: "file_b",
                    name: "b.pdf",
                    num_pages: 2,
                  },
                ],
              },
            ],
          },
          output: [
            {
              step_id: "st_c",
              base_version: 1,
              content: {
                documents: [
                  {
                    document_id: "d1",
                    group_id: "g1",
                    label: "invoice",
                    source_files: [
                      { file_ref: "job_1#0", page_ranges: [[1, 2]] },
                    ],
                  },
                  {
                    document_id: "d2",
                    group_id: "g2",
                    label: "memo",
                    source_files: [
                      { file_ref: "job_1#1", page_ranges: [[1, 1]] },
                    ],
                  },
                  {
                    document_id: "d3",
                    group_id: "g1",
                    label: null,
                    source_files: [
                      { file_ref: "job_1#0", page_ranges: [[2, 3]] },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    }),
  );
}

const files: Record<string, FileEntry> = {
  "job_1#0": {
    fileId: "file_a",
    name: "a.pdf",
    status: "ready",
    numPages: 3,
    imageUrls: ["https://img.test/a1", "https://img.test/a2", null],
    parse: {},
    parseChunks: {},
  },
};

describe("buildStructureView", () => {
  const review = doc();
  const job = review.jobs[0]!;
  const view = buildStructureView({
    doc: review,
    job,
    files,
    issues: validateJob(review, job),
  });

  it("문서마다 띠를 만들고 썸네일·라벨 선택지를 붙인다", () => {
    expect(view.strips.map(strip => strip.documentId)).toEqual([
      "d1",
      "d2",
      "d3",
    ]);
    const [d1, d2] = view.strips;
    expect(d1!.pages.map(page => page.key)).toEqual(["job_1#0:1", "job_1#0:2"]);
    expect(d1!.pages[0]!.thumbnailUrl).toBe("https://img.test/a1");
    expect(d2!.pages[0]!.thumbnailUrl).toBeNull();
    expect(d1!.labelChoices).toEqual(["invoice", "receipt"]);
    expect(d1!.labelNotInConfig).toBe(false);
    expect(d2!.labelNotInConfig).toBe(true);
  });

  it("그룹이 바뀌는 자리에 경계를 둔다", () => {
    expect(view.groupBoundariesAfter).toEqual([0, 1]);
  });

  it("겹친 페이지·빠진 페이지·제외와 겹친 페이지를 표시한다", () => {
    const d1 = view.strips[0]!;
    const d3 = view.strips[2]!;
    expect(d1.pages[1]!.issue).toBe("overlap");
    expect(d1.pages[0]!.issue).toBeUndefined();
    expect(d3.pages.map(page => page.issue)).toEqual(["overlap", "overlap"]);
    expect(view.excluded).toEqual([
      expect.objectContaining({
        key: "job_1#0:3",
        groupId: "g1",
        issue: "overlap",
      }),
    ]);
    expect(view.unplaced).toEqual([
      expect.objectContaining({
        key: "job_1#1:2",
        groupId: "g2",
        issue: "missing",
      }),
    ]);
    expect(view.coverageUnknown).toBe(false);
  });

  it("totalPages 는 띠 + 제외 + 빠진 페이지 수", () => {
    // d1 2 + d2 1 + d3 2 = 5, 제외 1, 빠진 1.
    expect(view.totalPages).toBe(7);
  });
});

describe("buildStructureView — 배치 보기 고르기", () => {
  it("layoutStepId 를 주면 그 보기의 문서만 띠로 만든다", () => {
    const review = readReviewDocument(MULTI_LAYOUT);
    const job = review.jobs[0]!;
    const view = (layoutStepId?: string | null) =>
      buildStructureView({ doc: review, job, files, issues: [], layoutStepId })
        .strips.length;
    expect(view()).toBe(2);
    expect(view("st_classify_b")).toBe(1);
    expect(view(null)).toBe(0);
  });

  it("totalPages 도 고른 보기의 띠만 센다(제외 페이지는 보기와 무관)", () => {
    const review = readReviewDocument(MULTI_LAYOUT);
    const job = review.jobs[0]!;
    const total = (layoutStepId?: string | null) =>
      buildStructureView({ doc: review, job, files, issues: [], layoutStepId })
        .totalPages;
    const excludedCount = buildStructureView({
      doc: review,
      job,
      files,
      issues: [],
      layoutStepId: null,
    }).excluded.length;
    expect(total(null)).toBe(excludedCount);
    expect(total()).toBeGreaterThan(total("st_classify_b"));
    expect(total("st_classify_b")).toBeGreaterThan(total(null));
  });
});

describe("buildStructureView — 제외 문서", () => {
  it("excluded_documents 의 문서 띠에 excluded 를 붙이고, 그 페이지를 빠짐으로 보지 않는다", () => {
    const review = doc();
    const job = review.jobs[0]!;
    const excludedJob = {
      ...job,
      file_groups: { ...job.file_groups!, excluded_documents: ["d2"] },
    };
    const view = buildStructureView({
      doc: review,
      job: excludedJob,
      files,
      issues: validateJob(review, excludedJob),
    });
    expect(view.strips.map(strip => strip.excluded ?? false)).toEqual([
      false,
      true,
      false,
    ]);
    // d2 는 b.pdf 1쪽만 갖고 2쪽은 여전히 어디에도 없다.
    expect(view.unplaced.map(page => page.key)).toEqual(["job_1#1:2"]);
  });
});

describe("pageRangeRows·sourcesFromRows", () => {
  it("source_files 를 파일별 행으로, 행을 다시 source_files 로(순서 유지)", () => {
    const rows = pageRangeRows([
      {
        file_ref: "job_1#1",
        page_ranges: [
          [3, 3],
          [1, 2],
        ],
      },
      { file_ref: "job_1#0", page_ranges: [[5, 5]] },
    ]);
    expect(rows).toEqual([
      { fileRef: "job_1#1", text: "3, 1-2" },
      { fileRef: "job_1#0", text: "5" },
    ]);
    expect(sourcesFromRows(rows)).toEqual([
      {
        file_ref: "job_1#1",
        page_ranges: [
          [3, 3],
          [1, 2],
        ],
      },
      { file_ref: "job_1#0", page_ranges: [[5, 5]] },
    ]);
  });

  it("읽을 수 없는 행이 하나라도 있으면 null", () => {
    expect(
      sourcesFromRows([
        { fileRef: "job_1#0", text: "1-2" },
        { fileRef: "job_1#1", text: "3-1" },
      ]),
    ).toBeNull();
    expect(sourcesFromRows([{ fileRef: "job_1#0", text: "" }])).toBeNull();
  });
});

describe("fileMoveOptions", () => {
  it("다른 그룹마다 사유, 파일이 하나뿐인 그룹은 새 그룹 분리 불가", () => {
    const job = doc().jobs[0]!;
    expect(fileMoveOptions(job, "job_1#1")).toEqual({
      targets: [{ groupId: "g1", position: 1, reason: null }],
      newGroup: "target_missing",
    });
    expect(fileMoveOptions(job, "job_1#0")).toEqual({
      targets: [{ groupId: "g2", position: 2, reason: null }],
      newGroup: "target_missing",
    });
  });
});

describe("groupBlockOf", () => {
  const strips = ["g1", "g1", "g2", "g2", "g2", "g1"].map(groupId => ({
    groupId,
  }));

  it("같은 그룹이 이어진 구간을 돌려준다", () => {
    expect(groupBlockOf(strips, 0)).toEqual({ first: 0, last: 1 });
    expect(groupBlockOf(strips, 1)).toEqual({ first: 0, last: 1 });
    expect(groupBlockOf(strips, 3)).toEqual({ first: 2, last: 4 });
  });

  it("같은 그룹이 떨어진 자리에 있어도 이어진 구간만 본다", () => {
    expect(groupBlockOf(strips, 5)).toEqual({ first: 5, last: 5 });
  });

  it("그룹이 하나뿐이면 전체", () => {
    const single = [{ groupId: "g" }, { groupId: "g" }, { groupId: "g" }];
    expect(groupBlockOf(single, 1)).toEqual({ first: 0, last: 2 });
  });

  it("범위 밖 index 는 그 자리 하나", () => {
    expect(groupBlockOf(strips, 9)).toEqual({ first: 9, last: 9 });
    expect(groupBlockOf([], 0)).toEqual({ first: 0, last: 0 });
  });
});
