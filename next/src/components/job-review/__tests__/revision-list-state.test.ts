import { describe, expect, it } from "vitest";

import { ApiError } from "@/lib/review-api/client";
import type { JobRevision, JobRevisionPage } from "@/lib/review-api/types";
import { revision } from "@/lib/revision-history/__tests__/helpers";

import {
  BLOCK_LIMIT,
  IDLE_KEY,
  initialRevisionList,
  pageView,
  pendingRequest,
  queryKeyOf,
  retryAtOf,
  retrySecondsOf,
  revisionListReducer,
  type HistoryFilter,
  type RevisionListAction,
  type RevisionListState,
} from "../revision-list-state";

const FILTER: HistoryFilter = { type: null, occurrenceId: null, order: "desc" };
const KEY = queryKeyOf("scol_1", "job_1", FILTER);

/** 최신순(published_at 내림차순) 행 `count` 개. `from` 번째부터. */
function rows(count: number, from = 0): JobRevision[] {
  return Array.from({ length: count }, (_, index) => {
    const n = from + index;
    return revision({
      id: `rev_${String(n).padStart(4, "0")}`,
      published_at: 2_000_000_000 - n * 10,
    });
  });
}

function page(data: JobRevision[], lastId: string | null): JobRevisionPage {
  return {
    object: "list",
    data,
    first_id: data[0]?.id ?? null,
    last_id: lastId ?? data.at(-1)?.id ?? null,
    has_more: lastId !== null,
  };
}

const run = (state: RevisionListState, ...actions: RevisionListAction[]) =>
  actions.reduce(revisionListReducer, state);

function loaded(data: JobRevision[], cursor: string | null): RevisionListState {
  return run(initialRevisionList(KEY), {
    type: "PAGE_LOADED",
    key: KEY,
    after: null,
    page: page(data, cursor),
    now: 1_000,
  });
}

const busy = (retryAfter: string | null) =>
  new ApiError(429, "operation_capacity_exceeded", "busy", { retryAfter });

