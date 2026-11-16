import { describe, expect, it } from "vitest";

import type { InstructOutput } from "@/lib/review-api/instruct";
import {
  EMPTY_JOB_RESPONSE,
  type JobResponseData,
} from "@/lib/review-api/job-response";
import { readReviewDocument, type ReviewDocument } from "@/lib/review-model";
import {
  MULTI_LAYOUT,
  NO_LOOKUPS,
  SINGLE_JOB,
} from "@/lib/review-model/__tests__/fixtures/fixtures";

import {
  NO_LAYOUT_STEP_TAB_ID,
  defaultStepTab,
  stepTabsFor,
  stepTabsForDocument,
  type DocumentScope,
  type StepTab,
} from "../step-tabs-model";

const instruct = (stepId: string, stepName: string): InstructOutput => ({
  stepId,
  stepName,
  index: 0,
  text: "본문",
  json: null,
  enumDecision: null,
  citations: [],
  pageRanges: [],
  extra: null,
});

/** single-job 에 붙일 가짜 응답: Parse → 분류 → 추출 → Instruct → 검증 → Export(Merge 합성본). */
const RESPONSE: JobResponseData = {
  ...EMPTY_JOB_RESPONSE,
  parseStepId: "st_parse",
  parseElements: [
    {
      id: "p1-0",
      elementId: "0",
      page: 1,
      category: "paragraph",
      text: "본문",
      image: null,
      tableHtml: null,
      coordinates: null,
    },
  ],
  instructOutputs: [instruct("st_ins", "Instruct - 요약")],
  stepOrder: [
    {
      stepId: "st_parse",
      stepType: "document-parse",
      stepName: "step_1_document-parse",
    },
    {
      stepId: "st_classify",
      stepType: "document-classify",
      stepName: "Classify - 문서 분류",
    },
    {
      stepId: "st_extract",
      stepType: "information-extract",
      stepName: "금액 추출",
    },
    { stepId: "st_ins", stepType: "instruct", stepName: "Instruct - 요약" },
    { stepId: "st_validate", stepType: "validate", stepName: "금액 검증" },
    { stepId: "st_merge", stepType: "export", stepName: "Export - 합계" },
  ],
};

const summary = (tabs: readonly StepTab[]) =>
  tabs.map(tab => [tab.id, tab.kind, tab.type, tab.name, tab.editable]);

function single(): ReviewDocument {
  return readReviewDocument(SINGLE_JOB);
}

