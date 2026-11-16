import { describe, expect, it } from "vitest";

import {
  addChange,
  createSession,
  findResult,
  isExactNumber,
  layouts,
  parseJson,
  readReviewDocument,
  replaceStructure,
  replaceSubtree,
  revertChange,
  type ChangeDraft,
  type JsonObject,
} from "@/lib/review-model";

import { MULTI_LAYOUT } from "../../review-model/__tests__/fixtures/fixtures";
import { singleJob } from "../../review-model/__tests__/fixtures/builders";
import { readStructureContent, revisionToDraft } from "../draft";
import { asJson, revision, structureOf } from "./helpers";

const STRUCTURE = revision({ type: "structure", result: null });

function expectDraft<K extends ChangeDraft["kind"]>(
  outcome: ReturnType<typeof revisionToDraft>,
  kind: K,
): Extract<ChangeDraft, { kind: K }> {
  expect(outcome.ok).toBe(true);
  if (!outcome.ok) throw new Error(outcome.reason);
  expect(outcome.draft.kind).toBe(kind);
  return outcome.draft as Extract<ChangeDraft, { kind: K }>;
}

describe("revisionToDraft — 값", () => {
  const { doc, job } = singleJob();
  const previous = parseJson(
    '{"amount": 12345678901234567891, "currency": "KRW", "invoice_no": "INV-0"}',
  );

  it("결과 content 전체를 바꾸는 replace_subtree path [] 를 만들고 적용된다", () => {
    const draft = expectDraft(
      revisionToDraft(job, revision(), previous),
      "replace_subtree",
    );
    expect(draft).toMatchObject({
      jobId: "job_A",
      resultId: "occ_extract_1",
      path: [],
    });
    const applied = replaceSubtree(
      job,
      draft.resultId,
      draft.path,
      draft.value,
    );
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const content = findResult(applied.job, "occ_extract_1")!
      .content as JsonObject;
    // 왕복할 수 없는 큰 정수는 ExactNumber 그대로 들어간다.
    expect(isExactNumber(content.amount)).toBe(true);
    expect(String(content.amount)).toBe("12345678901234567891");
    expect(content.invoice_no).toBe("INV-0");
    expect(doc.jobs[0]).toBe(job);
  });

  it("내용이 없으면 content_unavailable", () => {
    expect(revisionToDraft(job, revision(), null)).toEqual({
      ok: false,
      reason: "content_unavailable",
    });
    expect(revisionToDraft(job, revision(), undefined)).toMatchObject({
      reason: "content_unavailable",
    });
  });

  it("지금 Job 에 결과가 없으면 result_missing", () => {
    const rev = revision({
      result: { occurrence_id: "occ_none", step_id: "st_extract" },
    });
    expect(revisionToDraft(job, rev, previous)).toMatchObject({
      reason: "result_missing",
    });
  });

  it("input_changed 결과는 result_not_editable, stale 은 불러올 수 있다", () => {
    const changed = revision({
      result: { occurrence_id: "occ_extract_2", step_id: "st_extract" },
    });
    expect(revisionToDraft(job, changed, previous)).toMatchObject({
      reason: "result_not_editable",
    });
    const stale = revision({
      result: { occurrence_id: "occ_validate_1", step_id: "st_validate" },
    });
    expect(
      expectDraft(revisionToDraft(job, stale, "yellow"), "replace_subtree")
        .value,
    ).toBe("yellow");
  });

  it("지금 값과 같으면(숫자 표기 차이 무시) unchanged", () => {
    const same = parseJson(
      JSON.stringify(findResult(job, "occ_merge_1")!.content).replace(
        "1000.5",
        "1000.50",
      ),
    );
    const merge = revision({
      result: { occurrence_id: "occ_merge_1", step_id: "st_merge" },
    });
    expect(revisionToDraft(job, merge, same)).toMatchObject({
      reason: "unchanged",
    });
  });

  it("set_value 항목이 있는 세션에 넣으면 새 항목으로 쌓이고 되돌리기가 이어진다", () => {
    const set = addChange(createSession(doc), {
      kind: "set_value",
      jobId: "job_A",
      resultId: "occ_extract_1",
      path: ["invoice_no"],
      value: "INV-9",
    });
    expect(set.ok).toBe(true);
    if (!set.ok) return;
    const draft = expectDraft(
      revisionToDraft(set.session.current.jobs[0]!, revision(), previous),
      "replace_subtree",
    );
    const loaded = addChange(set.session, draft);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    const [first, second] = loaded.session.entries;
    expect(loaded.session.entries).toHaveLength(2);
    expect(second!.kind).toBe("replace_subtree");
    const contentOf = (session: typeof loaded.session) =>
      findResult(session.current.jobs[0]!, "occ_extract_1")!
        .content as JsonObject;
    expect(contentOf(loaded.session).invoice_no).toBe("INV-0");

    // 불러온 항목만 되돌리면 앞의 set_value 가 남는다.
    const undoLoad = revertChange(loaded.session, second!.id);
    expect(undoLoad.alsoReverted).toEqual([]);
    expect(undoLoad.session.entries.map(entry => entry.id)).toEqual([
      first!.id,
    ]);
    expect(contentOf(undoLoad.session).invoice_no).toBe("INV-9");

    // 앞 set_value 를 되돌리면 그 자리를 덮어쓴 불러오기 항목도 함께 빠진다.
    const undoSet = revertChange(loaded.session, first!.id);
    expect(undoSet.alsoReverted).toEqual([
      { entry: second, reason: "depends_on_reverted" },
    ]);
    expect(undoSet.session.entries).toEqual([]);
    expect(undoSet.session.current).toEqual(doc);
  });
});

