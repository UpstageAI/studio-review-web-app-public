import { describe, expect, it } from "vitest";

import {
  addDocument,
  excludeDocument,
  excludePages,
  movePages,
  restoreDocument,
  restorePages,
  setLabel,
  setPageRanges,
  splitDocument,
  type EditResult,
} from "../edits";
import { findDocument, findLayout } from "../layout";
import { readReviewDocument } from "../normalize";
import { flattenPages, pageKey } from "../pages";
import type { PageRef, ReviewJob, SourceRange } from "../types";
import { validateStructure } from "../validate";
import { singleJob, twoGroupDoc } from "./fixtures/builders";
import { MULTI_LAYOUT, NO_LOOKUPS } from "./fixtures/fixtures";

const S = "st_classify";
const NEW_ID = "review-doc-new";
const p = (file: 0 | 1, page: number, job = "job_A"): PageRef => ({
  file_ref: `${job}#${file}`,
  page,
});
const src = (fileRef: string, ...ranges: [number, number][]): SourceRange => ({
  file_ref: fileRef,
  page_ranges: ranges,
});

function ok(result: EditResult): ReviewJob {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.job;
}

function pagesOf(job: ReviewJob, documentId: string): string[] {
  const document = findDocument(job, S, documentId);
  return document ? flattenPages(document).map(pageKey) : [];
}

function documentIds(job: ReviewJob): string[] {
  return findLayout(job, S)!.content.documents.map(d => d.document_id);
}

/** 편집 연산을 거치지 않고 문서의 `source_files` 를 바꾼다(서버 결과부터 겹친 상태 등). */
function withSources(
  job: ReviewJob,
  documentId: string,
  sources: SourceRange[],
): ReviewJob {
  const layout = findLayout(job, S)!;
  const documents = layout.content.documents.map(document =>
    document.document_id === documentId
      ? { ...document, source_files: sources }
      : document,
  );
  return {
    ...job,
    output: job.output.map(item =>
      item === layout
        ? { ...layout, content: { ...layout.content, documents } }
        : item,
    ),
  };
}

const multiJob = () => readReviewDocument(MULTI_LAYOUT).jobs[0]!;

