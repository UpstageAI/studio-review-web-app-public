import { describe, expect, it } from "vitest";

import { applyEntry, type ChangeDraft } from "../changes";
import { ExactNumber, parseJson } from "../json";
import { readReviewDocument } from "../normalize";
import type { ReviewDocument } from "../types";
import { MAX_INLINE_IMPORT_BYTES, buildUploadBody } from "../upload";
import { singleJob } from "./fixtures/builders";
import { NO_LOOKUPS } from "./fixtures/fixtures";

function apply(doc: ReviewDocument, ...drafts: ChangeDraft[]): ReviewDocument {
  return drafts.reduce((current, draft) => {
    const outcome = applyEntry(current, draft);
    if (!outcome.ok) throw new Error(outcome.reason);
    return outcome.job;
  }, doc);
}

type Wire = {
  format: string;
  collection_id: string;
  configs: Record<string, unknown>;
  steps: Record<string, Record<string, unknown>>;
  jobs: {
    id: string;
    file_groups?: Record<string, unknown>;
    output: Record<string, unknown>[];
  }[];
};

const wire = (text: string) => parseJson(text) as unknown as Wire;

describe("buildUploadBody", () => {
  it("무변경이면 body null", () => {
    const { doc } = singleJob();
    const upload = buildUploadBody(doc, doc);
    expect(upload).toMatchObject({
      body: null,
      text: "",
      bytes: 0,
      issues: [],
    });
  });

  it("값만: 바뀐 결과만·file_groups 없음·steps 축약·무관 Job 생략", () => {
    const base = readReviewDocument(NO_LOOKUPS);
    const current = apply(base, {
      kind: "set_value",
      jobId: "job_V",
      resultId: "occ_v_1",
      path: ["title"],
      value: "Fixed",
    });
    const upload = buildUploadBody(base, current);
    const body = wire(upload.text);
    expect(body.jobs).toEqual([
      {
        id: "job_V",
        output: [
          {
            id: "occ_v_1",
            step_id: "st_extract",
            base_version: 0,
            content: { title: "Fixed" },
          },
        ],
      },
    ]);
    expect(body.steps.st_extract).toEqual({
      config_id: "cfg_1",
      name: "추출",
      type: "information-extract",
    });
    expect(body.format).toBe("collection-results/11");
    expect(body.collection_id).toBe("scol_test");
    expect(upload.changedResultIds).toEqual(["occ_v_1"]);
    expect(upload.structureChangedJobIds).toEqual([]);
    expect(upload.bytes).toBe(new TextEncoder().encode(upload.text).length);
  });

  it("결과에는 state·document_ids·checks 를 싣지 않고 steps 에는 labels·schema 가 없다", () => {
    const { doc } = singleJob();
    const current = apply(doc, {
      kind: "set_value",
      jobId: "job_A",
      resultId: "occ_validate_1",
      path: [],
      value: "red",
    });
    const body = wire(buildUploadBody(doc, current).text);
    expect(Object.keys(body.jobs[0]!.output[0]!).sort()).toEqual([
      "base_version",
      "content",
      "id",
      "step_id",
    ]);
    for (const step of Object.values(body.steps)) {
      expect(Object.keys(step).sort()).toEqual(["config_id", "name", "type"]);
    }
  });

  it("구조: file_groups(num_pages·input_index 제외) + 모든 layout + 바뀐 결과", () => {
    const { doc } = singleJob();
    const current = apply(
      doc,
      {
        kind: "set_label",
        jobId: "job_A",
        stepId: "st_classify",
        documentId: "doc_3",
        label: "invoice",
      },
      {
        kind: "set_value",
        jobId: "job_A",
        resultId: "occ_extract_1",
        path: ["paid"],
        value: false,
      },
    );
    const upload = buildUploadBody(doc, current);
    const job = wire(upload.text).jobs[0]!;
    expect(upload.structureChangedJobIds).toEqual(["job_A"]);
    expect(job.file_groups).toEqual({
      base_version: 3,
      groups: [
        {
          group_id: "grp_1",
          files: [
            { file_ref: "job_A#0", file_id: "file_1", name: "a.pdf" },
            { file_ref: "job_A#1", file_id: "file_2", name: "b.pdf" },
          ],
          layout_step_id: "st_classify",
        },
      ],
      excluded_pages: [],
      excluded_documents: [],
    });
    expect(
      job.output.map(item => item.id ?? `layout:${String(item.step_id)}`),
    ).toEqual(["layout:st_classify", "occ_extract_1"]);
    expect(upload.issues).toEqual([]);
  });

  it("ExactNumber 는 원문 토큰 그대로 나간다", () => {
    const { doc } = singleJob();
    const current = apply(doc, {
      kind: "set_value",
      jobId: "job_A",
      resultId: "occ_extract_1",
      path: ["currency"],
      value: "KRW",
    });
    const { text } = buildUploadBody(doc, current);
    expect(text).toContain('"amount":12345678901234567890');
    expect(text).toContain('"rate":0.1234567890123456789');
    expect(text).toContain('"scale":1E2');
    expect(text).toContain('"delta":-0');
  });

  it("구조 검증·값 검증 결과를 함께 낸다", () => {
    const { doc } = singleJob();
    const current = apply(
      doc,
      {
        kind: "exclude_pages",
        jobId: "job_A",
        stepId: "st_classify",
        fromDocumentId: "doc_3",
        pages: [{ file_ref: "job_A#1", page: 2 }],
      },
      {
        kind: "set_value",
        jobId: "job_A",
        resultId: "occ_extract_1",
        path: ["currency"],
        value: "EUR",
      },
    );
    const { issues } = buildUploadBody(doc, current);
    expect(issues.map(item => item.code)).toEqual(["schema_violation"]);
  });

  it("maxBytes 초과는 package_limit_exceeded(upload)", () => {
    const { doc } = singleJob();
    const current = apply(doc, {
      kind: "set_value",
      jobId: "job_A",
      resultId: "occ_extract_1",
      path: ["amount"],
      value: new ExactNumber("1"),
    });
    const upload = buildUploadBody(doc, current, { maxBytes: 100 });
    expect(upload.issues).toContainEqual({
      code: "package_limit_exceeded",
      severity: "error",
      jobId: "job_A",
      where: { kind: "upload", bytes: upload.bytes, limit: 100 },
    });
    expect(MAX_INLINE_IMPORT_BYTES).toBe(8 * 1024 * 1024);
  });
});