describe("revisionToDraft — 구조", () => {
  const { doc, job } = singleJob();

  /** 지금 구조에서 doc_2 라벨만 바꾸고 파일의 읽기 전용 정보를 뺀 이력 내용. */
  function relabeled() {
    const content = structureOf(job);
    return asJson({
      ...content,
      file_groups: {
        ...content.file_groups,
        groups: content.file_groups.groups.map(group => ({
          ...group,
          files: group.files.map(file => ({
            file_ref: file.file_ref,
            file_id: file.file_id,
          })),
        })),
      },
      documents: content.documents.map(document =>
        document.document_id === "doc_2"
          ? { ...document, label: "invoice" }
          : document,
      ),
    });
  }

  it("replace_structure 를 만들고 base_version 은 지금 값, 파일 정보는 지금 파일로 복원한다", () => {
    const draft = expectDraft(
      revisionToDraft(job, STRUCTURE, relabeled()),
      "replace_structure",
    );
    expect(draft.fileGroups.base_version).toBe(3);
    expect(draft.layouts.map(layout => layout.base_version)).toEqual([3]);
    expect(draft.fileGroups.groups[0]!.files).toEqual(
      job.file_groups!.groups[0]!.files,
    );
    expect(draft.fileGroups.groups[0]!.files[0]!.num_pages).toBe(3);
    expect(
      draft.layouts[0]!.content.documents.find(d => d.document_id === "doc_2")!
        .label,
    ).toBe("invoice");

    const applied = replaceStructure(job, draft.fileGroups, draft.layouts);
    expect(applied.ok).toBe(true);
    const session = addChange(createSession(doc), draft);
    expect(session.ok && session.session.entries).toHaveLength(1);
  });

  it("지금 구조와 같으면 unchanged", () => {
    expect(
      revisionToDraft(job, STRUCTURE, asJson(structureOf(job))),
    ).toMatchObject({ reason: "unchanged" });
  });

  it("지금 없는 문서 배치 보기의 문서가 있으면 layout_mismatch", () => {
    const content = structureOf(job);
    const bad = asJson({
      ...content,
      documents: [{ ...content.documents[0]!, step_id: "st_other" }],
    });
    expect(revisionToDraft(job, STRUCTURE, bad)).toMatchObject({
      reason: "layout_mismatch",
    });
  });

  it("파일 집합이 다르면 file_set_mismatch", () => {
    const content = structureOf(job);
    const files = content.file_groups.groups[0]!.files;
    const changed = asJson({
      ...content,
      file_groups: {
        ...content.file_groups,
        groups: [
          {
            ...content.file_groups.groups[0]!,
            files: [files[0]!, { ...files[1]!, file_id: "file_other" }],
          },
        ],
      },
    });
    expect(revisionToDraft(job, STRUCTURE, changed)).toMatchObject({
      reason: "file_set_mismatch",
    });
    const fewer = asJson({
      ...content,
      file_groups: {
        ...content.file_groups,
        groups: [{ ...content.file_groups.groups[0]!, files: [files[0]!] }],
      },
    });
    expect(revisionToDraft(job, STRUCTURE, fewer)).toMatchObject({
      reason: "file_set_mismatch",
    });
  });

  it("구성 정보가 없는 Job 이면 structure_missing", () => {
    const bare = { ...job, file_groups: undefined };
    expect(revisionToDraft(bare, STRUCTURE, relabeled())).toMatchObject({
      reason: "structure_missing",
    });
  });

  it("모양이 틀리면 invalid_content, 내용이 없으면 content_unavailable", () => {
    expect(revisionToDraft(job, STRUCTURE, { foo: 1 })).toMatchObject({
      reason: "invalid_content",
    });
    expect(revisionToDraft(job, STRUCTURE, null)).toMatchObject({
      reason: "content_unavailable",
    });
  });

  it("문서가 없는 지금 보기는 빈 documents 로 채운다(멀티 layout)", () => {
    const multi = readReviewDocument(MULTI_LAYOUT).jobs[0]!;
    const content = structureOf(multi);
    const onlyA = asJson({
      ...content,
      documents: content.documents.filter(d => d.step_id === "st_classify_a"),
    });
    const draft = expectDraft(
      revisionToDraft(multi, STRUCTURE, onlyA),
      "replace_structure",
    );
    expect(
      draft.layouts.map(layout => [
        layout.step_id,
        layout.content.documents.length,
      ]),
    ).toEqual([
      ["st_classify_a", 1],
      ["st_classify_b", 0],
    ]);
    expect(layouts(multi)).toHaveLength(2);
    expect(replaceStructure(multi, draft.fileGroups, draft.layouts).ok).toBe(
      true,
    );
  });
});

