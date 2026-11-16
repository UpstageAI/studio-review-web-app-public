import { describe, expect, it } from "vitest";

import type {
  FileHighlightsPage,
  FilePagesResponse,
} from "@/lib/review-api/types";
import {
  addChange,
  createSession,
  documentPages,
  documentsOf,
  findResult,
  readReviewDocument,
  type ChangeDraft,
  type HighlightLike,
  type PageSpace,
} from "@/lib/review-model";

import {
  EMPTY_JOB_RESPONSE,
  parseHighlightsByFile,
  readJobResponse,
} from "@/lib/review-api/job-response";
import { MULTI_LAYOUT } from "@/lib/review-model/__tests__/fixtures/fixtures";

import {
  fileProgress,
  imageUrlsFor,
  initialState,
  instructHighlightId,
  jobFiles,
  jobReviewReducer,
  parseHighlightsFor,
  parseVisible,
  type JobReviewState,
} from "../job-review-state";
import type { StoredDraft } from "../draft-store";
import type { StepTab } from "../step-tabs-model";

const tab = (
  kind: StepTab["kind"],
  stepId: string | null,
  id = stepId ?? "layout:none",
): StepTab => ({ id, stepId, kind, type: "", name: null, editable: true });

// 테스트 리터럴만 담으므로 JSON.stringify 로 만들어도 정밀도 손실이 없다.
function twoFileDoc() {
  return readReviewDocument(
    JSON.stringify({
      format: "collection-results/11",
      collection_id: "scol_1",
      configs: { cfg_1: { agent_id: null } },
      steps: {
        st_x: {
          config_id: "cfg_1",
          name: "Extract",
          type: "information-extract",
        },
      },
      jobs: [
        {
          id: "job_1",
          file_groups: {
            base_version: 3,
            groups: [
              {
                group_id: "grp_1",
                layout_step_id: null,
                files: [
                  {
                    file_ref: "job_1#1",
                    file_id: "file_b",
                    name: "b.pdf",
                    input_index: 1,
                  },
                  {
                    file_ref: "job_1#0",
                    file_id: "file_a",
                    name: "a.pdf",
                    num_pages: 2,
                    input_index: 0,
                  },
                ],
              },
            ],
          },
          output: [
            {
              step_id: null,
              base_version: 3,
              content: {
                documents: [
                  {
                    document_id: "doc_1",
                    group_id: "grp_1",
                    label: "invoice",
                    source_files: [
                      { file_ref: "job_1#1", page_ranges: [[1, 1]] },
                      { file_ref: "job_1#0", page_ranges: [[2, 2]] },
                    ],
                  },
                  {
                    document_id: "doc_2",
                    group_id: "grp_1",
                    label: null,
                    source_files: [
                      { file_ref: "job_1#0", page_ranges: [[1, 1]] },
                    ],
                  },
                ],
              },
            },
            {
              id: "occ_1",
              step_id: "st_x",
              base_version: 1,
              content: { amount: 1 },
              document_ids: ["doc_1"],
            },
          ],
        },
      ],
    }),
  );
}

const box = [
  { x: 0.1, y: 0.1 },
  { x: 0.2, y: 0.1 },
  { x: 0.2, y: 0.2 },
];

const hl = (id: string, page: number): HighlightLike => ({
  id,
  _value: id,
  page,
  coordinates: box,
});

function filesResponse(
  id: string,
  status: string,
  pages: number,
  withImages = true,
): FilePagesResponse {
  return {
    id,
    status,
    num_pages: pages,
    pages: Array.from({ length: pages }, (_, i) => ({
      image_url: withImages ? `https://img.test/${id}/${i + 1}.png` : null,
    })),
  };
}

/** 파일 로컬 페이지 `pages` 마다 하이라이트 하나(`p{n}-0`). */
function highlightsPages(pages: readonly number[]): FileHighlightsPage[] {
  return pages.map(page => ({ page, highlights: [hl(`p${page}-0`, page)] }));
}

function loadedHighlights(
  state: JobReviewState,
  fileRef: string,
  fileId: string,
  chunk: number,
  pages: readonly number[],
): JobReviewState {
  return jobReviewReducer(state, {
    type: "FILE_HIGHLIGHTS_LOADED",
    fileRef,
    fileId,
    chunk,
    pages: highlightsPages(pages),
  });
}

function loaded(): JobReviewState {
  const session = createSession(twoFileDoc());
  return jobReviewReducer(initialState("k", "scol_1", "job_1"), {
    type: "LOADED",
    session,
    sourceText: '{"source":1}',
    etag: '"e1"',
    capabilities: null,
    collectionName: "Invoices",
  });
}

describe("jobFiles", () => {
  it("input_index 순으로 파일을 나열한다", () => {
    const job = twoFileDoc().jobs[0]!;
    expect(jobFiles(job).map(file => file.fileRef)).toEqual([
      "job_1#0",
      "job_1#1",
    ]);
    expect(jobFiles(null)).toEqual([]);
  });
});

