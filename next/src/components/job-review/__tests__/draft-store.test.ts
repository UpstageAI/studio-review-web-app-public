import { describe, expect, it } from "vitest";

import {
  ExactNumber,
  addChange,
  createSession,
  isExactNumber,
  readReviewDocument,
  toDraft,
  type ChangeDraft,
  type ReviewSession,
} from "@/lib/review-model";
import { SINGLE_JOB } from "@/lib/review-model/__tests__/fixtures/fixtures";

import {
  DRAFT_FORMAT_VERSION,
  DRAFT_MAX_BYTES,
  buildStoredDraft,
  draftCompatibility,
  draftStorageKey,
  parseStoredDraft,
  serializeStoredDraft,
  type StoredDraft,
} from "../draft-store";

const JOB = "job_A";
const SAVED_AT = "2026-10-27T01:02:03.000Z";

function apply(session: ReviewSession, draft: ChangeDraft): ReviewSession {
  const outcome = addChange(session, draft);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.session;
}

const setValue = (
  resultId: string,
  key: string,
  value: number | ExactNumber,
): ChangeDraft => ({
  kind: "set_value",
  jobId: JOB,
  resultId,
  path: [key],
  value,
});

const setLabel: ChangeDraft = {
  kind: "set_label",
  jobId: JOB,
  stepId: "st_classify",
  documentId: "doc_2",
  label: "invoice",
};

/** fixture: `file_groups.base_version` 3, `occ_extract_1` version 2, `occ_merge_1` version 0 (`occ_extract_2` 는 편집 불가). */
function session(): ReviewSession {
  return createSession(readReviewDocument(SINGLE_JOB));
}

function edited(): ReviewSession {
  let s = session();
  s = apply(s, setValue("occ_extract_1", "amount", 5));
  s = apply(s, setValue("occ_merge_1", "total", 7));
  s = apply(s, setLabel);
  return s;
}

describe("draftStorageKey", () => {
  it("Collection·Job 마다 다른 키", () => {
    expect(draftStorageKey("scol_1", "job_1")).toBe(
      "review-draft:scol_1:job_1",
    );
    expect(draftStorageKey("scol_1", "job_2")).not.toBe(
      draftStorageKey("scol_1", "job_1"),
    );
  });
});

describe("toDraft(임시 저장 항목 변환)", () => {
  it("세션이 붙인 id·seq·description 을 떼고 draft 필드만 남긴다", () => {
    const s = apply(session(), setLabel);
    const entry = s.entries[0]!;
    expect(entry).toHaveProperty("id");
    expect(entry).toHaveProperty("description");
    expect(toDraft(entry)).toEqual(setLabel);
  });
});

describe("buildStoredDraft", () => {
  it("값 항목이 고치는 결과의 base version 과 구성 version 을 담는다", () => {
    const stored = buildStoredDraft(edited(), SAVED_AT);
    expect(stored.version).toBe(DRAFT_FORMAT_VERSION);
    expect(stored.savedAt).toBe(SAVED_AT);
    expect(stored.jobId).toBe(JOB);
    expect(stored.structureVersion).toBe(3);
    expect(stored.resultVersions).toEqual({
      occ_extract_1: 2,
      occ_merge_1: 0,
    });
    expect(stored.drafts.map(draft => draft.kind)).toEqual([
      "set_value",
      "set_value",
      "set_label",
    ]);
    expect(stored.drafts[2]).toEqual(setLabel);
  });

  it("같은 결과를 여러 번 고쳐도 version 은 한 번만, 항목이 없으면 비어 있다", () => {
    let s = session();
    s = apply(s, setValue("occ_extract_1", "amount", 5));
    s = apply(s, {
      kind: "set_value",
      jobId: JOB,
      resultId: "occ_extract_1",
      path: ["currency"],
      value: "KRW",
    });
    expect(buildStoredDraft(s, SAVED_AT).resultVersions).toEqual({
      occ_extract_1: 2,
    });
    const empty = buildStoredDraft(session(), SAVED_AT);
    expect(empty.drafts).toEqual([]);
    expect(empty.resultVersions).toEqual({});
  });
});