describe("revisionListReducer — 받기", () => {
  it("블록 크기는 100 행이고 첫 요청은 after 없이 보낸다", () => {
    expect(BLOCK_LIMIT).toBe(100);
    const state = initialRevisionList(KEY);
    expect(state.phase).toBe("loading");
    expect(pendingRequest(state)).toEqual({ after: null });
    expect(initialRevisionList(IDLE_KEY).phase).toBe("idle");
    expect(pendingRequest(initialRevisionList(IDLE_KEY))).toBeNull();
  });

  it("첫 페이지를 받고, 다음 블록을 이어 붙이며 중복 id 는 뺀다", () => {
    let state = loaded(rows(100), "rev_0099");
    expect(state.phase).toBe("ready");
    expect(state.rows).toHaveLength(100);
    expect(state.cursor).toBe("rev_0099");
    expect(state.fetchedAt).toBe(1_000);
    expect(pendingRequest(state)).toBeNull();

    state = revisionListReducer(state, { type: "BLOCK_STARTED" });
    expect(pendingRequest(state)).toEqual({ after: "rev_0099" });
    state = revisionListReducer(state, {
      type: "PAGE_LOADED",
      key: KEY,
      after: "rev_0099",
      page: page([...rows(1, 99), ...rows(20, 100)], null),
      now: 2_000,
    });
    expect(state.rows).toHaveLength(120);
    expect(state.rows.at(-1)?.id).toBe("rev_0119");
    expect(state.cursor).toBeNull();
    expect(state.block).toBe("idle");
    expect(state.fetchedAt).toBe(2_000);
  });

  it("has_more 가 true 여도 last_id 가 없으면 끝으로 본다", () => {
    const state = run(initialRevisionList(KEY), {
      type: "PAGE_LOADED",
      key: KEY,
      after: null,
      page: { data: rows(3), has_more: true, last_id: null },
      now: 1,
    });
    expect(state.cursor).toBeNull();
  });

  it("다른 key · 기다리지 않는 after 의 응답은 무시한다", () => {
    const state = initialRevisionList(KEY);
    const other = queryKeyOf("scol_1", "job_1", { ...FILTER, order: "asc" });
    expect(
      revisionListReducer(state, {
        type: "PAGE_LOADED",
        key: other,
        after: null,
        page: page(rows(2), null),
        now: 1,
      }),
    ).toBe(state);
    expect(
      revisionListReducer(state, {
        type: "PAGE_LOADED",
        key: KEY,
        after: "rev_0001",
        page: page(rows(2), null),
        now: 1,
      }),
    ).toBe(state);
    const ready = loaded(rows(2), null);
    expect(
      revisionListReducer(ready, {
        type: "PAGE_FAILED",
        key: KEY,
        after: null,
        error: new Error("late"),
        now: 1,
      }),
    ).toBe(ready);
  });

  it("RESET 은 행을 비우고 1 페이지부터 다시 받는다", () => {
    let state = loaded(rows(60), null);
    state = revisionListReducer(state, { type: "GO_TO_PAGE", page: 3 });
    expect(state.pageIndex).toBe(2);
    const reset = revisionListReducer(state, { type: "RESET", key: KEY });
    expect(reset).toMatchObject({ phase: "loading", pageIndex: 0, rows: [] });
    expect(reset.seq).toBeGreaterThan(state.seq);
    expect(pendingRequest(reset)).toEqual({ after: null });
  });

  it("order 는 key 에 들어가 바뀌면 RESET 으로 1 페이지가 된다", () => {
    const asc = queryKeyOf("scol_1", "job_1", { ...FILTER, order: "asc" });
    expect(asc).not.toBe(KEY);
    let state = run(initialRevisionList(asc), {
      type: "PAGE_LOADED",
      key: asc,
      after: null,
      page: page(rows(40), null),
      now: 1,
    });
    state = revisionListReducer(state, { type: "NEXT_PAGE" });
    expect(state.pageIndex).toBe(1);
    state = revisionListReducer(state, { type: "RESET", key: KEY });
    expect(state).toMatchObject({ key: KEY, pageIndex: 0, restorePage: null });
  });

  it("BLOCK_STARTED 는 받는 중이면 무시하고 cursor 가 없으면 아무것도 하지 않는다", () => {
    const started = revisionListReducer(loaded(rows(100), "rev_0099"), {
      type: "BLOCK_STARTED",
    });
    expect(started.block).toBe("loading");
    expect(revisionListReducer(started, { type: "BLOCK_STARTED" })).toBe(
      started,
    );
    const done = loaded(rows(3), null);
    expect(revisionListReducer(done, { type: "BLOCK_STARTED" })).toBe(done);
  });
});