describe("jobReviewReducer", () => {
  it("LOADED 는 파일을 loading 으로 두고 첫 문서를 고른다", () => {
    const state = loaded();
    expect(state.status).toBe("ready");
    expect(state.selectedDocument).toEqual({
      stepId: null,
      documentId: "doc_1",
    });
    expect(state.files["job_1#0"]).toMatchObject({
      fileId: "file_a",
      status: "loading",
      numPages: 2,
    });
    expect(state.files["job_1#1"]?.numPages).toBeNull();
  });

  it("LOADED 는 initialSelection 의 문서·페이지를 고르고 범위 안으로 줄인다", () => {
    const load = (initialSelection: {
      documentId: string | null;
      pageIndex: number | null;
    }) =>
      jobReviewReducer(initialState("k", "scol_1", "job_1"), {
        type: "LOADED",
        session: createSession(twoFileDoc()),
        sourceText: "{}",
        etag: null,
        capabilities: null,
        collectionName: null,
        initialSelection,
      });
    // doc_1 은 2 쪽: 2 번째 쪽을 고른다.
    let state = load({ documentId: "doc_1", pageIndex: 1 });
    expect(state.selectedDocument).toEqual({
      stepId: null,
      documentId: "doc_1",
    });
    expect(state.selectedPageIndex).toBe(1);
    // 범위를 넘으면 마지막 쪽, 음수면 첫 쪽.
    expect(load({ documentId: "doc_1", pageIndex: 50 }).selectedPageIndex).toBe(
      1,
    );
    expect(load({ documentId: "doc_1", pageIndex: -3 }).selectedPageIndex).toBe(
      0,
    );
    // 두 번째 문서(1 쪽)를 고르면 페이지는 0 으로 준다.
    state = load({ documentId: "doc_2", pageIndex: 9 });
    expect(state.selectedDocument).toEqual({
      stepId: null,
      documentId: "doc_2",
    });
    expect(state.selectedPageIndex).toBe(0);
    // 문서 없이 페이지만 있으면 첫 문서에 적용한다.
    state = load({ documentId: null, pageIndex: 1 });
    expect(state.selectedDocument?.documentId).toBe("doc_1");
    expect(state.selectedPageIndex).toBe(1);
  });

  it("LOADED 는 모르는 문서면 첫 문서·첫 페이지를 고른다", () => {
    const state = jobReviewReducer(initialState("k", "scol_1", "job_1"), {
      type: "LOADED",
      session: createSession(twoFileDoc()),
      sourceText: "{}",
      etag: null,
      capabilities: null,
      collectionName: null,
      initialSelection: { documentId: "doc_nope", pageIndex: 1 },
    });
    expect(state.selectedDocument).toEqual({
      stepId: null,
      documentId: "doc_1",
    });
    expect(state.selectedPageIndex).toBe(0);
    // 없는 선택과 null 은 기존 동작(첫 문서·첫 페이지).
    expect(
      jobReviewReducer(initialState("k", "scol_1", "job_1"), {
        type: "LOADED",
        session: createSession(twoFileDoc()),
        sourceText: "{}",
        etag: null,
        capabilities: null,
        collectionName: null,
        initialSelection: null,
      }).selectedPageIndex,
    ).toBe(0);
  });

  it("FILE_LOADED 는 이미지가 빠졌으면 not_ready, 모르는 파일은 무시한다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "FILE_LOADED",
      fileRef: "job_1#1",
      response: filesResponse("file_b", "PROCESSING", 1, false),
    });
    expect(state.files["job_1#1"]).toMatchObject({
      status: "not_ready",
      numPages: 1,
      parse: {},
      parseChunks: {},
    });
    const same = jobReviewReducer(state, {
      type: "FILE_LOADED",
      fileRef: "other#0",
      response: filesResponse("x", "READY", 1),
    });
    expect(same).toBe(state);
  });

  it("FILE_HIGHLIGHTS_LOADING·LOADED·FAILED 는 묶음 상태를 기록하고 fileId 가 다르면 무시한다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "FILE_LOADED",
      fileRef: "job_1#0",
      response: filesResponse("file_a", "READY", 2),
    });
    state = jobReviewReducer(state, {
      type: "FILE_HIGHLIGHTS_LOADING",
      fileRef: "job_1#0",
      fileId: "file_a",
      chunk: 1,
    });
    expect(state.files["job_1#0"]!.parseChunks).toEqual({ 1: "loading" });

    // 다른 파일 id 의 늦은 응답은 무시한다.
    const stale = loadedHighlights(state, "job_1#0", "file_old", 1, [1, 2]);
    expect(stale).toBe(state);
    const unknown = jobReviewReducer(state, {
      type: "FILE_HIGHLIGHTS_FAILED",
      fileRef: "other#0",
      fileId: "x",
      chunk: 1,
      code: "network_error",
    });
    expect(unknown).toBe(state);

    // 응답에 없는 묶음 안 페이지(2)는 빈 배열로 채운다(파일 쪽수 2 까지만).
    state = loadedHighlights(state, "job_1#0", "file_a", 1, [1]);
    expect(state.files["job_1#0"]!.parseChunks).toEqual({ 1: "ready" });
    expect(state.files["job_1#0"]!.parse).toEqual({
      1: [expect.objectContaining({ id: "p1-0" })],
      2: [],
    });

    state = jobReviewReducer(state, {
      type: "FILE_HIGHLIGHTS_FAILED",
      fileRef: "job_1#0",
      fileId: "file_a",
      chunk: 21,
      code: "network_error",
    });
    expect(state.files["job_1#0"]!.parseChunks).toEqual({
      1: "ready",
      21: "error",
    });
  });

  describe("FILE_HIGHLIGHTS_RETRY", () => {
    function withChunks(): JobReviewState {
      let state = jobReviewReducer(loaded(), {
        type: "FILE_LOADED",
        fileRef: "job_1#0",
        response: filesResponse("file_a", "READY", 60),
      });
      state = loadedHighlights(state, "job_1#0", "file_a", 1, [1]);
      state = jobReviewReducer(state, {
        type: "FILE_HIGHLIGHTS_LOADING",
        fileRef: "job_1#0",
        fileId: "file_a",
        chunk: 41,
      });
      return jobReviewReducer(state, {
        type: "FILE_HIGHLIGHTS_FAILED",
        fileRef: "job_1#0",
        fileId: "file_a",
        chunk: 21,
        code: "network_error",
      });
    }

    it("실패한 묶음만 지우고 받은 묶음·받는 중인 묶음과 하이라이트는 그대로 둔다", () => {
      const state = withChunks();
      const next = jobReviewReducer(state, {
        type: "FILE_HIGHLIGHTS_RETRY",
        fileRef: "job_1#0",
      });
      expect(next.files["job_1#0"]!.parseChunks).toEqual({
        1: "ready",
        41: "loading",
      });
      expect(next.files["job_1#0"]!.parse).toBe(state.files["job_1#0"]!.parse);
    });

    it("실패한 묶음이 없으면 같은 state 를 돌려준다", () => {
      const state = jobReviewReducer(withChunks(), {
        type: "FILE_HIGHLIGHTS_RETRY",
        fileRef: "job_1#0",
      });
      expect(
        jobReviewReducer(state, {
          type: "FILE_HIGHLIGHTS_RETRY",
          fileRef: "job_1#0",
        }),
      ).toBe(state);
    });

    it("없는 fileRef 는 같은 state 를 돌려준다", () => {
      const state = withChunks();
      expect(
        jobReviewReducer(state, {
          type: "FILE_HIGHLIGHTS_RETRY",
          fileRef: "other#0",
        }),
      ).toBe(state);
    });
  });

  it("쪽수를 모르는 파일은 묶음 20 쪽을 모두 채우고, 범위 밖 페이지는 버린다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "FILE_LOADED",
      fileRef: "job_1#1",
      response: {
        id: "file_b",
        status: "READY",
        num_pages: null,
        pages: [],
      },
    });
    state = loadedHighlights(state, "job_1#1", "file_b", 21, [25, 41]);
    const { parse } = state.files["job_1#1"]!;
    expect(Object.keys(parse)).toHaveLength(20);
    expect(parse[21]).toEqual([]);
    expect(parse[25]).toHaveLength(1);
    expect(parse[40]).toEqual([]);
    expect(parse[41]).toBeUndefined();
  });

  it("FILE_LOADED 는 받아 둔 묶음을 초기화한다(다시 받은 파일은 처음부터)", () => {
    let state = jobReviewReducer(loaded(), {
      type: "FILE_LOADED",
      fileRef: "job_1#0",
      response: filesResponse("file_a", "READY", 2),
    });
    state = loadedHighlights(state, "job_1#0", "file_a", 1, [1, 2]);
    expect(Object.keys(state.files["job_1#0"]!.parse)).toHaveLength(2);
    state = jobReviewReducer(state, {
      type: "FILE_LOADED",
      fileRef: "job_1#0",
      response: filesResponse("file_a", "READY", 2),
    });
    expect(state.files["job_1#0"]).toMatchObject({
      parse: {},
      parseChunks: {},
    });
  });

  it("fileProgress 는 받은 파일·페이지 수와 아직 받는 중인지 알린다", () => {
    let state = loaded();
    expect(fileProgress(state.files)).toEqual({
      files: 0,
      totalFiles: 2,
      pages: 0,
      totalPages: 2,
      pending: true,
    });
    state = jobReviewReducer(state, {
      type: "FILE_LOADED",
      fileRef: "job_1#0",
      response: filesResponse("file_a", "READY", 2),
    });
    expect(fileProgress(state.files)).toMatchObject({
      files: 1,
      pages: 2,
      totalPages: 2,
      pending: true,
    });
    state = jobReviewReducer(state, {
      type: "FILE_LOADED",
      fileRef: "job_1#1",
      response: filesResponse("file_b", "PROCESSING", 3, false),
    });
    expect(fileProgress(state.files)).toEqual({
      files: 2,
      totalFiles: 2,
      pages: 2,
      totalPages: 5,
      pending: false,
    });
    state = jobReviewReducer(state, {
      type: "FILE_FAILED",
      fileRef: "job_1#1",
      code: "api_unreachable",
    });
    expect(fileProgress(state.files)).toMatchObject({
      files: 1,
      pending: false,
    });
    expect(fileProgress({})).toEqual({
      files: 0,
      totalFiles: 0,
      pages: 0,
      totalPages: 0,
      pending: false,
    });
  });

  it("문서를 바꾸면 페이지·하이라이트 선택을 비운다", () => {
    let state = loaded();
    state = jobReviewReducer(state, { type: "SELECT_PAGE", index: 1 });
    state = jobReviewReducer(state, { type: "SELECT_HIGHLIGHT", id: "h" });
    state = jobReviewReducer(state, {
      type: "SELECT_DOCUMENT",
      document: { stepId: null, documentId: "doc_2" },
    });
    expect(state).toMatchObject({
      selectedPageIndex: 0,
      selectedHighlightId: null,
    });
  });

  it("Parse 하이라이트는 Parse 탭에서만 그린다", () => {
    let state = loaded();
    expect(parseVisible(state)).toBe(false);
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("parse", "st_parse"),
    });
    expect(parseVisible(state)).toBe(true);
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("structure", null),
    });
    expect(parseVisible(state)).toBe(false);
  });

  it("Job 응답을 받으면 담고, 실패하면 빈 목록으로 둔다", () => {
    let state = loaded();
    expect(state.response.status).toBe("loading");
    state = jobReviewReducer(state, {
      type: "RESPONSE_LOADED",
      data: { ...EMPTY_JOB_RESPONSE, parseStepId: "st_parse" },
    });
    expect(state.response.status).toBe("ready");
    expect(state.response.parseStepId).toBe("st_parse");
    state = jobReviewReducer(state, { type: "RESPONSE_FAILED" });
    expect(state.response).toEqual({
      status: "error",
      ...EMPTY_JOB_RESPONSE,
    });
  });
});

describe("SET_STEP_TAB · 패널 내용", () => {
  it("값 모드에서 탭을 바꾸고, 떠난 탭의 하이라이트 선택은 지운다", () => {
    let state = loaded();
    expect(state.panelTab).toBe("results");
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("parse", "st_parse"),
    });
    expect(state.panelTab).toBe("parse:st_parse");
    expect(parseVisible(state)).toBe(true);
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: "parse:job_1#0:p1-0",
      source: "panel",
    });
    expect(state.selectedHighlightId).toBe("parse:job_1#0:p1-0");
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("instruct", "st_instruct"),
    });
    expect(state.selectedHighlightId).toBeNull();
    expect(parseVisible(state)).toBe(false);
    const cite = instructHighlightId("st_instruct", 0, 1);
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: cite,
      source: "panel",
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_x"),
    });
    expect(state.selectedHighlightId).toBeNull();
    expect(state.highlightSource).toBeNull();
  });

  it("추출값 하이라이트 선택은 탭을 바꿔도 남는다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: "occ_1#/amount",
      source: "panel",
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("parse", "st_parse"),
    });
    expect(state.selectedHighlightId).toBe("occ_1#/amount");
  });

  it("같은 탭이면 그대로", () => {
    const values = {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_x"),
    } as const;
    const state = jobReviewReducer(loaded(), values);
    expect(jobReviewReducer(state, values)).toBe(state);
  });

  it("구성 탭은 패널 내용을 결과로 되돌리고 인용 선택을 지운다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("instruct", "st_instruct"),
    });
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: instructHighlightId("st_instruct", 0, 1),
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("structure", null),
    });
    expect(state.panelTab).toBe("results");
    expect(state.selectedHighlightId).toBeNull();
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_x"),
    });
    expect(state.panelTab).toBe("results");
  });
});

describe("imageUrlsFor · parseHighlightsFor", () => {
  it("문서 페이지 순서로 파일 로컬 페이지를 뷰어 페이지로 옮긴다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "FILE_LOADED",
      fileRef: "job_1#0",
      response: filesResponse("file_a", "READY", 2),
    });
    const pages = documentPages(
      documentsOf(state.session!.current.jobs[0]!)[0]!.document,
    );
    expect(pages).toEqual([
      { file_ref: "job_1#1", page: 1 },
      { file_ref: "job_1#0", page: 2 },
    ]);

    // 두 번째 파일은 아직 없으므로 빈 문자열로 자리를 지킨다.
    expect(imageUrlsFor(pages, state.files)).toEqual([
      "",
      "https://img.test/file_a/2.png",
    ]);
    // 묶음을 받기 전에는 파일 하이라이트가 없다.
    expect(parseHighlightsFor(pages, state.files)).toEqual([]);

    state = loadedHighlights(state, "job_1#0", "file_a", 1, [1, 2]);
    expect(parseHighlightsFor(pages, state.files)).toEqual([
      expect.objectContaining({ id: "parse:job_1#0:p2-0", page: 2 }),
    ]);

    // 페이지 단위: 파일 하이라이트가 있는 페이지는 파일, 없는 페이지(받지 않았거나 빈 페이지)는
    // Job 응답의 Parse 출력을 쓴다. 응답은 병합 페이지(job_1#0 = 1~2쪽, job_1#1 = 3쪽)이고
    // `parseHighlightsByFile` 이 파일 로컬 page·id 로 바꾼다.
    const space: PageSpace = {
      files: [
        { file_ref: "job_1#0", input_index: 0, num_pages: 2, offset: 0 },
        { file_ref: "job_1#1", input_index: 1, num_pages: 1, offset: 2 },
      ],
    };
    const fromResponse = parseHighlightsByFile(
      readJobResponse({
        output: [
          {
            step_id: "st_parse",
            step_type: "document-parse",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  elements: [
                    { id: 9, page: 2, coordinates: box },
                    { id: 7, page: 3, coordinates: box },
                  ],
                }),
              },
            ],
          },
        ],
      }).parse,
      space,
    );
    expect(
      parseHighlightsFor(pages, state.files, fromResponse).map(item => [
        item.id,
        item.page,
      ]),
    ).toEqual([
      ["parse:job_1#1:p1-7", 1],
      ["parse:job_1#0:p2-0", 2],
    ]);

    // 받았지만 요소가 없는 페이지도 Job 응답으로 메운다.
    state = jobReviewReducer(state, {
      type: "FILE_HIGHLIGHTS_LOADED",
      fileRef: "job_1#0",
      fileId: "file_a",
      chunk: 1,
      pages: [],
    });
    expect(
      parseHighlightsFor(pages, state.files, fromResponse).map(item => item.id),
    ).toEqual(["parse:job_1#1:p1-7", "parse:job_1#0:p2-9"]);
  });
});

