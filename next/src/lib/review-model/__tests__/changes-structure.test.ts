import { describe, expect, it } from "vitest";

import {
  STRUCTURE_GROUP_ID,
  addChange,
  createSession,
  describeChange,
  entryTargets,
  isValueEntry,
  revertChange,
  type ChangeDraft,
  type ReviewSession,
} from "../changes";
import { documentsOf, findDocument } from "../layout";
import type { Layout, ReviewDocument, SourceRange } from "../types";
import { validateStructure } from "../validate";
import { singleJob, twoGroupDoc } from "./fixtures/builders";

const J = "job_A";
const S = "st_classify";
const NEW_ID = "review-doc-new";

function add(session: ReviewSession, draft: ChangeDraft): ReviewSession {
  const outcome = addChange(session, draft);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.session;
}

const ids = (doc: ReviewDocument) =>
  documentsOf(doc.jobs[0]!).map(item => item.document.document_id);

const RANGES: SourceRange[] = [
  { file_ref: "job_A#0", page_ranges: [[3, 3]] },
  {
    file_ref: "job_A#1",
    page_ranges: [
      [1, 1],
      [2, 2],
    ],
  },
];

const setRanges: ChangeDraft = {
  kind: "set_page_ranges",
  jobId: J,
  stepId: S,
  documentId: "doc_2",
  sourceFiles: RANGES,
};

const addDoc: ChangeDraft = {
  kind: "add_document",
  jobId: J,
  stepId: S,
  newDocumentId: NEW_ID,
  groupId: "grp_1",
  label: "memo",
  sourceFiles: [{ file_ref: "job_A#1", page_ranges: [[1, 2]] }],
  index: 3,
};

const A = "job_A#0";
const B = "job_A#1";

/** `set_page_ranges` draft. `sources` 는 [파일, [first, last][]] 목록. */
function setDoc(
  documentId: string,
  sources: [string, [number, number][]][],
): ChangeDraft {
  return {
    kind: "set_page_ranges",
    jobId: J,
    stepId: S,
    documentId,
    sourceFiles: sources.map(([file_ref, page_ranges]) => ({
      file_ref,
      page_ranges,
    })),
  };
}

// doc_2(receipt = a3, b1)에 doc_1(invoice = a1-2)의 a2 를 가져온다 → doc_1 = a1
const e1 = setDoc("doc_2", [
  [A, [[3, 3]]],
  [B, [[1, 1]]],
  [A, [[2, 2]]],
]);
// e1 뒤 doc_1 에 a3 을 더한다(doc_2 에서 가져옴) → doc_1 = a1, a3 · doc_2 = b1, a2
const e2 = setDoc("doc_1", [
  [
    A,
    [
      [1, 1],
      [3, 3],
    ],
  ],
]);

/** 문서의 페이지를 "a1"·"b2" 꼴로. 없으면 null. */
function pagesOf(doc: ReviewDocument, documentId: string): string[] | null {
  const document = findDocument(doc.jobs[0]!, S, documentId);
  if (!document) return null;
  return document.source_files.flatMap(source =>
    source.page_ranges.flatMap(([first, last]) =>
      Array.from(
        { length: last - first + 1 },
        (_, offset) => `${source.file_ref === A ? "a" : "b"}${first + offset}`,
      ),
    ),
  );
}

function revertedKinds(
  alsoReverted: ReturnType<typeof revertChange>["alsoReverted"],
) {
  return alsoReverted.map(item => [item.entry.id, item.reason]);
}

