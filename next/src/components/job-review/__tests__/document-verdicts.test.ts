import { describe, expect, it } from "vitest";

import { readReviewDocument, type ReviewDocument } from "@/lib/review-model";
import { singleJob } from "@/lib/review-model/__tests__/fixtures/builders";

import {
  documentVerdicts,
  flagForVerdict,
  resultVerdict,
  validationIssuesForDocument,
  worseVerdict,
} from "../document-verdicts";

const check = (name: string, passed: boolean) => ({
  name,
  severity: passed ? "error" : "warning",
  passed,
  reason: `${name} rule`,
});

/** 문서 셋, Validate Step 둘(st_val_a, st_val_b), Extract 하나. */
function verdictDoc(): ReviewDocument {
  return readReviewDocument(
    JSON.stringify({
      format: "collection-results/11",
      collection_id: "scol_test",
      configs: { cfg_1: { agent_id: null } },
      steps: {
        st_classify: {
          config_id: "cfg_1",
          name: "분류",
          type: "document-classify",
        },
        st_extract: {
          config_id: "cfg_1",
          name: "추출",
          type: "information-extract",
        },
        st_val_a: { config_id: "cfg_1", name: "금액 검증", type: "validate" },
        st_val_b: { config_id: "cfg_1", name: "날짜 검증", type: "validate" },
      },
      jobs: [
        {
          id: "job_V",
          file_groups: {
            base_version: 1,
            groups: [
              {
                group_id: "grp_1",
                layout_step_id: "st_classify",
                files: [{ file_ref: "job_V#0", file_id: "f0", name: "a.pdf" }],
              },
            ],
            excluded_pages: [],
            excluded_documents: [],
          },
          output: [
            {
              step_id: "st_classify",
              base_version: 1,
              content: {
                documents: ["doc_1", "doc_2", "doc_3"].map((id, index) => ({
                  document_id: id,
                  group_id: "grp_1",
                  label: "invoice",
                  source_files: [
                    {
                      file_ref: "job_V#0",
                      page_ranges: [[index + 1, index + 1]],
                    },
                  ],
                })),
              },
            },
            {
              id: "occ_ext_1",
              step_id: "st_extract",
              base_version: 0,
              // 문자열 하나라도 Validate Step 이 아니면 판정이 아니다.
              content: "red",
              document_ids: ["doc_1", "doc_2", "doc_3"],
            },
            {
              id: "occ_val_a1",
              step_id: "st_val_a",
              base_version: 0,
              content: "yellow",
              checks: [check("sum", true), check("due", false)],
              document_ids: ["doc_1"],
            },
            {
              id: "occ_val_b1",
              step_id: "st_val_b",
              base_version: 0,
              content: "red",
              checks: [check("date", false)],
              document_ids: ["doc_1"],
            },
            {
              id: "occ_val_a2",
              step_id: "st_val_a",
              base_version: 0,
              content: "green",
              document_ids: ["doc_2"],
            },
            {
              id: "occ_val_a3",
              step_id: "st_val_a",
              base_version: 0,
              content: "yellow",
              document_ids: ["doc_3"],
            },
          ],
        },
      ],
    }),
  );
}

describe("resultVerdict", () => {
  const doc = verdictDoc();
  const job = doc.jobs[0]!;
  const byId = (id: string) =>
    job.output.find(item => "id" in item && item.id === id)!;

  it("Validate Step 결과의 판정 문자열", () => {
    expect(resultVerdict(byId("occ_val_a1") as never, doc.steps)).toBe(
      "yellow",
    );
    expect(resultVerdict(byId("occ_val_b1") as never, doc.steps)).toBe("red");
  });

  it("Validate 가 아닌 Step 은 판정이 아니다", () => {
    expect(resultVerdict(byId("occ_ext_1") as never, doc.steps)).toBeNull();
  });

  it("Step 카탈로그가 없으면 판정을 모른다", () => {
    expect(resultVerdict(byId("occ_val_a1") as never, undefined)).toBeNull();
  });
});

describe("documentVerdicts", () => {
  it("문서마다 연결된 판정 중 가장 나쁜 값", () => {
    const doc = verdictDoc();
    const verdicts = documentVerdicts(doc.jobs[0]!, doc.steps);
    expect(Object.fromEntries(verdicts)).toEqual({
      doc_1: "red",
      doc_2: "green",
      doc_3: "yellow",
    });
  });

  it("Job 이 없으면 빈 맵", () => {
    expect(documentVerdicts(null, undefined).size).toBe(0);
  });

  it("single-job fixture: 판정이 있는 문서만 들어간다", () => {
    const { doc, job } = singleJob();
    expect(Object.fromEntries(documentVerdicts(job, doc.steps))).toEqual({
      doc_1: "green",
    });
  });
});

describe("worseVerdict·flagForVerdict", () => {
  it("red > yellow > green", () => {
    expect(worseVerdict(undefined, "green")).toBe("green");
    expect(worseVerdict("yellow", "green")).toBe("yellow");
    expect(worseVerdict("yellow", "red")).toBe("red");
    expect(worseVerdict("red", "yellow")).toBe("red");
  });

  it("red → danger, yellow → warning, 나머지는 표시 없음", () => {
    expect(flagForVerdict("red")).toBe("danger");
    expect(flagForVerdict("yellow")).toBe("warning");
    expect(flagForVerdict("green")).toBeUndefined();
    expect(flagForVerdict(undefined)).toBeUndefined();
  });
});

describe("validationIssuesForDocument", () => {
  const doc = verdictDoc();
  const job = doc.jobs[0]!;

  it("yellow·red 결과를 red 먼저, 통과하지 못한 근거만", () => {
    const issues = validationIssuesForDocument(job, doc.steps, "doc_1");
    expect(issues.map(issue => [issue.resultId, issue.verdict])).toEqual([
      ["occ_val_b1", "red"],
      ["occ_val_a1", "yellow"],
    ]);
    expect(issues[0]!.stepName).toBe("날짜 검증");
    expect(issues[1]!.failedChecks.map(item => item.name)).toEqual(["due"]);
  });

  it("green 만 있거나 근거가 없는 결과", () => {
    expect(validationIssuesForDocument(job, doc.steps, "doc_2")).toEqual([]);
    const [only] = validationIssuesForDocument(job, doc.steps, "doc_3");
    expect(only?.failedChecks).toEqual([]);
  });

  it("Job 이 없거나 모르는 문서면 빈 목록", () => {
    expect(validationIssuesForDocument(null, doc.steps, "doc_1")).toEqual([]);
    expect(validationIssuesForDocument(job, doc.steps, "nope")).toEqual([]);
  });
});