describe("stepTabsFor", () => {
  it("응답 순서로 구성·값·Parse·Instruct 탭을 만든다", () => {
    const doc = single();
    const tabs = stepTabsFor(doc.jobs[0]!, doc.steps, RESPONSE);
    expect(summary(tabs)).toEqual([
      ["st_parse", "parse", "document-parse", null, false],
      ["st_classify", "structure", "document-classify", "문서 분류", true],
      ["st_extract", "values", "information-extract", "금액 추출", true],
      ["st_ins", "instruct", "instruct", "요약", false],
      ["st_validate", "values", "validate", "금액 검증", true],
      // Merge 결과는 Export Step 에 실리지만 배지는 카탈로그 타입(merge)이다.
      ["st_merge", "values", "merge", "합계", true],
    ]);
  });

  it("응답이 없으면 카탈로그 순서이고 Parse·Instruct 탭이 없다", () => {
    const doc = single();
    const tabs = stepTabsFor(doc.jobs[0]!, doc.steps, EMPTY_JOB_RESPONSE);
    expect(tabs.map(tab => tab.id)).toEqual([
      "st_classify",
      "st_extract",
      "st_merge",
      "st_validate",
    ]);
  });

  it("보여 줄 것이 없는 Step 은 탭이 없다", () => {
    const doc = single();
    const steps = {
      ...doc.steps,
      st_empty: { config_id: "cfg_1", name: "빈 Step", type: "match" },
    };
    const response: JobResponseData = {
      ...RESPONSE,
      // 요소가 없는 Parse 출력은 탭을 만들지 않는다.
      parseElements: [],
      stepOrder: [
        ...RESPONSE.stepOrder,
        { stepId: "st_match", stepType: "match", stepName: "대조" },
      ],
    };
    const ids = stepTabsFor(doc.jobs[0]!, steps, response).map(tab => tab.id);
    expect(ids).not.toContain("st_empty");
    expect(ids).not.toContain("st_match");
    expect(ids).not.toContain("st_parse");
  });

  it("카탈로그·응답 어디에도 없는 Step 은 id 를 이름으로 끝에 둔다", () => {
    const doc = single();
    const steps = Object.fromEntries(
      Object.entries(doc.steps).filter(([id]) => id !== "st_validate"),
    );
    const tabs = stepTabsFor(doc.jobs[0]!, steps, EMPTY_JOB_RESPONSE);
    expect(tabs.at(-1)).toMatchObject({
      id: "st_validate",
      type: "",
      name: "st_validate",
    });
  });

  it("문서 배치 보기가 여럿이면 구성 탭이 보기마다 있고 고칠 수 없다", () => {
    const doc = readReviewDocument(MULTI_LAYOUT);
    const tabs = stepTabsFor(doc.jobs[0]!, doc.steps, EMPTY_JOB_RESPONSE);
    expect(summary(tabs)).toEqual([
      ["st_classify_a", "structure", "document-classify", "분류 A", false],
      ["st_classify_b", "structure", "document-classify", "분류 B", false],
      ["st_extract", "values", "information-extract", "추출", true],
    ]);
  });

  it("분류 없는 보기는 맨 앞 layout:none 탭, file_groups 없는 Job 은 값 탭만", () => {
    const doc = readReviewDocument(NO_LOOKUPS);
    const withLayout = stepTabsFor(doc.jobs[0]!, doc.steps, RESPONSE);
    expect(withLayout[0]).toEqual({
      id: NO_LAYOUT_STEP_TAB_ID,
      stepId: null,
      kind: "structure",
      type: "",
      name: null,
      editable: true,
    });
    const valuesOnly = stepTabsFor(doc.jobs[1]!, doc.steps, EMPTY_JOB_RESPONSE);
    expect(summary(valuesOnly)).toEqual([
      ["st_extract", "values", "information-extract", "추출", true],
    ]);
  });

  it("같은 타입·같은 이름 탭은 두 번째부터 순번을 붙인다", () => {
    const doc = single();
    const response: JobResponseData = {
      ...EMPTY_JOB_RESPONSE,
      instructOutputs: [
        instruct("st_ins_1", "Instruct - 요약"),
        instruct("st_ins_2", "요약"),
        instruct("st_ins_3", "step_5_instruct"),
        instruct("st_ins_4", "step_6_instruct"),
      ],
    };
    const tabs = stepTabsFor(doc.jobs[0]!, doc.steps, response).filter(
      tab => tab.kind === "instruct",
    );
    expect(tabs.map(tab => [tab.id, tab.name, tab.ordinal])).toEqual([
      ["st_ins_1", "요약", undefined],
      ["st_ins_2", "요약", 2],
      ["st_ins_3", null, undefined],
      ["st_ins_4", null, 2],
    ]);
  });

  it("Job 이 없으면 응답 출력 탭만", () => {
    expect(stepTabsFor(null, undefined, EMPTY_JOB_RESPONSE)).toEqual([]);
  });
});

const scope = (
  documentId: string,
  mergedPages: readonly number[] | null,
): DocumentScope => ({
  documentId,
  mergedPages: mergedPages === null ? null : new Set(mergedPages),
});

const ids = (tabs: readonly StepTab[]) => tabs.map(tab => tab.id);

