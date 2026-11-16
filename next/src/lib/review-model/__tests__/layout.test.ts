import { describe, expect, it } from "vitest";

import {
  DOCUMENT_ID_PATTERN,
  canEditResult,
  documentsOf,
  findDocument,
  findLayout,
  findResult,
  groupOf,
  groupOfFile,
  hasSplitDocuments,
  isMultiLayout,
  labelChoices,
  layouts,
  newDocumentId,
  resultsForDocument,
  unlinkedResults,
} from "../layout";
import { readReviewDocument } from "../normalize";
import type { ReviewJob } from "../types";
import { MULTI_LAYOUT, NO_LOOKUPS, SINGLE_JOB } from "./fixtures/fixtures";

describe("layout 조회", () => {
  const single = readReviewDocument(SINGLE_JOB);
  const jobA = single.jobs[0]!;
  const multi = readReviewDocument(MULTI_LAYOUT);
  const jobM = multi.jobs[0]!;

  it("단일 보기", () => {
    expect(layouts(jobA).map(layout => layout.step_id)).toEqual([
      "st_classify",
    ]);
    expect(isMultiLayout(jobA)).toBe(false);
    expect(findDocument(jobA, "st_classify", "doc_2")?.label).toBe("receipt");
    expect(findDocument(jobA, null, "doc_2")).toBeNull();
    expect(findLayout(jobA, "st_other")).toBeNull();
  });

  it("멀티 layout — 같은 document_id 를 (stepId, documentId) 로 구분", () => {
    expect(isMultiLayout(jobM)).toBe(true);
    expect(findDocument(jobM, "st_classify_a", "doc_1")?.group_id).toBe(
      "grp_a",
    );
    expect(findDocument(jobM, "st_classify_b", "doc_1")?.group_id).toBe(
      "grp_b",
    );
    expect(
      documentsOf(jobM).map(item => [
        item.stepId,
        item.index,
        item.document.document_id,
      ]),
    ).toEqual([
      ["st_classify_a", 0, "doc_1"],
      ["st_classify_b", 0, "doc_1"],
    ]);
  });

  it("step_id: null 보기", () => {
    const jobN = readReviewDocument(NO_LOOKUPS).jobs[0]!;
    expect(findLayout(jobN, null)?.content.documents[0]?.document_id).toBe(
      "doc_n",
    );
    expect(findDocument(jobN, null, "doc_n")?.label).toBeNull();
  });

  it("그룹 조회", () => {
    expect(groupOf(jobA, "grp_1")?.files).toHaveLength(2);
    expect(groupOf(jobA, "grp_x")).toBeNull();
    expect(groupOfFile(jobM, "job_M#1")?.group_id).toBe("grp_b");
    expect(groupOfFile(jobM, "job_X#0")).toBeNull();
    const valuesOnly = readReviewDocument(NO_LOOKUPS).jobs[1]!;
    expect(groupOf(valuesOnly, "grp_1")).toBeNull();
  });

  it("resultsForDocument 는 document_ids 와 Merge 결과의 field_groups 를 함께 본다", () => {
    expect(resultsForDocument(jobA, "doc_1").map(result => result.id)).toEqual([
      "occ_extract_1",
      "occ_merge_1",
      "occ_validate_1",
    ]);
    expect(resultsForDocument(jobA, "doc_2").map(result => result.id)).toEqual([
      "occ_extract_2",
      "occ_merge_1",
    ]);
    expect(resultsForDocument(jobA, "doc_3")).toEqual([]);
  });

  it("unlinkedResults 는 연결 없는 결과만", () => {
    expect(unlinkedResults(jobA)).toEqual([]);
    const merge = findResult(jobA, "occ_merge_1")!;
    const unlinked = {
      ...merge,
      id: "occ_none",
      link: { kind: "none" } as const,
    };
    const job = { ...jobA, output: [...jobA.output, unlinked] };
    expect(unlinkedResults(job).map(result => result.id)).toEqual(["occ_none"]);
    expect(
      resultsForDocument(job, "doc_1").map(result => result.id),
    ).not.toContain("occ_none");
  });
});

describe("labelChoices", () => {
  it("보기 Step 의 labels", () => {
    const doc = readReviewDocument(SINGLE_JOB);
    expect(labelChoices(doc, doc.jobs[0]!, "doc_1")).toEqual([
      "invoice",
      "receipt",
      "contract",
    ]);
  });

  it("labels 없음·step_id null·없는 문서면 null", () => {
    const multi = readReviewDocument(MULTI_LAYOUT);
    expect(
      labelChoices(multi, multi.jobs[0]!, "doc_1", "st_classify_b"),
    ).toBeNull();
    expect(
      labelChoices(multi, multi.jobs[0]!, "doc_1", "st_classify_a"),
    ).toEqual(["invoice"]);
    const none = readReviewDocument(NO_LOOKUPS);
    expect(labelChoices(none, none.jobs[0]!, "doc_n")).toBeNull();
    expect(labelChoices(none, none.jobs[0]!, "doc_missing")).toBeNull();
  });
});

describe("canEditResult·newDocumentId", () => {
  it("present·stale 만 편집 가능", () => {
    expect(canEditResult({ state: "present" })).toBe(true);
    expect(canEditResult({ state: "stale" })).toBe(true);
    for (const state of [
      "input_changed",
      "unlinked",
      "missing",
      "future_state",
    ]) {
      expect(canEditResult({ state })).toBe(false);
    }
  });

  it("review-doc-<uuid> 47 자, 문서 id 패턴 안", () => {
    const id = newDocumentId(() => "123e4567-e89b-12d3-a456-426614174000");
    expect(id).toBe("review-doc-123e4567-e89b-12d3-a456-426614174000");
    expect(id).toHaveLength(47);
    expect(DOCUMENT_ID_PATTERN.test(id)).toBe(true);
  });
});