describe("describeChange — 구조 종류", () => {
  const { doc } = singleJob();

  it("set_page_ranges: 전·후 범위 원본과 문자열, 가져온 페이지와 지워진 문서", () => {
    expect(describeChange(doc, setRanges)).toEqual({
      documentLabel: "receipt",
      documentIds: ["doc_2", "doc_3"],
      takenFrom: [{ documentId: "doc_3", label: "contract", count: 1 }],
      removedDocuments: [{ documentId: "doc_3", label: "contract" }],
      beforeSourceFiles: [
        { file_ref: "job_A#0", page_ranges: [[3, 3]] },
        { file_ref: "job_A#1", page_ranges: [[1, 1]] },
      ],
      before: "3; 1",
      sourceFiles: RANGES,
      after: "3; 1, 2",
    });
  });

  it("add_document: 새 문서 id·라벨·페이지, 가져온 페이지", () => {
    expect(describeChange(doc, addDoc)).toMatchObject({
      documentLabel: "memo",
      documentIds: [NEW_ID, "doc_2", "doc_3"],
      takenFrom: [
        { documentId: "doc_2", label: "receipt", count: 1 },
        { documentId: "doc_3", label: "contract", count: 1 },
      ],
      removedDocuments: [{ documentId: "doc_3", label: "contract" }],
      pageRefs: [
        { file_ref: "job_A#1", page: 1 },
        { file_ref: "job_A#1", page: 2 },
      ],
      after: "1-2",
    });
  });

  it("set_page_ranges: 다른 문서에서 가져온 페이지만 기록하고 이미 있던 페이지는 세지 않는다", () => {
    expect(describeChange(doc, e1)).toMatchObject({
      before: "3; 1",
      after: "3; 1; 2",
      documentIds: ["doc_2", "doc_1"],
      takenFrom: [{ documentId: "doc_1", label: "invoice", count: 1 }],
    });
    expect(describeChange(doc, e1)).not.toHaveProperty("removedDocuments");
    const after1 = add(createSession(doc), e1).current;
    expect(describeChange(after1, e2)).toMatchObject({
      before: "1",
      after: "1, 3",
      documentIds: ["doc_1", "doc_2"],
      takenFrom: [{ documentId: "doc_2", label: "receipt", count: 1 }],
    });
    const after2 = add(add(createSession(doc), e1), e2).current;
    expect(pagesOf(after2, "doc_1")).toEqual(["a1", "a3"]);
    expect(pagesOf(after2, "doc_2")).toEqual(["b1", "a2"]);
    expect(pagesOf(after2, "doc_3")).toEqual(["b2"]);
  });

  it("set_page_ranges: 제외 페이지에서 가져오면 fromExcluded", () => {
    const excluded = add(createSession(doc), {
      kind: "exclude_pages",
      jobId: J,
      stepId: S,
      fromDocumentId: "doc_1",
      pages: [{ file_ref: "job_A#0", page: 2 }],
    }).current;
    const description = describeChange(excluded, e1);
    expect(description).toMatchObject({
      documentIds: ["doc_2"],
      fromExcluded: 1,
    });
    expect(description).not.toHaveProperty("takenFrom");
  });

  it("exclude_document·restore_document: 보기에서 id 로 라벨을 찾는다", () => {
    for (const kind of ["exclude_document", "restore_document"] as const) {
      expect(
        describeChange(doc, { kind, jobId: J, documentId: "doc_3" }),
      ).toEqual({ documentLabel: "contract", documentIds: ["doc_3"] });
    }
  });

  it("restore_pages 새 문서: 새 id 로 묶고 라벨 없음", () => {
    expect(
      describeChange(twoGroupDoc(), {
        kind: "restore_pages",
        jobId: "job_G",
        stepId: S,
        pages: [{ file_ref: "job_G#0", page: 2 }],
        to: { newDocumentId: NEW_ID, afterDocumentId: "doc_a" },
      }),
    ).toEqual({
      documentLabel: null,
      documentIds: [NEW_ID],
      pageRefs: [{ file_ref: "job_G#0", page: 2 }],
    });
  });

  it("restore_pages 새 문서 + to.label: 고른 라벨", () => {
    expect(
      describeChange(twoGroupDoc(), {
        kind: "restore_pages",
        jobId: "job_G",
        stepId: S,
        pages: [{ file_ref: "job_G#0", page: 2 }],
        to: { newDocumentId: NEW_ID, afterDocumentId: "doc_a", label: "B" },
      }),
    ).toMatchObject({ documentLabel: "B", documentIds: [NEW_ID] });
  });

  it("move_pages 새 문서: otherDocumentLabel 은 to.label, 없으면 원본 라벨", () => {
    const draft = (label?: string | null): ChangeDraft => ({
      kind: "move_pages",
      jobId: J,
      stepId: S,
      fromDocumentId: "doc_2",
      pages: [{ file_ref: "job_A#1", page: 1 }],
      to:
        label === undefined
          ? { newDocumentId: NEW_ID, afterDocumentId: "doc_2" }
          : { newDocumentId: NEW_ID, afterDocumentId: "doc_2", label },
    });
    expect(describeChange(doc, draft("B"))).toMatchObject({
      documentLabel: "receipt",
      otherDocumentLabel: "B",
    });
    expect(describeChange(doc, draft(null))).toMatchObject({
      otherDocumentLabel: null,
    });
    expect(describeChange(doc, draft())).toMatchObject({
      otherDocumentLabel: "receipt",
    });
  });
});