describe("stepTabsForDocument", () => {
  // single-job: job_A#0 3 쪽(병합 1~3) · job_A#1 2 쪽(병합 4~5).
  // doc_1 = 병합 1~2, doc_2 = 병합 3~4, doc_3 = 병합 5. 응답 Parse 요소는 1 쪽에 하나.
  const doc = single();
  const job = doc.jobs[0]!;
  const tabs = stepTabsFor(job, doc.steps, RESPONSE);

  it("값 탭은 그 문서에 연결된 결과가 있는 Step 만(Merge 의 field_groups 연결 포함)", () => {
    expect(
      ids(stepTabsForDocument(tabs, job, scope("doc_1", [1, 2]), RESPONSE)),
    ).toEqual([
      "st_parse",
      "st_classify",
      "st_extract",
      "st_ins",
      "st_validate",
      "st_merge",
    ]);
    expect(
      ids(stepTabsForDocument(tabs, job, scope("doc_2", [3, 4]), RESPONSE)),
    ).toEqual(["st_classify", "st_extract", "st_ins", "st_merge"]);
    expect(
      ids(stepTabsForDocument(tabs, job, scope("doc_3", [5]), RESPONSE)),
    ).toEqual(["st_classify", "st_ins"]);
  });

  it("Instruct 탭은 문서 페이지와 겹치는 출력이 있을 때(범위 없는 출력은 문서 전체)", () => {
    const response: JobResponseData = {
      ...RESPONSE,
      instructOutputs: [
        { ...instruct("st_ins", "Instruct - 요약"), pageRanges: [[5, 5]] },
      ],
    };
    expect(
      ids(stepTabsForDocument(tabs, job, scope("doc_1", [1, 2]), response)),
    ).toEqual([
      "st_parse",
      "st_classify",
      "st_extract",
      "st_validate",
      "st_merge",
    ]);
    expect(
      ids(stepTabsForDocument(tabs, job, scope("doc_3", [5]), response)),
    ).toEqual(["st_classify", "st_ins"]);
  });

  it("공간을 몰라 문서 페이지를 알 수 없으면 Parse·Instruct 탭은 거르지 않는다", () => {
    expect(
      ids(stepTabsForDocument(tabs, job, scope("doc_3", null), RESPONSE)),
    ).toEqual(["st_parse", "st_classify", "st_ins"]);
  });

  it("어느 문서에도 연결되지 않은 결과만 있는 Step 의 값 탭은 남긴다", () => {
    // 테스트 리터럴만 담으므로 JSON.stringify 로 만들어도 정밀도 손실이 없다.
    const unlinkedDoc = readReviewDocument(
      JSON.stringify({
        format: "collection-results/11",
        collection_id: "scol_1",
        configs: { cfg_1: { agent_id: null } },
        steps: {
          st_a: { config_id: "cfg_1", name: "A", type: "information-extract" },
          st_b: { config_id: "cfg_1", name: "B", type: "validate" },
        },
        jobs: [
          {
            id: "job_U",
            file_groups: {
              base_version: 1,
              groups: [
                {
                  group_id: "grp_1",
                  layout_step_id: null,
                  files: [
                    {
                      file_ref: "job_U#0",
                      file_id: "f0",
                      name: "a.pdf",
                      num_pages: 2,
                    },
                  ],
                },
              ],
            },
            output: [
              {
                step_id: null,
                base_version: 1,
                content: {
                  documents: [
                    {
                      document_id: "doc_1",
                      group_id: "grp_1",
                      label: null,
                      source_files: [
                        { file_ref: "job_U#0", page_ranges: [[1, 1]] },
                      ],
                    },
                    {
                      document_id: "doc_2",
                      group_id: "grp_1",
                      label: null,
                      source_files: [
                        { file_ref: "job_U#0", page_ranges: [[2, 2]] },
                      ],
                    },
                  ],
                },
              },
              {
                id: "r_a",
                step_id: "st_a",
                base_version: 1,
                content: { v: 1 },
                document_ids: ["doc_1"],
              },
              { id: "r_b", step_id: "st_b", base_version: 1, content: "green" },
            ],
          },
        ],
      }),
    );
    const unlinkedJob = unlinkedDoc.jobs[0]!;
    const all = stepTabsFor(unlinkedJob, unlinkedDoc.steps, EMPTY_JOB_RESPONSE);
    expect(ids(all)).toEqual([NO_LAYOUT_STEP_TAB_ID, "st_a", "st_b"]);
    expect(
      ids(
        stepTabsForDocument(
          all,
          unlinkedJob,
          scope("doc_2", [2]),
          EMPTY_JOB_RESPONSE,
        ),
      ),
    ).toEqual([NO_LAYOUT_STEP_TAB_ID, "st_b"]);
  });
});

describe("defaultStepTab", () => {
  const doc = single();
  const job = doc.jobs[0]!;
  const tabs = stepTabsFor(job, doc.steps, RESPONSE);

  it("고른 탭이 목록에 있으면 그것", () => {
    expect(defaultStepTab(tabs, "st_ins")?.id).toBe("st_ins");
  });

  it("없거나 아직 안 골랐으면 첫 편집 가능 탭", () => {
    expect(defaultStepTab(tabs, null)?.id).toBe("st_classify");
    expect(defaultStepTab(tabs, "gone")?.id).toBe("st_classify");
  });

  it("편집 가능 탭이 없으면 첫 탭, 탭이 없으면 null", () => {
    const readOnly = tabs.filter(tab => !tab.editable);
    expect(defaultStepTab(readOnly, null)?.id).toBe("st_parse");
    expect(defaultStepTab([], null)).toBeNull();
  });

  it("고른 탭이 선택 문서 때문에 숨었으면 같은 종류의 첫 탭, 없으면 첫 편집 가능 탭", () => {
    // doc_2: Parse·Validate 탭이 숨는다.
    const forDoc2 = stepTabsForDocument(
      tabs,
      job,
      scope("doc_2", [3, 4]),
      RESPONSE,
    );
    expect(defaultStepTab(forDoc2, "st_validate", tabs)?.id).toBe("st_extract");
    expect(defaultStepTab(forDoc2, "st_parse", tabs)?.id).toBe("st_classify");
    expect(defaultStepTab(forDoc2, "gone", tabs)?.id).toBe("st_classify");
  });
});