describe("APPLY · REVERT", () => {
  const draft = (value: number, path = ["amount"]) => ({
    kind: "set_value" as const,
    jobId: "job_1",
    resultId: "occ_1",
    path,
    value,
  });
  const amount = (state: JobReviewState) =>
    (
      findResult(state.session!.current.jobs[0]!, "occ_1")!.content as {
        amount: number;
      }
    ).amount;

  it("값 변경을 세션에 쌓고, 실패하면 이유를 남긴다", () => {
    let state = loaded();
    state = jobReviewReducer(state, { type: "APPLY", draft: draft(5) });
    expect(amount(state)).toBe(5);
    expect(state.session!.entries).toHaveLength(1);
    state = jobReviewReducer(state, {
      type: "APPLY",
      draft: draft(1, ["nope"]),
    });
    expect(state.editError).toBe("path_missing");
    expect(state.session!.entries).toHaveLength(1);
  });

  it("지금 값과 같은 입력은 같은 state 를 돌려준다", () => {
    const state: JobReviewState = { ...loaded(), revertNotice: 1 };
    const next = jobReviewReducer(state, { type: "APPLY", draft: draft(1) });
    expect(next).toBe(state);
    expect(next.session!.entries).toHaveLength(0);
    expect(next.save).toBe(state.save);
    expect(next.revertNotice).toBe(1);
  });

  it("지금 값과 같은 입력은 남아 있던 편집 오류만 지운다", () => {
    const failed = jobReviewReducer(loaded(), {
      type: "APPLY",
      draft: draft(1, ["nope"]),
    });
    expect(failed.editError).toBe("path_missing");
    const next = jobReviewReducer(failed, { type: "APPLY", draft: draft(1) });
    expect(next.editError).toBeNull();
    expect(next.session).toBe(failed.session);
    expect(next.save).toBe(failed.save);
  });

  it("APPLY_BATCH 가 모두 지금 값과 같으면 같은 state 를 돌려준다", () => {
    const state = loaded();
    expect(
      jobReviewReducer(state, {
        type: "APPLY_BATCH",
        drafts: [draft(1), draft(1)],
      }),
    ).toBe(state);
  });

  it("항목들을 되돌리면 원본 값으로 돌아간다", () => {
    let state = loaded();
    state = jobReviewReducer(state, { type: "APPLY", draft: draft(5) });
    const first = state.session!.entries[0]!.id;
    state = jobReviewReducer(state, { type: "REVERT", entryIds: [first] });
    expect(amount(state)).toBe(1);
    expect(state.session!.entries).toHaveLength(0);
    const same = jobReviewReducer(state, { type: "REVERT", entryIds: [] });
    expect(same).toBe(state);
  });
});

describe("SET_STEP_TAB · 구성 편집 뒤 선택", () => {
  it("구성 탭은 선택 문서가 다른 배치 보기에 있으면 그 보기의 첫 문서를 고른다", () => {
    const multi = readReviewDocument(MULTI_LAYOUT);
    let state = jobReviewReducer(
      initialState("k", "scol_1", multi.jobs[0]!.id),
      {
        type: "LOADED",
        session: createSession(multi),
        sourceText: "{}",
        etag: null,
        capabilities: null,
        collectionName: null,
      },
    );
    expect(state.selectedDocument).toEqual({
      stepId: "st_classify_a",
      documentId: "doc_1",
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("structure", "st_classify_b"),
    });
    expect(state.selectedDocument).toEqual({
      stepId: "st_classify_b",
      documentId: "doc_1",
    });
    expect(state.selectedPageIndex).toBe(0);
    // 값 탭은 모든 문서를 보이므로 선택을 그대로 둔다.
    const values = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_extract"),
    });
    expect(values.selectedDocument).toEqual(state.selectedDocument);
  });

  it("구성 모드는 하이라이트를 그리지 않으므로 선택을 지우고, 값 모드로 돌아와도 Parse 선택은 없다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: "occ_1#/amount",
      source: "panel",
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("structure", null),
    });
    expect(state.mode).toBe("structure");
    expect(parseVisible(state)).toBe(false);
    expect(state.selectedHighlightId).toBeNull();
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: "parse:job_1#0:p1-0",
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_x"),
    });
    expect(parseVisible(state)).toBe(false);
    expect(state.selectedHighlightId).toBeNull();
    expect(
      jobReviewReducer(state, {
        type: "SET_STEP_TAB",
        tab: tab("values", "st_x"),
      }),
    ).toBe(state);
  });

  it("선택 문서가 사라지면 같은 보기의 가까운 문서를 고른다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "SELECT_DOCUMENT",
      document: { stepId: null, documentId: "doc_2" },
    });
    state = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "merge_documents",
        jobId: "job_1",
        stepId: null,
        intoDocumentId: "doc_1",
        fromDocumentId: "doc_2",
      },
    });
    expect(state.editError).toBeNull();
    expect(state.selectedDocument).toEqual({
      stepId: null,
      documentId: "doc_1",
    });
    expect(state.selectedPageIndex).toBe(0);
    const job = state.session!.current.jobs[0]!;
    expect(documentsOf(job)).toHaveLength(1);
  });

  it("세 문서에서 선택 문서가 사라지면 그 자리의 문서, 마지막이었으면 새 마지막 문서", () => {
    // doc_1 을 나눠 [doc_1, review-doc-new, doc_2] 로 만든다.
    const split = jobReviewReducer(loaded(), {
      type: "APPLY",
      draft: {
        kind: "split_document",
        jobId: "job_1",
        stepId: null,
        documentId: "doc_1",
        afterPage: { file_ref: "job_1#1", page: 1 },
        newDocumentId: "review-doc-new",
      },
    });
    const merge = (fromDocumentId: string) =>
      ({
        type: "APPLY",
        draft: {
          kind: "merge_documents",
          jobId: "job_1",
          stepId: null,
          intoDocumentId: "doc_1",
          fromDocumentId,
        },
      }) as const;

    // 가운데 문서를 보다가 사라지면 그 자리에 온 doc_2.
    let middle = jobReviewReducer(split, {
      type: "SELECT_DOCUMENT",
      document: { stepId: null, documentId: "review-doc-new" },
    });
    middle = jobReviewReducer(middle, merge("review-doc-new"));
    expect(middle.editError).toBeNull();
    expect(middle.selectedDocument).toEqual({
      stepId: null,
      documentId: "doc_2",
    });
    expect(middle.selectedPageIndex).toBe(0);

    // 마지막 문서를 보다가 사라지면 새 마지막 문서.
    let last = jobReviewReducer(split, {
      type: "SELECT_DOCUMENT",
      document: { stepId: null, documentId: "doc_2" },
    });
    last = jobReviewReducer(last, merge("doc_2"));
    expect(last.editError).toBeNull();
    expect(last.selectedDocument).toEqual({
      stepId: null,
      documentId: "review-doc-new",
    });
  });

  it("move_pages 로 여러 페이지를 보내면 문서가 남으면 선택·클램프, 비면 그 자리의 문서", () => {
    // doc_1 = [b#1, a#2], doc_2 = [a#1]. 2 쪽을 보다가 a#2 를 보내면 1 쪽 문서가 되어 0 으로.
    let state = jobReviewReducer(loaded(), { type: "SELECT_PAGE", index: 1 });
    state = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "move_pages",
        jobId: "job_1",
        stepId: null,
        fromDocumentId: "doc_1",
        pages: [{ file_ref: "job_1#0", page: 2 }],
        to: { documentId: "doc_2", index: 0 },
      },
    });
    expect(state.editError).toBeNull();
    expect(state.selectedDocument).toEqual({
      stepId: null,
      documentId: "doc_1",
    });
    expect(state.selectedPageIndex).toBe(0);

    // 두 페이지를 한 번에 보내면 doc_1 이 지워지고 그 자리(첫 문서)의 doc_2 를 고른다.
    let gone = jobReviewReducer(loaded(), { type: "SELECT_PAGE", index: 1 });
    gone = jobReviewReducer(gone, {
      type: "APPLY",
      draft: {
        kind: "move_pages",
        jobId: "job_1",
        stepId: null,
        fromDocumentId: "doc_1",
        pages: [
          { file_ref: "job_1#1", page: 1 },
          { file_ref: "job_1#0", page: 2 },
        ],
        to: { documentId: "doc_2", index: 1 },
      },
    });
    expect(gone.editError).toBeNull();
    expect(gone.selectedDocument).toEqual({
      stepId: null,
      documentId: "doc_2",
    });
    expect(gone.selectedPageIndex).toBe(0);
    const docs = documentsOf(gone.session!.current.jobs[0]!);
    expect(docs).toHaveLength(1);
    expect(documentPages(docs[0]!.document)).toEqual([
      { file_ref: "job_1#0", page: 1 },
      { file_ref: "job_1#1", page: 1 },
      { file_ref: "job_1#0", page: 2 },
    ]);
  });

  it("나눈 뒤 새 문서를 고르면 그 문서의 첫 페이지(= 나누기 전에 보던 페이지)", () => {
    let state = jobReviewReducer(loaded(), { type: "SELECT_PAGE", index: 1 });
    state = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "split_document",
        jobId: "job_1",
        stepId: null,
        documentId: "doc_1",
        afterPage: { file_ref: "job_1#1", page: 1 },
        newDocumentId: "review-doc-new",
      },
    });
    state = jobReviewReducer(state, {
      type: "SELECT_DOCUMENT",
      document: { stepId: null, documentId: "review-doc-new" },
    });
    expect(state.selectedDocument).toEqual({
      stepId: null,
      documentId: "review-doc-new",
    });
    expect(state.selectedPageIndex).toBe(0);
    const created = documentsOf(state.session!.current.jobs[0]!).find(
      item => item.document.document_id === "review-doc-new",
    );
    expect(documentPages(created!.document)).toEqual([
      { file_ref: "job_1#0", page: 2 },
    ]);
  });

  it("분리 뒤 선택 문서의 페이지 위치를 페이지 수 안으로 줄인다", () => {
    let state = loaded();
    state = jobReviewReducer(state, { type: "SELECT_PAGE", index: 1 });
    state = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "split_document",
        jobId: "job_1",
        stepId: null,
        documentId: "doc_1",
        afterPage: { file_ref: "job_1#1", page: 1 },
        newDocumentId: "review-doc-new",
      },
    });
    expect(state.selectedDocument?.documentId).toBe("doc_1");
    expect(state.selectedPageIndex).toBe(0);
    const ids = documentsOf(state.session!.current.jobs[0]!).map(
      item => item.document.document_id,
    );
    expect(ids).toEqual(["doc_1", "review-doc-new", "doc_2"]);
  });

  it("적용되지 않은 사유를 남기고 모드를 바꾸면 지운다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "reorder_documents",
        jobId: "job_1",
        stepId: null,
        documentId: "nope",
        toIndex: 0,
      },
    });
    expect(state.editError).toBe("document_missing");
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("structure", null),
    });
    expect(state.editError).toBeNull();
  });
});

