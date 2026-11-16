import { describe, expect, it } from "vitest";

import { reorderPages } from "../edits";
import { findDocument } from "../layout";
import { readReviewDocument } from "../normalize";
import {
  MERGED_PAGE_BASE,
  buildPageSpace,
  documentPages,
  localToMerged,
  mergedToLocal,
  viewerIndex,
  viewerPage,
} from "../viewer";
import { singleJob } from "./fixtures/builders";
import { NO_LOOKUPS, SINGLE_JOB } from "./fixtures/fixtures";

describe("buildPageSpace", () => {
  it("input_index 오름차순·offset 누적", () => {
    const swapped = readReviewDocument(
      SINGLE_JOB.replace(
        '"num_pages": 3, "input_index": 0',
        '"num_pages": 3, "input_index": 1',
      ).replace(
        '"num_pages": 2, "input_index": 1',
        '"num_pages": 2, "input_index": 0',
      ),
    ).jobs[0]!;
    expect(buildPageSpace(swapped)).toEqual({
      files: [
        { file_ref: "job_A#1", input_index: 0, num_pages: 2, offset: 0 },
        { file_ref: "job_A#0", input_index: 1, num_pages: 3, offset: 2 },
      ],
    });
  });

  it("num_pages 없으면 null, 보충 맵이 있으면 채운다", () => {
    const job = readReviewDocument(NO_LOOKUPS).jobs[0]!;
    expect(buildPageSpace(job)).toBeNull();
    expect(buildPageSpace(job, { "job_N#0": 4 })).toEqual({
      files: [{ file_ref: "job_N#0", input_index: 0, num_pages: 4, offset: 0 }],
    });
    expect(buildPageSpace(readReviewDocument(NO_LOOKUPS).jobs[1]!)).toBeNull();
  });

  it("다른 Job 의 파일은 빼고, 이어지지 않는 input_index 는 null", () => {
    const foreign = readReviewDocument(
      SINGLE_JOB.replace(/job_A#1/g, "job_S#1"),
    ).jobs[0]!;
    expect(buildPageSpace(foreign)?.files.map(f => f.file_ref)).toEqual([
      "job_A#0",
    ]);
    const gap = readReviewDocument(
      SINGLE_JOB.replace(
        '"num_pages": 2, "input_index": 1',
        '"num_pages": 2, "input_index": 2',
      ),
    ).jobs[0]!;
    expect(buildPageSpace(gap)).toBeNull();
  });
});

describe("병합 ↔ 로컬", () => {
  const { job } = singleJob();
  const space = buildPageSpace(job)!;

  it("경계 왕복", () => {
    expect(MERGED_PAGE_BASE).toBe(1);
    expect(mergedToLocal(space, 1)).toEqual({ file_ref: "job_A#0", page: 1 });
    expect(mergedToLocal(space, 3)).toEqual({ file_ref: "job_A#0", page: 3 });
    expect(mergedToLocal(space, 4)).toEqual({ file_ref: "job_A#1", page: 1 });
    expect(mergedToLocal(space, 5)).toEqual({ file_ref: "job_A#1", page: 2 });
    for (const merged of [1, 2, 3, 4, 5]) {
      expect(localToMerged(space, mergedToLocal(space, merged)!)).toBe(merged);
    }
  });

  it("범위 밖은 null", () => {
    expect(mergedToLocal(space, 0)).toBeNull();
    expect(mergedToLocal(space, 6)).toBeNull();
    expect(mergedToLocal(space, 1.5)).toBeNull();
    expect(localToMerged(space, { file_ref: "job_A#0", page: 4 })).toBeNull();
    expect(localToMerged(space, { file_ref: "job_Z#0", page: 1 })).toBeNull();
  });
});

describe("뷰어 위치", () => {
  const { job } = singleJob();

  it("문서 페이지 순서를 따르고 순서를 바꾸면 따라간다", () => {
    const pages = documentPages(findDocument(job, "st_classify", "doc_2")!);
    expect(viewerIndex(pages, { file_ref: "job_A#1", page: 1 })).toBe(1);
    const moved = reorderPages(
      job,
      "st_classify",
      "doc_2",
      { file_ref: "job_A#1", page: 1 },
      0,
    );
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;
    const after = documentPages(
      findDocument(moved.job, "st_classify", "doc_2")!,
    );
    expect(viewerIndex(after, { file_ref: "job_A#1", page: 1 })).toBe(0);
    expect(viewerPage(after, 1)).toEqual({ file_ref: "job_A#0", page: 3 });
  });

  it("없는 페이지는 -1, 범위 밖 위치는 null", () => {
    const pages = documentPages(findDocument(job, "st_classify", "doc_1")!);
    expect(viewerIndex(pages, { file_ref: "job_A#1", page: 1 })).toBe(-1);
    expect(viewerPage(pages, 2)).toBeNull();
    expect(viewerPage(pages, -1)).toBeNull();
  });
});
