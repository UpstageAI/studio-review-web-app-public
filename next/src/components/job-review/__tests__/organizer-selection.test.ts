import { describe, expect, it } from "vitest";

import type { StructureDocument } from "@/components/studio-ui-kit/structure-editor";
import {
  addChange,
  createSession,
  documentPages,
  findLayout,
  pageKey,
  readReviewDocument,
  type ChangeDraft,
  type ReviewJob,
} from "@/lib/review-model";

import {
  applyClick,
  batchDrafts,
  EMPTY_SELECTION,
  formatPageRuns,
  groupSelection,
  orderedPages,
  pruneSelection,
  splitTargetOf,
  type BatchAction,
  type SelectionState,
} from "../organizer-selection";

const A = "job_1#0";
const B = "job_1#1";

// 테스트 리터럴만 담으므로 JSON.stringify 로 만들어도 정밀도 손실이 없다.
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
            excluded_pages: [],
            groups: [
              {
                group_id: "g1",
                layout_step_id: "st_c",
                files: [
                  { file_ref: A, file_id: "fa", name: "a.pdf", num_pages: 6 },
                ],
              },
              {
                group_id: "g2",
                layout_step_id: "st_c",
                files: [
                  { file_ref: B, file_id: "fb", name: "b.pdf", num_pages: 2 },
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
                    source_files: [{ file_ref: A, page_ranges: [[1, 2]] }],
                  },
                  {
                    document_id: "d2",
                    group_id: "g1",
                    label: "receipt",
                    source_files: [{ file_ref: A, page_ranges: [[3, 4]] }],
                  },
                  {
                    document_id: "d3",
                    group_id: "g2",
                    label: null,
                    source_files: [{ file_ref: B, page_ranges: [[1, 2]] }],
                  },
                  {
                    document_id: "d4",
                    group_id: "g1",
                    label: null,
                    source_files: [{ file_ref: A, page_ranges: [[5, 6]] }],
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

const key = (fileRef: string, page: number) =>
  pageKey({ file_ref: fileRef, page });

function stripsOf(job: ReviewJob): StructureDocument[] {
  return (findLayout(job, "st_c")?.content.documents ?? []).map(document => ({
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
}

/** 문서 id → 페이지 키 목록(문서 순). */
function layoutOf(job: ReviewJob): [string, string[]][] {
  return (findLayout(job, "st_c")?.content.documents ?? []).map(document => [
    document.document_id,
    documentPages(document).map(pageKey),
  ]);
}

/** 변경을 순서대로 적용한 Job. 하나라도 실패하면 사유를 던진다. */
function applied(drafts: readonly ChangeDraft[]): ReviewJob {
  let session = createSession(reviewDocument());
  for (const draft of drafts) {
    const outcome = addChange(session, draft);
    if (!outcome.ok) throw new Error(outcome.reason);
    session = outcome.session;
  }
  return session.current.jobs[0]!;
}

const job = () => reviewDocument().jobs[0]!;
const strips = () => stripsOf(job());
const order = () => orderedPages(strips());
const plain = { shift: false, toggle: false };
const shift = { shift: true, toggle: false };
const toggle = { shift: false, toggle: true };
const keysOf = (state: SelectionState) => [...state.keys].sort();

function drafts(result: ChangeDraft[] | { reason: string }): ChangeDraft[] {
  if (!Array.isArray(result)) throw new Error(result.reason);
  return result;
}

describe("orderedPages", () => {
  it("문서 순 → 문서 안 순", () => {
    expect(order().map(page => `${page.documentId}/${page.key}`)).toEqual([
      `d1/${key(A, 1)}`,
      `d1/${key(A, 2)}`,
      `d2/${key(A, 3)}`,
      `d2/${key(A, 4)}`,
      `d3/${key(B, 1)}`,
      `d3/${key(B, 2)}`,
      `d4/${key(A, 5)}`,
      `d4/${key(A, 6)}`,
    ]);
  });
});

describe("applyClick", () => {
  it("plain 은 선택을 비우고 기준만 옮긴다", () => {
    const state = { keys: new Set([key(A, 1), key(A, 2)]), anchor: key(A, 1) };
    expect(applyClick(state, order(), key(A, 3), plain)).toEqual({
      keys: new Set(),
      anchor: key(A, 3),
    });
  });

  it("Shift 는 기준부터 누른 키까지(앞→뒤) 고르고 기준을 유지한다", () => {
    const start = applyClick(EMPTY_SELECTION, order(), key(A, 2), plain);
    const next = applyClick(start, order(), key(A, 4), shift);
    expect(keysOf(next)).toEqual([key(A, 2), key(A, 3), key(A, 4)].sort());
    expect(next.anchor).toBe(key(A, 2));
  });

  it("Shift 범위는 뒤→앞도 같다", () => {
    const start = applyClick(EMPTY_SELECTION, order(), key(A, 4), plain);
    const next = applyClick(start, order(), key(A, 2), shift);
    expect(keysOf(next)).toEqual([key(A, 2), key(A, 3), key(A, 4)].sort());
    expect(next.anchor).toBe(key(A, 4));
  });

  it("Shift 범위는 문서 경계를 넘는다", () => {
    const start = applyClick(EMPTY_SELECTION, order(), key(A, 2), plain);
    const next = applyClick(start, order(), key(A, 5), shift);
    expect(keysOf(next)).toEqual(
      [key(A, 2), key(A, 3), key(A, 4), key(B, 1), key(B, 2), key(A, 5)].sort(),
    );
  });

  it("기준이 없으면 Shift 는 누른 키 하나", () => {
    const next = applyClick(EMPTY_SELECTION, order(), key(A, 3), shift);
    expect(keysOf(next)).toEqual([key(A, 3)]);
    expect(next.anchor).toBe(key(A, 3));
  });

  it("toggle 은 넣고 빼며 기준을 그 키로 옮긴다", () => {
    let state = applyClick(EMPTY_SELECTION, order(), key(A, 1), toggle);
    state = applyClick(state, order(), key(A, 5), toggle);
    expect(keysOf(state)).toEqual([key(A, 1), key(A, 5)].sort());
    expect(state.anchor).toBe(key(A, 5));
    state = applyClick(state, order(), key(A, 1), toggle);
    expect(keysOf(state)).toEqual([key(A, 5)]);
    expect(state.anchor).toBe(key(A, 1));
  });
});

describe("고를 수 없는 페이지(겹친 페이지·잠긴 문서)", () => {
  /** d1 의 2 쪽과 d2 의 3 쪽을 겹친 페이지로 표시하고, d3 을 잠근 띠. */
  function restricted(): StructureDocument[] {
    const overlap = new Set([key(A, 2), key(A, 3)]);
    return strips().map(strip => ({
      ...strip,
      ...(strip.documentId === "d3" ? { locked: true } : {}),
      pages: strip.pages.map(page =>
        overlap.has(page.key) ? { ...page, issue: "overlap" as const } : page,
      ),
    }));
  }
  const restrictedOrder = () => orderedPages(restricted());

  it("겹친 페이지와 잠긴 문서의 페이지는 order 에서 빠진다", () => {
    expect(
      restrictedOrder().map(page => `${page.documentId}/${page.key}`),
    ).toEqual([
      `d1/${key(A, 1)}`,
      `d2/${key(A, 4)}`,
      `d4/${key(A, 5)}`,
      `d4/${key(A, 6)}`,
    ]);
  });

  it("Shift 범위는 겹친 페이지·잠긴 문서를 건너뛴다", () => {
    const start = applyClick(
      EMPTY_SELECTION,
      restrictedOrder(),
      key(A, 1),
      plain,
    );
    const next = applyClick(start, restrictedOrder(), key(A, 5), shift);
    expect(keysOf(next)).toEqual([key(A, 1), key(A, 4), key(A, 5)].sort());
    expect(next.anchor).toBe(key(A, 1));
  });

  it("겹친 페이지 toggle·Shift 는 선택을 그대로 둔다(같은 객체)", () => {
    const state = { keys: new Set([key(A, 1)]), anchor: key(A, 1) };
    expect(applyClick(state, restrictedOrder(), key(A, 2), toggle)).toBe(state);
    expect(applyClick(state, restrictedOrder(), key(A, 3), shift)).toBe(state);
    expect(applyClick(state, restrictedOrder(), key(B, 1), toggle)).toBe(state);
  });

  it("겹친 페이지 plain 클릭은 선택을 비우고 기준을 두지 않는다", () => {
    const state = { keys: new Set([key(A, 1)]), anchor: key(A, 1) };
    expect(applyClick(state, restrictedOrder(), key(A, 2), plain)).toEqual({
      keys: new Set(),
      anchor: null,
    });
  });

  it("기준이 겹친 페이지에서 비워진 뒤 Shift 는 누른 키 하나", () => {
    const start = applyClick(
      EMPTY_SELECTION,
      restrictedOrder(),
      key(A, 2),
      plain,
    );
    const next = applyClick(start, restrictedOrder(), key(A, 5), shift);
    expect(keysOf(next)).toEqual([key(A, 5)]);
    expect(next.anchor).toBe(key(A, 5));
  });

  it("기준이 고를 수 있는 페이지면 Shift 는 기존 규칙대로 범위를 고른다", () => {
    const state = { keys: new Set([key(A, 4)]), anchor: key(A, 4) };
    const next = applyClick(state, restrictedOrder(), key(A, 6), shift);
    expect(keysOf(next)).toEqual([key(A, 4), key(A, 5), key(A, 6)].sort());
    expect(next.anchor).toBe(key(A, 4));
  });
});

describe("pruneSelection", () => {
  it("없어진 키를 빼고 기준이 없어지면 null", () => {
    const state = { keys: new Set([key(A, 1), "gone:1"]), anchor: "gone:1" };
    expect(pruneSelection(state, order())).toEqual({
      keys: new Set([key(A, 1)]),
      anchor: null,
    });
  });

  it("바뀐 것이 없으면 같은 객체", () => {
    const state = { keys: new Set([key(A, 1)]), anchor: key(A, 1) };
    expect(pruneSelection(state, order())).toBe(state);
  });
});

describe("groupSelection", () => {
  it("문서 순 → 문서 안 순으로 원본 문서별로 묶는다", () => {
    const keys = new Set([key(A, 6), key(A, 4), key(A, 1), key(A, 3)]);
    expect(groupSelection(keys, strips())).toEqual([
      { documentId: "d1", groupId: "g1", keys: [key(A, 1)] },
      { documentId: "d2", groupId: "g1", keys: [key(A, 3), key(A, 4)] },
      { documentId: "d4", groupId: "g1", keys: [key(A, 6)] },
    ]);
  });

  it("고른 것이 없으면 빈 배열", () => {
    expect(groupSelection(new Set(), strips())).toEqual([]);
  });
});

describe("batchDrafts", () => {
  const select = (...keys: string[]) => groupSelection(new Set(keys), strips());
  const ids = (newDocumentId = "unused") => ({
    newDocumentId,
    batchId: "batch-1",
  });

  it("모든 변경에 같은 batchId 를 넣는다(move·exclude·new-document)", () => {
    const actions = [
      { kind: "move", targetDocumentId: "d4", position: "end" },
      { kind: "exclude" },
      { kind: "new-document" },
    ] as const;
    for (const action of actions) {
      const result = drafts(
        batchDrafts(
          job(),
          "st_c",
          select(key(A, 1), key(A, 3), key(A, 4)),
          action,
          ids("review-doc-new"),
        ),
      );
      expect(result).toHaveLength(2);
      expect(
        result.map(draft =>
          draft.kind === "move_pages" || draft.kind === "exclude_pages"
            ? draft.batchId
            : null,
        ),
      ).toEqual(["batch-1", "batch-1"]);
    }
  });

  it("move end: 원본마다 변경 하나, index 는 대상 길이 + 지금까지 옮긴 수", () => {
    const result = drafts(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 1), key(A, 2), key(A, 4)),
        { kind: "move", targetDocumentId: "d4", position: "end" },
        ids(),
      ),
    );
    expect(
      result.map(draft =>
        draft.kind === "move_pages" ? [draft.fromDocumentId, draft.to] : null,
      ),
    ).toEqual([
      ["d1", { documentId: "d4", index: 2 }],
      ["d2", { documentId: "d4", index: 4 }],
    ]);
    // d1 은 전부 옮겨 사라진다.
    expect(layoutOf(applied(result))).toEqual([
      ["d2", [key(A, 3)]],
      ["d3", [key(B, 1), key(B, 2)]],
      ["d4", [key(A, 5), key(A, 6), key(A, 1), key(A, 2), key(A, 4)]],
    ]);
  });

  it("move start: index 는 지금까지 옮긴 수", () => {
    const result = drafts(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 2), key(A, 3)),
        { kind: "move", targetDocumentId: "d4", position: "start" },
        ids(),
      ),
    );
    expect(layoutOf(applied(result)).at(-1)).toEqual([
      "d4",
      [key(A, 2), key(A, 3), key(A, 5), key(A, 6)],
    ]);
  });

  it("move before n: n-1 + 지금까지 옮긴 수 — 대상의 n 번째 페이지 바로 앞에 이어 붙는다", () => {
    const result = drafts(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 1), key(A, 3)),
        { kind: "move", targetDocumentId: "d4", position: { beforePage: 2 } },
        ids(),
      ),
    );
    expect(
      result.map(draft => (draft.kind === "move_pages" ? draft.to : null)),
    ).toEqual([
      { documentId: "d4", index: 1 },
      { documentId: "d4", index: 2 },
    ]);
    expect(layoutOf(applied(result)).at(-1)).toEqual([
      "d4",
      [key(A, 5), key(A, 1), key(A, 3), key(A, 6)],
    ]);
  });

  it("move before 가 대상 밖이면 index_out_of_range", () => {
    expect(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 1)),
        { kind: "move", targetDocumentId: "d4", position: { beforePage: 4 } },
        ids(),
      ),
    ).toEqual({ reason: "index_out_of_range" });
  });

  it("대상 문서에 든 선택 페이지는 그 자리에 둔다", () => {
    const result = drafts(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 1), key(A, 6)),
        { kind: "move", targetDocumentId: "d4", position: "start" },
        ids(),
      ),
    );
    expect(result).toHaveLength(1);
    expect(layoutOf(applied(result)).at(-1)).toEqual([
      "d4",
      [key(A, 1), key(A, 5), key(A, 6)],
    ]);
  });

  it("대상 문서의 페이지만 골랐으면 옮길 것이 없다", () => {
    expect(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 5)),
        { kind: "move", targetDocumentId: "d4", position: "end" },
        ids(),
      ),
    ).toEqual({ reason: "page_not_in_document" });
  });

  it("대상과 원본의 그룹이 다르면 group_mismatch", () => {
    expect(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 1), key(B, 1)),
        { kind: "move", targetDocumentId: "d4", position: "end" },
        ids(),
      ),
    ).toEqual({ reason: "group_mismatch" });
  });

  it("대상이 없으면 target_missing", () => {
    expect(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 1)),
        { kind: "move", targetDocumentId: "d9", position: "end" },
        ids(),
      ),
    ).toEqual({ reason: "target_missing" });
  });

  it("exclude: 원본마다 exclude_pages, 다 뺀 원본은 사라진다", () => {
    const result = drafts(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 1), key(A, 2), key(B, 2)),
        { kind: "exclude" },
        ids(),
      ),
    );
    expect(
      result.map(draft =>
        draft.kind === "exclude_pages"
          ? [draft.fromDocumentId, draft.pages.map(pageKey)]
          : null,
      ),
    ).toEqual([
      ["d1", [key(A, 1), key(A, 2)]],
      ["d3", [key(B, 2)]],
    ]);
    const after = applied(result);
    expect(layoutOf(after).map(([id]) => id)).toEqual(["d2", "d3", "d4"]);
    expect(after.file_groups?.excluded_pages).toEqual([
      { file_ref: A, page_ranges: [[1, 2]] },
      { file_ref: B, page_ranges: [[2, 2]] },
    ]);
  });

  it("new-document: 첫 원본 뒤에 새 문서, 나머지는 그 문서 끝에 이어 붙는다", () => {
    const result = drafts(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 2), key(A, 3), key(A, 4), key(A, 6)),
        { kind: "new-document" },
        ids("review-doc-new"),
      ),
    );
    expect(
      result.map(draft => (draft.kind === "move_pages" ? draft.to : null)),
    ).toEqual([
      { newDocumentId: "review-doc-new", afterDocumentId: "d1" },
      { documentId: "review-doc-new", index: 1 },
      { documentId: "review-doc-new", index: 3 },
    ]);
    const after = applied(result);
    // d2 는 전부 옮겨 사라진다.
    expect(layoutOf(after)).toEqual([
      ["d1", [key(A, 1)]],
      ["review-doc-new", [key(A, 2), key(A, 3), key(A, 4), key(A, 6)]],
      ["d3", [key(B, 1), key(B, 2)]],
      ["d4", [key(A, 5)]],
    ]);
    const created = findLayout(after, "st_c")!.content.documents[1]!;
    expect(created.label).toBe("invoice");
  });

  it("new-document + label: 첫 변경의 to.label 로 새 문서 라벨을 정하고, 없으면 label 키가 없다", () => {
    const toOf = (action: BatchAction) => {
      const result = drafts(
        batchDrafts(
          job(),
          "st_c",
          select(key(A, 2), key(A, 6)),
          action,
          ids("review-doc-new"),
        ),
      );
      return {
        to: result[0]!.kind === "move_pages" ? result[0]!.to : null,
        label: findLayout(applied(result), "st_c")!.content.documents[1]!.label,
      };
    };
    expect(toOf({ kind: "new-document", label: "B" })).toEqual({
      to: {
        newDocumentId: "review-doc-new",
        afterDocumentId: "d1",
        label: "B",
      },
      label: "B",
    });
    const plain = toOf({ kind: "new-document" });
    expect(plain.to).not.toHaveProperty("label");
    expect(plain.label).toBe("invoice");
  });

  it("new-document 에서 원본을 전부 고르면 원본이 사라지고 문서 수가 준다", () => {
    const result = drafts(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 1), key(A, 2), key(A, 3), key(A, 4)),
        { kind: "new-document" },
        ids("review-doc-new"),
      ),
    );
    expect(layoutOf(applied(result))).toEqual([
      ["review-doc-new", [key(A, 1), key(A, 2), key(A, 3), key(A, 4)]],
      ["d3", [key(B, 1), key(B, 2)]],
      ["d4", [key(A, 5), key(A, 6)]],
    ]);
  });

  it("new-document 에서 그룹이 섞이면 group_mismatch", () => {
    expect(
      batchDrafts(
        job(),
        "st_c",
        select(key(A, 1), key(B, 1)),
        { kind: "new-document" },
        ids("review-doc-new"),
      ),
    ).toEqual({ reason: "group_mismatch" });
  });

  it("선택이 비었거나 문서에 없는 키면 page_not_in_document", () => {
    expect(batchDrafts(job(), "st_c", [], { kind: "exclude" }, ids())).toEqual({
      reason: "page_not_in_document",
    });
    expect(
      batchDrafts(
        job(),
        "st_c",
        [{ documentId: "d1", groupId: "g1", keys: [key(A, 5)] }],
        { kind: "exclude" },
        ids(),
      ),
    ).toEqual({ reason: "page_not_in_document" });
  });

  describe("drop", () => {
    const drop = (targetDocumentId: string, index: number) =>
      ({ kind: "drop", targetDocumentId, index }) as const;
    const targets = (result: ChangeDraft[]) =>
      result.map(draft =>
        draft.kind === "move_pages" ? [draft.fromDocumentId, draft.to] : null,
      );

    it("대상이 원본이 아니면 원본마다 index + 지금까지 옮긴 수", () => {
      const result = drafts(
        batchDrafts(
          job(),
          "st_c",
          select(key(A, 1), key(A, 3)),
          drop("d4", 1),
          ids(),
        ),
      );
      expect(targets(result)).toEqual([
        ["d1", { documentId: "d4", index: 1 }],
        ["d2", { documentId: "d4", index: 2 }],
      ]);
      expect(layoutOf(applied(result)).at(-1)).toEqual([
        "d4",
        [key(A, 5), key(A, 1), key(A, 3), key(A, 6)],
      ]);
    });

    it("대상이 가운데 원본이면 대상 자신을 먼저 모으고, 다른 원본은 문서 순 offset 으로 넣는다", () => {
      const result = drafts(
        batchDrafts(
          job(),
          "st_c",
          select(key(A, 2), key(A, 3), key(A, 6)),
          // d2 [3, 4] 의 끝(지금 배열 기준 2)에 놓으면 끄는 3 을 뺀 뒤 기준 1.
          drop("d2", 1),
          ids(),
        ),
      );
      expect(targets(result)).toEqual([
        ["d2", { documentId: "d2", index: 1 }],
        ["d1", { documentId: "d2", index: 1 }],
        ["d4", { documentId: "d2", index: 3 }],
      ]);
      expect(
        result.map(draft =>
          draft.kind === "move_pages" ? draft.batchId : null,
        ),
      ).toEqual(["batch-1", "batch-1", "batch-1"]);
      // 놓은 자리 앞의 고르지 않은 페이지 → 고른 페이지(문서 순) → 나머지.
      expect(layoutOf(applied(result))).toEqual([
        ["d1", [key(A, 1)]],
        ["d2", [key(A, 4), key(A, 2), key(A, 3), key(A, 6)]],
        ["d3", [key(B, 1), key(B, 2)]],
        ["d4", [key(A, 5)]],
      ]);
    });

    it("같은 문서 안에서만 모으면 변경 하나", () => {
      const result = drafts(
        batchDrafts(job(), "st_c", select(key(A, 1)), drop("d1", 1), ids()),
      );
      expect(targets(result)).toEqual([["d1", { documentId: "d1", index: 1 }]]);
      expect(layoutOf(applied(result))[0]).toEqual([
        "d1",
        [key(A, 2), key(A, 1)],
      ]);
    });

    it("그룹이 다르면 group_mismatch, 대상이 없으면 target_missing, 자리가 음수·정수 아님이면 index_out_of_range", () => {
      expect(
        batchDrafts(job(), "st_c", select(key(B, 1)), drop("d4", 0), ids()),
      ).toEqual({ reason: "group_mismatch" });
      expect(
        batchDrafts(
          job(),
          "st_c",
          select(key(A, 1), key(B, 1)),
          drop("d4", 0),
          ids(),
        ),
      ).toEqual({ reason: "group_mismatch" });
      expect(
        batchDrafts(job(), "st_c", select(key(A, 1)), drop("nope", 0), ids()),
      ).toEqual({ reason: "target_missing" });
      expect(
        batchDrafts(job(), "st_c", select(key(A, 1)), drop("d4", -1), ids()),
      ).toEqual({ reason: "index_out_of_range" });
      expect(
        batchDrafts(job(), "st_c", select(key(A, 1)), drop("d4", 0.5), ids()),
      ).toEqual({ reason: "index_out_of_range" });
    });
  });
});