describe("트레이 · 저장 상태", () => {
  const setAmount = (value: number) => ({
    type: "APPLY" as const,
    draft: {
      kind: "set_value" as const,
      jobId: "job_1",
      resultId: "occ_1",
      path: ["amount"],
      value,
    },
  });

  it("되돌리면 함께 빠진 뒤 항목 수를 알리고, 다음 편집에서 지운다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "split_document",
        jobId: "job_1",
        stepId: null,
        documentId: "doc_1",
        afterPage: { file_ref: "job_1#1", page: 1 },
        newDocumentId: "review-doc-new",
      },
    });
    state = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "set_label",
        jobId: "job_1",
        stepId: null,
        documentId: "review-doc-new",
        label: "receipt",
      },
    });
    const split = state.session!.entries[0]!.id;
    state = jobReviewReducer(state, { type: "REVERT", entryIds: [split] });
    expect(state.session!.entries).toHaveLength(0);
    expect(state.revertNotice).toBe(1);
    state = jobReviewReducer(state, setAmount(2));
    expect(state.revertNotice).toBeNull();
  });

  it("저장 중에는 편집·되돌리기·모드 전환을 받지 않는다", () => {
    let state = jobReviewReducer(loaded(), setAmount(5));
    state = jobReviewReducer(state, { type: "SAVE_STARTED" });
    state = jobReviewReducer(state, {
      type: "SAVE_POLLING",
      importId: "rvop_1",
    });
    expect(jobReviewReducer(state, setAmount(7))).toBe(state);
    expect(
      jobReviewReducer(state, {
        type: "REVERT",
        entryIds: [state.session!.entries[0]!.id],
      }),
    ).toBe(state);
    expect(
      jobReviewReducer(state, {
        type: "SET_STEP_TAB",
        tab: tab("structure", null),
      }),
    ).toBe(state);
  });

  it("반영되면 세션을 바꾸고 다시 불러온 뒤 저장됨으로 끝난다", () => {
    let state = jobReviewReducer(loaded(), setAmount(5));
    state = jobReviewReducer(state, {
      type: "FILE_LOADED",
      fileRef: "job_1#0",
      response: filesResponse("file_a", "READY", 2),
    });
    state = jobReviewReducer(state, { type: "SAVE_STARTED" });
    const committed = createSession(state.session!.current);
    state = jobReviewReducer(state, {
      type: "SAVE_COMMITTED",
      session: committed,
      importId: "rvop_1",
      revision: 4,
      partial: false,
    });
    expect(state.session!.entries).toHaveLength(0);
    expect(state.save).toMatchObject({
      phase: "reloading",
      importId: "rvop_1",
    });

    // 다른 요청(화면 전환 전)의 응답은 버린다.
    const fresh = createSession(twoFileDoc());
    expect(
      jobReviewReducer(state, {
        type: "RELOADED",
        requestKey: "other",
        session: fresh,
        sourceText: '{"source":2}',
        etag: '"e2"',
      }),
    ).toBe(state);

    const files = state.files;
    state = jobReviewReducer(state, {
      type: "RELOADED",
      requestKey: "k",
      session: fresh,
      sourceText: '{"source":2}',
      etag: '"e2"',
    });
    expect(state.session).toBe(fresh);
    expect(state.etag).toBe('"e2"');
    expect(state.files["job_1#0"]).toBe(files["job_1#0"]);
    expect(state.save).toEqual({
      phase: "saved",
      importId: "rvop_1",
      revision: 4,
      partial: false,
      reloadFailed: null,
    });
    // 다음 편집은 저장 결과 안내를 지운다.
    state = jobReviewReducer(state, setAmount(9));
    expect(state.save).toEqual({ phase: "idle" });
  });

  it("다시 불러오기에 실패하면 저장됨에 사유를 남긴다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "SAVE_COMMITTED",
      session: createSession(twoFileDoc()),
      importId: "rvop_1",
      revision: null,
      partial: true,
    });
    state = jobReviewReducer(state, {
      type: "RELOAD_FAILED",
      requestKey: "k",
      code: "network_error",
    });
    expect(state.save).toMatchObject({
      phase: "saved",
      partial: true,
      reloadFailed: "network_error",
    });
  });

  it("충돌은 트레이를 열고, 편집해도 다시 불러올 때까지 남는다", () => {
    let state = jobReviewReducer(loaded(), setAmount(5));
    state = jobReviewReducer(state, {
      type: "SAVE_FINISHED",
      status: {
        phase: "conflict",
        importId: "rvop_1",
        conflict: {
          entryIds: ["change-1"],
          resultIds: ["occ_1"],
          structure: false,
          count: 1,
        },
      },
      openTray: true,
    });
    expect(state.trayOpen).toBe(true);
    state = jobReviewReducer(state, setAmount(6));
    expect(state.save.phase).toBe("conflict");
    state = jobReviewReducer(state, { type: "RELOAD_STARTED" });
    expect(state.save).toMatchObject({ phase: "reloading", importId: null });
    state = jobReviewReducer(state, {
      type: "RELOADED",
      requestKey: "k",
      session: createSession(twoFileDoc()),
      sourceText: '{"source":2}',
      etag: null,
    });
    expect(state.save).toEqual({ phase: "reloaded" });
    expect(state.session!.entries).toHaveLength(0);
    expect(state.trayOpen).toBe(true);
    state = jobReviewReducer(state, { type: "CLOSE_TRAY" });
    expect(state.trayOpen).toBe(false);
  });
});

describe("전체 JSON — sourceText · APPLY_MANY · OPEN_JSON", () => {
  const amount = (value: number) =>
    ({
      kind: "set_value",
      jobId: "job_1",
      resultId: "occ_1",
      path: ["amount"],
      value,
    }) as const;

  it("LOADED·RELOADED 는 원본 텍스트를 담는다", () => {
    let state = loaded();
    expect(state.sourceText).toBe('{"source":1}');
    state = jobReviewReducer(state, { type: "RELOAD_STARTED" });
    state = jobReviewReducer(state, {
      type: "RELOADED",
      requestKey: "k",
      session: createSession(twoFileDoc()),
      sourceText: '{"source":2}',
      etag: null,
    });
    expect(state.sourceText).toBe('{"source":2}');
  });

  it("전부 적용되면 한 번에 쌓고 시트를 닫고 트레이를 연다", () => {
    let state = jobReviewReducer(loaded(), { type: "OPEN_JSON" });
    expect(state.jsonSheetOpen).toBe(true);
    state = jobReviewReducer(state, {
      type: "APPLY_MANY",
      drafts: [
        amount(2),
        {
          kind: "set_label",
          jobId: "job_1",
          stepId: null,
          documentId: "doc_2",
          label: "receipt",
        },
      ],
    });
    expect(state.session!.entries.map(entry => entry.kind)).toEqual([
      "set_value",
      "set_label",
    ]);
    expect(state.jsonSheetOpen).toBe(false);
    expect(state.trayOpen).toBe(true);
    expect(state.importError).toBeNull();
    expect(state.importNotice).toEqual({ count: 2, source: "json" });
    state = jobReviewReducer(state, { type: "CLOSE_TRAY" });
    expect(state.importNotice).toBeNull();
  });

  it("하나라도 실패하면 세션을 바꾸지 않고 어느 항목인지 남긴다", () => {
    const before = jobReviewReducer(loaded(), { type: "OPEN_JSON" });
    const state = jobReviewReducer(before, {
      type: "APPLY_MANY",
      drafts: [
        amount(2),
        {
          kind: "set_value",
          jobId: "job_1",
          resultId: "occ_missing",
          path: ["amount"],
          value: 3,
        },
      ],
    });
    expect(state.session).toBe(before.session);
    expect(state.editError).toBe("result_missing");
    expect(state.importError).toEqual({ index: 1, reason: "result_missing" });
    expect(state.jsonSheetOpen).toBe(true);
    // 시트를 닫으면 실패 표시도 지운다.
    expect(
      jobReviewReducer(state, { type: "CLOSE_JSON" }).importError,
    ).toBeNull();
  });

  it("지금 값과 같은 항목은 세지 않고 실제로 생긴 변경 수를 안내한다", () => {
    const state = jobReviewReducer(loaded(), {
      type: "APPLY_MANY",
      drafts: [
        amount(1),
        {
          kind: "set_label",
          jobId: "job_1",
          stepId: null,
          documentId: "doc_2",
          label: "receipt",
        },
        amount(1),
      ],
    });
    expect(state.session!.entries).toHaveLength(1);
    expect(state.importNotice).toEqual({ count: 1, source: "json" });
  });

  it("모두 지금 값과 같으면 세션은 그대로 두고 0 건을 안내한다", () => {
    const base: JobReviewState = {
      ...jobReviewReducer(loaded(), { type: "OPEN_JSON" }),
      importError: { index: 0, reason: "result_missing" },
      revertNotice: 1,
      save: {
        phase: "saved",
        importId: "rvop_1",
        revision: 4,
        partial: false,
        reloadFailed: null,
      },
    };
    const state = jobReviewReducer(base, {
      type: "APPLY_MANY",
      drafts: [amount(1)],
    });
    expect(state.session).toBe(base.session);
    expect(state.importError).toBeNull();
    expect(state.importNotice).toEqual({ count: 0, source: "json" });
    expect(state.draft).toBe(base.draft);
    expect(state.jsonSheetOpen).toBe(false);
    expect(state.trayOpen).toBe(true);
    expect(state.revertNotice).toBe(1);
    // 0 건 안내가 보이도록 지난 저장 결과 안내는 거둔다(저장할 것이 생기지는 않는다).
    expect(state.save).toEqual({ phase: "idle" });
  });

  it("저장 중이거나 항목이 없으면 그대로", () => {
    const state = loaded();
    expect(jobReviewReducer(state, { type: "APPLY_MANY", drafts: [] })).toBe(
      state,
    );
    const saving = jobReviewReducer(state, { type: "SAVE_STARTED" });
    expect(
      jobReviewReducer(saving, { type: "APPLY_MANY", drafts: [amount(2)] }),
    ).toBe(saving);
  });
});