describe("setPageRanges (B5)", () => {
  const { job } = singleJob();

  it("source_files 를 입력 순서 그대로(압축·정렬 없이) 바꾼다", () => {
    const next = ok(
      setPageRanges(job, S, "doc_2", [
        src("job_A#1", [1, 1]),
        src("job_A#0", [3, 3], [2, 2]),
      ]),
    );
    expect(findDocument(next, S, "doc_2")!.source_files).toEqual([
      { file_ref: "job_A#1", page_ranges: [[1, 1]] },
      {
        file_ref: "job_A#0",
        page_ranges: [
          [3, 3],
          [2, 2],
        ],
      },
    ]);
    expect(pagesOf(next, "doc_2")).toEqual([
      "job_A#1:1",
      "job_A#0:3",
      "job_A#0:2",
    ]);
    // 새로 넣은 job_A#0:2 는 doc_1 에서 옮겨 온다
    expect(pagesOf(next, "doc_1")).toEqual(["job_A#0:1"]);
    // 입력은 불변, 걸리지 않은 문서는 공유
    expect(pagesOf(job, "doc_2")).toEqual(["job_A#0:3", "job_A#1:1"]);
    expect(findDocument(next, S, "doc_3")).toBe(findDocument(job, S, "doc_3"));
  });

  it("다른 문서의 페이지는 옮겨 오고, num_pages 초과는 validateStructure 가 보인다", () => {
    const next = ok(setPageRanges(job, S, "doc_3", [src("job_A#1", [1, 5])]));
    expect(pagesOf(next, "doc_2")).toEqual(["job_A#0:3"]);
    expect(validateStructure(next).map(issue => issue.code)).toEqual([
      "page_out_of_range",
    ]);
  });

  it("다른 문서 페이지를 넣으면 그 문서에서 빠지고 나머지 순서는 유지된다", () => {
    const next = ok(
      setPageRanges(job, S, "doc_3", [
        src("job_A#1", [2, 2]),
        src("job_A#0", [2, 2]),
      ]),
    );
    expect(pagesOf(next, "doc_3")).toEqual(["job_A#1:2", "job_A#0:2"]);
    expect(pagesOf(next, "doc_1")).toEqual(["job_A#0:1"]);
    expect(findDocument(next, S, "doc_2")).toBe(findDocument(job, S, "doc_2"));
    expect(next.file_groups).toBe(job.file_groups);
    expect(validateStructure(next)).toEqual([]);
  });

  it("원 문서가 비면 지우고 excluded_documents 에서도 뺀다", () => {
    const excluded = ok(excludeDocument(job, "doc_3"));
    const next = ok(
      setPageRanges(excluded, S, "doc_2", [
        src("job_A#0", [3, 3]),
        src("job_A#1", [1, 2]),
      ]),
    );
    expect(documentIds(next)).toEqual(["doc_1", "doc_2"]);
    expect(next.file_groups!.excluded_documents).toEqual([]);
    expect(validateStructure(next)).toEqual([]);
  });

  it("제외 페이지를 넣으면 excluded_pages 에서 빠진다", () => {
    const withExcluded = ok(excludePages(job, S, "doc_1", [p(0, 2)]));
    expect(withExcluded.file_groups!.excluded_pages).toEqual([
      src("job_A#0", [2, 2]),
    ]);
    const next = ok(
      setPageRanges(withExcluded, S, "doc_3", [
        src("job_A#1", [2, 2]),
        src("job_A#0", [2, 2]),
      ]),
    );
    expect(next.file_groups!.excluded_pages).toEqual([]);
    expect(pagesOf(next, "doc_1")).toEqual(["job_A#0:1"]);
    expect(validateStructure(next)).toEqual([]);
  });

  it("이 문서에 원래 있던 페이지의 겹침은 건드리지 않는다", () => {
    // doc_3 이 처음부터 doc_2 의 job_A#1:1 과 겹쳐 있는 상태
    const overlapping = withSources(job, "doc_3", [src("job_A#1", [1, 2])]);
    const next = ok(
      setPageRanges(overlapping, S, "doc_3", [
        src("job_A#1", [1, 2]),
        src("job_A#0", [1, 1]),
      ]),
    );
    expect(pagesOf(next, "doc_2")).toEqual(["job_A#0:3", "job_A#1:1"]);
    expect(pagesOf(next, "doc_1")).toEqual(["job_A#0:2"]);
    expect(validateStructure(next).map(issue => issue.code)).toEqual([
      "duplicate_review_page",
    ]);
  });

  it.each<[string, SourceRange[]]>([
    ["빈 목록", []],
    ["범위 없는 파일", [src("job_A#0")]],
    ["역순", [src("job_A#0", [3, 1])]],
    ["0 페이지", [src("job_A#0", [0, 1])]],
    ["정수 아님", [src("job_A#0", [1.5, 2])]],
    ["MAX_PAGE_NUMBER 초과", [src("job_A#0", [1, 10_001])]],
    ["다른 그룹·없는 파일", [src("job_Z#0", [1, 1])]],
  ])("%s → invalid_page_ranges", (_name, sources) => {
    expect(setPageRanges(job, S, "doc_1", sources)).toEqual({
      ok: false,
      reason: "invalid_page_ranges",
    });
  });

  it("문서 페이지 상한을 넘으면 invalid_page_ranges", () => {
    expect(
      setPageRanges(job, S, "doc_1", [
        src("job_A#0", [1, 6_000]),
        src("job_A#1", [1, 6_000]),
      ]),
    ).toEqual({ ok: false, reason: "invalid_page_ranges" });
  });

  it("자기 그룹이 아닌 파일은 invalid_page_ranges", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    expect(setPageRanges(job2, S, "doc_a", [src("job_G#1", [1, 1])])).toEqual({
      ok: false,
      reason: "invalid_page_ranges",
    });
  });

  it("없는 문서·멀티 layout", () => {
    expect(setPageRanges(job, S, "nope", [src("job_A#0", [1, 1])])).toEqual({
      ok: false,
      reason: "document_missing",
    });
    expect(
      setPageRanges(multiJob(), S, "doc_1", [src("job_A#0", [1, 1])]),
    ).toEqual({ ok: false, reason: "multi_layout_unsupported" });
  });
});