describe("revisionListReducer — 오류", () => {
  const invalidCursor = () =>
    new ApiError(400, "invalid_cursor", "unknown cursor");

  it("첫 페이지 오류는 phase error, RETRY 로 다시 받는다", () => {
    const failed = revisionListReducer(initialRevisionList(KEY), {
      type: "PAGE_FAILED",
      key: KEY,
      after: null,
      error: new ApiError(500, "upstream_error", "boom"),
      now: 5,
    });
    expect(failed).toMatchObject({ phase: "error", retryAt: null });
    expect(pendingRequest(failed)).toBeNull();
    const retried = revisionListReducer(failed, { type: "RETRY" });
    expect(retried.phase).toBe("loading");
    expect(retried.seq).toBe(failed.seq + 1);
  });

  it("첫 페이지의 invalid_cursor 는 그대로 오류다", () => {
    const state = revisionListReducer(initialRevisionList(KEY), {
      type: "PAGE_FAILED",
      key: KEY,
      after: null,
      error: invalidCursor(),
      now: 1,
    });
    expect(state.phase).toBe("error");
  });

  it("블록의 invalid_cursor 는 한 번은 1 페이지부터 다시, 두 번째는 블록 오류로 현재 페이지를 지킨다", () => {
    let state = run(
      loaded(rows(100), "rev_0099"),
      { type: "GO_TO_PAGE", page: 5 },
      {
        type: "NEXT_PAGE",
      },
    );
    expect(state.block).toBe("loading");
    state = revisionListReducer(state, {
      type: "PAGE_FAILED",
      key: KEY,
      after: "rev_0099",
      error: invalidCursor(),
      now: 1,
    });
    expect(state).toMatchObject({
      phase: "loading",
      rows: [],
      pageIndex: 0,
      cursorResets: 1,
    });
    state = run(
      state,
      {
        type: "PAGE_LOADED",
        key: KEY,
        after: null,
        page: page(rows(100), "rev_0099"),
        now: 2,
      },
      { type: "GO_TO_PAGE", page: 5 },
      { type: "NEXT_PAGE" },
      {
        type: "PAGE_FAILED",
        key: KEY,
        after: "rev_0099",
        error: invalidCursor(),
        now: 3,
      },
    );
    expect(state).toMatchObject({
      phase: "ready",
      block: "error",
      pageIndex: 4,
      cursorResets: 1,
    });
    expect(state.rows).toHaveLength(100);
    expect(
      pageView(state.rows.length, state.pageIndex, state.cursor).page,
    ).toBe(5);
    const retried = revisionListReducer(state, { type: "RETRY" });
    expect(retried.block).toBe("loading");
    expect(pendingRequest(retried)).toEqual({ after: "rev_0099" });
  });

  it("429 면 retryAt 을 남긴다(첫 페이지 · 블록 모두)", () => {
    const first = revisionListReducer(initialRevisionList(KEY), {
      type: "PAGE_FAILED",
      key: KEY,
      after: null,
      error: busy("3"),
      now: 10_000,
    });
    expect(first).toMatchObject({ retryAt: 13_000, failedAt: 10_000 });
    const block = run(
      loaded(rows(100), "rev_0099"),
      { type: "BLOCK_STARTED" },
      {
        type: "PAGE_FAILED",
        key: KEY,
        after: "rev_0099",
        error: busy(null),
        now: 0,
      },
    );
    expect(block).toMatchObject({ block: "error", retryAt: 2_000 });
  });

  it("abort 는 상태를 바꾸지 않는다", () => {
    const state = initialRevisionList(KEY);
    const error = new DOMException("aborted", "AbortError");
    expect(
      revisionListReducer(state, {
        type: "PAGE_FAILED",
        key: KEY,
        after: null,
        error,
        now: 1,
      }),
    ).toBe(state);
  });
});

describe("retrySecondsOf", () => {
  it("지금 시각 기준으로 올림한 남은 초", () => {
    expect(retrySecondsOf(13_000, 10_000, 10_000)).toBe(3);
    expect(retrySecondsOf(13_000, 10_000, 11_000)).toBe(2);
    expect(retrySecondsOf(13_000, 10_000, 11_001)).toBe(2);
    expect(retrySecondsOf(13_000, 10_000, 11_999)).toBe(2);
  });

  it("시계가 오류 시각보다 이르면 오류 시각 기준", () => {
    expect(retrySecondsOf(13_000, 10_000, 0)).toBe(3);
    expect(retrySecondsOf(12_500, 10_000, 5_000)).toBe(3);
  });

  it("지났거나 1 초 미만이면 1", () => {
    expect(retrySecondsOf(13_000, 10_000, 12_999)).toBe(1);
    expect(retrySecondsOf(13_000, 10_000, 13_000)).toBe(1);
    expect(retrySecondsOf(13_000, 10_000, 20_000)).toBe(1);
  });
});

