import { describe, expect, it } from "vitest";

import {
  excludePages,
  mergeDocuments,
  movePages,
  reorderDocuments,
  reorderPages,
  restorePages,
  setLabel,
  setValue,
  splitDocument,
  type EditResult,
} from "../edits";
import { ExactNumber, isExactNumber, stringifyJson } from "../json";
import { findDocument, findLayout, findResult } from "../layout";
import { readReviewDocument } from "../normalize";
import { flattenPages, flattenSources, pageKey } from "../pages";
import type { PageRef, ReviewJob } from "../types";
import { singleJob, twoGroupDoc } from "./fixtures/builders";
import { MULTI_LAYOUT, SINGLE_JOB } from "./fixtures/fixtures";

const S = "st_classify";
const p = (file: 0 | 1, page: number, job = "job_A"): PageRef => ({
  file_ref: `${job}#${file}`,
  page,
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

describe("setValue (E1·E2)", () => {
  const { job } = singleJob();

  it("있는 경로의 leaf 만 바꾸고 나머지는 공유한다", () => {
    const next = ok(setValue(job, "occ_extract_1", ["lines", "0", "qty"], 3));
    const content = findResult(next, "occ_extract_1")!.content as Record<
      string,
      unknown
    >;
    expect((content.lines as { qty: number }[])[0]!.qty).toBe(3);
    expect(isExactNumber(content.amount)).toBe(true);
    // 입력은 불변
    expect(
      (
        findResult(job, "occ_extract_1")!.content as {
          lines: { qty: number }[];
        }
      ).lines[0]!.qty,
    ).toBe(2);
    expect(findResult(next, "occ_merge_1")).toBe(
      findResult(job, "occ_merge_1"),
    );
  });

  it("ExactNumber 를 그대로 넣는다", () => {
    const next = ok(
      setValue(
        job,
        "occ_extract_1",
        ["amount"],
        new ExactNumber("98765432109876543210"),
      ),
    );
    expect(stringifyJson(findResult(next, "occ_extract_1")!.content)).toContain(
      '"amount":98765432109876543210',
    );
  });

  it("scalar content 는 경로 [] 로 통째로 바꾼다", () => {
    const next = ok(setValue(job, "occ_validate_1", [], "red"));
    expect(findResult(next, "occ_validate_1")!.content).toBe("red");
    expect(setValue(job, "occ_extract_1", [], "x")).toEqual({
      ok: false,
      reason: "path_missing",
    });
  });

  it("없는 경로·컨테이너·컨테이너 값은 path_missing", () => {
    for (const path of [
      ["nope"],
      ["lines", "5", "qty"],
      ["lines"],
      ["lines", "x"],
    ]) {
      expect(setValue(job, "occ_extract_1", path, 1)).toEqual({
        ok: false,
        reason: "path_missing",
      });
    }
    expect(setValue(job, "occ_extract_1", ["paid"], { a: 1 })).toEqual({
      ok: false,
      reason: "path_missing",
    });
  });

  it("없는 결과·편집 불가 상태", () => {
    expect(setValue(job, "occ_none", ["amount"], 1)).toEqual({
      ok: false,
      reason: "result_missing",
    });
    expect(setValue(job, "occ_extract_2", ["amount"], 1)).toEqual({
      ok: false,
      reason: "result_not_editable",
    });
  });

  it("__proto__ 키도 데이터로 다룬다", () => {
    const doc = readReviewDocument(
      SINGLE_JOB.replace('"invoice_no": "INV-1"', '"__proto__": "x"'),
    );
    const next = ok(
      setValue(doc.jobs[0]!, "occ_extract_1", ["__proto__"], "y"),
    );
    const content = findResult(next, "occ_extract_1")!.content as object;
    expect(Object.getOwnPropertyDescriptor(content, "__proto__")?.value).toBe(
      "y",
    );
    expect(Object.getPrototypeOf(content)).toBe(Object.prototype);
  });
});

describe("setLabel (E3)·reorderDocuments (E5)", () => {
  const { job } = singleJob();

  it("라벨을 바꾸고 null 도 허용한다", () => {
    const next = ok(setLabel(job, S, "doc_2", null));
    expect(findDocument(next, S, "doc_2")!.label).toBeNull();
    expect(findDocument(job, S, "doc_2")!.label).toBe("receipt");
    expect(setLabel(job, S, "doc_9", "x")).toEqual({
      ok: false,
      reason: "document_missing",
    });
  });

  it("문서 순서를 바꾸고 끝을 넘으면 끝에 둔다", () => {
    expect(documentIds(ok(reorderDocuments(job, S, "doc_1", 2)))).toEqual([
      "doc_2",
      "doc_3",
      "doc_1",
    ]);
    expect(documentIds(ok(reorderDocuments(job, S, "doc_3", 0)))).toEqual([
      "doc_3",
      "doc_1",
      "doc_2",
    ]);
    expect(documentIds(ok(reorderDocuments(job, S, "doc_1", 99)))).toEqual([
      "doc_2",
      "doc_3",
      "doc_1",
    ]);
    expect(reorderDocuments(job, S, "doc_1", -1)).toEqual({
      ok: false,
      reason: "index_out_of_range",
    });
  });

  it("없는 보기·멀티 layout 은 거부", () => {
    expect(setLabel(job, "st_other", "doc_1", "x")).toEqual({
      ok: false,
      reason: "target_missing",
    });
    const multi = readReviewDocument(MULTI_LAYOUT).jobs[0]!;
    expect(setLabel(multi, "st_classify_a", "doc_1", "x")).toEqual({
      ok: false,
      reason: "multi_layout_unsupported",
    });
  });
});

describe("reorderPages (E4)", () => {
  const { job } = singleJob();

  it("페이지 하나를 옮기고 source_files 를 다시 압축한다", () => {
    const next = ok(reorderPages(job, S, "doc_2", p(1, 1), 0));
    expect(pagesOf(next, "doc_2")).toEqual(["job_A#1:1", "job_A#0:3"]);
    expect(findDocument(next, S, "doc_2")!.source_files).toEqual([
      { file_ref: "job_A#1", page_ranges: [[1, 1]] },
      { file_ref: "job_A#0", page_ranges: [[3, 3]] },
    ]);
  });

  it("역순은 범위로 묶지 않고, 되돌리면 다시 묶는다", () => {
    const reversed = ok(reorderPages(job, S, "doc_1", p(0, 2), 0));
    expect(findDocument(reversed, S, "doc_1")!.source_files).toEqual([
      {
        file_ref: "job_A#0",
        page_ranges: [
          [2, 2],
          [1, 1],
        ],
      },
    ]);
    const back = ok(reorderPages(reversed, S, "doc_1", p(0, 1), 0));
    expect(findDocument(back, S, "doc_1")!.source_files).toEqual([
      { file_ref: "job_A#0", page_ranges: [[1, 2]] },
    ]);
  });

  it("같은 파일 반복 참조(A#0 → A#1 → A#0)를 허용하고 물리 중복은 없다", () => {
    const merged = ok(mergeDocuments(job, S, "doc_2", "doc_3"));
    // doc_2 = [A#0:3, A#1:1, A#1:2] → A#0:3 을 가운데로
    const next = ok(reorderPages(merged, S, "doc_2", p(1, 2), 0));
    const again = ok(reorderPages(next, S, "doc_2", p(0, 3), 1));
    expect(pagesOf(again, "doc_2")).toEqual([
      "job_A#1:2",
      "job_A#0:3",
      "job_A#1:1",
    ]);
    expect(new Set(pagesOf(again, "doc_2")).size).toBe(3);
    expect(findDocument(again, S, "doc_2")!.source_files).toHaveLength(3);
  });

  it("문서에 없는 페이지는 page_not_in_document", () => {
    expect(reorderPages(job, S, "doc_1", p(1, 1), 0)).toEqual({
      ok: false,
      reason: "page_not_in_document",
    });
  });
});

describe("splitDocument·mergeDocuments (E6)", () => {
  const { job } = singleJob();

  it("분리: 라벨을 물려받은 새 문서를 바로 뒤에 넣는다", () => {
    const next = ok(splitDocument(job, S, "doc_2", p(0, 3), "review-doc-new"));
    expect(documentIds(next)).toEqual([
      "doc_1",
      "doc_2",
      "review-doc-new",
      "doc_3",
    ]);
    expect(pagesOf(next, "doc_2")).toEqual(["job_A#0:3"]);
    expect(pagesOf(next, "review-doc-new")).toEqual(["job_A#1:1"]);
    const created = findDocument(next, S, "review-doc-new")!;
    expect(created.label).toBe("receipt");
    expect(created.group_id).toBe("grp_1");
  });

  it("분리: 마지막 페이지 뒤·없는 페이지·잘못된/겹치는 id 는 실패", () => {
    expect(splitDocument(job, S, "doc_2", p(1, 1), "n1")).toEqual({
      ok: false,
      reason: "index_out_of_range",
    });
    expect(splitDocument(job, S, "doc_2", p(0, 1), "n1")).toEqual({
      ok: false,
      reason: "page_not_in_document",
    });
    expect(splitDocument(job, S, "doc_1", p(0, 1), "bad id!")).toEqual({
      ok: false,
      reason: "invalid_document_id",
    });
    expect(splitDocument(job, S, "doc_1", p(0, 1), "doc_3")).toEqual({
      ok: false,
      reason: "invalid_document_id",
    });
  });

  it("합치기: into 뒤에 이어 붙이고 from 을 지운다", () => {
    const next = ok(mergeDocuments(job, S, "doc_1", "doc_3"));
    expect(documentIds(next)).toEqual(["doc_1", "doc_2"]);
    expect(pagesOf(next, "doc_1")).toEqual([
      "job_A#0:1",
      "job_A#0:2",
      "job_A#1:2",
    ]);
    expect(findDocument(next, S, "doc_1")!.label).toBe("invoice");
  });

  it("합치기: from 이 제외 문서면 excluded_documents 에서도 뺀다", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    const next = ok(mergeDocuments(job2, S, "doc_a", "doc_x"));
    expect(documentIds(next)).toEqual(["doc_a", "doc_b"]);
    expect(next.file_groups!.excluded_documents).toEqual([]);
    const into = ok(mergeDocuments(job2, S, "doc_x", "doc_a"));
    expect(documentIds(into)).toEqual(["doc_b", "doc_x"]);
    expect(into.file_groups!.excluded_documents).toEqual(["doc_x"]);
  });

  it("합치기: 다른 그룹은 group_mismatch", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    expect(mergeDocuments(job2, S, "doc_a", "doc_b")).toEqual({
      ok: false,
      reason: "group_mismatch",
    });
    expect(mergeDocuments(job, S, "doc_1", "doc_9")).toEqual({
      ok: false,
      reason: "document_missing",
    });
  });
});

