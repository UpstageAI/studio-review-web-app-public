import { describe, expect, it } from "vitest";

import {
  addChange,
  createSession,
  documentPages,
  findLayout,
  pageKey,
  readReviewDocument,
  type ChangeDraft,
} from "@/lib/review-model";

import { batchDrafts, groupSelection } from "../organizer-selection";

import {
  addDocumentDraft,
  movePagesDraft,
  newDocumentFromPageDraft,
  type MovePagesPosition,
  placementAfterGroup,
  pageDestinations,
  selectionAfterApply,
  selectionAfterBatch,
  selectionAfterEdit,
  viewedPageKeyOf,
} from "../use-structure-actions";

// 테스트 리터럴만 담으므로 JSON.stringify 로 만들어도 정밀도 손실이 없다.
function job() {
  return reviewDocument().jobs[0]!;
}

function reviewDocument() {
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
                    file_id: "fa",
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
                    file_id: "fb",
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
                    label: "x",
                    source_files: [
                      { file_ref: "job_1#0", page_ranges: [[1, 1]] },
                    ],
                  },
                  {
                    document_id: "d2",
                    group_id: "g2",
                    label: null,
                    source_files: [
                      { file_ref: "job_1#1", page_ranges: [[1, 1]] },
                    ],
                  },
                  {
                    document_id: "d3",
                    group_id: "g1",
                    label: null,
                    source_files: [
                      { file_ref: "job_1#0", page_ranges: [[2, 2]] },
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

describe("placementAfterGroup", () => {
  it("그룹의 마지막 문서 다음 자리", () => {
    expect(placementAfterGroup(job(), "st_c", "g1")).toEqual({
      index: 3,
      afterDocumentId: "d3",
    });
    expect(placementAfterGroup(job(), "st_c", "g2")).toEqual({
      index: 2,
      afterDocumentId: "d2",
    });
  });

  it("그룹 문서가 없으면 끝", () => {
    expect(placementAfterGroup(job(), "st_c", "g9")).toEqual({
      index: 3,
      afterDocumentId: "d3",
    });
  });
});

describe("newDocumentFromPageDraft", () => {
  it("제외 페이지는 restore_pages 의 새 문서 대상(그룹 마지막 문서 뒤)", () => {
    expect(newDocumentFromPageDraft(job(), "st_c", "job_1#0:3", "new")).toEqual(
      {
        kind: "restore_pages",
        jobId: "job_1",
        stepId: "st_c",
        pages: [{ file_ref: "job_1#0", page: 3 }],
        to: { newDocumentId: "new", afterDocumentId: "d3" },
      },
    );
  });

  it("어디에도 없는 페이지는 add_document(그 그룹, 라벨 없음)", () => {
    expect(newDocumentFromPageDraft(job(), "st_c", "job_1#1:2", "new")).toEqual(
      {
        kind: "add_document",
        jobId: "job_1",
        stepId: "st_c",
        newDocumentId: "new",
        groupId: "g2",
        label: null,
        sourceFiles: [{ file_ref: "job_1#1", page_ranges: [[2, 2]] }],
        index: 2,
      },
    );
  });

  it("읽을 수 없는 키·모르는 파일은 null", () => {
    expect(newDocumentFromPageDraft(job(), "st_c", "bad", "new")).toBeNull();
    expect(
      newDocumentFromPageDraft(job(), "st_c", "job_9#0:1", "new"),
    ).toBeNull();
  });
});

describe("addDocumentDraft", () => {
  const sourceFiles = [
    { file_ref: "job_1#0", page_ranges: [[3, 3]] as [number, number][] },
  ];

  it("afterDocumentId 바로 다음에 넣는다", () => {
    expect(
      addDocumentDraft(
        job(),
        "st_c",
        { groupId: "g1", label: "x", sourceFiles, afterDocumentId: "d1" },
        "new",
      ),
    ).toEqual({
      kind: "add_document",
      jobId: "job_1",
      stepId: "st_c",
      newDocumentId: "new",
      groupId: "g1",
      label: "x",
      sourceFiles,
      index: 1,
    });
  });

  it("afterDocumentId 가 없거나 못 찾으면 그룹 끝", () => {
    const draft = addDocumentDraft(
      job(),
      "st_c",
      { groupId: "g2", label: null, sourceFiles, afterDocumentId: "gone" },
      "new",
    );
    expect(draft).toMatchObject({ kind: "add_document", index: 2 });
  });
});

describe("movePagesDraft", () => {
  const page1 = { file_ref: "job_1#0", page: 1 };
  const input = { documentId: "d1", from: 1, to: 1 };
  const toD3 = (position: MovePagesPosition) => ({
    ...input,
    destination: { kind: "document", documentId: "d3", position } as const,
  });

  it("끝은 대상 문서의 페이지 수, 앞은 0, 특정 페이지 앞은 번호 - 1", () => {
    expect(movePagesDraft(job(), "st_c", toD3("end"), "unused")).toEqual({
      kind: "move_pages",
      jobId: "job_1",
      stepId: "st_c",
      fromDocumentId: "d1",
      pages: [page1],
      to: { documentId: "d3", index: 1 },
    });
    expect(
      movePagesDraft(job(), "st_c", toD3("start"), "unused"),
    ).toMatchObject({ to: { documentId: "d3", index: 0 } });
    expect(
      movePagesDraft(job(), "st_c", toD3({ beforePage: 2 }), "unused"),
    ).toMatchObject({ to: { documentId: "d3", index: 1 } });
  });

  it("범위가 문서 밖이거나 위치가 대상 밖이면 null", () => {
    expect(
      movePagesDraft(job(), "st_c", { ...toD3("end"), to: 2 }, "unused"),
    ).toBeNull();
    expect(
      movePagesDraft(job(), "st_c", { ...toD3("end"), from: 0 }, "unused"),
    ).toBeNull();
    // 대상이 1 쪽이면 "앞에 넣을 페이지" 는 1‥2.
    expect(
      movePagesDraft(job(), "st_c", toD3({ beforePage: 3 }), "unused"),
    ).toBeNull();
    expect(
      movePagesDraft(job(), "st_c", toD3({ beforePage: 0 }), "unused"),
    ).toBeNull();
  });

  it("문서나 대상이 없으면 null", () => {
    expect(
      movePagesDraft(
        job(),
        "st_c",
        {
          ...input,
          destination: {
            kind: "document",
            documentId: "nope",
            position: "end",
          },
        },
        "unused",
      ),
    ).toBeNull();
    expect(
      movePagesDraft(
        job(),
        "st_c",
        { ...toD3("end"), documentId: "nope" },
        "unused",
      ),
    ).toBeNull();
    expect(movePagesDraft(job(), "st_x", toD3("end"), "unused")).toBeNull();
  });

  it("새 문서: 원본 바로 뒤 newId 문서에 고른 라벨로, 범위가 문서 밖이면 null", () => {
    const toNew = {
      ...input,
      destination: { kind: "new-document", label: "B" } as const,
    };
    expect(movePagesDraft(job(), "st_c", toNew, "review-doc-n")).toEqual({
      kind: "move_pages",
      jobId: "job_1",
      stepId: "st_c",
      fromDocumentId: "d1",
      pages: [page1],
      to: { newDocumentId: "review-doc-n", afterDocumentId: "d1", label: "B" },
    });
    expect(
      movePagesDraft(job(), "st_c", { ...toNew, to: 2 }, "review-doc-n"),
    ).toBeNull();
  });
});

// g1 의 d1(1‥3 쪽)·d3(4‥5 쪽). 한 파일의 페이지를 두 문서가 나눠 가진다.
function longDoc() {
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
        },
      },
      jobs: [
        {
          id: "job_1",
          file_groups: {
            base_version: 1,
            excluded_pages: [],
            groups: [
              {
                group_id: "g1",
                layout_step_id: "st_c",
                files: [
                  {
                    file_ref: "job_1#0",
                    file_id: "fa",
                    name: "a.pdf",
                    num_pages: 5,
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
                    label: null,
                    source_files: [
                      { file_ref: "job_1#0", page_ranges: [[1, 3]] },
                    ],
                  },
                  {
                    document_id: "d3",
                    group_id: "g1",
                    label: null,
                    source_files: [
                      { file_ref: "job_1#0", page_ranges: [[4, 5]] },
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

const longJob = () => longDoc().jobs[0]!;

describe("selectionAfterEdit", () => {
  const page = (n: number) => ({ file_ref: "job_1#0", page: n });
  const selected = (documentId: string) => ({ stepId: "st_c", documentId });
  const merge = {
    kind: "merge_documents",
    jobId: "job_1",
    stepId: "st_c",
    intoDocumentId: "d1",
    fromDocumentId: "d3",
  } as const;
  const move = (pages: number[], to: { documentId: string; index: number }) =>
    ({
      kind: "move_pages",
      jobId: "job_1",
      stepId: "st_c",
      fromDocumentId: "d1",
      pages: pages.map(page),
      to,
    }) as const;

  it("합친 문서를 보고 있었으면 합쳐진 문서의 붙은 첫 페이지", () => {
    expect(
      selectionAfterEdit(longJob(), "st_c", merge, selected("d3")),
    ).toEqual({ documentId: "d1", pageIndex: 3 });
  });

  it("합치기 대상이나 다른 문서를 보고 있었으면 null", () => {
    expect(
      selectionAfterEdit(longJob(), "st_c", merge, selected("d1")),
    ).toBeNull();
    expect(selectionAfterEdit(longJob(), "st_c", merge, null)).toBeNull();
    expect(
      selectionAfterEdit(longJob(), "st_c", merge, {
        stepId: "st_other",
        documentId: "d3",
      }),
    ).toBeNull();
  });

  it("보던 문서의 페이지를 전부 옮기면 대상 문서의 옮긴 첫 페이지", () => {
    expect(
      selectionAfterEdit(
        longJob(),
        "st_c",
        move([1, 2, 3], { documentId: "d3", index: 2 }),
        selected("d1"),
      ),
    ).toEqual({ documentId: "d3", pageIndex: 2 });
    expect(
      selectionAfterEdit(
        longJob(),
        "st_c",
        move([1, 2, 3], { documentId: "d3", index: 0 }),
        selected("d1"),
      ),
    ).toEqual({ documentId: "d3", pageIndex: 0 });
  });

  it("끝을 넘는 위치는 대상 문서 끝으로 줄인다", () => {
    expect(
      selectionAfterEdit(
        longJob(),
        "st_c",
        move([1, 2, 3], { documentId: "d3", index: 9 }),
        selected("d1"),
      ),
    ).toEqual({ documentId: "d3", pageIndex: 2 });
  });

  it("일부만 옮기거나 다른 문서를 보고 있으면 null", () => {
    expect(
      selectionAfterEdit(
        longJob(),
        "st_c",
        move([2], { documentId: "d3", index: 2 }),
        selected("d1"),
      ),
    ).toBeNull();
    expect(
      selectionAfterEdit(
        longJob(),
        "st_c",
        move([1, 2, 3], { documentId: "d3", index: 2 }),
        selected("d3"),
      ),
    ).toBeNull();
  });

  it("새 문서로 전부 옮기면 새 문서의 첫 페이지", () => {
    expect(
      selectionAfterEdit(
        longJob(),
        "st_c",
        {
          kind: "move_pages",
          jobId: "job_1",
          stepId: "st_c",
          fromDocumentId: "d1",
          pages: [page(1), page(2), page(3)],
          to: { newDocumentId: "new", afterDocumentId: "d3" },
        },
        selected("d1"),
      ),
    ).toEqual({ documentId: "new", pageIndex: 0 });
  });

  it("선택을 옮기지 않는 편집은 null", () => {
    expect(
      selectionAfterEdit(
        longJob(),
        "st_c",
        {
          kind: "reorder_documents",
          jobId: "job_1",
          stepId: "st_c",
          documentId: "d1",
          toIndex: 1,
        },
        selected("d1"),
      ),
    ).toBeNull();
  });
});

describe("일괄 편집 — batchDrafts 를 세션에 적용", () => {
  const strips = () =>
    (findLayout(job(), "st_c")?.content.documents ?? []).map(document => ({
      documentId: document.document_id,
      label: document.label,
      groupId: document.group_id,
      pages: documentPages(document).map(ref => ({
        key: pageKey(ref),
        fileRef: ref.file_ref,
        page: ref.page,
        thumbnailUrl: null,
      })),
    }));
  const run = (drafts: readonly ChangeDraft[]) => {
    let session = createSession(reviewDocument());
    for (const draft of drafts) {
      const outcome = addChange(session, draft);
      expect(outcome.ok).toBe(true);
      if (outcome.ok) session = outcome.session;
    }
    return (
      findLayout(session.current.jobs[0]!, "st_c")?.content.documents ?? []
    ).map(document => [
      document.document_id,
      documentPages(document).map(pageKey),
    ]);
  };
  const both = () =>
    groupSelection(new Set(["job_1#0:1", "job_1#0:2"]), strips());

  it("옮기기: 대상에 든 선택 페이지는 두고 나머지를 대상 앞에 붙이며, 빈 원본은 사라지고 옮긴 첫 페이지를 고른다", () => {
    const action = {
      kind: "move",
      targetDocumentId: "d3",
      position: "start",
    } as const;
    // d3 에 든 선택 페이지(2)는 그 자리에 두고 d1 의 1 만 옮긴다.
    const drafts = batchDrafts(job(), "st_c", both(), action, {
      newDocumentId: "unused",
      batchId: "batch-1",
    });
    if (!Array.isArray(drafts)) throw new Error(drafts.reason);
    expect(run(drafts)).toEqual([
      ["d2", ["job_1#1:1"]],
      ["d3", ["job_1#0:1", "job_1#0:2"]],
    ]);
    expect(selectionAfterBatch(action, drafts)).toEqual({
      documentId: "d3",
      pageIndex: 0,
    });
  });

  it("새 문서로: 첫 원본 뒤에 새 문서를 만들고 그 첫 페이지를 고른다", () => {
    const action = { kind: "new-document" } as const;
    const drafts = batchDrafts(job(), "st_c", both(), action, {
      newDocumentId: "review-doc-n",
      batchId: "batch-1",
    });
    if (!Array.isArray(drafts)) throw new Error(drafts.reason);
    expect(run(drafts)).toEqual([
      ["review-doc-n", ["job_1#0:1", "job_1#0:2"]],
      ["d2", ["job_1#1:1"]],
    ]);
    expect(selectionAfterBatch(action, drafts)).toEqual({
      documentId: "review-doc-n",
      pageIndex: 0,
    });
  });

  it("새 문서로 + label: 새 문서 라벨이 고른 라벨", () => {
    const drafts = batchDrafts(
      job(),
      "st_c",
      both(),
      { kind: "new-document", label: "B" },
      { newDocumentId: "review-doc-n", batchId: "batch-1" },
    );
    if (!Array.isArray(drafts)) throw new Error(drafts.reason);
    let session = createSession(reviewDocument());
    for (const draft of drafts) {
      const outcome = addChange(session, draft);
      if (!outcome.ok) throw new Error(outcome.reason);
      session = outcome.session;
    }
    const created = findLayout(
      session.current.jobs[0]!,
      "st_c",
    )?.content.documents.find(d => d.document_id === "review-doc-n");
    expect(created?.label).toBe("B");
  });

  it("제외: 원본마다 제외하고 고를 자리는 없다", () => {
    const action = { kind: "exclude" } as const;
    const drafts = batchDrafts(job(), "st_c", both(), action, {
      newDocumentId: "unused",
      batchId: "batch-1",
    });
    if (!Array.isArray(drafts)) throw new Error(drafts.reason);
    expect(drafts).toHaveLength(2);
    expect(run(drafts)).toEqual([["d2", ["job_1#1:1"]]]);
    expect(selectionAfterBatch(action, drafts)).toBeUndefined();
  });

  it("끌어 놓기: 대상에 든 고른 페이지와 함께 놓은 자리에 문서 순으로 모으고, 빈 원본은 사라지고 모인 첫 페이지를 고른다", () => {
    const action = { kind: "drop", targetDocumentId: "d3", index: 0 } as const;
    const drafts = batchDrafts(job(), "st_c", both(), action, {
      newDocumentId: "unused",
      batchId: "batch-1",
    });
    if (!Array.isArray(drafts)) throw new Error(drafts.reason);
    expect(drafts).toHaveLength(2);
    expect(run(drafts)).toEqual([
      ["d2", ["job_1#1:1"]],
      ["d3", ["job_1#0:1", "job_1#0:2"]],
    ]);
    expect(selectionAfterBatch(action, drafts)).toEqual({
      documentId: "d3",
      pageIndex: 0,
    });
  });
});

describe("selectionAfterApply", () => {
  const page = (n: number) => ({ file_ref: "job_1#0", page: n });
  const key = (n: number) => pageKey(page(n));
  const selected = (documentId: string) => ({ stepId: "st_c", documentId });
  const after = (draft: ChangeDraft) => {
    const outcome = addChange(createSession(longDoc()), draft);
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome.session.current.jobs[0]!;
  };
  const follow = (
    draft: ChangeDraft,
    documentId: string,
    viewed: number | null,
  ) =>
    selectionAfterApply(
      longJob(),
      after(draft),
      "st_c",
      draft,
      selected(documentId),
      viewed === null ? null : key(viewed),
    );
  const split = (afterPage: number): ChangeDraft => ({
    kind: "split_document",
    jobId: "job_1",
    stepId: "st_c",
    documentId: "d1",
    afterPage: page(afterPage),
    newDocumentId: "new",
  });
  const move = (
    fromDocumentId: string,
    pages: number[],
    to: { documentId: string; index: number },
  ): ChangeDraft => ({
    kind: "move_pages",
    jobId: "job_1",
    stepId: "st_c",
    fromDocumentId,
    pages: pages.map(page),
    to,
  });
  const merge: ChangeDraft = {
    kind: "merge_documents",
    jobId: "job_1",
    stepId: "st_c",
    intoDocumentId: "d1",
    fromDocumentId: "d3",
  };
  const exclude = (pages: number[]): ChangeDraft => ({
    kind: "exclude_pages",
    jobId: "job_1",
    stepId: "st_c",
    fromDocumentId: "d1",
    pages: pages.map(page),
  });

  it("나누기: 보던 페이지가 머리에 남으면 같은 문서·같은 위치", () => {
    expect(follow(split(2), "d1", 1)).toEqual({
      documentId: "d1",
      pageIndex: 0,
    });
    expect(follow(split(2), "d1", 2)).toEqual({
      documentId: "d1",
      pageIndex: 1,
    });
  });

  it("나누기: 보던 페이지가 꼬리로 가면 새 문서의 그 페이지", () => {
    expect(follow(split(1), "d1", 3)).toEqual({
      documentId: "new",
      pageIndex: 1,
    });
    expect(follow(split(2), "d1", 3)).toEqual({
      documentId: "new",
      pageIndex: 0,
    });
  });

  it("나누기: 다른 문서를 보던 중이면 그 문서 그대로", () => {
    expect(follow(split(2), "d3", 5)).toEqual({
      documentId: "d3",
      pageIndex: 1,
    });
  });

  it("보던 페이지를 포함해 일부를 옮기면 대상 문서의 그 페이지", () => {
    expect(
      follow(move("d1", [2], { documentId: "d3", index: 1 }), "d1", 2),
    ).toEqual({ documentId: "d3", pageIndex: 1 });
    // 옮긴 페이지는 원본 문서 순서로 들어간다.
    expect(
      follow(move("d1", [2, 1], { documentId: "d3", index: 0 }), "d1", 2),
    ).toEqual({ documentId: "d3", pageIndex: 1 });
  });

  it("다른 페이지만 옮기면 같은 문서에서 위치만 맞춘다", () => {
    expect(
      follow(move("d1", [1], { documentId: "d3", index: 2 }), "d1", 3),
    ).toEqual({ documentId: "d1", pageIndex: 1 });
    expect(
      follow(move("d1", [3], { documentId: "d3", index: 2 }), "d1", 1),
    ).toEqual({ documentId: "d1", pageIndex: 0 });
  });

  it("전부 옮기면 대상 문서에서 보던 페이지", () => {
    const all = move("d1", [1, 2, 3], { documentId: "d3", index: 9 });
    expect(follow(all, "d1", 1)).toEqual({ documentId: "d3", pageIndex: 2 });
    expect(follow(all, "d1", 3)).toEqual({ documentId: "d3", pageIndex: 4 });
  });

  it("대상 문서를 보던 중이면 앞에 낀 만큼 위치를 민다", () => {
    expect(
      follow(move("d1", [1], { documentId: "d3", index: 0 }), "d3", 5),
    ).toEqual({ documentId: "d3", pageIndex: 2 });
  });

  it("앞·뒤 문서로 보내면 보낸 페이지를 따라 이웃 문서", () => {
    expect(
      follow(move("d1", [2], { documentId: "d3", index: 0 }), "d1", 2),
    ).toEqual({ documentId: "d3", pageIndex: 0 });
    expect(
      follow(move("d3", [4], { documentId: "d1", index: 3 }), "d3", 4),
    ).toEqual({ documentId: "d1", pageIndex: 3 });
  });

  it("합치기: 합친 문서에서 보던 페이지", () => {
    expect(follow(merge, "d3", 5)).toEqual({ documentId: "d1", pageIndex: 4 });
  });

  it("제외: 다른 페이지면 위치를 당기고 보던 페이지면 null", () => {
    expect(follow(exclude([1]), "d1", 3)).toEqual({
      documentId: "d1",
      pageIndex: 1,
    });
    expect(follow(exclude([2]), "d1", 2)).toBeNull();
  });

  it("보던 페이지를 모르면 selectionAfterEdit 로, 다른 보기 선택이면 null", () => {
    expect(follow(merge, "d3", null)).toEqual({
      documentId: "d1",
      pageIndex: 3,
    });
    expect(
      selectionAfterApply(
        longJob(),
        after(merge),
        "st_c",
        merge,
        { stepId: "st_other", documentId: "d3" },
        key(5),
      ),
    ).toBeNull();
    expect(
      selectionAfterApply(longJob(), after(merge), "st_c", merge, null, key(5)),
    ).toBeNull();
  });

  it("pageDestinations 는 편집이 페이지를 보내는 문서", () => {
    expect(pageDestinations(split(1))).toEqual(["new"]);
    expect(pageDestinations(merge)).toEqual(["d1"]);
    expect(
      pageDestinations(move("d1", [1], { documentId: "d3", index: 0 })),
    ).toEqual(["d3"]);
    expect(pageDestinations(exclude([1]))).toEqual([]);
  });
});

describe("viewedPageKeyOf", () => {
  const selected = (documentId: string) => ({ stepId: "st_c", documentId });

  it("선택 문서의 그 위치 페이지, 끝을 넘으면 마지막 페이지", () => {
    expect(viewedPageKeyOf(longJob(), selected("d1"), 1)).toBe(
      pageKey({ file_ref: "job_1#0", page: 2 }),
    );
    expect(viewedPageKeyOf(longJob(), selected("d1"), 9)).toBe(
      pageKey({ file_ref: "job_1#0", page: 3 }),
    );
  });

  it("선택이 없거나 문서가 없으면 null", () => {
    expect(viewedPageKeyOf(longJob(), null, 0)).toBeNull();
    expect(viewedPageKeyOf(longJob(), selected("missing"), 0)).toBeNull();
  });
});
