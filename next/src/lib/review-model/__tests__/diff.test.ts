import { describe, expect, it } from "vitest";

import {
  changedDocuments,
  changedResults,
  lockedDocumentIds,
  structureChanged,
  summarizeStructureReplacement,
  valueLockReason,
  type DocumentChange,
} from "../diff";
import {
  mergeDocuments,
  reorderDocuments,
  reorderPages,
  replaceStructure,
  setLabel,
  setValue,
  splitDocument,
  type EditResult,
} from "../edits";
import { ExactNumber } from "../json";
import { findResult, linkedDocumentIds } from "../layout";
import { readReviewDocument } from "../normalize";
import type { Layout, ReviewJob } from "../types";
import { singleJob } from "./fixtures/builders";
import { SINGLE_JOB } from "./fixtures/fixtures";

const S = "st_classify";

function ok(result: EditResult): ReviewJob {
  if (!result.ok) throw new Error(result.reason);
  return result.job;
}

function byId(changes: readonly DocumentChange[]) {
  return Object.fromEntries(changes.map(change => [change.documentId, change]));
}

describe("changedDocuments", () => {
  const { job } = singleJob();

  it("변경 없음", () => {
    expect(changedDocuments(job, job).every(c => c.status === "same")).toBe(
      true,
    );
    expect(structureChanged(job, job)).toBe(false);
  });

  it("라벨만", () => {
    const next = ok(setLabel(job, S, "doc_2", "invoice"));
    const changes = byId(changedDocuments(job, next));
    expect(changes.doc_2).toMatchObject({
      status: "changed",
      labelOnly: true,
      pageSetChanged: false,
      orderOnly: false,
    });
    expect(changes.doc_1!.status).toBe("same");
    expect(structureChanged(job, next)).toBe(true);
    expect(lockedDocumentIds(changedDocuments(job, next)).size).toBe(0);
  });

  it("페이지 순서만 — 기본은 잠그지 않고 lockOnOrderChange 면 잠근다", () => {
    const next = ok(
      reorderPages(job, S, "doc_2", { file_ref: "job_A#1", page: 1 }, 0),
    );
    const changes = changedDocuments(job, next);
    expect(byId(changes).doc_2).toMatchObject({
      status: "changed",
      orderOnly: true,
      pageSetChanged: false,
      labelOnly: false,
    });
    expect([...lockedDocumentIds(changes)]).toEqual([]);
    expect([
      ...lockedDocumentIds(changes, { lockOnOrderChange: true }),
    ]).toEqual(["doc_2"]);
  });

  it("문서 순서 — positionChanged", () => {
    const next = ok(reorderDocuments(job, S, "doc_3", 0));
    const changes = byId(changedDocuments(job, next));
    expect(changes.doc_3).toMatchObject({
      status: "changed",
      positionChanged: true,
    });
    expect(changes.doc_3!.pageSetChanged).toBe(false);
    expect(structureChanged(job, next)).toBe(true);
  });

  it("분리 — 원 문서는 집합 변경, 새 문서는 added", () => {
    const next = ok(
      splitDocument(
        job,
        S,
        "doc_1",
        { file_ref: "job_A#0", page: 1 },
        "review-doc-s",
      ),
    );
    const changes = changedDocuments(job, next);
    expect(byId(changes).doc_1).toMatchObject({
      status: "changed",
      pageSetChanged: true,
    });
    expect(byId(changes)["review-doc-s"]).toMatchObject({
      status: "added",
      pageSetChanged: true,
    });
    expect([...lockedDocumentIds(changes)].sort()).toEqual([
      "doc_1",
      "review-doc-s",
    ]);
  });

  it("합치기 — 사라진 문서는 removed 로 끝에", () => {
    const next = ok(mergeDocuments(job, S, "doc_1", "doc_2"));
    const changes = changedDocuments(job, next);
    expect(changes[changes.length - 1]).toMatchObject({
      documentId: "doc_2",
      status: "removed",
    });
    expect(byId(changes).doc_1!.pageSetChanged).toBe(true);
    // doc_3 은 남은 문서끼리의 상대 순서가 같다
    expect(byId(changes).doc_3!.status).toBe("same");
  });

  it("인접 범위 병합 표기 차이는 구조 변경이 아니다", () => {
    const split = readReviewDocument(
      SINGLE_JOB.replace(
        '"source_files": [{ "file_ref": "job_A#0", "page_ranges": [[1, 2]] }]',
        '"source_files": [{ "file_ref": "job_A#0", "page_ranges": [[1, 1], [2, 2]] }]',
      ),
    ).jobs[0]!;
    expect(structureChanged(job, split)).toBe(false);
    expect(changedDocuments(job, split).every(c => c.status === "same")).toBe(
      true,
    );
  });
});

describe("structureChanged — 그룹 구성", () => {
  const { job } = singleJob();
  const groups = job.file_groups!;

  it("layout_step_id·파일 순서가 다르면 구조 변경", () => {
    const group = groups.groups[0]!;
    const relinked: ReviewJob = {
      ...job,
      file_groups: {
        ...groups,
        groups: [{ ...group, layout_step_id: null }],
      },
    };
    expect(structureChanged(job, relinked)).toBe(true);
    const reordered: ReviewJob = {
      ...job,
      file_groups: {
        ...groups,
        groups: [{ ...group, files: [...group.files].reverse() }],
      },
    };
    expect(structureChanged(job, reordered)).toBe(true);
  });

  it("파일 이름 같은 읽기 전용 정보만 다르면 변경 아님", () => {
    const group = groups.groups[0]!;
    const renamed: ReviewJob = {
      ...job,
      file_groups: {
        ...groups,
        groups: [
          {
            ...group,
            files: group.files.map(file => ({ ...file, name: "x.pdf" })),
          },
        ],
      },
    };
    expect(structureChanged(job, renamed)).toBe(false);
  });
});