describe("세션 — 구조 종류", () => {
  it("구조 종류는 값 항목이 아니고 결과 대상이 없다", () => {
    const session = add(createSession(singleJob().doc), addDoc);
    const entry = session.entries[0]!;
    expect(isValueEntry(entry)).toBe(false);
    expect(entryTargets(entry)).toEqual({
      documentIds: [NEW_ID, "doc_2", "doc_3"],
      resultIds: [],
    });
  });

  it("add_document 를 되돌리면 그 문서를 고친 뒤 항목도 빠진다", () => {
    let session = add(createSession(singleJob().doc), addDoc);
    session = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: NEW_ID,
      label: "other",
    });
    session = add(session, {
      kind: "exclude_document",
      jobId: J,
      documentId: "doc_1",
    });
    // 새 문서가 job_A#1:2 를 가져가 doc_3 은 비어 지워진다
    expect(ids(session.current)).toEqual(["doc_1", "doc_2", NEW_ID]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(ids(next.current)).toEqual(["doc_1", "doc_2", "doc_3"]);
    expect(alsoReverted.map(item => [item.entry.kind, item.reason])).toEqual([
      ["set_label", "document_missing"],
    ]);
    expect(next.entries.map(entry => entry.kind)).toEqual(["exclude_document"]);
    expect(next.current.jobs[0]!.file_groups!.excluded_documents).toEqual([
      "doc_1",
    ]);
  });

  it("exclude_document 뒤 restore_document 는 제외 목록을 원래대로 돌린다", () => {
    const { doc } = singleJob();
    let session = add(createSession(doc), {
      kind: "exclude_document",
      jobId: J,
      documentId: "doc_2",
    });
    expect(
      addChange(session, {
        kind: "exclude_document",
        jobId: J,
        documentId: "doc_2",
      }),
    ).toEqual({ ok: false, reason: "already_excluded" });
    session = add(session, {
      kind: "restore_document",
      jobId: J,
      documentId: "doc_2",
    });
    expect(session.current.jobs[0]!.file_groups).toEqual(
      doc.jobs[0]!.file_groups,
    );
    // 제외하고 다시 복귀하면 불러온 상태와 같아지므로 변경 항목이 남지 않는다.
    expect(session.entries).toEqual([]);
    expect(session.current).toBe(session.base);
  });

  it("제외와 복귀 사이에 다른 변경이 있으면 제외를 되돌릴 때 뒤의 복귀도 함께 빠진다", () => {
    const { doc } = singleJob();
    let session = add(createSession(doc), {
      kind: "exclude_document",
      jobId: J,
      documentId: "doc_2",
    });
    session = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "receipt",
    });
    session = add(session, {
      kind: "restore_document",
      jobId: J,
      documentId: "doc_2",
    });
    expect(session.entries).toHaveLength(3);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted.map(item => item.reason)).toEqual(["target_missing"]);
    expect(next.entries.map(entry => entry.kind)).toEqual(["set_label"]);
  });

  it("공백뿐인 라벨 항목은 null 로 기록되고, 처음 라벨로 돌아오면 항목이 지워진다", () => {
    const { doc } = singleJob();
    const session = add(createSession(doc), {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "  ",
    });
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0]).toMatchObject({
      label: null,
      description: { before: "invoice", after: null },
    });
    const cleared = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "invoice",
    });
    expect(cleared.entries).toEqual([]);
  });

  it("set_page_ranges 는 적용되고 되돌리면 base 로 돌아간다", () => {
    const { doc } = singleJob();
    const session = add(createSession(doc), setRanges);
    expect(session.entries[0]!.description.after).toBe("3; 1, 2");
    // doc_3 의 job_A#1:2 를 옮겨 와 doc_3 이 지워지고, 되돌리면 다시 생긴다
    expect(ids(session.current)).toEqual(["doc_1", "doc_2"]);
    const { session: reverted } = revertChange(session, session.entries[0]!.id);
    expect(reverted.current).toBe(doc);
  });
});