describe("serializeStoredDraft · parseStoredDraft", () => {
  it("왕복해도 같은 모양이고 ExactNumber 값은 ExactNumber 로 돌아온다", () => {
    let s = session();
    s = apply(
      s,
      setValue(
        "occ_extract_1",
        "amount",
        new ExactNumber("12345678901234567891"),
      ),
    );
    s = apply(s, setValue("occ_merge_1", "total", 42));
    const stored = buildStoredDraft(s, SAVED_AT);
    const serialized = serializeStoredDraft(stored);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    expect(serialized.bytes).toBeGreaterThan(0);
    expect(serialized.text).toContain("12345678901234567891");

    const parsed = parseStoredDraft(serialized.text);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(stored);
    const [exact, plain] = parsed!.drafts as (ChangeDraft & {
      kind: "set_value";
    })[];
    expect(isExactNumber(exact!.value)).toBe(true);
    expect(String(exact!.value)).toBe("12345678901234567891");
    expect(plain!.value).toBe(42);
  });

  it("일괄 편집 묶음 id(batchId)도 왕복해 남는다", () => {
    const exclude = (fromDocumentId: string, page: number): ChangeDraft => ({
      kind: "exclude_pages",
      jobId: JOB,
      stepId: "st_classify",
      fromDocumentId,
      pages: [{ file_ref: "job_A#0", page }],
      batchId: "batch-1",
    });
    let s = session();
    s = apply(s, exclude("doc_1", 1));
    s = apply(s, exclude("doc_2", 3));
    const stored = buildStoredDraft(s, SAVED_AT);
    const serialized = serializeStoredDraft(stored);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const parsed = parseStoredDraft(serialized.text);
    expect(parsed).toEqual(stored);
    expect(
      parsed!.drafts.map(draft =>
        draft.kind === "exclude_pages" ? draft.batchId : null,
      ),
    ).toEqual(["batch-1", "batch-1"]);
  });

  it("이력에서 불러온 출처(origin)도 왕복해 남는다", () => {
    let s = session();
    s = apply(s, {
      kind: "replace_subtree",
      jobId: JOB,
      resultId: "occ_extract_1",
      path: [],
      value: { currency: "KRW" },
      origin: { kind: "revision", revisionId: "rev_7", version: 7 },
    });
    const stored = buildStoredDraft(s, SAVED_AT);
    const serialized = serializeStoredDraft(stored);
    expect(serialized.ok).toBe(true);
    if (!serialized.ok) return;
    const parsed = parseStoredDraft(serialized.text);
    expect(parsed).toEqual(stored);
    expect(parsed!.version).toBe(DRAFT_FORMAT_VERSION);
    expect(parsed!.drafts[0]).toMatchObject({
      kind: "replace_subtree",
      origin: { kind: "revision", revisionId: "rev_7", version: 7 },
    });
  });

  it("상한을 넘으면 쓰지 않고 크기를 알린다", () => {
    const stored: StoredDraft = {
      version: DRAFT_FORMAT_VERSION,
      savedAt: SAVED_AT,
      jobId: JOB,
      structureVersion: 3,
      resultVersions: {},
      drafts: [
        {
          kind: "set_value",
          jobId: JOB,
          resultId: "occ_extract_1",
          path: ["memo"],
          value: "x".repeat(DRAFT_MAX_BYTES),
        },
      ],
    };
    const serialized = serializeStoredDraft(stored);
    expect(serialized.ok).toBe(false);
    if (serialized.ok) return;
    expect(serialized.reason).toBe("too_large");
    expect(serialized.bytes).toBeGreaterThan(DRAFT_MAX_BYTES);
  });

  it("깨진 JSON·다른 버전·모양이 다른 것은 null", () => {
    const valid = buildStoredDraft(edited(), SAVED_AT);
    const text = (patch: Record<string, unknown>) =>
      JSON.stringify({ ...valid, ...patch });
    expect(parseStoredDraft("{oops")).toBeNull();
    expect(parseStoredDraft("[]")).toBeNull();
    expect(parseStoredDraft(text({ version: 2 }))).toBeNull();
    expect(parseStoredDraft(text({ savedAt: 123 }))).toBeNull();
    expect(parseStoredDraft(text({ structureVersion: "3" }))).toBeNull();
    expect(parseStoredDraft(text({ resultVersions: { a: "2" } }))).toBeNull();
    expect(parseStoredDraft(text({ drafts: {} }))).toBeNull();
    expect(parseStoredDraft(text({ drafts: [{ jobId: JOB }] }))).toBeNull();
    expect(
      parseStoredDraft(
        text({ drafts: [{ kind: "set_label", jobId: "job_B" }] }),
      ),
    ).toBeNull();
    expect(parseStoredDraft(text({}))).toEqual(valid);
    expect(parseStoredDraft(text({ structureVersion: null }))).toEqual({
      ...valid,
      structureVersion: null,
    });
  });
});

describe("draftCompatibility", () => {
  const doc = readReviewDocument(SINGLE_JOB);
  const stored = buildStoredDraft(edited(), SAVED_AT);

  it("Job·구성 version·결과 version 이 모두 같으면 ok", () => {
    expect(draftCompatibility(stored, doc, JOB)).toEqual({ ok: true });
  });

  it("Job 이 다르면 job_mismatch", () => {
    expect(draftCompatibility(stored, doc, "job_B")).toEqual({
      ok: false,
      reason: "job_mismatch",
    });
    expect(draftCompatibility({ ...stored, jobId: "job_B" }, doc, JOB)).toEqual(
      { ok: false, reason: "job_mismatch" },
    );
  });

  it("구성 version 이 다르면 structure_version", () => {
    expect(
      draftCompatibility({ ...stored, structureVersion: 2 }, doc, JOB),
    ).toEqual({ ok: false, reason: "structure_version" });
    expect(
      draftCompatibility({ ...stored, structureVersion: null }, doc, JOB),
    ).toEqual({ ok: false, reason: "structure_version" });
  });

  it("결과 version 이 다르면 result_version, 결과가 없어졌으면 result_missing", () => {
    expect(
      draftCompatibility(
        { ...stored, resultVersions: { occ_extract_1: 3 } },
        doc,
        JOB,
      ),
    ).toEqual({ ok: false, reason: "result_version" });
    expect(
      draftCompatibility(
        { ...stored, resultVersions: { occ_gone: 1 } },
        doc,
        JOB,
      ),
    ).toEqual({ ok: false, reason: "result_missing" });
  });
});