describe("hasSplitDocuments", () => {
  type Doc = {
    id: string;
    group: string;
    pages: [string, number, number][];
  };

  /** 그룹마다 파일 하나(`job_S#<i>`)를 둔 작은 Job. `pages` 가 `null` 이면 `num_pages` 를 뺀다. */
  function buildJob(options: {
    groups: { id: string; pages: number | null; layout?: string }[];
    documents: Doc[];
    excludedDocuments?: string[];
    excludedPages?: [string, number, number][];
    withFileGroups?: boolean;
  }): ReviewJob {
    const fileGroups = {
      base_version: 1,
      groups: options.groups.map((group, index) => ({
        group_id: group.id,
        layout_step_id: group.layout ?? "st_classify",
        files: [
          {
            file_ref: `job_S#${index}`,
            file_id: `f${index}`,
            name: `${index}.pdf`,
            ...(group.pages === null ? {} : { num_pages: group.pages }),
          },
        ],
      })),
      excluded_pages: (options.excludedPages ?? []).map(
        ([fileRef, first, last]) => ({
          file_ref: fileRef,
          page_ranges: [[first, last]],
        }),
      ),
      excluded_documents: options.excludedDocuments ?? [],
    };
    const doc = readReviewDocument(
      JSON.stringify({
        format: "collection-results/11",
        collection_id: "scol_test",
        configs: { cfg_1: { agent_id: null } },
        steps: {
          st_classify: {
            config_id: "cfg_1",
            name: "분류",
            type: "document-classify",
          },
        },
        jobs: [
          {
            id: "job_S",
            ...(options.withFileGroups === false
              ? {}
              : { file_groups: fileGroups }),
            output: [
              {
                step_id: "st_classify",
                base_version: 1,
                content: {
                  documents: options.documents.map(document => ({
                    document_id: document.id,
                    group_id: document.group,
                    label: null,
                    source_files: document.pages.map(
                      ([fileRef, first, last]) => ({
                        file_ref: fileRef,
                        page_ranges: [[first, last]],
                      }),
                    ),
                  })),
                },
              },
            ],
          },
        ],
      }),
    );
    return doc.jobs[0]!;
  }

  it("한 그룹에 문서가 둘 이상이면 나뉜 Job", () => {
    expect(hasSplitDocuments(readReviewDocument(SINGLE_JOB).jobs[0]!)).toBe(
      true,
    );
  });

  it("그룹마다 문서 하나가 파일 전체를 덮으면 나뉘지 않은 Job", () => {
    const job = buildJob({
      groups: [
        { id: "g1", pages: 3 },
        { id: "g2", pages: 2 },
      ],
      documents: [
        { id: "d1", group: "g1", pages: [["job_S#0", 1, 3]] },
        { id: "d2", group: "g2", pages: [["job_S#1", 1, 2]] },
      ],
    });
    expect(hasSplitDocuments(job)).toBe(false);
  });

  it("문서 하나가 일부 페이지만 덮으면(나머지 제외) 나뉜 Job", () => {
    const job = buildJob({
      groups: [{ id: "g1", pages: 3 }],
      documents: [{ id: "d1", group: "g1", pages: [["job_S#0", 1, 2]] }],
      excludedPages: [["job_S#0", 3, 3]],
    });
    expect(hasSplitDocuments(job)).toBe(true);
  });

  it("num_pages 를 모르면 문서 하나는 나뉘지 않은 것으로 본다", () => {
    const job = buildJob({
      groups: [{ id: "g1", pages: null }],
      documents: [{ id: "d1", group: "g1", pages: [["job_S#0", 1, 2]] }],
    });
    expect(hasSplitDocuments(job)).toBe(false);
  });

  it("file_groups 가 없으면 false", () => {
    const job = buildJob({
      groups: [{ id: "g1", pages: 3 }],
      documents: [
        { id: "d1", group: "g1", pages: [["job_S#0", 1, 1]] },
        { id: "d2", group: "g1", pages: [["job_S#0", 2, 3]] },
      ],
      withFileGroups: false,
    });
    expect(hasSplitDocuments(job)).toBe(false);
  });

  it("그룹의 layout_step_id 보기가 없으면 false", () => {
    const job = buildJob({
      groups: [{ id: "g1", pages: 3, layout: "st_missing" }],
      documents: [
        { id: "d1", group: "g1", pages: [["job_S#0", 1, 1]] },
        { id: "d2", group: "g1", pages: [["job_S#0", 2, 3]] },
      ],
    });
    expect(hasSplitDocuments(job)).toBe(false);
  });

  it("제외 문서도 문서 수에 넣는다", () => {
    const job = buildJob({
      groups: [{ id: "g1", pages: 3 }],
      documents: [
        { id: "d1", group: "g1", pages: [["job_S#0", 1, 3]] },
        { id: "d2", group: "g1", pages: [["job_S#0", 3, 3]] },
      ],
      excludedDocuments: ["d2"],
    });
    expect(hasSplitDocuments(job)).toBe(true);
  });

  it("멀티 layout 은 그룹마다 그 그룹 보기 기준으로 판정한다", () => {
    // 그룹 2 개가 각자 다른 보기에서 문서 하나(파일 전체) — 보기 전체로는 문서가 둘이어도 나뉘지 않음.
    expect(hasSplitDocuments(readReviewDocument(MULTI_LAYOUT).jobs[0]!)).toBe(
      false,
    );
  });
});