describe("SET_STEP_TAB", () => {
  it("구성 탭은 구성 모드, Parse 요소를 보이고 추출값 선택을 지운다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: "occ_1#/amount",
      source: "panel",
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("structure", null),
    });
    expect(state).toMatchObject({
      stepTab: "layout:none",
      mode: "structure",
      panelTab: "results",
      selectedHighlightId: null,
      highlightSource: null,
    });
    expect(parseVisible(state)).toBe(false);
  });

  it("값 탭은 값 모드 + 결과, 다른 Step 결과의 추출값 선택·호버를 지운다", () => {
    let state = loaded();
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("instruct", "st_ins"),
    });
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: "occ_1#/amount",
      source: "panel",
    });
    state = jobReviewReducer(state, {
      type: "HOVER_HIGHLIGHT",
      id: "occ_1#/amount",
    });
    const same = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_x"),
    });
    expect(same).toMatchObject({
      stepTab: "st_x",
      mode: "values",
      panelTab: "results",
      selectedHighlightId: "occ_1#/amount",
      hoveredHighlightId: "occ_1#/amount",
    });
    const other = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_y"),
    });
    expect(other).toMatchObject({
      stepTab: "st_y",
      selectedHighlightId: null,
      highlightSource: null,
      hoveredHighlightId: null,
    });
  });

  it("Parse·Instruct 탭은 값 모드 + 그 출력 탭, 떠난 탭의 하이라이트를 지운다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "SET_STEP_TAB",
      tab: tab("structure", null),
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("parse", "st_parse"),
    });
    expect(state).toMatchObject({
      stepTab: "st_parse",
      mode: "values",
      panelTab: "parse:st_parse",
    });
    expect(parseVisible(state)).toBe(true);
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: "parse:job_1#0:p1-0",
      source: "panel",
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("instruct", "st_ins"),
    });
    expect(state).toMatchObject({
      stepTab: "st_ins",
      panelTab: "instruct:st_ins",
      selectedHighlightId: null,
    });
    state = jobReviewReducer(state, {
      type: "SELECT_HIGHLIGHT",
      id: instructHighlightId("st_ins", 0, 1),
    });
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_x"),
    });
    expect(state.panelTab).toBe("results");
    expect(state.selectedHighlightId).toBeNull();
  });

  it("같은 탭이면 그대로, 저장 중이면 무시한다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_x"),
    });
    expect(
      jobReviewReducer(state, {
        type: "SET_STEP_TAB",
        tab: tab("values", "st_x"),
      }),
    ).toBe(state);
    state = jobReviewReducer(state, { type: "SAVE_STARTED" });
    expect(
      jobReviewReducer(state, {
        type: "SET_STEP_TAB",
        tab: tab("structure", null),
      }),
    ).toBe(state);
  });

  it("LOADED 는 탭 선택을 비우고 RELOADED 는 유지한다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "SET_STEP_TAB",
      tab: tab("values", "st_x"),
    });
    state = jobReviewReducer(state, {
      type: "RELOADED",
      requestKey: "k",
      session: createSession(twoFileDoc()),
      sourceText: "{}",
      etag: null,
    });
    expect(state.stepTab).toBe("st_x");
    state = jobReviewReducer(state, {
      type: "LOADED",
      session: createSession(twoFileDoc()),
      sourceText: "{}",
      etag: null,
      capabilities: null,
      collectionName: null,
    });
    expect(state.stepTab).toBeNull();
  });
});

describe("REVERT_ALL", () => {
  const setAmount = (value: number) => ({
    type: "APPLY" as const,
    draft: {
      kind: "set_value" as const,
      jobId: "job_1",
      resultId: "occ_1",
      path: ["amount"],
      value,
    },
  });
  const setLabel = {
    type: "APPLY" as const,
    draft: {
      kind: "set_label" as const,
      jobId: "job_1",
      stepId: null,
      documentId: "doc_1",
      label: "receipt",
    },
  };

  it("모든 항목을 버리고 원본으로 돌아가며 버린 수를 알린다", () => {
    let state = jobReviewReducer(loaded(), setAmount(5));
    state = jobReviewReducer(state, setLabel);
    state = jobReviewReducer(state, {
      type: "SET_STEP_TAB",
      tab: {
        id: "st_x",
        stepId: "st_x",
        kind: "values",
        type: "",
        name: null,
        editable: true,
      },
    });
    const before = state;
    state = jobReviewReducer(state, { type: "REVERT_ALL" });
    expect(state.session!.entries).toHaveLength(0);
    expect(state.session!.current).toBe(state.session!.base);
    expect(state.revertAllNotice).toBe(2);
    expect(state.sourceText).toBe(before.sourceText);
    expect(state.etag).toBe(before.etag);
    expect(state.stepTab).toBe("st_x");
    state = jobReviewReducer(state, setAmount(3));
    expect(state.revertAllNotice).toBeNull();
  });

  it("항목이 없거나 저장 중이면 무시한다", () => {
    const empty = loaded();
    expect(jobReviewReducer(empty, { type: "REVERT_ALL" })).toBe(empty);
    let state = jobReviewReducer(loaded(), setAmount(5));
    state = jobReviewReducer(state, { type: "SAVE_STARTED" });
    expect(jobReviewReducer(state, { type: "REVERT_ALL" })).toBe(state);
  });

  it("충돌 상태는 남기고 지난 저장 안내·가져오기 안내는 지운다", () => {
    let state = jobReviewReducer(loaded(), setAmount(5));
    state = jobReviewReducer(state, {
      type: "SAVE_FINISHED",
      status: {
        phase: "conflict",
        importId: "rvop_1",
        conflict: {
          entryIds: [],
          resultIds: ["occ_1"],
          structure: false,
          count: 1,
        },
      },
    });
    state = {
      ...state,
      importNotice: { count: 1, source: "json" },
      revertNotice: 1,
    };
    state = jobReviewReducer(state, { type: "REVERT_ALL" });
    expect(state.save.phase).toBe("conflict");
    expect(state.importNotice).toBeNull();
    expect(state.revertNotice).toBeNull();

    let failed = jobReviewReducer(loaded(), setAmount(5));
    failed = jobReviewReducer(failed, {
      type: "SAVE_FINISHED",
      status: { phase: "no_change", importId: null },
    });
    failed = jobReviewReducer(failed, { type: "REVERT_ALL" });
    expect(failed.save).toEqual({ phase: "idle" });
  });
});