describe("되돌리기 — 페이지 집합을 바꾼 구조 항목의 연쇄", () => {
  it("앞 범위 편집에 기댄 뒤 범위 편집이 함께 빠진다", () => {
    const { doc } = singleJob();
    const session = add(add(createSession(doc), e1), e2);
    const [first, second] = session.entries;
    const { session: next, alsoReverted } = revertChange(session, first!.id);
    expect(revertedKinds(alsoReverted)).toEqual([
      [second!.id, "depends_on_reverted"],
    ]);
    expect(next.entries).toEqual([]);
    expect(next.current).toBe(doc);
    expect(
      validateStructure(next.current.jobs[0]!).filter(
        issue => issue.code === "page_missing",
      ),
    ).toEqual([]);
  });

  it("뒤 항목만 되돌리면 앞 항목은 남는다", () => {
    const { doc } = singleJob();
    const session = add(add(createSession(doc), e1), e2);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[1]!.id,
    );
    expect(alsoReverted).toEqual([]);
    expect(pagesOf(next.current, "doc_1")).toEqual(["a1"]);
    expect(pagesOf(next.current, "doc_2")).toEqual(["a3", "b1", "a2"]);
  });

  it("앞 항목이 바꾼 문서에서 페이지만 가져오는 뒤 항목은 남는다", () => {
    const { doc } = singleJob();
    const session = add(
      add(createSession(doc), e1),
      setDoc("doc_3", [
        [B, [[2, 2]]],
        [A, [[1, 1]]],
      ]),
    );
    // 두 번째 항목이 doc_1 의 마지막 페이지 a1 을 가져가 doc_1 이 지워진다
    expect(ids(session.current)).toEqual(["doc_2", "doc_3"]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted).toEqual([]);
    expect(ids(next.current)).toEqual(["doc_1", "doc_2", "doc_3"]);
    expect(pagesOf(next.current, "doc_1")).toEqual(["a2"]);
    expect(pagesOf(next.current, "doc_2")).toEqual(["a3", "b1"]);
    expect(pagesOf(next.current, "doc_3")).toEqual(["b2", "a1"]);
    expect(next.entries[0]!.description.takenFrom).toEqual([
      { documentId: "doc_1", label: "invoice", count: 1 },
    ]);
    expect(next.entries[0]!.description).not.toHaveProperty("removedDocuments");
  });

  it("add_document 는 연쇄하지 않는다", () => {
    const { doc } = singleJob();
    const session = add(add(createSession(doc), e1), {
      kind: "add_document",
      jobId: J,
      stepId: S,
      newDocumentId: NEW_ID,
      groupId: "grp_1",
      label: null,
      sourceFiles: [{ file_ref: A, page_ranges: [[1, 1]] }],
      index: 3,
    });
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted).toEqual([]);
    expect(ids(next.current)).toEqual(["doc_1", "doc_2", "doc_3", NEW_ID]);
    expect(pagesOf(next.current, "doc_1")).toEqual(["a2"]);
  });

  it("연쇄는 전이적이다", () => {
    const { doc } = singleJob();
    let session = add(
      createSession(doc),
      setDoc("doc_3", [
        [B, [[2, 2]]],
        [A, [[2, 2]]],
      ]),
    );
    session = add(
      session,
      setDoc("doc_3", [
        [B, [[2, 2]]],
        [A, [[2, 3]]],
      ]),
    );
    session = add(
      session,
      setDoc("doc_2", [
        [B, [[1, 1]]],
        [A, [[1, 1]]],
      ]),
    );
    expect(ids(session.current)).toEqual(["doc_2", "doc_3"]);
    const [first, second, third] = session.entries;
    const { session: next, alsoReverted } = revertChange(session, first!.id);
    expect(revertedKinds(alsoReverted)).toEqual([
      [second!.id, "depends_on_reverted"],
      [third!.id, "depends_on_reverted"],
    ]);
    expect(next.entries).toEqual([]);
    expect(next.current).toBe(doc);
  });

  it("move_pages 도 연쇄를 일으킨다", () => {
    const { doc } = singleJob();
    let session = add(createSession(doc), {
      kind: "move_pages",
      jobId: J,
      stepId: S,
      fromDocumentId: "doc_1",
      pages: [{ file_ref: A, page: 2 }],
      to: { documentId: "doc_2", index: 2 },
    });
    session = add(
      session,
      setDoc("doc_1", [
        [
          A,
          [
            [1, 1],
            [3, 3],
          ],
        ],
      ]),
    );
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(revertedKinds(alsoReverted)).toEqual([
      [session.entries[1]!.id, "depends_on_reverted"],
    ]);
    expect(next.current).toBe(doc);
  });

  it("순서만 바꾼 범위 편집은 연쇄하지 않는다", () => {
    const { doc } = singleJob();
    let session = add(
      createSession(doc),
      setDoc("doc_1", [
        [
          A,
          [
            [2, 2],
            [1, 1],
          ],
        ],
      ]),
    );
    session = add(session, setDoc("doc_1", [[A, [[1, 3]]]]));
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted).toEqual([]);
    expect(pagesOf(next.current, "doc_1")).toEqual(["a1", "a2", "a3"]);
    expect(pagesOf(next.current, "doc_2")).toEqual(["b1"]);
  });
});

