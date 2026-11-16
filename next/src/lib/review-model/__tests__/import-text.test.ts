import { describe, expect, it } from "vitest";

import {
  STRUCTURE_GROUP_ID,
  addChange,
  createSession,
  describeChange,
  type ChangeDraft,
  type ReviewSession,
} from "../changes";
import { structureChanged } from "../diff";
import { planImport, type ImportPlan } from "../import-text";
import {
  ExactNumber,
  cloneJson,
  isJsonObject,
  stringifyJson,
  type JsonObject,
  type JsonValue,
} from "../json";
import { readReviewDocument } from "../normalize";
import { serializeReviewDocument } from "../serialize";
import { buildUploadBody } from "../upload";
import { singleJob, twoGroupDoc } from "./fixtures/builders";
import { MULTI_LAYOUT } from "./fixtures/fixtures";

const J = "job_A";

/** 경로를 따라 객체를 꺼낸다(테스트용 — 없으면 던진다). */
function node(root: JsonValue, ...path: (string | number)[]): JsonObject {
  let current: JsonValue = root;
  for (const token of path) {
    const next: JsonValue | undefined = Array.isArray(current)
      ? current[token as number]
      : isJsonObject(current)
        ? current[String(token)]
        : undefined;
    if (next === undefined) throw new Error(`missing ${String(token)}`);
    current = next;
  }
  if (!isJsonObject(current)) throw new Error("not an object");
  return current;
}

function wireOf(session: ReviewSession): JsonObject {
  return cloneJson(serializeReviewDocument(session.current));
}

function plan(
  session: ReviewSession,
  edit: (wire: JsonObject) => void,
  jobId = J,
): Extract<ImportPlan, { ok: true }> {
  const wire = wireOf(session);
  edit(wire);
  const outcome = planImport({ session, jobId, text: stringifyJson(wire) });
  if (!outcome.ok) throw outcome.error;
  return outcome;
}

const session = () => createSession(singleJob().doc);

/** single-job 의 결과 위치: 1 = occ_extract_1, 2 = occ_extract_2, 3 = merge, 4 = validate. */
const result = (wire: JsonObject, index: number) =>
  node(wire, "jobs", 0, "output", index);