describe("readStructureContent", () => {
  const { job } = singleJob();

  it("지금 구조 모양을 그대로 읽고, 빠진 제외 목록은 빈 배열", () => {
    const content = structureOf(job);
    expect(readStructureContent(asJson(content))).toEqual(content);
    const json = asJson(content) as JsonObject;
    const fileGroups = { ...(json.file_groups as JsonObject) };
    delete fileGroups.excluded_pages;
    delete fileGroups.excluded_documents;
    const read = readStructureContent({ ...json, file_groups: fileGroups });
    expect(read?.file_groups.excluded_pages).toEqual([]);
    expect(read?.file_groups.excluded_documents).toEqual([]);
  });

  it("페이지 범위가 정수 [a, b] 가 아니면 null", () => {
    const content = structureOf(job);
    const withRange = (range: unknown) =>
      readStructureContent(
        parseJson(
          JSON.stringify({
            ...content,
            documents: [
              {
                ...content.documents[0]!,
                source_files: [{ file_ref: "job_A#0", page_ranges: [range] }],
              },
            ],
          }),
        ),
      );
    expect(withRange([1, 2])).not.toBeNull();
    expect(withRange([1.5, 2])).toBeNull();
    expect(withRange([1])).toBeNull();
    expect(withRange(["1", 2])).toBeNull();
    expect(readStructureContent(null)).toBeNull();
    expect(readStructureContent([])).toBeNull();
  });
});