describe("구조 통째 교체", () => {
  function replaceWith(
    doc: ReviewDocument,
    edit: (
      documents: Layout["content"]["documents"],
    ) => Layout["content"]["documents"],
  ): ChangeDraft {
    const job = doc.jobs[0]!;
    const layout = job.output.find(item => !("id" in item)) as Layout;
    return {
      kind: "replace_structure",
      jobId: J,
      fileGroups: job.file_groups!,
      layouts: [
        {
          ...layout,
          content: {
            ...layout.content,
            documents: edit(layout.content.documents),
          },
        },
      ],
    };
  }

  it("출처(origin)는 항목에 남고 설명·적용 결과에는 영향이 없다", () => {
    const { doc } = singleJob();
    const draft = replaceWith(doc, documents =>
      documents.map(item =>
        item.document_id === "doc_2" ? { ...item, label: "contract" } : item,
      ),
    );
    const plain = add(createSession(doc), draft);
    const tagged = add(createSession(doc), {
      ...draft,
      origin: { kind: "revision", revisionId: "rev_1", version: 1 },
    } as ChangeDraft);
    expect(tagged.entries[0]).toMatchObject({
      origin: { kind: "revision", revisionId: "rev_1", version: 1 },
    });
    expect(tagged.entries[0]!.description).toEqual(
      plain.entries[0]!.description,
    );
    expect(tagged.current).toEqual(plain.current);
  });

  it("바뀐 수와 바뀐 문서를 설명에 싣고 그 문서 id 를 덧붙인다", () => {
    const { doc } = singleJob();
    const draft = replaceWith(doc, documents =>
      documents.map(item =>
        item.document_id === "doc_2" ? { ...item, label: "contract" } : item,
      ),
    );
    expect(describeChange(doc, draft)).toEqual({
      documentLabel: null,
      documentIds: [STRUCTURE_GROUP_ID, "doc_2"],
      detail: {
        documents: 3,
        excludedDocuments: 0,
        excludedPages: 0,
        labelChanged: 1,
        rangesChanged: 0,
        added: 0,
        removed: 0,
        reordered: 0,
        groupsChanged: 0,
      },
      structureDocuments: [
        {
          documentId: "doc_2",
          status: "changed",
          position: 2,
          before: "receipt",
          after: "contract",
          labelChanged: true,
          rangesChanged: false,
          pageSetChanged: false,
        },
      ],
    });
  });

  it("페이지 집합을 바꾼 문서의 뒤 범위 편집은 교체를 되돌리면 함께 빠진다", () => {
    const { doc } = singleJob();
    // doc_2 의 job_A#1:1 을 doc_3 으로 옮긴다
    const draft = replaceWith(doc, documents =>
      documents.map(item =>
        item.document_id === "doc_2"
          ? {
              ...item,
              source_files: [{ file_ref: "job_A#0", page_ranges: [[3, 3]] }],
            }
          : item.document_id === "doc_3"
            ? {
                ...item,
                source_files: [{ file_ref: "job_A#1", page_ranges: [[1, 2]] }],
              }
            : item,
      ),
    );
    const session = add(add(createSession(doc), draft), {
      kind: "set_page_ranges",
      jobId: J,
      stepId: S,
      documentId: "doc_2",
      sourceFiles: [{ file_ref: "job_A#0", page_ranges: [[2, 3]] }],
    });
    expect(session.entries[0]!.description.documentIds).toEqual([
      STRUCTURE_GROUP_ID,
      "doc_2",
      "doc_3",
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted.map(item => [item.entry.kind, item.reason])).toEqual([
      ["set_page_ranges", "depends_on_reverted"],
    ]);
    expect(next.current).toBe(doc);
  });

  const relabel =
    (documentId: string, label: string) =>
    (documents: Layout["content"]["documents"]) =>
      documents.map(item =>
        item.document_id === documentId ? { ...item, label } : item,
      );

  it("앞 분리를 되돌리면 그 결과를 담은 뒤 구조 교체도 함께 빠지고 구조가 base 로 돌아간다", () => {
    const { doc } = singleJob();
    let session = add(createSession(doc), {
      kind: "split_document",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      afterPage: { file_ref: A, page: 1 },
      newDocumentId: NEW_ID,
    });
    session = add(
      session,
      replaceWith(session.current, relabel("doc_3", "memo")),
    );
    expect(ids(session.current)).toEqual(["doc_1", NEW_ID, "doc_2", "doc_3"]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted.map(item => [item.entry.kind, item.reason])).toEqual([
      ["replace_structure", "depends_on_reverted"],
    ]);
    expect(next.entries).toEqual([]);
    expect(next.current).toBe(doc);
  });

  it("앞 라벨 변경(라벨 지움)을 되돌리면 뒤 구조 교체도 함께 빠진다", () => {
    const { doc } = singleJob();
    let session = add(createSession(doc), {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_2",
      label: "  ",
    });
    expect(session.entries[0]).toMatchObject({ label: null });
    session = add(
      session,
      replaceWith(session.current, relabel("doc_3", "memo")),
    );
    session = add(
      session,
      replaceWith(session.current, relabel("doc_1", "bill")),
    );
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted.map(item => [item.entry.seq, item.reason])).toEqual([
      [2, "depends_on_reverted"],
      [3, "depends_on_reverted"],
    ]);
    expect(next.current).toBe(doc);
  });

  it("값 항목을 되돌려도 뒤 구조 교체는 남고, 구조 교체를 되돌려도 앞 구조 항목은 남는다", () => {
    const { doc } = singleJob();
    let session = add(createSession(doc), {
      kind: "set_value",
      jobId: J,
      resultId: "occ_extract_1",
      path: ["currency"],
      value: "KRW",
    });
    session = add(session, {
      kind: "exclude_document",
      jobId: J,
      documentId: "doc_1",
    });
    session = add(
      session,
      replaceWith(session.current, relabel("doc_3", "memo")),
    );
    expect(revertChange(session, session.entries[0]!.id).alsoReverted).toEqual(
      [],
    );
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[2]!.id,
    );
    expect(alsoReverted).toEqual([]);
    expect(next.entries.map(entry => entry.kind)).toEqual([
      "set_value",
      "exclude_document",
    ]);
  });
});