describe("summarizeStructureReplacement", () => {
  it("라벨·범위·추가·삭제·순서·그룹 설정을 세고 바뀐 문서를 순서대로 낸다", () => {
    const { job } = singleJob();
    const layout = job.output.find(item => !("id" in item)) as Layout;
    const [doc1, , doc3] = layout.content.documents;
    const after = ok(
      replaceStructure(
        job,
        { ...job.file_groups!, excluded_documents: ["doc_2"] },
        [
          {
            ...layout,
            content: {
              ...layout.content,
              documents: [
                {
                  ...doc3!,
                  source_files: [
                    { file_ref: "job_A#0", page_ranges: [[3, 3]] },
                    { file_ref: "job_A#1", page_ranges: [[2, 2]] },
                  ],
                },
                { ...doc1!, label: "bill" },
                {
                  document_id: "doc_new",
                  group_id: "grp_1",
                  label: "memo",
                  source_files: [
                    { file_ref: "job_A#1", page_ranges: [[1, 1]] },
                  ],
                },
              ],
            },
          },
        ],
      ),
    );
    const summary = summarizeStructureReplacement(job, after);
    expect(summary).toMatchObject({
      labelChanged: 1,
      rangesChanged: 1,
      added: 1,
      removed: 1,
      reordered: 2,
      groupsChanged: true,
    });
    expect(
      summary.documents.map(change => [
        change.documentId,
        change.status,
        change.position,
        change.before,
        change.after,
        change.labelChanged,
        change.rangesChanged,
        change.pageSetChanged,
      ]),
    ).toEqual([
      ["doc_3", "changed", 1, "contract", "contract", false, true, true],
      ["doc_1", "changed", 2, "invoice", "bill", true, false, false],
      ["doc_new", "added", 3, null, "memo", false, false, true],
      ["doc_2", "removed", 2, "receipt", null, false, false, true],
    ]);
  });

  it("같은 구조면 모두 0", () => {
    const { job } = singleJob();
    expect(summarizeStructureReplacement(job, job)).toEqual({
      labelChanged: 0,
      rangesChanged: 0,
      added: 0,
      removed: 0,
      reordered: 0,
      groupsChanged: false,
      documents: [],
    });
  });
});

describe("changedResults", () => {
  const { job } = singleJob();

  it("의미 동치(1000 vs 1000.0·1.0005e3, 키 순서)는 변경이 아니다", () => {
    const variant = readReviewDocument(
      SINGLE_JOB.replace(
        '"content": { "amount": 1000, "currency": "KRW" }',
        '"content": { "currency": "KRW", "amount": 1000.0 }',
      ).replace(
        '"content": { "total": 1000.50 }',
        '"content": { "total": 1.0005e3 }',
      ),
    ).jobs[0]!;
    expect(changedResults(job, variant)).toEqual([]);
  });

  it("값이 바뀐 결과만", () => {
    let next = ok(setValue(job, "occ_extract_1", ["currency"], "KRW"));
    next = ok(setValue(next, "occ_validate_1", [], "red"));
    expect(changedResults(job, next)).toEqual([
      "occ_extract_1",
      "occ_validate_1",
    ]);
    const sameNumber = ok(
      setValue(
        job,
        "occ_extract_1",
        ["lines", "0", "price"],
        new ExactNumber("10.50"),
      ),
    );
    expect(changedResults(job, sameNumber)).toEqual([]);
    expect(structureChanged(job, next)).toBe(false);
  });
});

describe("valueLockReason", () => {
  const { job } = singleJob();
  const extract1 = findResult(job, "occ_extract_1")!;
  const change = (patch: Partial<DocumentChange>): DocumentChange => ({
    jobId: "job_A",
    documentId: "doc_1",
    stepId: S,
    status: "changed",
    pageSetChanged: false,
    orderOnly: false,
    labelOnly: false,
    positionChanged: false,
    ...patch,
  });

  it("state 가 먼저", () => {
    expect(
      valueLockReason(
        findResult(job, "occ_extract_2")!,
        change({ pageSetChanged: true }),
      ),
    ).toBe("input_changed");
    expect(valueLockReason({ ...extract1, state: "unlinked" })).toBe(
      "unlinked",
    );
    expect(valueLockReason({ ...extract1, state: "missing" })).toBe("missing");
    expect(valueLockReason({ ...extract1, state: "archived" })).toBe(
      "unsupported_state",
    );
  });

  it("연결 문서의 페이지 집합이 바뀌었거나 사라졌으면 structure_changed", () => {
    expect(valueLockReason(extract1, change({ pageSetChanged: true }))).toBe(
      "structure_changed",
    );
    expect(valueLockReason(extract1, [change({ status: "removed" })])).toBe(
      "structure_changed",
    );
    expect(valueLockReason(extract1, change({ orderOnly: true }))).toBeNull();
    expect(valueLockReason(extract1, change({ labelOnly: true }))).toBeNull();
    expect(
      valueLockReason(findResult(job, "occ_validate_1")!, null),
    ).toBeNull();
  });

  it("linkedDocumentIds — documents·field_groups·none", () => {
    expect(linkedDocumentIds(extract1)).toEqual(["doc_1"]);
    expect(linkedDocumentIds(findResult(job, "occ_merge_1")!)).toEqual([
      "doc_1",
      "doc_2",
    ]);
    expect(linkedDocumentIds({ ...extract1, link: { kind: "none" } })).toEqual(
      [],
    );
  });
});