describe("revisionListReducer — 저장 뒤 페이지 복귀", () => {
  const reset = (restorePage: number) =>
    revisionListReducer(loaded(rows(5), null), {
      type: "RESET",
      key: KEY,
      restorePage,
    });

  it("RESET(restorePage 2) 뒤 첫 페이지 64 행이면 pageIndex 2 로 돌아간다", () => {
    const start = reset(2);
    expect(start).toMatchObject({ phase: "loading", restorePage: 2 });
    const state = revisionListReducer(start, {
      type: "PAGE_LOADED",
      key: KEY,
      after: null,
      page: page(rows(64), null),
      now: 1,
    });
    expect(state).toMatchObject({ pageIndex: 2, restorePage: null });
    expect(pendingRequest(state)).toBeNull();
  });

  it("120 행에서 복귀 페이지 5 면 첫 블록 뒤 다음 블록을 받고, 둘째 블록 뒤 pageIndex 5", () => {
    let state = revisionListReducer(reset(5), {
      type: "PAGE_LOADED",
      key: KEY,
      after: null,
      page: page(rows(100), "rev_0099"),
      now: 1,
    });
    expect(state).toMatchObject({
      phase: "ready",
      block: "loading",
      pageIndex: 4,
      restorePage: 5,
    });
    expect(pendingRequest(state)).toEqual({ after: "rev_0099" });
    state = revisionListReducer(state, {
      type: "PAGE_LOADED",
      key: KEY,
      after: "rev_0099",
      page: page(rows(20, 100), null),
      now: 2,
    });
    expect(state).toMatchObject({
      block: "idle",
      pageIndex: 5,
      restorePage: null,
    });
    expect(pendingRequest(state)).toBeNull();
  });

  it("cursor 가 없고 행이 모자라면 마지막 페이지로 돌아간다", () => {
    const state = revisionListReducer(reset(4), {
      type: "PAGE_LOADED",
      key: KEY,
      after: null,
      page: page(rows(45), null),
      now: 1,
    });
    expect(state).toMatchObject({ pageIndex: 2, restorePage: null });
  });

  it("사용자가 페이지를 옮기면 restorePage 를 지운다", () => {
    const blocking = revisionListReducer(reset(7), {
      type: "PAGE_LOADED",
      key: KEY,
      after: null,
      page: page(rows(100), "rev_0099"),
      now: 1,
    });
    expect(blocking.restorePage).toBe(7);
    const withRestore: RevisionListState = {
      ...loaded(rows(64), null),
      restorePage: 3,
    };
    for (const action of [
      { type: "NEXT_PAGE" },
      { type: "GO_TO_PAGE", page: 2 },
    ] as const) {
      expect(revisionListReducer(withRestore, action).restorePage).toBeNull();
    }
    expect(
      run({ ...withRestore, pageIndex: 1 }, { type: "PREVIOUS_PAGE" })
        .restorePage,
    ).toBeNull();
    const withCursor: RevisionListState = {
      ...loaded(rows(100), "rev_0099"),
      restorePage: 3,
    };
    expect(
      revisionListReducer(withCursor, { type: "BLOCK_STARTED" }).restorePage,
    ).toBeNull();
  });

  it("블록 PAGE_FAILED 는 restorePage 를 남기고 RETRY 가 이어 받는다", () => {
    let state = revisionListReducer(reset(5), {
      type: "PAGE_LOADED",
      key: KEY,
      after: null,
      page: page(rows(100), "rev_0099"),
      now: 1,
    });
    state = revisionListReducer(state, {
      type: "PAGE_FAILED",
      key: KEY,
      after: "rev_0099",
      error: new ApiError(500, "upstream_error", "boom"),
      now: 2,
    });
    expect(state).toMatchObject({ block: "error", restorePage: 5 });
    state = revisionListReducer(state, { type: "RETRY" });
    expect(pendingRequest(state)).toEqual({ after: "rev_0099" });
    state = revisionListReducer(state, {
      type: "PAGE_LOADED",
      key: KEY,
      after: "rev_0099",
      page: page(rows(30, 100), null),
      now: 3,
    });
    expect(state).toMatchObject({ pageIndex: 5, restorePage: null });
  });
});

describe("retryAtOf", () => {
  it("정수 초를 쓰고, 읽지 못하면 2 초, 최대 10 초", () => {
    expect(retryAtOf(busy("4"), 1_000)).toBe(5_000);
    expect(retryAtOf(busy("soon"), 1_000)).toBe(3_000);
    expect(retryAtOf(busy(null), 1_000)).toBe(3_000);
    expect(retryAtOf(busy("120"), 1_000)).toBe(11_000);
  });

  it("429 가 아니면 null", () => {
    expect(retryAtOf(new ApiError(500, "upstream_error", "x"), 1)).toBeNull();
    expect(retryAtOf(new Error("x"), 1)).toBeNull();
  });
});