describe("planImport — 읽기 실패", () => {
  it("JSON 이 아니면 ok: false + offset", () => {
    const outcome = planImport({ session: session(), jobId: J, text: "{" });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("invalid_json");
    expect(typeof outcome.error.details?.offset).toBe("number");
  });

  it("format 이 다르면 unsupported_review_format", () => {
    const wire = wireOf(session());
    wire.format = "collection-results/10";
    const outcome = planImport({
      session: session(),
      jobId: J,
      text: stringifyJson(wire),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok)
      expect(outcome.error.code).toBe("unsupported_review_format");
  });

  it("모양이 틀리면 invalid_document + pointer", () => {
    const wire = wireOf(session());
    delete result(wire, 1).step_id;
    const outcome = planImport({
      session: session(),
      jobId: J,
      text: stringifyJson(wire),
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe("invalid_document");
      expect(outcome.error.pointer).toBe("/jobs/0/output/1/step_id");
    }
  });
});

describe("planImport — 거부", () => {
  it("그대로면 항목 없음", () => {
    const outcome = plan(session(), () => {});
    expect(outcome).toMatchObject({
      errors: [],
      warnings: [],
      drafts: [],
      structureChanged: false,
    });
  });

  it("collection_id 불일치", () => {
    const outcome = plan(session(), wire => {
      wire.collection_id = "scol_other";
    });
    expect(outcome.errors).toEqual([
      { code: "collection_mismatch", pointer: "/collection_id" },
    ]);
    expect(outcome.drafts).toEqual([]);
  });

  it("Job id 불일치·Job 개수", () => {
    expect(
      plan(session(), wire => {
        node(wire, "jobs", 0).id = "job_B";
      }).errors,
    ).toEqual([{ code: "job_mismatch", pointer: "/jobs/0/id" }]);
    expect(
      plan(session(), wire => {
        wire.jobs = [];
      }).errors,
    ).toEqual([{ code: "job_mismatch", pointer: "/jobs" }]);
  });

  it("카탈로그: Step 이름·config 가 다르면 거부, labels·schema 는 경고", () => {
    const outcome = plan(session(), wire => {
      node(wire, "steps", "st_extract").name = "다른 이름";
      node(wire, "configs", "cfg_1").agent_id = "agt_2";
      node(wire, "steps", "st_classify").labels = ["invoice"];
    });
    expect(outcome.errors).toEqual([
      { code: "catalog_mismatch", pointer: "/configs/cfg_1/agent_id" },
      { code: "catalog_mismatch", pointer: "/steps/st_extract/name" },
    ]);
  });

  it("Step 키 집합이 다르면 거부", () => {
    const outcome = plan(session(), wire => {
      delete node(wire, "steps").st_merge;
    });
    expect(outcome.errors).toEqual([
      { code: "catalog_mismatch", pointer: "/steps" },
    ]);
  });

  it("모르는 결과 id·step_id·base_version", () => {
    const outcome = plan(session(), wire => {
      result(wire, 1).id = "occ_unknown";
      result(wire, 3).step_id = "st_extract";
      result(wire, 4).base_version = 9;
    });
    expect(outcome.errors).toEqual([
      { code: "unknown_result", pointer: "/jobs/0/output/1/id" },
      { code: "result_step_mismatch", pointer: "/jobs/0/output/3/step_id" },
      {
        code: "base_version_mismatch",
        pointer: "/jobs/0/output/4/base_version",
      },
    ]);
    expect(outcome.drafts).toEqual([]);
  });

  it("Layout base_version·file_groups base_version", () => {
    const outcome = plan(session(), wire => {
      result(wire, 0).base_version = 4;
      node(wire, "jobs", 0, "file_groups").base_version = 4;
    });
    expect(outcome.errors).toEqual([
      {
        code: "base_version_mismatch",
        pointer: "/jobs/0/file_groups/base_version",
      },
      {
        code: "base_version_mismatch",
        pointer: "/jobs/0/output/0/base_version",
      },
    ]);
  });

  it("문서 배치 보기 집합이 다르면 layout_mismatch", () => {
    const outcome = plan(session(), wire => {
      result(wire, 0).step_id = null;
    });
    expect(outcome.errors).toEqual([
      { code: "layout_mismatch", pointer: "/jobs/0/output/0/step_id" },
    ]);
  });

  it("파일 집합이 다르면 file_set_mismatch", () => {
    const outcome = plan(session(), wire => {
      node(wire, "jobs", 0, "file_groups", "groups", 0, "files", 1).file_id =
        "file_x";
    });
    expect(outcome.errors).toEqual([
      { code: "file_set_mismatch", pointer: "/jobs/0/file_groups/groups" },
    ]);
  });

  it("file_groups 없이 보기만 있으면 structure_mismatch", () => {
    const outcome = plan(session(), wire => {
      delete node(wire, "jobs", 0).file_groups;
    });
    expect(outcome.errors).toEqual([
      { code: "structure_mismatch", pointer: "/jobs/0/file_groups" },
    ]);
  });

  it("잠긴 결과의 값을 바꾸면 apply_failed", () => {
    const outcome = plan(session(), wire => {
      node(result(wire, 2), "content").currency = "USD";
    });
    expect(outcome.errors).toEqual([
      {
        code: "apply_failed",
        pointer: "/jobs/0/output/2/content/currency",
        reason: "result_not_editable",
      },
    ]);
  });
});

describe("planImport — 경고", () => {
  it("읽기 전용 필드가 바뀌면 read_only_ignored(적용은 됨)", () => {
    const outcome = plan(session(), wire => {
      result(wire, 1).state = "stale";
      result(wire, 1).document_ids = ["doc_2"];
      result(wire, 4).checks = [];
      node(wire, "steps", "st_classify").labels = ["invoice"];
      node(wire, "jobs", 0, "file_groups", "groups", 0, "files", 0).name =
        "renamed.pdf";
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.warnings).toEqual([
      { code: "read_only_ignored", pointer: "/steps/st_classify/labels" },
      { code: "read_only_ignored", pointer: "/jobs/0/output/1/state" },
      { code: "read_only_ignored", pointer: "/jobs/0/output/1/document_ids" },
      { code: "read_only_ignored", pointer: "/jobs/0/output/4/checks" },
      {
        code: "read_only_ignored",
        pointer: "/jobs/0/file_groups/groups/0/files/0/name",
      },
    ]);
    // 읽기 전용만 바뀌었으니 항목은 없다.
    expect(outcome.drafts).toEqual([]);
  });

  it("layout_step_id 가 바뀌면 경고 + 구조 교체", () => {
    const outcome = plan(session(), wire => {
      node(wire, "jobs", 0, "file_groups", "groups", 0).layout_step_id = null;
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.warnings).toEqual([
      {
        code: "layout_step_changed",
        pointer: "/jobs/0/file_groups/groups/0/layout_step_id",
      },
    ]);
    expect(outcome.drafts.map(draft => draft.kind)).toEqual([
      "replace_structure",
    ]);
  });
});

describe("planImport — diff → 항목", () => {
  it("모양이 같으면 다른 leaf 마다 set_value(숫자 원문 유지)", () => {
    const outcome = plan(session(), wire => {
      const content = node(result(wire, 1), "content");
      content.invoice_no = "INV-2";
      content.amount = new ExactNumber("98765432109876543210");
      node(content, "lines", 0).qty = 3;
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.changedResultIds).toEqual(["occ_extract_1"]);
    expect(
      outcome.drafts.map(draft =>
        draft.kind === "set_value" ? [draft.path, draft.value] : draft.kind,
      ),
    ).toEqual([
      [["amount"], new ExactNumber("98765432109876543210")],
      [["invoice_no"], "INV-2"],
      [["lines", "0", "qty"], 3],
    ]);
  });

  it("숫자 표기만 다르면 변경 없음", () => {
    const outcome = plan(session(), wire => {
      node(result(wire, 1), "content").scale = 100;
    });
    expect(outcome.drafts).toEqual([]);
  });

  it("배열 길이·키 집합이 다르면 replace_subtree [] 하나", () => {
    const outcome = plan(session(), wire => {
      const content = node(result(wire, 1), "content");
      (content.lines as JsonValue[]).push({ qty: 1, price: 1 });
    });
    expect(outcome.drafts).toHaveLength(1);
    expect(outcome.drafts[0]).toMatchObject({
      kind: "replace_subtree",
      resultId: "occ_extract_1",
      path: [],
    });
  });

  it("scalar 결과(Validate)는 set_value []", () => {
    const outcome = plan(session(), wire => {
      result(wire, 4).content = "red";
    });
    expect(outcome.drafts).toEqual([
      {
        kind: "set_value",
        jobId: J,
        resultId: "occ_validate_1",
        path: [],
        value: "red",
      },
    ]);
  });

  it("파일에 없는 결과는 그대로 둔다", () => {
    const outcome = plan(session(), wire => {
      const output = node(wire, "jobs", 0).output as JsonValue[];
      output.splice(1, 1);
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.drafts).toEqual([]);
  });

  it("문서 라벨이 바뀌면 replace_structure(파일 읽기 전용 정보는 지금 것)", () => {
    const base = session();
    const outcome = plan(base, wire => {
      const documents = node(result(wire, 0), "content")
        .documents as JsonObject[];
      documents[0]!.label = "contract";
      node(wire, "jobs", 0, "file_groups", "groups", 0, "files", 0).num_pages =
        9;
    });
    expect(outcome.structureChanged).toBe(true);
    const draft = outcome.drafts[0] as Extract<
      ChangeDraft,
      { kind: "replace_structure" }
    >;
    expect(draft.kind).toBe("replace_structure");
    expect(draft.fileGroups.groups[0]!.files[0]!.num_pages).toBe(3);
    expect(draft.layouts[0]!.content.documents[0]!.label).toBe("contract");
  });

  it("문서 배치 보기·file_groups 를 둘 다 빼면 구조는 비교하지 않는다", () => {
    const outcome = plan(session(), wire => {
      const job = node(wire, "jobs", 0);
      delete job.file_groups;
      job.output = (job.output as JsonValue[]).filter(
        item => isJsonObject(item) && Object.hasOwn(item, "id"),
      );
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.drafts).toEqual([]);
  });

  it("지금 세션(편집본) 기준으로 비교한다", () => {
    let current = session();
    const added = addChange(current, {
      kind: "set_value",
      jobId: J,
      resultId: "occ_extract_1",
      path: ["invoice_no"],
      value: "INV-9",
    });
    if (!added.ok) throw new Error(added.reason);
    current = added.session;
    expect(plan(current, () => {}).drafts).toEqual([]);
  });

  it("값·배열·라벨을 함께 고친 파일 → 항목 3 종류, 업로드 본문은 바뀐 것만", () => {
    let current = session();
    const outcome = plan(current, wire => {
      node(result(wire, 1), "content").invoice_no = "INV-2";
      node(result(wire, 3), "content").extra = 1;
      const documents = node(result(wire, 0), "content")
        .documents as JsonObject[];
      documents[1]!.label = "invoice";
    });
    expect(outcome.errors).toEqual([]);
    expect(outcome.drafts.map(draft => draft.kind)).toEqual([
      "set_value",
      "replace_subtree",
      "replace_structure",
    ]);
    for (const draft of outcome.drafts) {
      const added = addChange(current, draft);
      if (!added.ok) throw new Error(added.reason);
      current = added.session;
    }
    const upload = buildUploadBody(current.base, current.current);
    expect(upload.changedResultIds).toEqual(["occ_extract_1", "occ_merge_1"]);
    expect(upload.structureChangedJobIds).toEqual([J]);
  });

  it("멀티 layout Job 도 구조 교체를 받는다", () => {
    const doc = readReviewDocument(MULTI_LAYOUT);
    const outcome = plan(
      createSession(doc),
      wire => {
        const documents = node(result(wire, 0), "content")
          .documents as JsonObject[];
        documents[0]!.label = null;
      },
      "job_M",
    );
    expect(outcome.errors).toEqual([]);
    expect(outcome.drafts.map(draft => draft.kind)).toEqual([
      "replace_structure",
    ]);
  });
});

describe("replace_structure", () => {
  it("적용·설명(트레이 묶음 id·개수)", () => {
    const doc = twoGroupDoc();
    const wire = cloneJson(serializeReviewDocument(doc));
    node(wire, "jobs", 0, "file_groups").excluded_documents = [];
    const imported = readReviewDocument(stringifyJson(wire));
    const job = imported.jobs[0]!;
    const draft: ChangeDraft = {
      kind: "replace_structure",
      jobId: "job_G",
      fileGroups: job.file_groups!,
      layouts: job.output.filter(item => !("id" in item)) as never,
    };
    expect(describeChange(doc, draft)).toEqual({
      documentLabel: null,
      documentIds: [STRUCTURE_GROUP_ID],
      detail: {
        documents: 3,
        excludedDocuments: 0,
        excludedPages: 1,
        labelChanged: 0,
        rangesChanged: 0,
        added: 0,
        removed: 0,
        reordered: 0,
        groupsChanged: 1,
      },
    });
    const added = addChange(createSession(doc), draft);
    if (!added.ok) throw new Error(added.reason);
    const next = added.session.current.jobs[0]!;
    expect(next.file_groups?.excluded_documents).toEqual([]);
    expect(structureChanged(doc.jobs[0]!, next)).toBe(true);
  });

  it("보기 집합이 다르면 target_missing", () => {
    const { doc } = singleJob();
    const job = doc.jobs[0]!;
    const outcome = addChange(createSession(doc), {
      kind: "replace_structure",
      jobId: J,
      fileGroups: job.file_groups!,
      layouts: [],
    });
    expect(outcome).toEqual({ ok: false, reason: "target_missing" });
  });
});
