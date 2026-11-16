import { describe, expect, it } from "vitest";

import {
  STRUCTURE_GROUP_ID,
  addChange,
  createSession,
  describeChange,
  revertChange,
} from "../changes";
import { structureChanged } from "../diff";
import { moveFile, type EditResult } from "../edits";
import { findLayout, newGroupId } from "../layout";
import { readReviewDocument } from "../normalize";
import { buildUploadBody } from "../upload";
import type { ReviewDocument, ReviewJob } from "../types";
import { validateStructure } from "../validate";
import { MULTI_LAYOUT } from "./fixtures/fixtures";

const S = "st_classify";

type DocSpec = {
  id: string;
  group: string;
  sources: [string, [number, number]][];
};

/**
 * 그룹 2 개: `grp_1` = `job_M#0`(2p)·`job_M#1`(1p), `grp_2` = `job_M#2`(1p). 문서는
 * 파일마다 하나. `otherStepGroup` 이면 분류 Step 이 다른 `grp_3`(`job_M#3`)을 더한다.
 */
function moveDoc(
  options: {
    extraDocs?: DocSpec[];
    excludedDocuments?: string[];
    otherStepGroup?: boolean;
  } = {},
): ReviewDocument {
  const docs: DocSpec[] = [
    { id: "doc_0", group: "grp_1", sources: [["job_M#0", [1, 2]]] },
    { id: "doc_1", group: "grp_1", sources: [["job_M#1", [1, 1]]] },
    { id: "doc_2", group: "grp_2", sources: [["job_M#2", [1, 1]]] },
    ...(options.otherStepGroup
      ? [
          {
            id: "doc_3",
            group: "grp_3",
            sources: [["job_M#3", [1, 1]]],
          } satisfies DocSpec,
        ]
      : []),
    ...(options.extraDocs ?? []),
  ];
  const file = (index: number, pages: number) => ({
    file_ref: `job_M#${index}`,
    file_id: `f${index}`,
    name: `file-${index}.pdf`,
    num_pages: pages,
  });
  return readReviewDocument(
    JSON.stringify({
      format: "collection-results/11",
      collection_id: "scol_test",
      configs: { cfg_1: { agent_id: null } },
      steps: {
        [S]: { config_id: "cfg_1", name: "분류", type: "document-classify" },
        st_other: {
          config_id: "cfg_1",
          name: "다른 분류",
          type: "document-classify",
        },
      },
      jobs: [
        {
          id: "job_M",
          file_groups: {
            base_version: 3,
            groups: [
              {
                group_id: "grp_1",
                layout_step_id: S,
                files: [file(0, 2), file(1, 1)],
              },
              { group_id: "grp_2", layout_step_id: S, files: [file(2, 1)] },
              ...(options.otherStepGroup
                ? [
                    {
                      group_id: "grp_3",
                      layout_step_id: "st_other",
                      files: [file(3, 1)],
                    },
                  ]
                : []),
            ],
            excluded_pages: [],
            excluded_documents: options.excludedDocuments ?? [],
          },
          output: [
            {
              step_id: S,
              base_version: 3,
              content: {
                documents: docs.map(doc => ({
                  document_id: doc.id,
                  group_id: doc.group,
                  label: null,
                  source_files: doc.sources.map(([fileRef, range]) => ({
                    file_ref: fileRef,
                    page_ranges: [range],
                  })),
                })),
              },
            },
          ],
        },
      ],
    }),
  );
}

function ok(result: EditResult): ReviewJob {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.job;
}

const jobOf = (doc: ReviewDocument) => doc.jobs[0]!;

function groupFiles(job: ReviewJob): Record<string, string[]> {
  return Object.fromEntries(
    (job.file_groups?.groups ?? []).map(group => [
      group.group_id,
      group.files.map(file => file.file_ref),
    ]),
  );
}

function documentGroups(job: ReviewJob): Record<string, string> {
  return Object.fromEntries(
    findLayout(job, S)!.content.documents.map(document => [
      document.document_id,
      document.group_id,
    ]),
  );
}