describe("revisionListReducer — 페이지 이동", () => {
  it("받은 범위 안의 NEXT_PAGE 는 요청 없이 넘긴다", () => {
    const state = revisionListReducer(loaded(rows(64), null), {
      type: "NEXT_PAGE",
    });
    expect(state.pageIndex).toBe(1);
    expect(state.block).toBe("idle");
    expect(pendingRequest(state)).toBeNull();
  });

  it("마지막 받은 페이지에서 cursor 가 있으면 다음 블록을 받고, 받은 뒤 그 페이지를 보인다", () => {
    let state = run(loaded(rows(100), "rev_0099"), {
      type: "GO_TO_PAGE",
      page: 5,
    });
    state = revisionListReducer(state, { type: "NEXT_PAGE" });
    expect(state).toMatchObject({ block: "loading", pageIndex: 5 });
    // 받는 동안은 5 페이지를 그대로 보인다.
    expect(
      pageView(state.rows.length, state.pageIndex, state.cursor).page,
    ).toBe(5);
    // 받는 중에는 이동을 무시한다.
    expect(revisionListReducer(state, { type: "NEXT_PAGE" })).toBe(state);
    expect(revisionListReducer(state, { type: "PREVIOUS_PAGE" })).toBe(state);
    state = revisionListReducer(state, {
      type: "PAGE_LOADED",
      key: KEY,
      after: "rev_0099",
      page: page(rows(24, 100), null),
      now: 2,
    });
    const view = pageView(state.rows.length, state.pageIndex, state.cursor);
    expect(view.page).toBe(6);
    expect(view.pageNumbers).toEqual([6, 7]);
  });

  it("마지막 받은 페이지에서 cursor 가 없으면 NEXT_PAGE 를 무시한다", () => {
    const state = run(loaded(rows(64), null), { type: "GO_TO_PAGE", page: 4 });
    expect(revisionListReducer(state, { type: "NEXT_PAGE" })).toBe(state);
  });

  it("PREVIOUS_PAGE 는 1 페이지에서 무시하고, 그 외에는 요청 없이 앞으로", () => {
    const first = loaded(rows(64), null);
    expect(revisionListReducer(first, { type: "PREVIOUS_PAGE" })).toBe(first);
    const third = run(
      first,
      { type: "GO_TO_PAGE", page: 3 },
      {
        type: "PREVIOUS_PAGE",
      },
    );
    expect(third.pageIndex).toBe(1);
  });

  it("GO_TO_PAGE 는 번호 버튼에 있는 페이지만 받는다", () => {
    const state = loaded(rows(64), null);
    expect(
      revisionListReducer(state, { type: "GO_TO_PAGE", page: 4 }).pageIndex,
    ).toBe(3);
    expect(revisionListReducer(state, { type: "GO_TO_PAGE", page: 5 })).toBe(
      state,
    );
    expect(revisionListReducer(state, { type: "GO_TO_PAGE", page: 0 })).toBe(
      state,
    );
    expect(revisionListReducer(state, { type: "GO_TO_PAGE", page: 1 })).toBe(
      state,
    );
  });
});

describe("pageView", () => {
  it("64 행이면 번호 1~4, 마지막 페이지는 4 행", () => {
    const view = pageView(64, 0, null);
    expect(view.pageNumbers).toEqual([1, 2, 3, 4]);
    expect(view).toMatchObject({ page: 1, canGoBack: false, hasMore: true });
    const last = pageView(64, 3, null);
    expect(last).toMatchObject({
      page: 4,
      start: 60,
      end: 80,
      hasMore: false,
      isLastLoadedPage: true,
      loadedPages: 4,
    });
  });

  it("120 행에서 두 번째 블록은 번호 6 하나", () => {
    expect(pageView(120, 5, null)).toMatchObject({
      page: 6,
      pageNumbers: [6],
      canGoBack: true,
      hasMore: false,
    });
    expect(pageView(120, 4, null).pageNumbers).toEqual([1, 2, 3, 4, 5]);
  });

  it("받은 범위 끝이어도 cursor 가 있으면 hasMore", () => {
    expect(pageView(100, 4, "rev_0099")).toMatchObject({
      page: 5,
      hasMore: true,
      isLastLoadedPage: true,
    });
  });

  it("행이 없으면 1 페이지 하나, 넘어선 pageIndex 는 마지막 받은 페이지로 당긴다", () => {
    expect(pageView(0, 0, null)).toMatchObject({
      page: 1,
      pageNumbers: [1],
      canGoBack: false,
      hasMore: false,
    });
    expect(pageView(30, 9, null).page).toBe(2);
  });
});