describe("브라우저 임시 저장 — DRAFT_* · APPLY_MANY source", () => {
  const stored = (count = 1): StoredDraft => ({
    version: 1,
    savedAt: "2026-10-27T00:00:00.000Z",
    jobId: "job_1",
    structureVersion: 3,
    resultVersions: { occ_1: 1 },
    drafts: Array.from({ length: count }, (_, i) => ({
      kind: "set_value" as const,
      jobId: "job_1",
      resultId: "occ_1",
      path: ["amount"],
      value: i + 2,
    })),
  });
  const found = () =>
    jobReviewReducer(loaded(), { type: "DRAFT_CHECKED", stored: stored() });

  it("초기·LOADED 는 unchecked 이고 DRAFT_CHECKED 는 unchecked 에서만 받는다", () => {
    expect(initialState("k", "scol_1", "job_1").draft).toEqual({
      status: "unchecked",
    });
    const state = loaded();
    expect(state.draft).toEqual({ status: "unchecked" });
    const none = jobReviewReducer(state, {
      type: "DRAFT_CHECKED",
      stored: null,
    });
    expect(none.draft).toEqual({ status: "none" });
    expect(
      jobReviewReducer(none, { type: "DRAFT_CHECKED", stored: stored() }),
    ).toBe(none);
    const checked = jobReviewReducer(state, {
      type: "DRAFT_CHECKED",
      stored: stored(2),
    });
    expect(checked.draft).toEqual({ status: "found", stored: stored(2) });
    expect(
      jobReviewReducer(checked, { type: "DRAFT_CHECKED", stored: null }),
    ).toBe(checked);
    // 다시 불러오면(LOADED) 다시 읽는다. RELOADED 는 유지한다.
    expect(
      jobReviewReducer(checked, {
        type: "LOADED",
        session: createSession(twoFileDoc()),
        sourceText: "{}",
        etag: null,
        capabilities: null,
        collectionName: null,
      }).draft,
    ).toEqual({ status: "unchecked" });
    expect(
      jobReviewReducer(checked, {
        type: "RELOADED",
        requestKey: "k",
        session: createSession(twoFileDoc()),
        sourceText: "{}",
        etag: null,
      }).draft,
    ).toEqual(checked.draft);
  });

  it("DRAFT_DISMISSED 는 found 를 none 으로 돌리고(복원 실패 표시도 함께) JSON 오류는 그대로 둔다", () => {
    const base = found();
    const state = {
      ...base,
      draft:
        base.draft.status === "found"
          ? {
              ...base.draft,
              restoreError: { index: 0, reason: "result_missing" as const },
            }
          : base.draft,
      importError: { index: 1, reason: "document_missing" as const },
    };
    const dismissed = jobReviewReducer(state, { type: "DRAFT_DISMISSED" });
    expect(dismissed.draft).toEqual({ status: "none" });
    expect(dismissed.importError).toEqual(state.importError);
    expect(jobReviewReducer(dismissed, { type: "DRAFT_DISMISSED" })).toBe(
      dismissed,
    );
  });

  it("DRAFT_WRITE_FAILED 는 사유와 함께 write_failed 로, 같은 사유·크기면 같은 상태, 읽기 전·found 에서는 무시", () => {
    const none = jobReviewReducer(loaded(), {
      type: "DRAFT_CHECKED",
      stored: null,
    });
    const failed = jobReviewReducer(none, {
      type: "DRAFT_WRITE_FAILED",
      reason: "too_large",
      bytes: 3_000_000,
    });
    expect(failed.draft).toEqual({
      status: "write_failed",
      reason: "too_large",
      bytes: 3_000_000,
    });
    expect(
      jobReviewReducer(failed, {
        type: "DRAFT_WRITE_FAILED",
        reason: "too_large",
        bytes: 3_000_000,
      }),
    ).toBe(failed);
    expect(
      jobReviewReducer(failed, {
        type: "DRAFT_WRITE_FAILED",
        reason: "too_large",
        bytes: 3_000_001,
      }).draft,
    ).toEqual({
      status: "write_failed",
      reason: "too_large",
      bytes: 3_000_001,
    });
    // 같은 크기라도 사유가 바뀌면(저장소가 가득 참) 그 사유로 바꾼다.
    expect(
      jobReviewReducer(failed, {
        type: "DRAFT_WRITE_FAILED",
        reason: "storage_full",
        bytes: 3_000_000,
      }).draft,
    ).toEqual({
      status: "write_failed",
      reason: "storage_full",
      bytes: 3_000_000,
    });
    const unchecked = loaded();
    expect(
      jobReviewReducer(unchecked, {
        type: "DRAFT_WRITE_FAILED",
        reason: "storage_full",
        bytes: 1,
      }),
    ).toBe(unchecked);
    const foundState = found();
    expect(
      jobReviewReducer(foundState, {
        type: "DRAFT_WRITE_FAILED",
        reason: "storage_full",
        bytes: 1,
      }),
    ).toBe(foundState);
    // 다시 쓰이면 안내를 거둔다. write_failed 가 아니면 그대로.
    const written = jobReviewReducer(failed, { type: "DRAFT_WRITTEN" });
    expect(written.draft).toEqual({ status: "none" });
    expect(jobReviewReducer(written, { type: "DRAFT_WRITTEN" })).toBe(written);
    expect(jobReviewReducer(foundState, { type: "DRAFT_WRITTEN" })).toBe(
      foundState,
    );
  });

  it("APPLY_MANY source draft 는 성공하면 복원 알림과 함께 배너를 거두고, 실패하면 found 를 둔다", () => {
    const state = found();
    const restored = jobReviewReducer(state, {
      type: "APPLY_MANY",
      drafts: state.draft.status === "found" ? state.draft.stored.drafts : [],
      source: "draft",
    });
    expect(restored.session!.entries).toHaveLength(1);
    expect(restored.draft).toEqual({ status: "none" });
    expect(restored.importNotice).toEqual({ count: 1, source: "draft" });
    expect(restored.importError).toBeNull();
    expect(restored.trayOpen).toBe(true);

    const failed = jobReviewReducer(state, {
      type: "APPLY_MANY",
      drafts: [
        {
          kind: "set_value",
          jobId: "job_1",
          resultId: "occ_missing",
          path: ["amount"],
          value: 3,
        },
      ],
      source: "draft",
    });
    expect(failed.session).toBe(state.session);
    expect(failed.draft).toEqual({
      ...state.draft,
      restoreError: { index: 0, reason: "result_missing" },
    });
    expect(failed.importError).toBeNull();
    expect(failed.importNotice).toBeNull();
    // JSON 시트를 열고 닫아도 복원 실패 표시는 남는다.
    const opened = jobReviewReducer(failed, { type: "OPEN_JSON" });
    const closed = jobReviewReducer(opened, { type: "CLOSE_JSON" });
    expect(closed.draft).toEqual(failed.draft);
  });

  it("모양이 깨진 임시 저장을 복원하면 던지지 않고 복원 오류로 보인다", () => {
    const broken = [
      {
        kind: "set_value",
        jobId: "job_1",
        resultId: "occ_1",
        path: "a",
        value: 3,
      },
      {
        kind: "set_value",
        jobId: "job_1",
        resultId: "occ_1",
        path: 5,
        value: 3,
      },
      {
        kind: "set_label",
        jobId: "job_1",
        stepId: null,
        documentId: "doc_1",
        label: 5,
      },
      {
        kind: "replace_structure",
        jobId: "job_1",
        fileGroups: null,
        layouts: [],
      },
    ] as unknown as ChangeDraft[];
    for (const draft of broken) {
      const state = found();
      // 리듀서 밖에서 그대로 적용하면 던지는 입력이다.
      expect(() => addChange(state.session!, draft)).toThrow();
      const next = jobReviewReducer(state, {
        type: "APPLY_MANY",
        drafts: [draft],
        source: "draft",
      });
      expect(next.session).toBe(state.session);
      expect(next.draft).toEqual({
        ...state.draft,
        restoreError: { index: 0, reason: "target_missing" },
      });
      expect(next.editError).toBe("target_missing");
      expect(next.importError).toBeNull();
    }
  });

  it("복원할 변경이 모두 지금 값과 같으면 세션은 그대로 두고 0 건 안내와 함께 배너를 거둔다", () => {
    const base: JobReviewState = { ...found(), revertNotice: 1 };
    const state = jobReviewReducer(base, {
      type: "APPLY_MANY",
      drafts: [
        {
          kind: "set_value",
          jobId: "job_1",
          resultId: "occ_1",
          path: ["amount"],
          value: 1,
        },
      ],
      source: "draft",
    });
    expect(state.session).toBe(base.session);
    expect(state.importNotice).toEqual({ count: 0, source: "draft" });
    expect(state.draft).toEqual({ status: "none" });
    expect(state.trayOpen).toBe(true);
    expect(state.jsonSheetOpen).toBe(false);
    expect(state.revertNotice).toBe(1);
  });

  it("JSON 이 모두 지금 값과 같으면 복원 배너(found)는 그대로", () => {
    const base = found();
    const state = jobReviewReducer(base, {
      type: "APPLY_MANY",
      drafts: [
        {
          kind: "set_value",
          jobId: "job_1",
          resultId: "occ_1",
          path: ["amount"],
          value: 1,
        },
      ],
      source: "json",
    });
    expect(state.session).toBe(base.session);
    expect(state.importError).toBeNull();
    expect(state.draft).toBe(base.draft);
  });

  it("JSON 가져오기 실패는 importError 에만 남고 복원 배너(found)는 그대로", () => {
    const state = jobReviewReducer(found(), { type: "OPEN_JSON" });
    const failed = jobReviewReducer(state, {
      type: "APPLY_MANY",
      drafts: [
        {
          kind: "set_value",
          jobId: "job_1",
          resultId: "occ_missing",
          path: ["amount"],
          value: 3,
        },
      ],
      source: "json",
    });
    expect(failed.importError).toEqual({ index: 0, reason: "result_missing" });
    expect(failed.draft).toBe(state.draft);
    const closed = jobReviewReducer(failed, { type: "CLOSE_JSON" });
    expect(closed.importError).toBeNull();
    expect(closed.draft).toBe(state.draft);
  });

  it("복원 실패 뒤 JSON 가져오기가 실패해도 배너의 복원 실패 사유는 바뀌지 않는다", () => {
    const missing = (resultId: string) => ({
      kind: "set_value" as const,
      jobId: "job_1",
      resultId,
      path: ["amount"],
      value: 3,
    });
    const restoreFailed = jobReviewReducer(found(), {
      type: "APPLY_MANY",
      drafts: [missing("occ_missing")],
      source: "draft",
    });
    const jsonFailed = jobReviewReducer(restoreFailed, {
      type: "APPLY_MANY",
      drafts: [
        {
          kind: "set_value",
          jobId: "job_1",
          resultId: "occ_1",
          path: ["amount"],
          value: 4,
        },
        missing("occ_other"),
      ],
      source: "json",
    });
    expect(jsonFailed.draft).toBe(restoreFailed.draft);
    expect(jsonFailed.importError).toEqual({
      index: 1,
      reason: "result_missing",
    });
  });

  it("found 가 아닐 때 draft 출처 APPLY_MANY 가 실패하면 임시 저장 상태도 importError 도 그대로", () => {
    const none = jobReviewReducer(loaded(), {
      type: "DRAFT_CHECKED",
      stored: null,
    });
    const failed = jobReviewReducer(none, {
      type: "APPLY_MANY",
      drafts: [
        {
          kind: "set_value",
          jobId: "job_1",
          resultId: "occ_missing",
          path: ["amount"],
          value: 3,
        },
      ],
      source: "draft",
    });
    expect(failed.draft).toBe(none.draft);
    expect(failed.importError).toBeNull();
    expect(failed.editError).toBe("result_missing");
  });

  it("배너(found)가 떠 있는 채 APPLY 가 성공하면 지난 임시 저장을 버린다", () => {
    const state = found();
    const edited = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "set_value",
        jobId: "job_1",
        resultId: "occ_1",
        path: ["amount"],
        value: 9,
      },
    });
    expect(edited.session!.entries).toHaveLength(1);
    expect(edited.draft).toEqual({ status: "none" });
  });

  it("거부된 APPLY 는 배너(found)를 그대로 둔다", () => {
    const state = found();
    const rejected = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "set_value",
        jobId: "job_1",
        resultId: "occ_missing",
        path: ["amount"],
        value: 9,
      },
    });
    expect(rejected.editError).toBe("result_missing");
    expect(rejected.draft).toBe(state.draft);
  });

  it("found 가 아니면 APPLY 성공이 임시 저장 상태를 바꾸지 않는다", () => {
    const draft = {
      kind: "set_value" as const,
      jobId: "job_1",
      resultId: "occ_1",
      path: ["amount"],
      value: 9,
    };
    const none = jobReviewReducer(loaded(), {
      type: "DRAFT_CHECKED",
      stored: null,
    });
    expect(jobReviewReducer(none, { type: "APPLY", draft }).draft).toBe(
      none.draft,
    );
    const tooLarge = jobReviewReducer(none, {
      type: "DRAFT_WRITE_FAILED",
      reason: "too_large",
      bytes: 3_000_000,
    });
    expect(jobReviewReducer(tooLarge, { type: "APPLY", draft }).draft).toBe(
      tooLarge.draft,
    );
  });

  it("APPLY_MANY 의 출처가 json 이거나 없으면 편집이므로 배너(found)가 있으면 버린다", () => {
    const state = found();
    const drafts =
      state.draft.status === "found" ? state.draft.stored.drafts : [];
    const json = jobReviewReducer(state, {
      type: "APPLY_MANY",
      drafts,
      source: "json",
    });
    expect(json.draft).toEqual({ status: "none" });
    expect(json.importNotice).toEqual({ count: 1, source: "json" });
    const plain = jobReviewReducer(state, { type: "APPLY_MANY", drafts });
    expect(plain.draft).toEqual({ status: "none" });
    expect(plain.importNotice).toEqual({ count: 1, source: "json" });
    // found 가 아니면 그대로.
    const none = jobReviewReducer(loaded(), {
      type: "DRAFT_CHECKED",
      stored: null,
    });
    expect(
      jobReviewReducer(none, { type: "APPLY_MANY", drafts, source: "json" })
        .draft,
    ).toBe(none.draft);
  });
});