describe("moveFile (B10)", () => {
  it("기존 그룹으로 옮기면 파일은 대상 그룹 끝에, 그 파일의 문서는 대상 그룹으로", () => {
    const job = ok(moveFile(jobOf(moveDoc()), "job_M#1", { groupId: "grp_2" }));
    expect(groupFiles(job)).toEqual({
      grp_1: ["job_M#0"],
      grp_2: ["job_M#2", "job_M#1"],
    });
    expect(documentGroups(job)).toEqual({
      doc_0: "grp_1",
      doc_1: "grp_2",
      doc_2: "grp_2",
    });
    // 문서 순서·페이지는 그대로
    expect(
      findLayout(job, S)!.content.documents.map(d => d.document_id),
    ).toEqual(["doc_0", "doc_1", "doc_2"]);
    expect(validateStructure(job)).toEqual([]);
  });

  it("새 그룹은 원 그룹 바로 뒤에, layout_step_id 는 원 그룹 값", () => {
    const id = newGroupId(() => "00000000-0000-4000-8000-000000000000");
    expect(id.length).toBeLessThanOrEqual(64);
    const job = ok(moveFile(jobOf(moveDoc()), "job_M#0", { newGroupId: id }));
    const groups = job.file_groups!.groups;
    expect(groups.map(group => group.group_id)).toEqual(["grp_1", id, "grp_2"]);
    expect(groups[1]!.layout_step_id).toBe(S);
    expect(groups[1]!.files.map(file => file.file_ref)).toEqual(["job_M#0"]);
    expect(documentGroups(job).doc_0).toBe(id);
    expect(documentGroups(job).doc_1).toBe("grp_1");
    expect(validateStructure(job)).toEqual([]);
  });

  it("파일이 빠져 빈 그룹은 지운다", () => {
    const job = ok(moveFile(jobOf(moveDoc()), "job_M#2", { groupId: "grp_1" }));
    expect(groupFiles(job)).toEqual({
      grp_1: ["job_M#0", "job_M#1", "job_M#2"],
    });
    expect(documentGroups(job).doc_2).toBe("grp_1");
    expect(validateStructure(job)).toEqual([]);
  });

  it("그 파일과 다른 파일을 함께 쓰는 문서가 있으면 mixed_file_document", () => {
    const doc = moveDoc({
      extraDocs: [
        {
          id: "doc_mix",
          group: "grp_1",
          sources: [
            ["job_M#0", [1, 1]],
            ["job_M#1", [1, 1]],
          ],
        },
      ],
    });
    expect(moveFile(jobOf(doc), "job_M#1", { groupId: "grp_2" })).toEqual({
      ok: false,
      reason: "mixed_file_document",
    });
    expect(
      moveFile(jobOf(doc), "job_M#0", { newGroupId: "review-grp-x" }),
    ).toEqual({ ok: false, reason: "mixed_file_document" });
  });

  it("제외 문서도 함께 옮겨 가고 excluded_documents 는 그대로", () => {
    const doc = moveDoc({ excludedDocuments: ["doc_1"] });
    const job = ok(moveFile(jobOf(doc), "job_M#1", { groupId: "grp_2" }));
    expect(documentGroups(job).doc_1).toBe("grp_2");
    expect(job.file_groups!.excluded_documents).toEqual(["doc_1"]);
  });

  it("없는 파일·없는 그룹·같은 그룹은 target_missing", () => {
    const job = jobOf(moveDoc());
    expect(moveFile(job, "job_M#9", { groupId: "grp_2" })).toMatchObject({
      reason: "target_missing",
    });
    expect(moveFile(job, "job_M#0", { groupId: "grp_9" })).toMatchObject({
      reason: "target_missing",
    });
    expect(moveFile(job, "job_M#0", { groupId: "grp_1" })).toMatchObject({
      reason: "target_missing",
    });
  });

  it("파일이 하나뿐인 그룹은 새 그룹으로 분리하지 않는다", () => {
    expect(
      moveFile(jobOf(moveDoc()), "job_M#2", { newGroupId: "review-grp-x" }),
    ).toEqual({ ok: false, reason: "target_missing" });
  });

  it("분류 Step 이 다른 그룹으로는 group_mismatch", () => {
    expect(
      moveFile(jobOf(moveDoc({ otherStepGroup: true })), "job_M#1", {
        groupId: "grp_3",
      }),
    ).toEqual({ ok: false, reason: "group_mismatch" });
  });

  it("새 그룹 id 가 이미 있거나 64 자를 넘으면 invalid_document_id", () => {
    const job = jobOf(moveDoc());
    expect(moveFile(job, "job_M#0", { newGroupId: "grp_2" })).toMatchObject({
      reason: "invalid_document_id",
    });
    expect(
      moveFile(job, "job_M#0", { newGroupId: "g".repeat(65) }),
    ).toMatchObject({ reason: "invalid_document_id" });
    expect(moveFile(job, "job_M#0", { newGroupId: "" })).toMatchObject({
      reason: "invalid_document_id",
    });
  });

  it("멀티 layout Job 은 multi_layout_unsupported", () => {
    const job = readReviewDocument(MULTI_LAYOUT).jobs[0]!;
    const fileRef = job.file_groups!.groups[0]!.files[0]!.file_ref;
    expect(moveFile(job, fileRef, { newGroupId: "review-grp-x" })).toEqual({
      ok: false,
      reason: "multi_layout_unsupported",
    });
  });
});

