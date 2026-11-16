import { describe, expect, it } from "vitest";

import {
  parseJson,
  stringifyJson,
  type JsonObject,
  type JsonValue,
} from "../json";
import { readReviewDocument } from "../normalize";
import type { ReviewDocument, ReviewJob } from "../types";
import {
  DOCUMENT_LABEL_MAX_LENGTH,
  hasBlockingIssues,
  validateJob,
  validateStructure,
  validateValues,
} from "../validate";
import { MULTI_LAYOUT, NO_LOOKUPS, SINGLE_JOB } from "./fixtures/fixtures";

type Raw = JsonObject;

/** fixture 를 JSON 수준에서 고친 뒤 다시 읽는다. */
function edited(
  text: string,
  edit: (job: Raw, root: Raw) => void,
): ReviewDocument {
  const root = parseJson(text) as Raw;
  edit((root.jobs as JsonValue[])[0] as Raw, root);
  return readReviewDocument(stringifyJson(root));
}

function documentsOf(job: Raw, layoutIndex = 0): Raw[] {
  const layout = (job.output as Raw[])[layoutIndex]!;
  return (layout.content as Raw).documents as Raw[];
}

function fileGroups(job: Raw): Raw {
  return job.file_groups as Raw;
}

function resultContent(job: Raw, id: string): Raw {
  return (job.output as Raw[]).find(item => item.id === id)!.content as Raw;
}

const codes = (issues: readonly { code: string }[]) =>
  issues.map(item => item.code);

describe("정상 fixture", () => {
  it.each([
    ["single-job", SINGLE_JOB],
    ["multi-layout", MULTI_LAYOUT],
  ])("%s 는 빈 배열", (_name, text) => {
    const doc = readReviewDocument(text);
    expect(validateJob(doc, doc.jobs[0]!)).toEqual([]);
  });

  it("file_groups 없는 Job 은 구조 검증을 건너뛴다", () => {
    const doc = readReviewDocument(NO_LOOKUPS);
    expect(validateStructure(doc.jobs[1]!)).toEqual([]);
    expect(validateJob(doc, doc.jobs[1]!)).toEqual([]);
  });
});