describe("APPLY_BATCH", () => {
  const label = {
    kind: "set_label",
    jobId: "job_1",
    stepId: null,
    documentId: "doc_2",
    label: "receipt",
  } as const;
  const move = (fromDocumentId: string) =>
    ({
      kind: "move_pages",
      jobId: "job_1",
      stepId: null,
      fromDocumentId,
      pages: [{ file_ref: "job_1#1", page: 1 }],
      to: { documentId: "doc_2", index: 0 },
    }) as const;

  it("항목이 없으면 그대로", () => {
    const state = loaded();
    expect(jobReviewReducer(state, { type: "APPLY_BATCH", drafts: [] })).toBe(
      state,
    );
  });

  it("저장 중이면 그대로", () => {
    const state = loaded();
    const saving = jobReviewReducer(state, { type: "SAVE_STARTED" });
    expect(
      jobReviewReducer(saving, { type: "APPLY_BATCH", drafts: [label] }),
    ).toBe(saving);
  });

  it("둘째 변경이 실패하면 세션을 바꾸지 않고 사유만 남긴다", () => {
    const before = loaded();
    const state = jobReviewReducer(before, {
      type: "APPLY_BATCH",
      drafts: [label, move("doc_missing")],
    });
    expect(state.session).toBe(before.session);
    expect(state.editError).toBe("document_missing");
    expect(state.importError).toBeNull();
    expect(state.trayOpen).toBe(before.trayOpen);
  });

  it("전부 적용하면 변경마다 항목 하나, 트레이·가져오기 알림은 열지 않고 임시 저장 배너를 거둔다", () => {
    const found = jobReviewReducer(loaded(), {
      type: "DRAFT_CHECKED",
      stored: {
        version: 1,
        savedAt: "2026-10-27T00:00:00.000Z",
        jobId: "job_1",
        structureVersion: 3,
        resultVersions: { occ_1: 1 },
        drafts: [label],
      },
    });
    expect(found.draft.status).toBe("found");
    const state = jobReviewReducer(found, {
      type: "APPLY_BATCH",
      drafts: [label, move("doc_1")],
    });
    expect(state.session!.entries.map(entry => entry.kind)).toEqual([
      "set_label",
      "move_pages",
    ]);
    const doc2 = documentsOf(state.session!.current.jobs[0]!).find(
      located => located.document.document_id === "doc_2",
    )!.document;
    expect(doc2.label).toBe("receipt");
    expect(documentPages(doc2)).toHaveLength(2);
    expect(state.trayOpen).toBe(found.trayOpen);
    expect(state.importNotice).toBeNull();
    expect(state.jsonSheetOpen).toBe(false);
    expect(state.editError).toBeNull();
    expect(state.draft).toEqual({ status: "none" });
  });

  // 새 문서 묶음: 첫 항목이 새 문서를 만들고 둘째 항목이 그 문서로 옮긴다 — 첫 항목을 되돌리면
  // 둘째 항목은 대상이 없어 함께 빠진다.
  const newDocumentBatch = [
    {
      kind: "move_pages",
      jobId: "job_1",
      stepId: null,
      fromDocumentId: "doc_1",
      pages: [{ file_ref: "job_1#1", page: 1 }],
      to: { newDocumentId: "review-doc-b", afterDocumentId: "doc_1" },
      batchId: "batch-1",
    },
    {
      kind: "move_pages",
      jobId: "job_1",
      stepId: null,
      fromDocumentId: "doc_2",
      pages: [{ file_ref: "job_1#0", page: 1 }],
      to: { documentId: "review-doc-b", index: 1 },
      batchId: "batch-1",
    },
  ] as const;

  it("항목에 batchId 가 남고, 묶음 id 들로 되돌리면 함께 되돌림 알림이 없다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "APPLY_BATCH",
      drafts: newDocumentBatch,
    });
    const entries = state.session!.entries;
    expect(
      entries.map(entry =>
        entry.kind === "move_pages" ? entry.batchId : null,
      ),
    ).toEqual(["batch-1", "batch-1"]);
    state = jobReviewReducer(state, {
      type: "REVERT",
      entryIds: entries.map(entry => entry.id),
    });
    expect(state.session!.entries).toHaveLength(0);
    expect(state.revertNotice).toBeNull();
  });

  it("묶음 밖에서 묶음에 기대던 항목이 빠지면 그 수만 알린다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "APPLY_BATCH",
      drafts: newDocumentBatch,
    });
    const batchIds = state.session!.entries.map(entry => entry.id);
    state = jobReviewReducer(state, {
      type: "APPLY",
      draft: {
        kind: "set_label",
        jobId: "job_1",
        stepId: null,
        documentId: "review-doc-b",
        label: "receipt",
      },
    });
    expect(state.session!.entries).toHaveLength(3);
    state = jobReviewReducer(state, { type: "REVERT", entryIds: batchIds });
    expect(state.session!.entries).toHaveLength(0);
    expect(state.revertNotice).toBe(1);
  });
});