describe("movePages (E6)", () => {
  const { job } = singleJob();

  it("기존 문서의 index 에 넣고, 빈 원 문서는 지운다", () => {
    const next = ok(
      movePages(job, S, "doc_3", [p(1, 2)], { documentId: "doc_1", index: 1 }),
    );
    expect(pagesOf(next, "doc_1")).toEqual([
      "job_A#0:1",
      "job_A#1:2",
      "job_A#0:2",
    ]);
    expect(documentIds(next)).toEqual(["doc_1", "doc_2"]);
  });

  it("옮기는 페이지는 원 문서 순서를 따른다", () => {
    const next = ok(
      movePages(job, S, "doc_1", [p(0, 2), p(0, 1)], {
        documentId: "doc_3",
        index: 0,
      }),
    );
    expect(pagesOf(next, "doc_3")).toEqual([
      "job_A#0:1",
      "job_A#0:2",
      "job_A#1:2",
    ]);
  });

  it("새 문서로: from 라벨, afterDocumentId 뒤", () => {
    const next = ok(
      movePages(job, S, "doc_2", [p(1, 1)], {
        newDocumentId: "review-doc-m",
        afterDocumentId: "doc_3",
      }),
    );
    expect(documentIds(next)).toEqual([
      "doc_1",
      "doc_2",
      "doc_3",
      "review-doc-m",
    ]);
    expect(findDocument(next, S, "review-doc-m")!.label).toBe("receipt");
    expect(pagesOf(next, "doc_2")).toEqual(["job_A#0:3"]);
  });

  it("새 문서로: to.label 이 있으면 그 라벨, null 이면 라벨 없음", () => {
    const labelOf = (label: string | null) =>
      findDocument(
        ok(
          movePages(job, S, "doc_2", [p(1, 1)], {
            newDocumentId: "review-doc-m",
            afterDocumentId: "doc_2",
            label,
          }),
        ),
        S,
        "review-doc-m",
      )!.label;
    expect(labelOf("B")).toBe("B");
    expect(labelOf(null)).toBeNull();
  });

  it("제외 문서가 비면 지우고 excluded_documents 에서도 뺀다", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    const next = ok(
      movePages(job2, S, "doc_x", [p(0, 1, "job_G")], {
        documentId: "doc_a",
        index: 1,
      }),
    );
    expect(documentIds(next)).toEqual(["doc_a", "doc_b"]);
    expect(next.file_groups!.excluded_documents).toEqual([]);
    expect(job2.file_groups!.excluded_documents).toEqual(["doc_x"]);
  });

  it("제외 문서에서 페이지를 빼고도 남으면 제외 목록은 그대로", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    const next = ok(
      movePages(job2, S, "doc_x", [p(0, 1, "job_G")], {
        newDocumentId: "review-doc-m",
        afterDocumentId: "doc_b",
      }),
    );
    expect(documentIds(next)).toEqual(["doc_a", "doc_b", "review-doc-m"]);
    expect(next.file_groups!.excluded_documents).toEqual([]);
  });

  it("없는 페이지·다른 그룹·없는 대상", () => {
    expect(
      movePages(job, S, "doc_1", [p(1, 1)], { documentId: "doc_2", index: 0 }),
    ).toEqual({
      ok: false,
      reason: "page_not_in_document",
    });
    const job2 = twoGroupDoc().jobs[0]!;
    expect(
      movePages(job2, S, "doc_a", [p(0, 1, "job_G")], {
        documentId: "doc_b",
        index: 0,
      }),
    ).toEqual({ ok: false, reason: "group_mismatch" });
    expect(
      movePages(job, S, "doc_1", [p(0, 1)], { documentId: "doc_9", index: 0 }),
    ).toEqual({
      ok: false,
      reason: "target_missing",
    });
  });
});