describe("커버리지", () => {
  it("빠진 페이지는 page_missing (step·그룹·페이지)", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job).splice(2, 1);
    });
    expect(validateStructure(doc.jobs[0]!)).toEqual([
      {
        code: "page_missing",
        severity: "error",
        jobId: "job_A",
        where: {
          kind: "page",
          stepId: "st_classify",
          groupId: "grp_1",
          page: { file_ref: "job_A#1", page: 2 },
          documentIds: [],
        },
      },
    ]);
  });

  it("num_pages 가 없으면 coverageUnknown 경고만(저장을 막지 않음)", () => {
    const doc = readReviewDocument(NO_LOOKUPS);
    const issues = validateJob(doc, doc.jobs[0]!);
    expect(issues).toEqual([
      {
        code: "page_missing",
        severity: "warning",
        jobId: "job_N",
        where: { kind: "job" },
        detail: { coverageUnknown: true, fileRef: "job_N#0" },
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(false);
  });

  it("두 문서가 같은 페이지 → duplicate_review_page(문서 id 들)", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[2]!.source_files = [
        { file_ref: "job_A#1", page_ranges: [[1, 2]] },
      ];
    });
    const issues = validateStructure(doc.jobs[0]!);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      code: "duplicate_review_page",
      where: {
        kind: "page",
        page: { file_ref: "job_A#1", page: 1 },
        documentIds: ["doc_2", "doc_3"],
      },
    });
  });

  it("한 문서가 같은 페이지를 두 번 → duplicate_review_page(한 번만)", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[0]!.source_files = [
        {
          file_ref: "job_A#0",
          page_ranges: [
            [1, 2],
            [2, 2],
          ],
        },
      ];
    });
    expect(validateStructure(doc.jobs[0]!)).toMatchObject([
      {
        code: "duplicate_review_page",
        where: { documentIds: ["doc_1"], page: { page: 2 } },
      },
    ]);
  });

  it("문서에 있는 페이지를 제외 → page_overlap(excluded)", () => {
    const doc = edited(SINGLE_JOB, job => {
      fileGroups(job).excluded_pages = [
        { file_ref: "job_A#0", page_ranges: [[1, 1]] },
      ];
    });
    expect(validateStructure(doc.jobs[0]!)).toMatchObject([
      {
        code: "page_overlap",
        where: {
          page: { file_ref: "job_A#0", page: 1 },
          documentIds: ["doc_1"],
        },
        detail: { excluded: true },
      },
    ]);
  });

  it("같은 페이지를 두 번 제외 → page_overlap, 빠진 페이지는 아님", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job).splice(2, 1);
      fileGroups(job).excluded_pages = [
        { file_ref: "job_A#1", page_ranges: [[2, 2]] },
        { file_ref: "job_A#1", page_ranges: [[2, 2]] },
      ];
    });
    expect(validateStructure(doc.jobs[0]!)).toMatchObject([
      {
        code: "page_overlap",
        where: { documentIds: [] },
        detail: { excluded: true, count: 2 },
      },
    ]);
  });

  it("제외 페이지·제외 문서의 페이지는 빠진 것으로 보지 않는다", () => {
    const excludedPage = edited(SINGLE_JOB, job => {
      documentsOf(job).splice(2, 1);
      fileGroups(job).excluded_pages = [
        { file_ref: "job_A#1", page_ranges: [[2, 2]] },
      ];
    });
    expect(validateStructure(excludedPage.jobs[0]!)).toEqual([]);
    // 제외 문서는 다른 문서와 페이지가 겹쳐도 된다
    const excludedDoc = edited(SINGLE_JOB, job => {
      documentsOf(job)[2]!.source_files = [
        { file_ref: "job_A#1", page_ranges: [[1, 2]] },
      ];
      fileGroups(job).excluded_documents = ["doc_3"];
    });
    expect(validateStructure(excludedDoc.jobs[0]!)).toEqual([]);
  });

  it("그룹의 layout_step_id 보기에 있는 문서만 커버리지에 센다(멀티 layout)", () => {
    const doc = edited(MULTI_LAYOUT, job => {
      const moved = documentsOf(job, 0).splice(0, 1)[0]!;
      documentsOf(job, 1).push({ ...moved, document_id: "doc_2" });
    });
    expect(validateStructure(doc.jobs[0]!)).toMatchObject([
      {
        code: "page_missing",
        where: { stepId: "st_classify_a", groupId: "grp_a", page: { page: 1 } },
      },
      {
        code: "page_missing",
        where: { stepId: "st_classify_a", groupId: "grp_a", page: { page: 2 } },
      },
    ]);
  });
});