describe("move_file 변경 항목", () => {
  it("설명은 문서 구성 묶음 + 함께 옮기는 문서, 이동 뒤 그룹 순서", () => {
    const doc = moveDoc();
    // grp_2 는 파일이 하나라 비어 지워지므로 grp_1 은 여전히 1번째
    expect(
      describeChange(doc, {
        kind: "move_file",
        jobId: "job_M",
        fileRef: "job_M#2",
        to: { groupId: "grp_1" },
      }),
    ).toEqual({
      documentLabel: null,
      documentIds: [STRUCTURE_GROUP_ID, "doc_2"],
      detail: { fileRef: "job_M#2", group: 1 },
    });
    // grp_1 의 파일을 grp_2 로: grp_1 이 남으므로 2번째
    expect(
      describeChange(doc, {
        kind: "move_file",
        jobId: "job_M",
        fileRef: "job_M#1",
        to: { groupId: "grp_2" },
      }).detail,
    ).toEqual({ fileRef: "job_M#1", group: 2 });
    expect(
      describeChange(doc, {
        kind: "move_file",
        jobId: "job_M",
        fileRef: "job_M#0",
        to: { newGroupId: "review-grp-x" },
      }).detail,
    ).toEqual({ fileRef: "job_M#0" });
  });

  it("세션에 적용하면 구조가 바뀐 것으로 잡혀 업로드 본문에 실리고, 되돌리면 원래대로", () => {
    const doc = moveDoc();
    const session = createSession(doc);
    const added = addChange(session, {
      kind: "move_file",
      jobId: "job_M",
      fileRef: "job_M#1",
      to: { newGroupId: "review-grp-new" },
    });
    if (!added.ok) throw new Error(added.reason);
    const current = jobOf(added.session.current);
    expect(structureChanged(jobOf(doc), current)).toBe(true);
    const upload = buildUploadBody(doc, added.session.current);
    expect(upload.structureChangedJobIds).toEqual(["job_M"]);
    expect(upload.issues.filter(issue => issue.severity === "error")).toEqual(
      [],
    );
    expect(upload.text).toContain('"group_id":"review-grp-new"');
    const entry = added.session.entries[0]!;
    const reverted = revertChange(added.session, entry.id);
    expect(groupFiles(jobOf(reverted.session.current))).toEqual(
      groupFiles(jobOf(doc)),
    );
  });
});
