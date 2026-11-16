import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MARK_DOCUMENT_LIST_READY,
  MARK_HIGHLIGHT_COMMITTED,
  MARK_HIGHLIGHT_INPUT,
  MARK_LOADED,
  MARK_PAGE_IMAGE_PAINTED,
  MARK_SELECT_PAGE,
  HIGHLIGHT_MARKS_FLAG,
  markDocumentListReady,
  markHighlightCommitted,
  markHighlightInput,
  markLoaded,
  markPageImagePainted,
  markSelectPage,
} from "../perf-marks";

function stubPerformance(mark: unknown) {
  vi.stubGlobal("performance", { mark });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("perf-marks", () => {
  it("이름과 1-based 페이지·출처를 detail 로 남긴다", () => {
    const mark = vi.fn();
    stubPerformance(mark);
    markSelectPage(54, "viewer");
    markPageImagePainted(55);
    expect(mark).toHaveBeenNthCalledWith(1, MARK_SELECT_PAGE, {
      detail: { page: 55, source: "viewer" },
    });
    expect(mark).toHaveBeenNthCalledWith(2, MARK_PAGE_IMAGE_PAINTED, {
      detail: { page: 55 },
    });
  });

  it("목록 준비·LOADED 는 detail 없이 이름만", () => {
    const mark = vi.fn();
    stubPerformance(mark);
    markDocumentListReady();
    markLoaded();
    expect(mark).toHaveBeenNthCalledWith(1, MARK_DOCUMENT_LIST_READY);
    expect(mark).toHaveBeenNthCalledWith(2, MARK_LOADED);
  });

  it("하이라이트 마크는 측정 플래그가 없으면 남기지 않는다", () => {
    const mark = vi.fn();
    stubPerformance(mark);
    markHighlightInput("hover");
    markHighlightCommitted();
    expect(mark).not.toHaveBeenCalled();
  });

  it("측정 플래그가 있으면 하이라이트 입력은 종류를 detail 로, 커밋은 이름만 남긴다", () => {
    const mark = vi.fn();
    stubPerformance(mark);
    vi.stubGlobal(HIGHLIGHT_MARKS_FLAG, true);
    markHighlightInput("hover");
    markHighlightInput("select");
    markHighlightCommitted();
    expect(mark).toHaveBeenNthCalledWith(1, MARK_HIGHLIGHT_INPUT, {
      detail: { kind: "hover" },
    });
    expect(mark).toHaveBeenNthCalledWith(2, MARK_HIGHLIGHT_INPUT, {
      detail: { kind: "select" },
    });
    expect(mark).toHaveBeenNthCalledWith(3, MARK_HIGHLIGHT_COMMITTED);
  });

  it("mark 함수가 없으면 아무것도 하지 않는다", () => {
    stubPerformance(undefined);
    expect(() => markSelectPage(0, "tabs")).not.toThrow();
    vi.stubGlobal("performance", undefined);
    expect(() => markLoaded()).not.toThrow();
  });

  it("mark 가 throw 해도 삼킨다", () => {
    stubPerformance(() => {
      throw new Error("boom");
    });
    expect(() => markPageImagePainted(1)).not.toThrow();
    expect(() => markDocumentListReady()).not.toThrow();
  });
});
