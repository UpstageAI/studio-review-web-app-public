import { describe, expect, it } from "vitest";

import {
  addChange,
  createSession,
  readReviewDocument,
  type ChangeEntry,
} from "@/lib/review-model";

import {
  conflictTargets,
  failureTarget,
  revisionOf,
  sha256Hex,
} from "../save-outcome";

function entries(): readonly ChangeEntry[] {
  const doc = readReviewDocument(
    JSON.stringify({
      format: "collection-results/11",
      collection_id: "scol_1",
      configs: { cfg_1: { agent_id: null } },
      steps: {
        st_x: {
          config_id: "cfg_1",
          name: "Extract",
          type: "information-extract",
        },
      },
      jobs: [
        {
          id: "job_1",
          file_groups: {
            base_version: 1,
            groups: [
              {
                group_id: "grp_1",
                layout_step_id: null,
                files: [
                  {
                    file_ref: "job_1#0",
                    file_id: "file_a",
                    name: "a.pdf",
                    num_pages: 1,
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
                      { file_ref: "job_1#0", page_ranges: [[1, 1]] },
                    ],
                  },
                ],
              },
            },
            {
              id: "occ_1",
              step_id: "st_x",
              base_version: 1,
              content: { amount: 1 },
              document_ids: ["doc_1"],
            },
            {
              id: "occ_2",
              step_id: "st_x",
              base_version: 1,
              content: { amount: 2 },
              document_ids: ["doc_1"],
            },
          ],
        },
      ],
    }),
  );
  let session = createSession(doc);
  for (const draft of [
    {
      kind: "set_value" as const,
      jobId: "job_1",
      resultId: "occ_1",
      path: ["amount"],
      value: 5,
    },
    {
      kind: "set_label" as const,
      jobId: "job_1",
      stepId: null,
      documentId: "doc_1",
      label: "x",
    },
    {
      kind: "set_value" as const,
      jobId: "job_1",
      resultId: "occ_2",
      path: ["amount"],
      value: 6,
    },
    {
      kind: "set_key" as const,
      jobId: "job_1",
      resultId: "occ_2",
      path: [],
      key: "memo",
      value: "",
    },
  ]) {
    const outcome = addChange(session, draft);
    if (!outcome.ok) throw new Error(outcome.reason);
    session = outcome.session;
  }
  return session.entries;
}

describe("conflictTargets", () => {
  it("값 충돌은 그 결과의 값 항목(키 추가 포함), 구조 충돌은 그 Job 의 구성 항목을 가리킨다", () => {
    const list = entries();
    expect(
      conflictTargets(list, [
        {
          target: { kind: "value", job_id: "job_1", occurrence_id: "occ_2" },
          base: 1,
          current: 2,
        },
      ]),
    ).toEqual({
      entryIds: ["change-3", "change-4"],
      resultIds: ["occ_2"],
      structure: false,
      count: 1,
    });
    expect(
      conflictTargets(list, [
        { target: { kind: "structure", job_id: "job_1" }, base: 1, current: 3 },
      ]),
    ).toMatchObject({ entryIds: ["change-2"], structure: true });
  });
});

describe("failureTarget", () => {
  const body = {
    jobs: [{ id: "job_1", output: [{ id: "occ_2", content: { amount: 6 } }] }],
  };

  it("업로드 본문의 output 순번을 결과 id 와 content 안 pointer 로 바꾼다", () => {
    expect(failureTarget(body, "/jobs/0/output/0/content/amount")).toEqual({
      resultId: "occ_2",
      fieldPointer: "/amount",
    });
    expect(failureTarget(body, "/jobs/0/output/0")).toEqual({
      resultId: "occ_2",
      fieldPointer: null,
    });
  });

  it("결과를 가리키지 않으면 null", () => {
    expect(failureTarget(body, "/jobs/0/file_groups/groups/0")).toBeNull();
    expect(failureTarget(body, "/jobs/0/output/5/content")).toBeNull();
    expect(failureTarget(body, undefined)).toBeNull();
    expect(failureTarget(null, "/jobs/0/output/0")).toBeNull();
  });
});

describe("revisionOf", () => {
  it("반영된 version 의 최댓값, 없으면 fallback", () => {
    expect(
      revisionOf(
        [
          {
            status: "applied",
            applied_versions: { "s:job_1": 4, "v:occ_1": 7 },
          },
          { status: "applied", applied_versions: { "x:y": 99 } },
        ],
        2,
      ),
    ).toBe(7);
    expect(revisionOf([{ status: "applied" }], 2)).toBe(2);
  });
});

describe("sha256Hex", () => {
  it("같은 본문은 같은 hex", async () => {
    const a = await sha256Hex("{}");
    expect(a).toBe(
      "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
    );
    expect(await sha256Hex("{}")).toBe(a);
    expect(await sha256Hex("{ }")).not.toBe(a);
  });
});