describe("범위·소속", () => {
  it("num_pages 를 넘으면 page_out_of_range(문서)", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[2]!.source_files = [
        { file_ref: "job_A#1", page_ranges: [[2, 3]] },
      ];
    });
    expect(validateStructure(doc.jobs[0]!)).toEqual([
      {
        code: "page_out_of_range",
        severity: "error",
        jobId: "job_A",
        where: { kind: "document", stepId: "st_classify", documentId: "doc_3" },
        detail: { fileRef: "job_A#1", first: 2, last: 3, numPages: 2 },
      },
    ]);
  });

  it("역순 범위는 page_out_of_range, 그 페이지는 빠진 것으로", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[2]!.source_files = [
        { file_ref: "job_A#1", page_ranges: [[2, 1]] },
      ];
    });
    expect(codes(validateStructure(doc.jobs[0]!))).toEqual([
      "page_out_of_range",
      "page_missing",
    ]);
  });

  it("자기 그룹 밖 파일 → review_file_unavailable", () => {
    const doc = edited(SINGLE_JOB, job => {
      (documentsOf(job)[2]!.source_files as JsonValue[]).push({
        file_ref: "job_Z#0",
        page_ranges: [[1, 1]],
      });
    });
    expect(validateStructure(doc.jobs[0]!)).toMatchObject([
      {
        code: "review_file_unavailable",
        where: { kind: "document", documentId: "doc_3" },
        detail: { fileRef: "job_Z#0" },
      },
    ]);
  });

  it("없는 그룹 → review_group_unavailable", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[2]!.group_id = "grp_x";
    });
    expect(codes(validateStructure(doc.jobs[0]!))).toEqual([
      "review_group_unavailable",
      "page_missing",
    ]);
  });

  it("한 파일이 두 그룹에 → duplicate_review_file", () => {
    const base = readReviewDocument(SINGLE_JOB).jobs[0]!;
    const groups = base.file_groups!.groups;
    const job: ReviewJob = {
      ...base,
      file_groups: {
        ...base.file_groups!,
        groups: [
          ...groups,
          {
            group_id: "grp_2",
            layout_step_id: "st_classify",
            files: [groups[0]!.files[0]!],
          },
        ],
      },
    };
    expect(validateStructure(job)).toMatchObject([
      {
        code: "duplicate_review_file",
        where: { kind: "job" },
        detail: { fileRef: "job_A#0", groupId: "grp_2" },
      },
    ]);
  });

  it("문서 10,001 개 → review_limit_exceeded", () => {
    const base = readReviewDocument(NO_LOOKUPS).jobs[0]!;
    const documents = Array.from({ length: 10_001 }, (_, index) => ({
      document_id: `d${index}`,
      group_id: "grp_1",
      label: null,
      source_files: [{ file_ref: "job_N#0", page_ranges: [[1, 1] as const] }],
    }));
    const job: ReviewJob = {
      ...base,
      output: [{ step_id: null, base_version: 0, content: { documents } }],
    };
    const limit = validateStructure(job).filter(
      item => item.code === "review_limit_exceeded",
    );
    expect(limit).toEqual([
      {
        code: "review_limit_exceeded",
        severity: "error",
        jobId: "job_N",
        where: { kind: "job" },
        detail: { limit: 10_000, count: 10_001, resource: "documents" },
      },
    ]);
  });
});