describe("splitTargetOf", () => {
  const select = (...keys: string[]) => groupSelection(new Set(keys), strips());

  it("한 장이고 문서 첫 페이지가 아니면 바로 앞 페이지 뒤에서 나눈다", () => {
    expect(splitTargetOf(select(key(A, 4)), strips())).toEqual({
      documentId: "d2",
      afterPageKey: key(A, 3),
    });
  });

  it("문서 첫 페이지·여러 장·빈 선택은 null", () => {
    expect(splitTargetOf(select(key(A, 3)), strips())).toBeNull();
    expect(splitTargetOf(select(key(A, 2), key(A, 4)), strips())).toBeNull();
    expect(splitTargetOf(select(key(A, 1), key(A, 2)), strips())).toBeNull();
    expect(splitTargetOf([], strips())).toBeNull();
  });
});

describe("formatPageRuns", () => {
  it("이어진 번호를 구간으로 줄인다", () => {
    expect(formatPageRuns([1, 2, 3, 5])).toBe("1–3, 5");
  });

  it("정렬하고 같은 번호는 한 번만 센다", () => {
    expect(formatPageRuns([7, 2, 3, 3, 9, 8])).toBe("2–3, 7–9");
  });

  it("하나·빈 목록", () => {
    expect(formatPageRuns([4])).toBe("4");
    expect(formatPageRuns([])).toBe("");
  });
});
