import { describe, expect, it } from "vitest";

import { singleJob } from "../../review-model/__tests__/fixtures/builders";
import type { StructureContent } from "../draft";
import { diffStructure } from "../diff-structure";
import { structureOf } from "./helpers";

const { job } = singleJob();
const BASE = structureOf(job);

function withDocuments(
  map: (
    documents: StructureContent["documents"],
  ) => StructureContent["documents"],
  content: StructureContent = BASE,
): StructureContent {
  return { ...content, documents: map(content.documents) };
}

function withGroups(
  fileGroups: Partial<StructureContent["file_groups"]>,
  content: StructureContent = BASE,
): StructureContent {
  return { ...content, file_groups: { ...content.file_groups, ...fileGroups } };
}

const kinds = (before: StructureContent, after: StructureContent) =>
  diffStructure(before, after).map(change => change.kind);

describe("diffStructure", () => {
  it("같으면 빈 배열", () => {
    expect(diffStructure(BASE, structureOf(job))).toEqual([]);
  });

  it("파일 추가·제거·그룹 이동", () => {
    const [group] = BASE.file_groups.groups;
    const [first, second] = group!.files;
    const moved = withGroups({
      groups: [
        { ...group!, files: [first!] },
        { group_id: "grp_2", layout_step_id: "st_classify", files: [second!] },
      ],
    });
    expect(diffStructure(BASE, moved)).toEqual([
      {
        kind: "fileMoved",
        fileRef: "job_A#1",
        name: "b.pdf",
        fromGroupId: "grp_1",
        toGroupId: "grp_2",
      },
    ]);
    const added = withGroups({
      groups: [
        {
          ...group!,
          files: [
            first!,
            second!,
            { file_ref: "job_A#2", file_id: "file_3", name: "c.pdf" },
          ],
        },
      ],
    });
    expect(diffStructure(BASE, added)).toEqual([
      {
        kind: "fileAdded",
        fileRef: "job_A#2",
        name: "c.pdf",
        groupId: "grp_1",
      },
    ]);
    expect(diffStructure(added, BASE)).toEqual([
      {
        kind: "fileRemoved",
        fileRef: "job_A#2",
        name: "c.pdf",
        groupId: "grp_1",
      },
    ]);
  });

  it("문서 추가·삭제", () => {
    const extra = withDocuments(documents => [
      ...documents,
      {
        document_id: "doc_4",
        step_id: "st_classify",
        group_id: "grp_1",
        label: null,
        source_files: [{ file_ref: "job_A#1", page_ranges: [[2, 2]] }],
      },
    ]);
    expect(diffStructure(BASE, extra)).toEqual([
      {
        kind: "documentAdded",
        documentId: "doc_4",
        stepId: "st_classify",
        label: null,
      },
    ]);
    expect(diffStructure(extra, BASE)).toEqual([
      {
        kind: "documentRemoved",
        documentId: "doc_4",
        stepId: "st_classify",
        label: null,
      },
    ]);
  });

  it("라벨·그룹·페이지 범위 변경", () => {
    const after = withDocuments(documents =>
      documents.map(document =>
        document.document_id === "doc_2"
          ? { ...document, label: "invoice", group_id: "grp_2" }
          : document.document_id === "doc_1"
            ? {
                ...document,
                source_files: [{ file_ref: "job_A#0", page_ranges: [[1, 1]] }],
              }
            : document,
      ),
    );
    expect(diffStructure(BASE, after)).toEqual([
      {
        kind: "documentPages",
        documentId: "doc_1",
        stepId: "st_classify",
        label: "invoice",
        before: [{ file_ref: "job_A#0", page_ranges: [[1, 2]] }],
        after: [{ file_ref: "job_A#0", page_ranges: [[1, 1]] }],
      },
      {
        kind: "documentLabel",
        documentId: "doc_2",
        stepId: "st_classify",
        from: "receipt",
        to: "invoice",
      },
      {
        kind: "documentMoved",
        documentId: "doc_2",
        stepId: "st_classify",
        label: "invoice",
        fromGroupId: "grp_1",
        toGroupId: "grp_2",
      },
    ]);
  });

  it("인접 범위 표기만 다르면 페이지 변경이 아니고, 순서만 다르면 페이지 변경", () => {
    const split = withDocuments(documents =>
      documents.map(document =>
        document.document_id === "doc_1"
          ? {
              ...document,
              source_files: [
                {
                  file_ref: "job_A#0",
                  page_ranges: [
                    [1, 1],
                    [2, 2],
                  ],
                },
              ],
            }
          : document,
      ),
    );
    expect(diffStructure(BASE, split)).toEqual([]);
    const reversed = withDocuments(documents =>
      documents.map(document =>
        document.document_id === "doc_1"
          ? {
              ...document,
              source_files: [
                {
                  file_ref: "job_A#0",
                  page_ranges: [
                    [2, 2],
                    [1, 1],
                  ],
                },
              ],
            }
          : document,
      ),
    );
    expect(kinds(BASE, reversed)).toEqual(["documentPages"]);
  });

  it("문서 순서 변경은 보기마다 한 줄", () => {
    const reordered = withDocuments(documents => [...documents].reverse());
    expect(diffStructure(BASE, reordered)).toEqual([
      { kind: "documentsReordered", stepId: "st_classify" },
    ]);
  });

  it("문서 제외·제외 해제", () => {
    const excluded = withGroups({ excluded_documents: ["doc_3"] });
    expect(diffStructure(BASE, excluded)).toEqual([
      { kind: "documentExcluded", documentId: "doc_3", label: "contract" },
    ]);
    expect(diffStructure(excluded, BASE)).toEqual([
      { kind: "documentIncluded", documentId: "doc_3", label: "contract" },
    ]);
  });

  it("페이지 제외·제외 해제는 바뀐 페이지만 묶어서", () => {
    const before = withGroups({
      excluded_pages: [{ file_ref: "job_A#0", page_ranges: [[3, 3]] }],
    });
    const after = withGroups({
      excluded_pages: [{ file_ref: "job_A#1", page_ranges: [[1, 2]] }],
    });
    expect(diffStructure(before, after)).toEqual([
      {
        kind: "pagesExcluded",
        pages: [{ file_ref: "job_A#1", page_ranges: [[1, 2]] }],
      },
      {
        kind: "pagesIncluded",
        pages: [{ file_ref: "job_A#0", page_ranges: [[3, 3]] }],
      },
    ]);
  });

  it("출력 순서는 파일 → 문서 → 제외", () => {
    const [group] = BASE.file_groups.groups;
    const after = withGroups(
      {
        groups: [
          {
            ...group!,
            files: [...group!.files, { file_ref: "job_A#2", file_id: "f3" }],
          },
        ],
        excluded_documents: ["doc_1"],
      },
      withDocuments(documents =>
        documents.map(document =>
          document.document_id === "doc_3"
            ? { ...document, label: null }
            : document,
        ),
      ),
    );
    expect(kinds(BASE, after)).toEqual([
      "fileAdded",
      "documentLabel",
      "documentExcluded",
    ]);
  });
});