describe("라벨·값", () => {
  it("labels 밖 라벨은 label_not_in_config 경고", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[0]!.label = "memo";
    });
    const issues = validateJob(doc, doc.jobs[0]!);
    expect(issues).toEqual([
      {
        code: "label_not_in_config",
        severity: "warning",
        jobId: "job_A",
        where: { kind: "document", stepId: "st_classify", documentId: "doc_1" },
        detail: { label: "memo" },
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(false);
    // labels 조회 정보가 없으면 판단하지 않는다
    const multi = edited(MULTI_LAYOUT, job => {
      documentsOf(job, 1)[0]!.label = "anything";
    });
    expect(validateJob(multi, multi.jobs[0]!)).toEqual([]);
  });

  it("schema 위반은 필드 pointer", () => {
    const doc = edited(SINGLE_JOB, job => {
      const content = resultContent(job, "occ_extract_1");
      content.currency = "EUR";
      ((content.lines as Raw[])[0] as Raw).qty = 1.5;
    });
    const issues = validateJob(doc, doc.jobs[0]!, {
      changedResultIds: ["occ_extract_1"],
    });
    expect(issues).toEqual([
      {
        code: "schema_violation",
        severity: "error",
        jobId: "job_A",
        where: {
          kind: "field",
          resultId: "occ_extract_1",
          pointer: "/currency",
        },
        detail: { expected: "enum" },
      },
      {
        code: "schema_violation",
        severity: "error",
        jobId: "job_A",
        where: {
          kind: "field",
          resultId: "occ_extract_1",
          pointer: "/lines/0/qty",
        },
        detail: { expected: "integer" },
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("편집 불가 상태의 결과를 바꾸면 result_not_editable", () => {
    const doc = readReviewDocument(SINGLE_JOB);
    expect(
      validateValues(doc, doc.jobs[0]!, ["occ_extract_2", "occ_validate_1"]),
    ).toEqual([
      {
        code: "result_not_editable",
        severity: "error",
        jobId: "job_A",
        where: { kind: "field", resultId: "occ_extract_2", pointer: "" },
        detail: { state: "input_changed" },
      },
    ]);
  });

  it("Validate 는 schema 조회 정보가 없어도 green/yellow/red 만", () => {
    const doc = edited(NO_LOOKUPS, job => {
      (job.output as Raw[])[2]!.content = "blue";
    });
    expect(validateValues(doc, doc.jobs[0]!, ["occ_n_2"])).toMatchObject([
      {
        code: "schema_violation",
        where: { resultId: "occ_n_2", pointer: "" },
        detail: { expected: "enum" },
      },
    ]);
  });

  it("객체 schema 에 scalar·scalar schema 에 객체면 루트 위반", () => {
    const doc = edited(SINGLE_JOB, job => {
      (job.output as Raw[])[1]!.content = "oops";
      (job.output as Raw[])[4]!.content = { verdict: "green" };
    });
    expect(
      validateValues(doc, doc.jobs[0]!, [
        "occ_extract_1",
        "occ_validate_1",
      ]).map(item => [item.where, item.detail]),
    ).toEqual([
      [
        { kind: "field", resultId: "occ_extract_1", pointer: "" },
        { expected: "object" },
      ],
      [
        { kind: "field", resultId: "occ_validate_1", pointer: "" },
        { expected: "enum" },
      ],
    ]);
  });
});

describe("항목 하나짜리 배열 값", () => {
  const wrap = (mutate?: (content: Raw) => void, count = 1) =>
    edited(SINGLE_JOB, job => {
      const item = (job.output as Raw[]).find(
        entry => entry.id === "occ_extract_1",
      )!;
      const content = item.content as Raw;
      mutate?.(content);
      item.content = Array.from({ length: count }, () => content);
    });

  it("객체 schema 의 결과가 [객체] 면 그 항목을 값으로 본다", () => {
    const doc = wrap();
    expect(validateValues(doc, doc.jobs[0]!, ["occ_extract_1"])).toEqual([]);
  });

  it("항목 안 위반은 /0 을 붙인 pointer 로 알린다", () => {
    const doc = wrap(content => {
      ((content.lines as Raw[])[0] as Raw).qty = "x";
    });
    expect(
      validateValues(doc, doc.jobs[0]!, ["occ_extract_1"]).map(
        item => item.where,
      ),
    ).toEqual([
      { kind: "field", resultId: "occ_extract_1", pointer: "/0/lines/0/qty" },
    ]);
  });

  it("항목이 둘 이상이면 루트 위반", () => {
    const doc = wrap(undefined, 2);
    expect(
      validateValues(doc, doc.jobs[0]!, ["occ_extract_1"]).map(
        item => item.where,
      ),
    ).toContainEqual({ kind: "field", resultId: "occ_extract_1", pointer: "" });
  });
});

describe("정렬", () => {
  it("Job → 문서 순 → 페이지 순 → 결과 순", () => {
    const doc = edited(SINGLE_JOB, job => {
      const documents = documentsOf(job);
      documents.splice(2, 1);
      documents[1]!.source_files = [
        { file_ref: "job_A#0", page_ranges: [[3, 4]] },
      ];
      documents[0]!.label = "memo";
      resultContent(job, "occ_extract_1").paid = "yes";
      fileGroups(job).excluded_pages = [
        { file_ref: "job_Z#0", page_ranges: [[1, 1]] },
      ];
    });
    const issues = validateJob(doc, doc.jobs[0]!);
    expect(issues.map(item => [item.code, item.where.kind])).toEqual([
      ["review_file_unavailable", "job"],
      ["label_not_in_config", "document"],
      ["page_out_of_range", "document"],
      ["page_missing", "page"],
      ["page_missing", "page"],
      ["schema_violation", "field"],
    ]);
    expect(
      issues
        .filter(item => item.where.kind === "page")
        .map(item => (item.where.kind === "page" ? item.where.page : null)),
    ).toEqual([
      { file_ref: "job_A#1", page: 1 },
      { file_ref: "job_A#1", page: 2 },
    ]);
  });
});

describe("duplicate_review_page 와 page_overlap", () => {
  it("제외 문서도 한 문서 안의 반복은 duplicate_review_page", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[2]!.source_files = [
        {
          file_ref: "job_A#1",
          page_ranges: [
            [2, 2],
            [2, 2],
          ],
        },
      ];
      fileGroups(job).excluded_documents = ["doc_3"];
    });
    expect(codes(validateStructure(doc.jobs[0]!))).toEqual([
      "duplicate_review_page",
    ]);
  });

  it("제외 페이지와 겹침은 page_overlap, 문서끼리 겹침은 duplicate_review_page", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[2]!.source_files = [
        { file_ref: "job_A#1", page_ranges: [[1, 2]] },
      ];
      fileGroups(job).excluded_pages = [
        { file_ref: "job_A#0", page_ranges: [[1, 1]] },
      ];
    });
    expect(codes(validateStructure(doc.jobs[0]!)).sort()).toEqual([
      "duplicate_review_page",
      "page_overlap",
    ]);
  });

  it("제외 문서 페이지는 빠짐이 아니고, 제외 페이지와 겹쳐도 page_overlap 이 아니다", () => {
    const doc = edited(SINGLE_JOB, job => {
      fileGroups(job).excluded_documents = ["doc_3"];
      fileGroups(job).excluded_pages = [
        { file_ref: "job_A#1", page_ranges: [[2, 2]] },
      ];
    });
    expect(validateStructure(doc.jobs[0]!)).toEqual([]);
  });
});