describe("addDocument (B7)", () => {
  const { job } = singleJob();

  it("그룹·라벨·범위로 새 문서를 index 에 넣는다", () => {
    const next = ok(
      addDocument(job, S, NEW_ID, "grp_1", "memo", [src("job_A#1", [2, 2])], 1),
    );
    // job_A#1:2 를 doc_3 에서 옮겨 와 doc_3 은 비어 지워진다
    expect(documentIds(next)).toEqual(["doc_1", NEW_ID, "doc_2"]);
    expect(findDocument(next, S, NEW_ID)).toEqual({
      document_id: NEW_ID,
      group_id: "grp_1",
      label: "memo",
      source_files: [{ file_ref: "job_A#1", page_ranges: [[2, 2]] }],
    });
    const atEnd = ok(
      addDocument(job, S, NEW_ID, "grp_1", null, [src("job_A#1", [2, 2])], 99),
    );
    expect(documentIds(atEnd)).toEqual(["doc_1", "doc_2", NEW_ID]);
    expect(validateStructure(next)).toEqual([]);
  });

  it("다른 문서 페이지로 만들면 원 문서에서 빠지고 index 는 빼기 전 기준이다", () => {
    // doc_2 바로 뒤(index 2)에 넣는다. doc_1 은 비어 지워져도 새 문서는 doc_2 뒤에 남는다
    const next = ok(
      addDocument(job, S, NEW_ID, "grp_1", null, [src("job_A#0", [1, 2])], 2),
    );
    expect(documentIds(next)).toEqual(["doc_2", NEW_ID, "doc_3"]);
    expect(pagesOf(next, NEW_ID)).toEqual(["job_A#0:1", "job_A#0:2"]);
    expect(validateStructure(next)).toEqual([]);

    const partial = ok(
      addDocument(job, S, NEW_ID, "grp_1", null, [src("job_A#0", [3, 3])], 3),
    );
    expect(pagesOf(partial, "doc_2")).toEqual(["job_A#1:1"]);
    expect(findDocument(partial, S, "doc_1")).toBe(
      findDocument(job, S, "doc_1"),
    );
  });

  it("빠진 페이지로 새 문서를 만들면 page_missing 이 사라진다", () => {
    const shrunk = ok(setPageRanges(job, S, "doc_2", [src("job_A#0", [3, 3])]));
    expect(validateStructure(shrunk).map(issue => issue.code)).toEqual([
      "page_missing",
    ]);
    const added = ok(
      addDocument(
        shrunk,
        S,
        NEW_ID,
        "grp_1",
        null,
        [src("job_A#1", [1, 1])],
        2,
      ),
    );
    expect(validateStructure(added)).toEqual([]);
  });

  it("잘못된 id·중복 id·없는 그룹·잘못된 범위·음수 index", () => {
    const one = [src("job_A#1", [2, 2])];
    expect(addDocument(job, S, "bad id", "grp_1", null, one, 0)).toEqual({
      ok: false,
      reason: "invalid_document_id",
    });
    expect(addDocument(job, S, "doc_1", "grp_1", null, one, 0)).toEqual({
      ok: false,
      reason: "invalid_document_id",
    });
    expect(addDocument(job, S, NEW_ID, "grp_9", null, one, 0)).toEqual({
      ok: false,
      reason: "target_missing",
    });
    expect(addDocument(job, S, NEW_ID, "grp_1", null, [], 0)).toEqual({
      ok: false,
      reason: "invalid_page_ranges",
    });
    expect(addDocument(job, S, NEW_ID, "grp_1", null, one, -1)).toEqual({
      ok: false,
      reason: "index_out_of_range",
    });
  });
});

describe("excludeDocument·restoreDocument (B9)", () => {
  const { job } = singleJob();

  it("excluded_documents 에 넣고 documents[] 는 그대로 둔다", () => {
    const next = ok(excludeDocument(job, "doc_3"));
    expect(next.file_groups!.excluded_documents).toEqual(["doc_3"]);
    expect(documentIds(next)).toEqual(["doc_1", "doc_2", "doc_3"]);
    expect(next.output).toBe(job.output);
    expect(job.file_groups!.excluded_documents).toEqual([]);
  });

  it("제외 문서의 페이지는 빠짐이 아니고, 다른 문서와 겹쳐도 된다", () => {
    const excluded = ok(excludeDocument(job, "doc_3"));
    expect(validateStructure(excluded)).toEqual([]);
    const overlapping = withSources(excluded, "doc_3", [
      src("job_A#1", [1, 2]),
    ]);
    expect(validateStructure(overlapping)).toEqual([]);
    const restored = ok(restoreDocument(overlapping, "doc_3"));
    expect(validateStructure(restored).map(issue => issue.code)).toEqual([
      "duplicate_review_page",
    ]);
  });

  it("이미 제외·없는 문서·제외 안 된 문서 복귀", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    expect(excludeDocument(job2, "doc_x")).toEqual({
      ok: false,
      reason: "already_excluded",
    });
    expect(excludeDocument(job, "nope")).toEqual({
      ok: false,
      reason: "document_missing",
    });
    expect(restoreDocument(job, "doc_1")).toEqual({
      ok: false,
      reason: "target_missing",
    });
    expect(
      ok(restoreDocument(job2, "doc_x")).file_groups!.excluded_documents,
    ).toEqual([]);
  });

  it("멀티 layout·file_groups 없는 Job 은 막는다", () => {
    expect(excludeDocument(multiJob(), "doc_1")).toEqual({
      ok: false,
      reason: "multi_layout_unsupported",
    });
    const noGroups = readReviewDocument(NO_LOOKUPS).jobs[1]!;
    expect(excludeDocument(noGroups, "doc_1")).toEqual({
      ok: false,
      reason: "target_missing",
    });
  });
});

