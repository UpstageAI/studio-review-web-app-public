import { describe, expect, it } from "vitest";

import {
  addChange,
  createSession,
  type ChangeDraft,
  type ReviewSession,
} from "../changes";
import type { JsonValue } from "../json";
import { readReviewDocument } from "../normalize";
import { changedValueResultIds, planSave } from "../save-plan";
import { MAX_INLINE_IMPORT_BYTES, buildUploadBody } from "../upload";

function docText(options: { schema?: boolean; amount?: JsonValue } = {}) {
  return JSON.stringify({
    format: "collection-results/11",
    collection_id: "scol_1",
    configs: { cfg_1: { agent_id: null } },
    steps: {
      st_x: {
        config_id: "cfg_1",
        name: "Extract",
        type: "information-extract",
        ...(options.schema
          ? {
              schema: {
                type: "object",
                properties: { amount: { type: "number" } },
              },
            }
          : {}),
      },
    },
    jobs: [
      {
        id: "job_1",
        file_groups: {
          base_version: 3,
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
                  input_index: 0,
                },
              ],
            },
          ],
        },
        output: [
          {
            step_id: null,
            base_version: 3,
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
            content: { amount: options.amount ?? 1 },
            document_ids: ["doc_1"],
          },
        ],
      },
    ],
  });
}

const setAmount = (value: JsonValue): ChangeDraft => ({
  kind: "set_value",
  jobId: "job_1",
  resultId: "occ_1",
  path: ["amount"],
  value,
});

const setLabel: ChangeDraft = {
  kind: "set_label",
  jobId: "job_1",
  stepId: null,
  documentId: "doc_1",
  label: "memo",
};

function sessionOf(text: string): ReviewSession {
  return createSession(readReviewDocument(text));
}

function change(session: ReviewSession, draft: ChangeDraft): ReviewSession {
  const outcome = addChange(session, draft);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.session;
}

const LIMIT = { maxBytes: MAX_INLINE_IMPORT_BYTES };

describe("changedValueResultIds", () => {
  it("값 항목의 결과 id 만 항목 순서대로 모은다", () => {
    let session = sessionOf(docText());
    session = change(session, setLabel);
    session = change(session, setAmount(5));
    expect(session.entries).toHaveLength(2);
    expect([...changedValueResultIds(session.entries)]).toEqual(["occ_1"]);
    expect(changedValueResultIds([]).size).toBe(0);
  });
});

describe("planSave", () => {
  it("Job 이 없으면 no_job", () => {
    const session = sessionOf(docText());
    const empty: ReviewSession = {
      ...session,
      current: { ...session.current, jobs: [] },
    };
    expect(planSave(empty, LIMIT)).toEqual({ kind: "no_job" });
  });

  it("항목이 없으면 검증보다 먼저 no_change", () => {
    // 불러온 값부터 schema 를 어기지만 항목이 없으므로 검증하지 않는다.
    const session = sessionOf(docText({ schema: true, amount: "bad" }));
    expect(planSave(session, LIMIT)).toEqual({ kind: "no_change" });
  });

  it("값 항목 기준 검증에 막히면 크기 판정보다 먼저 blocked/issues", () => {
    const session = change(
      sessionOf(docText({ schema: true })),
      setAmount("not a number"),
    );
    expect(planSave(session, { maxBytes: 10 })).toEqual({
      kind: "blocked",
      reason: "issues",
    });
  });

  it("항목은 있지만 원본과 차이가 없으면 no_change", () => {
    const edited = change(sessionOf(docText()), setAmount(5));
    const session: ReviewSession = { ...edited, current: edited.base };
    expect(session.entries).toHaveLength(1);
    expect(planSave(session, LIMIT)).toEqual({ kind: "no_change" });
  });

  it("본문이 한도를 넘으면 blocked/package_limit_exceeded 에 bytes·limit 을 담는다", () => {
    const session = change(sessionOf(docText()), setAmount(5));
    const { bytes } = buildUploadBody(session.base, session.current);
    expect(bytes).toBeGreaterThan(10);
    expect(planSave(session, { maxBytes: 10 })).toEqual({
      kind: "blocked",
      reason: "package_limit_exceeded",
      bytes,
      limit: 10,
    });
  });

  it("값 항목 밖의 결과가 본문 검증에 막히면 blocked/issues", () => {
    // 항목은 라벨 변경뿐이라 항목 기준 검증은 통과하고, 원본과 다른 결과 값은 본문 검증이 막는다.
    const labeled = change(sessionOf(docText({ schema: true })), setLabel);
    const withBadValue = change(labeled, setAmount("not a number"));
    const session: ReviewSession = {
      ...labeled,
      current: withBadValue.current,
    };
    expect(planSave(labeled, LIMIT).kind).toBe("ready");
    expect(changedValueResultIds(session.entries).size).toBe(0);
    expect(planSave(session, LIMIT)).toEqual({
      kind: "blocked",
      reason: "issues",
    });
  });

  it("막히지 않으면 buildUploadBody 의 text·body 로 ready", () => {
    const session = change(sessionOf(docText()), setAmount(5));
    const upload = buildUploadBody(session.base, session.current, LIMIT);
    expect(upload.body).not.toBeNull();
    expect(planSave(session, LIMIT)).toEqual({
      kind: "ready",
      text: upload.text,
      body: upload.body,
    });
  });
});
