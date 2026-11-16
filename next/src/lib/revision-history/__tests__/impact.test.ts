import { describe, expect, it } from "vitest";

import {
  layouts,
  type ChangeDraft,
  type ReviewDocumentEntry,
} from "@/lib/review-model";

import { singleJob } from "../../review-model/__tests__/fixtures/builders";
import { structureImpact } from "../impact";

type StructureDraft = Extract<ChangeDraft, { kind: "replace_structure" }>;

const { job } = singleJob();

/** 지금 구조에서 문서 목록만 `edit` 로 바꾼 구조 draft. */
function draftWith(
  edit: (documents: readonly ReviewDocumentEntry[]) => ReviewDocumentEntry[],
): StructureDraft {
  return {
    kind: "replace_structure",
    jobId: job.id,
    fileGroups: job.file_groups!,
    layouts: layouts(job).map(layout => ({
      ...layout,
      content: { ...layout.content, documents: edit(layout.content.documents) },
    })),
  };
}

describe("structureImpact", () => {
  it("사라지는 문서와 그 문서에 연결된 결과를 보인다", () => {
    const impact = structureImpact(
      job,
      draftWith(documents => documents.filter(d => d.document_id !== "doc_2")),
    );
    expect(impact).toEqual({
      documents: [
        {
          documentId: "doc_2",
          label: "receipt",
          status: "removed",
          results: [
            { occurrenceId: "occ_extract_2", stepId: "st_extract" },
            { occurrenceId: "occ_merge_1", stepId: "st_merge" },
          ],
        },
      ],
      resultCount: 2,
    });
  });

  it("페이지 범위가 바뀐 문서는 pages", () => {
    const impact = structureImpact(
      job,
      draftWith(documents =>
        documents.map(d =>
          d.document_id === "doc_2"
            ? { ...d, source_files: [d.source_files[0]!] }
            : d.document_id === "doc_3"
              ? {
                  ...d,
                  source_files: [
                    { file_ref: "job_A#1", page_ranges: [[1, 2]] },
                  ],
                }
              : d,
        ),
      ),
    );
    expect(impact?.documents.map(d => [d.documentId, d.status])).toEqual([
      ["doc_2", "pages"],
      ["doc_3", "pages"],
    ]);
    expect(impact?.documents[1]!.results).toEqual([]);
    expect(impact?.resultCount).toBe(2);
  });

  it("새로 생기는 문서는 added 이고 연결 결과가 없다", () => {
    const impact = structureImpact(
      job,
      draftWith(documents => [
        ...documents.map(d =>
          d.document_id === "doc_3" ? { ...d, source_files: [] } : d,
        ),
        {
          document_id: "doc_4",
          group_id: "grp_1",
          label: "memo",
          source_files: [{ file_ref: "job_A#1", page_ranges: [[2, 2]] }],
        },
      ]),
    );
    expect(impact?.documents).toContainEqual({
      documentId: "doc_4",
      label: "memo",
      status: "added",
      results: [],
    });
  });

  it("라벨·순서만 바뀌면 영향이 없다", () => {
    const impact = structureImpact(
      job,
      draftWith(documents =>
        [...documents]
          .reverse()
          .map(d =>
            d.document_id === "doc_2" ? { ...d, label: "invoice" } : d,
          ),
      ),
    );
    expect(impact).toEqual({ documents: [], resultCount: 0 });
  });

  it("문서 배치 보기 집합이 다르면 null", () => {
    const draft = draftWith(documents => [...documents]);
    expect(
      structureImpact(job, {
        ...draft,
        layouts: draft.layouts.map(layout => ({
          ...layout,
          step_id: "st_other",
        })),
      }),
    ).toBeNull();
    expect(structureImpact(job, { ...draft, layouts: [] })).toBeNull();
  });

  it("여러 문서에 걸린 결과는 한 번만 센다", () => {
    const impact = structureImpact(
      job,
      draftWith(documents => documents.filter(d => d.document_id === "doc_3")),
    );
    expect(impact?.documents.map(d => d.documentId)).toEqual([
      "doc_1",
      "doc_2",
    ]);
    // doc_1: extract_1 · validate_1 · merge_1, doc_2: extract_2 · merge_1
    expect(impact?.resultCount).toBe(4);
  });
});