describe("검수 상태", () => {
  const record = (
    review_status: "pending" | "in_progress" | "done",
    review_completed_at: string | null = null,
  ) => ({ job_id: "job_1", review_status, review_completed_at });

  function updated(
    state: JobReviewState,
    action: "start" | "complete" | "reopen",
    status: ReturnType<typeof record>,
  ): JobReviewState {
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_UPDATING",
      requestKey: "k",
      action,
    });
    return jobReviewReducer(state, {
      type: "REVIEW_STATUS_UPDATED",
      requestKey: "k",
      action,
      status,
    });
  }

  function committed(state: JobReviewState): JobReviewState {
    return jobReviewReducer(state, {
      type: "SAVE_COMMITTED",
      session: createSession(twoFileDoc()),
      importId: "rvop_1",
      revision: 4,
      partial: false,
    });
  }

  it("처음에는 모르는 상태이고, 다른 요청의 응답은 무시한다", () => {
    const state = loaded();
    expect(state.reviewStatus).toEqual({
      value: "unknown",
      completedAt: null,
      updating: null,
      revertRequested: false,
      committedDuringStart: false,
      startFailed: false,
      notice: null,
    });
    for (const action of [
      {
        type: "REVIEW_STATUS_UPDATING",
        requestKey: "other",
        action: "start",
      },
      {
        type: "REVIEW_STATUS_UPDATED",
        requestKey: "other",
        action: "start",
        status: record("in_progress"),
      },
      { type: "REVIEW_STATUS_FAILED", requestKey: "other", action: "start" },
    ] as const) {
      expect(jobReviewReducer(state, action)).toBe(state);
    }
  });

  it("start 는 상태만 반영하고 안내를 바꾸지 않는다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "REVIEW_STATUS_UPDATING",
      requestKey: "k",
      action: "start",
    });
    expect(state.reviewStatus.updating).toBe("start");
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_UPDATED",
      requestKey: "k",
      action: "start",
      status: record("in_progress"),
    });
    expect(state.reviewStatus).toMatchObject({
      value: "in_progress",
      updating: null,
      notice: null,
    });
  });

  it("complete·reopen 은 상태와 안내를 바꾼다", () => {
    let state = updated(loaded(), "start", record("in_progress"));
    state = updated(state, "complete", record("done", "2026-10-29T00:00:00Z"));
    expect(state.reviewStatus).toMatchObject({
      value: "done",
      completedAt: "2026-10-29T00:00:00Z",
      notice: "completed",
    });
    state = updated(state, "reopen", record("in_progress"));
    expect(state.reviewStatus).toMatchObject({
      value: "in_progress",
      completedAt: null,
      notice: "reopened",
    });
  });

  it("start 실패는 검수 전으로 두고 다시 보내지 않게 표시한다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "REVIEW_STATUS_UPDATING",
      requestKey: "k",
      action: "start",
    });
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_FAILED",
      requestKey: "k",
      action: "start",
    });
    expect(state.reviewStatus).toMatchObject({
      value: "pending",
      updating: null,
      startFailed: true,
      notice: null,
    });
  });

  it("complete 실패는 상태를 두고 안내만 남긴다", () => {
    let state = updated(loaded(), "start", record("in_progress"));
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_UPDATING",
      requestKey: "k",
      action: "complete",
    });
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_FAILED",
      requestKey: "k",
      action: "complete",
    });
    expect(state.reviewStatus).toMatchObject({
      value: "in_progress",
      updating: null,
      notice: "failed",
    });
  });

  it("검수 완료 Job 의 저장이 반영되면 되돌리기를 요청하고, reopen 뒤 저장 안내를 남긴다", () => {
    let state = updated(
      loaded(),
      "start",
      record("done", "2026-10-29T00:00:00Z"),
    );
    state = committed(state);
    expect(state.reviewStatus.revertRequested).toBe(true);
    state = updated(state, "reopen", record("in_progress"));
    expect(state.reviewStatus).toMatchObject({
      value: "in_progress",
      revertRequested: false,
      notice: "reverted_by_save",
    });
  });

  it("start 요청 중에 저장이 반영되고 응답이 완료면 되돌리기를 한 번 요청한다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "REVIEW_STATUS_UPDATING",
      requestKey: "k",
      action: "start",
    });
    state = committed(state);
    expect(state.reviewStatus).toMatchObject({
      revertRequested: false,
      committedDuringStart: true,
    });
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_UPDATED",
      requestKey: "k",
      action: "start",
      status: record("done", "2026-10-29T00:00:00Z"),
    });
    expect(state.reviewStatus).toMatchObject({
      value: "done",
      revertRequested: true,
      committedDuringStart: false,
    });
    state = updated(state, "reopen", record("in_progress"));
    expect(state.reviewStatus).toMatchObject({
      value: "in_progress",
      revertRequested: false,
      committedDuringStart: false,
      notice: "reverted_by_save",
    });
  });

  it("start 요청 중에 저장이 반영돼도 응답이 검수 중이면 되돌리기를 요청하지 않는다", () => {
    let state = jobReviewReducer(loaded(), {
      type: "REVIEW_STATUS_UPDATING",
      requestKey: "k",
      action: "start",
    });
    state = committed(state);
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_UPDATED",
      requestKey: "k",
      action: "start",
      status: record("in_progress"),
    });
    expect(state.reviewStatus).toMatchObject({
      value: "in_progress",
      revertRequested: false,
      committedDuringStart: false,
    });
  });

  it("start 요청 중 저장이 없으면 응답이 완료여도 되돌리기를 요청하지 않는다", () => {
    const state = updated(
      loaded(),
      "start",
      record("done", "2026-10-29T00:00:00Z"),
    );
    expect(state.reviewStatus).toMatchObject({
      value: "done",
      revertRequested: false,
      committedDuringStart: false,
    });
  });

  it("검수 중에 저장이 반영되면 되돌리기를 요청하지 않는다", () => {
    const state = committed(updated(loaded(), "start", record("in_progress")));
    expect(state.reviewStatus.revertRequested).toBe(false);
  });

  it("완료 요청 중에 저장이 반영되면 완료 뒤에도 되돌리기 요청이 남는다", () => {
    let state = updated(loaded(), "start", record("in_progress"));
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_UPDATING",
      requestKey: "k",
      action: "complete",
    });
    state = committed(state);
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_UPDATED",
      requestKey: "k",
      action: "complete",
      status: record("done", "2026-10-29T00:00:00Z"),
    });
    expect(state.reviewStatus).toMatchObject({
      value: "done",
      revertRequested: true,
    });
  });

  it("실패하면 되돌리기 요청을 내린다(다시 보내지 않는다)", () => {
    let state = committed(
      updated(loaded(), "start", record("done", "2026-10-29T00:00:00Z")),
    );
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_UPDATING",
      requestKey: "k",
      action: "reopen",
    });
    state = jobReviewReducer(state, {
      type: "REVIEW_STATUS_FAILED",
      requestKey: "k",
      action: "reopen",
    });
    expect(state.reviewStatus).toMatchObject({
      value: "done",
      revertRequested: false,
      notice: "failed",
    });
  });
});

describe("변경 이력 시트", () => {
  const amount = (value: number) =>
    ({
      kind: "set_value",
      jobId: "job_1",
      resultId: "occ_1",
      path: ["amount"],
      value,
    }) as const;
  const missing = {
    kind: "set_value",
    jobId: "job_1",
    resultId: "occ_missing",
    path: ["amount"],
    value: 3,
  } as const;
  const open = (resultId?: string | null) =>
    jobReviewReducer(loaded(), { type: "OPEN_HISTORY", resultId });

  it("처음에는 닫혀 있다", () => {
    expect(loaded().history).toEqual({ open: false, resultId: null });
  });

  it("OPEN 은 기본이면 전체 이력, resultId 를 주면 그 결과로 열고 JSON 시트를 닫는다", () => {
    expect(open().history).toEqual({ open: true, resultId: null });
    expect(open("occ_1").history).toEqual({ open: true, resultId: "occ_1" });
    const json = jobReviewReducer(loaded(), { type: "OPEN_JSON" });
    const state = jobReviewReducer(json, { type: "OPEN_HISTORY" });
    expect(state.jsonSheetOpen).toBe(false);
    expect(state.history.open).toBe(true);
  });

  it("같은 resultId 로 다시 열면 참조가 같고, 다른 값이면 바꾼다", () => {
    const state = open("occ_1");
    expect(
      jobReviewReducer(state, { type: "OPEN_HISTORY", resultId: "occ_1" }),
    ).toBe(state);
    const all = open();
    expect(jobReviewReducer(all, { type: "OPEN_HISTORY" })).toBe(all);
    expect(
      jobReviewReducer(state, { type: "OPEN_HISTORY", resultId: null }).history,
    ).toEqual({ open: true, resultId: null });
    expect(
      jobReviewReducer(state, { type: "OPEN_HISTORY", resultId: "occ_2" })
        .history,
    ).toEqual({ open: true, resultId: "occ_2" });
  });

  it("OPEN · CLOSE 는 editError 를 비운다", () => {
    const failed = jobReviewReducer(loaded(), {
      type: "APPLY",
      draft: missing,
    });
    expect(failed.editError).not.toBeNull();
    const opened = jobReviewReducer(failed, { type: "OPEN_HISTORY" });
    expect(opened.editError).toBeNull();
    const failedAgain = jobReviewReducer(opened, {
      type: "APPLY",
      draft: missing,
    });
    const closed = jobReviewReducer(failedAgain, { type: "CLOSE_HISTORY" });
    expect(closed.history).toEqual({ open: false, resultId: null });
    expect(closed.editError).toBeNull();
  });

  it("닫힌 상태의 CLOSE 는 참조가 같다", () => {
    const state = loaded();
    expect(jobReviewReducer(state, { type: "CLOSE_HISTORY" })).toBe(state);
  });

  it("열린 채 APPLY 가 실패하면 editError 를 남기고 시트는 열려 있다", () => {
    const state = jobReviewReducer(open("occ_1"), {
      type: "APPLY",
      draft: missing,
    });
    expect(state.editError).not.toBeNull();
    expect(state.history).toEqual({ open: true, resultId: "occ_1" });
  });

  it("열린 채 APPLY 가 성공해도 시트는 열려 있다", () => {
    const state = jobReviewReducer(open(), { type: "APPLY", draft: amount(9) });
    expect(state.session!.entries).toHaveLength(1);
    expect(state.history.open).toBe(true);
  });

  it("APPLY_MANY 가 성공하면(변경 0 건 포함) 닫고 트레이를 연다, 실패하면 열려 있다", () => {
    const applied = jobReviewReducer(open(), {
      type: "APPLY_MANY",
      drafts: [amount(2)],
    });
    expect(applied.history.open).toBe(false);
    expect(applied.trayOpen).toBe(true);
    // 지금 값(amount 1)과 같은 draft 는 세션을 바꾸지 않는다.
    const unchanged = jobReviewReducer(open(), {
      type: "APPLY_MANY",
      drafts: [amount(1)],
    });
    expect(unchanged.importNotice).toEqual({ count: 0, source: "json" });
    expect(unchanged.history.open).toBe(false);
    expect(unchanged.trayOpen).toBe(true);
    const failed = jobReviewReducer(open(), {
      type: "APPLY_MANY",
      drafts: [missing],
    });
    expect(failed.history.open).toBe(true);
  });

  it("SAVE_FINISHED 가 트레이를 열면 닫고, 아니면 그대로 둔다", () => {
    const edited = jobReviewReducer(open(), {
      type: "APPLY",
      draft: amount(5),
    });
    const conflict = jobReviewReducer(edited, {
      type: "SAVE_FINISHED",
      status: {
        phase: "conflict",
        importId: "rvop_1",
        conflict: {
          entryIds: ["change-1"],
          resultIds: ["occ_1"],
          structure: false,
          count: 1,
        },
      },
      openTray: true,
    });
    expect(conflict.history.open).toBe(false);
    expect(conflict.trayOpen).toBe(true);
    const failed = jobReviewReducer(edited, {
      type: "SAVE_FINISHED",
      status: {
        phase: "failed",
        code: "network_error",
        importId: null,
        message: null,
        resultId: null,
        fieldPointer: null,
        entryIds: [],
      },
    });
    expect(failed.history.open).toBe(true);
  });

  it("OPEN_TRAY · OPEN_JSON 은 닫는다", () => {
    expect(jobReviewReducer(open(), { type: "OPEN_TRAY" }).history.open).toBe(
      false,
    );
    expect(jobReviewReducer(open(), { type: "OPEN_JSON" }).history.open).toBe(
      false,
    );
  });

  it("RESET 은 닫고 RELOADED 는 그대로 둔다", () => {
    expect(
      jobReviewReducer(open(), {
        type: "RESET",
        requestKey: "k2",
        collectionId: "scol_1",
        jobId: "job_2",
      }).history.open,
    ).toBe(false);
    let state = jobReviewReducer(open("occ_1"), { type: "RELOAD_STARTED" });
    state = jobReviewReducer(state, {
      type: "RELOADED",
      requestKey: "k",
      session: createSession(twoFileDoc()),
      sourceText: '{"source":2}',
      etag: null,
    });
    expect(state.history).toEqual({ open: true, resultId: "occ_1" });
  });
});