describe("excludePages·restorePages (E10)", () => {
  const { job } = singleJob();

  it("제외: 문서에서 빼고 excluded_pages 에 압축해 넣는다", () => {
    const one = ok(excludePages(job, S, "doc_1", [p(0, 2)]));
    const two = ok(excludePages(one, S, "doc_1", [p(0, 1)]));
    expect(documentIds(two)).toEqual(["doc_2", "doc_3"]);
    expect(two.file_groups!.excluded_pages).toEqual([
      {
        file_ref: "job_A#0",
        page_ranges: [
          [2, 2],
          [1, 1],
        ],
      },
    ]);
    expect(job.file_groups!.excluded_pages).toEqual([]);
  });

  it("제외 문서의 마지막 페이지를 제외하면 문서를 지우고 제외 목록에서도 뺀다", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    const next = ok(excludePages(job2, S, "doc_x", [p(0, 1, "job_G")]));
    expect(documentIds(next)).toEqual(["doc_a", "doc_b"]);
    expect(next.file_groups!.excluded_documents).toEqual([]);
    expect(
      flattenSources(next.file_groups!.excluded_pages).map(pageKey),
    ).toEqual(["job_G#0:2", "job_G#0:1"]);
  });

  it("이미 제외한 페이지는 already_excluded, 다시 넣은 뒤에는 제외 가능", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    // job_G#0:2 는 이미 excluded_pages 에 있다
    expect(excludePages(job2, S, "doc_x", [p(0, 2, "job_G")])).toEqual({
      ok: false,
      reason: "already_excluded",
    });
    const restored = ok(
      restorePages(job2, S, [p(0, 2, "job_G")], {
        documentId: "doc_a",
        index: 1,
      }),
    );
    const again = ok(excludePages(restored, S, "doc_a", [p(0, 2, "job_G")]));
    expect(
      flattenSources(again.file_groups!.excluded_pages).map(pageKey),
    ).toEqual(["job_G#0:2"]);
  });

  it("복원: excluded 에서 빼서 같은 그룹 문서 index 에 넣는다", () => {
    const job2 = twoGroupDoc().jobs[0]!;
    const next = ok(
      restorePages(job2, S, [p(0, 2, "job_G")], {
        documentId: "doc_a",
        index: 0,
      }),
    );
    expect(pagesOf(next, "doc_a")).toEqual(["job_G#0:2", "job_G#0:1"]);
    expect(next.file_groups!.excluded_pages).toEqual([]);
    expect(
      restorePages(job2, S, [p(0, 2, "job_G")], {
        documentId: "doc_b",
        index: 0,
      }),
    ).toEqual({ ok: false, reason: "group_mismatch" });
    expect(
      restorePages(job2, S, [p(0, 1, "job_G")], {
        documentId: "doc_a",
        index: 0,
      }),
    ).toEqual({ ok: false, reason: "page_not_in_document" });
  });
});