describe("서버 schema·참조 규칙", () => {
  const withLabel = (label: string) =>
    edited(SINGLE_JOB, job => {
      documentsOf(job)[0]!.label = label;
    });
  const docWhere = {
    kind: "document",
    stepId: "st_classify",
    documentId: "doc_1",
  };

  it("빈 라벨 → schema_violation(문서, 차단)", () => {
    const doc = withLabel("");
    const issues = validateJob(doc, doc.jobs[0]!);
    expect(issues).toEqual([
      {
        code: "schema_violation",
        severity: "error",
        jobId: "job_A",
        where: docWhere,
        detail: { expected: "min_length", field: "label", limit: 1, count: 0 },
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("라벨 201 자 → schema_violation(차단), 200 자는 통과", () => {
    expect(DOCUMENT_LABEL_MAX_LENGTH).toBe(200);
    const long = withLabel("가".repeat(201));
    const issues = validateStructure(long.jobs[0]!);
    expect(issues).toMatchObject([
      {
        code: "schema_violation",
        severity: "error",
        where: docWhere,
        detail: {
          expected: "max_length",
          field: "label",
          limit: 200,
          count: 201,
        },
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(validateStructure(withLabel("가".repeat(200)).jobs[0]!)).toEqual([]);
  });

  it("라벨 길이는 code point 로 센다(서로게이트 쌍 한 글자)", () => {
    const emoji = "\u{1F600}";
    expect(validateStructure(withLabel(emoji.repeat(200)).jobs[0]!)).toEqual(
      [],
    );
    expect(
      codes(validateStructure(withLabel(emoji.repeat(201)).jobs[0]!)),
    ).toEqual(["schema_violation"]);
  });

  it("공백뿐인 라벨은 서버가 받으므로 이슈 없음", () => {
    expect(validateStructure(withLabel("  ").jobs[0]!)).toEqual([]);
  });

  it("source_files: [] → schema_violation(문서)", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[2]!.source_files = [];
      fileGroups(job).excluded_pages = [
        { file_ref: "job_A#1", page_ranges: [[2, 2]] },
      ];
    });
    expect(validateStructure(doc.jobs[0]!)).toEqual([
      {
        code: "schema_violation",
        severity: "error",
        jobId: "job_A",
        where: { kind: "document", stepId: "st_classify", documentId: "doc_3" },
        detail: {
          expected: "min_items",
          field: "source_files",
          limit: 1,
          count: 0,
        },
      },
    ]);
  });

  it("page_ranges: [] → schema_violation(문서·제외 페이지)", () => {
    const doc = edited(SINGLE_JOB, job => {
      (documentsOf(job)[2]!.source_files as JsonValue[]).push({
        file_ref: "job_A#0",
        page_ranges: [],
      });
      fileGroups(job).excluded_pages = [
        { file_ref: "job_A#1", page_ranges: [] },
      ];
    });
    const issues = validateStructure(doc.jobs[0]!);
    expect(issues).toMatchObject([
      {
        code: "schema_violation",
        where: { kind: "job" },
        detail: {
          expected: "min_items",
          field: "page_ranges",
          fileRef: "job_A#1",
        },
      },
      {
        code: "schema_violation",
        where: { kind: "document", documentId: "doc_3" },
        detail: {
          expected: "min_items",
          field: "page_ranges",
          fileRef: "job_A#0",
        },
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("없는 제외 문서 id → review_document_unavailable(차단)", () => {
    const doc = edited(SINGLE_JOB, job => {
      fileGroups(job).excluded_documents = ["doc_x"];
    });
    const issues = validateStructure(doc.jobs[0]!);
    expect(issues).toEqual([
      {
        code: "review_document_unavailable",
        severity: "error",
        jobId: "job_A",
        where: { kind: "job" },
        detail: { documentId: "doc_x" },
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(true);
  });

  it("제외 문서 id 의 반복은 서버가 받으므로 이슈 없음", () => {
    const doc = edited(SINGLE_JOB, job => {
      documentsOf(job)[2]!.source_files = [
        { file_ref: "job_A#1", page_ranges: [[1, 2]] },
      ];
      fileGroups(job).excluded_documents = ["doc_3", "doc_3"];
    });
    expect(validateJob(doc, doc.jobs[0]!)).toEqual([]);
  });

  it("없는 layout_step_id → review_step_unavailable(doc 를 줄 때, 차단)", () => {
    const doc = edited(SINGLE_JOB, job => {
      ((fileGroups(job).groups as Raw[])[0] as Raw).layout_step_id = "st_x";
    });
    const issues = validateStructure(doc.jobs[0]!, doc);
    expect(
      issues.filter(item => item.code === "review_step_unavailable"),
    ).toEqual([
      {
        code: "review_step_unavailable",
        severity: "error",
        jobId: "job_A",
        where: { kind: "job" },
        detail: { groupId: "grp_1", stepId: "st_x" },
      },
    ]);
    expect(hasBlockingIssues(issues)).toBe(true);
    expect(codes(validateStructure(doc.jobs[0]!))).not.toContain(
      "review_step_unavailable",
    );
  });

  it("Classify 가 아닌 layout_step_id → review_step_unavailable", () => {
    const doc = edited(SINGLE_JOB, job => {
      ((fileGroups(job).groups as Raw[])[0] as Raw).layout_step_id =
        "st_extract";
    });
    expect(codes(validateJob(doc, doc.jobs[0]!))).toContain(
      "review_step_unavailable",
    );
  });

  it("layout_step_id 가 null 이면 Step 검사를 하지 않는다", () => {
    const doc = readReviewDocument(NO_LOOKUPS);
    expect(codes(validateStructure(doc.jobs[0]!, doc))).not.toContain(
      "review_step_unavailable",
    );
  });
});