describe("restorePages — 새 문서 대상", () => {
  it("제외 페이지로 afterDocumentId 뒤에 새 문서(페이지의 그룹, 라벨 없음)를 만든다", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    const next = ok(
      restorePages(job2, S, [p(0, 2, "job_G")], {
        newDocumentId: NEW_ID,
        afterDocumentId: "doc_a",
      }),
    );
    expect(documentIds(next)).toEqual(["doc_a", NEW_ID, "doc_b", "doc_x"]);
    expect(findDocument(next, S, NEW_ID)).toEqual({
      document_id: NEW_ID,
      group_id: "grp_1",
      label: null,
      source_files: [{ file_ref: "job_G#0", page_ranges: [[2, 2]] }],
    });
    expect(next.file_groups!.excluded_pages).toEqual([]);
  });

  it("to.label 이 있으면 새 문서 라벨이 그 라벨", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    const next = ok(
      restorePages(job2, S, [p(0, 2, "job_G")], {
        newDocumentId: NEW_ID,
        afterDocumentId: "doc_a",
        label: "B",
      }),
    );
    expect(findDocument(next, S, NEW_ID)!.label).toBe("B");
  });

  it("없는 기준 문서·중복 id·제외 안 된 페이지", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    expect(
      restorePages(job2, S, [p(0, 2, "job_G")], {
        newDocumentId: NEW_ID,
        afterDocumentId: "nope",
      }),
    ).toEqual({ ok: false, reason: "target_missing" });
    expect(
      restorePages(job2, S, [p(0, 2, "job_G")], {
        newDocumentId: "doc_b",
        afterDocumentId: "doc_a",
      }),
    ).toEqual({ ok: false, reason: "invalid_document_id" });
    expect(
      restorePages(job2, S, [p(0, 1, "job_G")], {
        newDocumentId: NEW_ID,
        afterDocumentId: "doc_a",
      }),
    ).toEqual({ ok: false, reason: "page_not_in_document" });
  });

  it("두 그룹에 걸친 페이지는 group_mismatch", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    // job_G#1:1 도 제외해 두 그룹의 페이지가 excluded_pages 에 있게 한다
    const both = ok(excludePages(job2, S, "doc_b", [p(1, 1, "job_G")]));
    expect(
      restorePages(both, S, [p(0, 2, "job_G"), p(1, 1, "job_G")], {
        newDocumentId: NEW_ID,
        afterDocumentId: "doc_a",
      }),
    ).toEqual({ ok: false, reason: "group_mismatch" });
  });
});

describe("splitDocument — 제외 문서", () => {
  const { job } = singleJob();

  it("제외 문서를 나누면 새 문서도 excluded_documents 에 들어간다", () => {
    const excluded = ok(excludeDocument(job, "doc_1"));
    const next = ok(splitDocument(excluded, S, "doc_1", p(0, 1), NEW_ID));
    expect(documentIds(next)).toEqual(["doc_1", NEW_ID, "doc_2", "doc_3"]);
    expect(next.file_groups!.excluded_documents).toEqual(["doc_1", NEW_ID]);
    expect(pagesOf(next, NEW_ID)).toEqual([pageKey(p(0, 2))]);
    expect(validateStructure(next)).toEqual([]);
    expect(excluded.file_groups!.excluded_documents).toEqual(["doc_1"]);
  });

  it("활성 문서를 나누면 excluded_documents 는 그대로(같은 객체)", () => {
    const next = ok(splitDocument(job, S, "doc_1", p(0, 1), NEW_ID));
    expect(next.file_groups).toBe(job.file_groups);
    expect(next.file_groups!.excluded_documents).toEqual([]);
  });

  it("제외 문서에서 페이지를 옮겨 만든 새 문서는 활성", () => {
    const excluded = ok(excludeDocument(job, "doc_1"));
    const next = ok(
      movePages(excluded, S, "doc_1", [p(0, 2)], {
        newDocumentId: NEW_ID,
        afterDocumentId: "doc_1",
      }),
    );
    expect(next.file_groups!.excluded_documents).toEqual(["doc_1"]);
  });
});

describe("setLabel — 빈 라벨", () => {
  const { job } = singleJob();

  it.each([[""], ["  "], ["\t\n"]])("%j 는 라벨 없음(null)", label => {
    const next = ok(setLabel(job, S, "doc_1", label));
    expect(findDocument(next, S, "doc_1")!.label).toBeNull();
  });

  it("앞뒤 공백이 있는 라벨은 그대로", () => {
    const next = ok(setLabel(job, S, "doc_1", " memo "));
    expect(findDocument(next, S, "doc_1")!.label).toBe(" memo ");
  });
});
