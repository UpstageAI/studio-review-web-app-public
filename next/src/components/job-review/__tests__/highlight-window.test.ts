import { describe, expect, it } from "vitest";

import type { HighlightLike, PageRef } from "@/lib/review-model";

import {
  chunkStartOf,
  highlightsStatusFor,
  viewerHighlightsFor,
  wantedHighlightChunks,
} from "../highlight-window";
import type { FileEntry } from "../job-review-state";
import { HIGHLIGHT_CHUNK, HIGHLIGHT_WINDOW } from "../large-job";

const entry = (
  fileId: string,
  numPages: number | null,
  overrides: Partial<FileEntry> = {},
): FileEntry => ({
  fileId,
  name: `${fileId}.pdf`,
  status: "ready",
  numPages,
  imageUrls: [],
  parse: {},
  parseChunks: {},
  ...overrides,
});

/** 파일 `fileRef` 의 1..count 페이지를 순서대로. */
const pagesOf = (fileRef: string, count: number, start = 1): PageRef[] =>
  Array.from({ length: count }, (_, i) => ({
    file_ref: fileRef,
    page: start + i,
  }));

describe("chunkStartOf", () => {
  it("20 쪽 묶음의 시작 페이지", () => {
    expect(chunkStartOf(1)).toBe(1);
    expect(chunkStartOf(20)).toBe(1);
    expect(chunkStartOf(21)).toBe(21);
    expect(chunkStartOf(40)).toBe(21);
    expect(chunkStartOf(41)).toBe(41);
    expect(HIGHLIGHT_CHUNK).toBe(20);
  });
});

describe("wantedHighlightChunks", () => {
  const files = { "f#0": entry("file_a", 60) };

  it("현재 페이지 ±10 쪽이 속한 묶음만, 중복 없이, 파일 쪽수까지", () => {
    const pages = pagesOf("f#0", 60);
    expect(wantedHighlightChunks(pages, 0, files)).toEqual([
      { fileRef: "f#0", fileId: "file_a", chunk: 1, from: 1, to: 20 },
    ]);
    // 뷰어 index 15 → 페이지 6..26 → 묶음 1·21.
    expect(wantedHighlightChunks(pages, 15, files).map(w => w.chunk)).toEqual([
      1, 21,
    ]);
    // 마지막 묶음은 파일 쪽수(60)에서 끊는다.
    expect(wantedHighlightChunks(pages, 59, files)).toEqual([
      { fileRef: "f#0", fileId: "file_a", chunk: 41, from: 41, to: 60 },
    ]);
  });

  it("문서가 파일 중간 페이지에서 시작해도 파일 로컬 페이지로 묶음을 정한다", () => {
    const pages = pagesOf("f#0", 10, 35); // 파일 35..44 쪽
    expect(wantedHighlightChunks(pages, 0, files).map(w => w.chunk)).toEqual([
      21, 41,
    ]);
  });

  it("두 파일에 걸친 문서는 파일마다 묶음을 낸다", () => {
    const pages = [...pagesOf("f#0", 3, 58), ...pagesOf("f#1", 3, 1)];
    const two = { ...files, "f#1": entry("file_b", 3) };
    expect(wantedHighlightChunks(pages, 2, two)).toEqual([
      { fileRef: "f#0", fileId: "file_a", chunk: 41, from: 41, to: 60 },
      { fileRef: "f#1", fileId: "file_b", chunk: 1, from: 1, to: 3 },
    ]);
  });

  it("이미 상태가 있는 묶음(loading·ready·error)은 다시 고르지 않는다", () => {
    const pages = pagesOf("f#0", 60);
    const loading = {
      "f#0": entry("file_a", 60, { parseChunks: { 1: "loading" } }),
    };
    expect(wantedHighlightChunks(pages, 0, loading)).toEqual([]);
    const mixed = {
      "f#0": entry("file_a", 60, { parseChunks: { 1: "ready", 21: "error" } }),
    };
    expect(wantedHighlightChunks(pages, 15, mixed)).toEqual([]);
    expect(wantedHighlightChunks(pages, 35, mixed).map(w => w.chunk)).toEqual([
      41,
    ]);
  });

  it("이미지를 아직 받는 중이거나 실패한 파일, 모르는 파일은 건너뛴다", () => {
    const pages = pagesOf("f#0", 5);
    expect(
      wantedHighlightChunks(pages, 0, {
        "f#0": entry("file_a", 5, { status: "loading" }),
      }),
    ).toEqual([]);
    expect(
      wantedHighlightChunks(pages, 0, {
        "f#0": entry("file_a", 5, { status: "error" }),
      }),
    ).toEqual([]);
    expect(wantedHighlightChunks(pages, 0, {})).toEqual([]);
    expect(
      wantedHighlightChunks(pages, 0, {
        "f#0": entry("file_a", 5, { status: "not_ready" }),
      }),
    ).toHaveLength(1);
  });

  it("쪽수를 모르는 파일은 묶음 전체(20 쪽)를 요청한다", () => {
    expect(
      wantedHighlightChunks(pagesOf("f#0", 2), 0, {
        "f#0": entry("file_a", null),
      }),
    ).toEqual([
      { fileRef: "f#0", fileId: "file_a", chunk: 1, from: 1, to: 20 },
    ]);
  });
});

describe("highlightsStatusFor", () => {
  const pages = pagesOf("f#0", 60);

  it("창 안 묶음이 하나라도 받는 중이면 loading, 아니면 실패가 있으면 error, 그 밖은 idle", () => {
    expect(highlightsStatusFor(pages, 0, { "f#0": entry("file_a", 60) })).toBe(
      "idle",
    );
    expect(
      highlightsStatusFor(pages, 15, {
        "f#0": entry("file_a", 60, {
          parseChunks: { 1: "ready", 21: "loading" },
        }),
      }),
    ).toBe("loading");
    expect(
      highlightsStatusFor(pages, 15, {
        "f#0": entry("file_a", 60, {
          parseChunks: { 1: "error", 21: "loading" },
        }),
      }),
    ).toBe("loading");
    expect(
      highlightsStatusFor(pages, 15, {
        "f#0": entry("file_a", 60, {
          parseChunks: { 1: "error", 21: "ready" },
        }),
      }),
    ).toBe("error");
    // 창 밖 묶음의 상태는 보지 않는다.
    expect(
      highlightsStatusFor(pages, 0, {
        "f#0": entry("file_a", 60, {
          parseChunks: { 1: "ready", 41: "error" },
        }),
      }),
    ).toBe("idle");
  });
});

describe("viewerHighlightsFor", () => {
  const box = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ];
  const hl = (id: string, page: number): HighlightLike => ({
    id,
    _value: id,
    page,
    coordinates: box,
  });
  const all = Array.from({ length: 30 }, (_, i) => hl(`h${i + 1}`, i + 1));

  it("현재 페이지 ±HIGHLIGHT_WINDOW 와 선택·호버만 남긴다", () => {
    const kept = viewerHighlightsFor(all, 9, "h30", "h1");
    expect(kept.map(h => h.page)).toEqual([1, 7, 8, 9, 10, 11, 12, 13, 30]);
    expect(HIGHLIGHT_WINDOW).toBe(3);
    expect(viewerHighlightsFor(all, 0, null, null).map(h => h.page)).toEqual([
      1, 2, 3, 4,
    ]);
  });

  it("전부 창 안이면 입력 배열을 그대로 돌려준다", () => {
    const small = all.slice(0, 4);
    expect(viewerHighlightsFor(small, 1, null, null)).toBe(small);
    expect(viewerHighlightsFor([], 5, null, null)).toEqual([]);
  });
});
