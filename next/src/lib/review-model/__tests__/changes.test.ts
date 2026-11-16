import { describe, expect, it } from "vitest";

import {
  CHANGE_ENTRY_ONLY_KEYS,
  addChange,
  applyEntry,
  commitSession,
  createSession,
  entryTargets,
  replay,
  resetSession,
  revertChange,
  toDraft,
  type ChangeDraft,
  type ReviewSession,
} from "../changes";
import { jsonEquals, stringifyJson } from "../json";
import { findDocument, findResult } from "../layout";
import { flattenPages, pageKey } from "../pages";
import type { PageRef, ReviewDocument } from "../types";
import { singleJob } from "./fixtures/builders";

const J = "job_A";
const S = "st_classify";
const p = (file: 0 | 1, page: number): PageRef => ({
  file_ref: `${J}#${file}`,
  page,
});

function add(session: ReviewSession, draft: ChangeDraft): ReviewSession {
  const outcome = addChange(session, draft);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.session;
}

function job(doc: ReviewDocument) {
  return doc.jobs[0]!;
}

const value = (
  path: string[],
  v: string | number,
): Extract<ChangeDraft, { kind: "set_value" }> => ({
  kind: "set_value",
  jobId: J,
  resultId: "occ_extract_1",
  path,
  value: v,
});

describe("addChange", () => {
  const { doc } = singleJob();

  it("id·seq·description(적용 전 상태)을 붙이고 current 에 증분 적용", () => {
    const outcome = addChange(createSession(doc), value(["currency"], "KRW"));
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const { entry, session } = outcome;
    expect(entry).toMatchObject({ id: "change-1", seq: 1 });
    expect(entry!.description).toMatchObject({
      documentLabel: "invoice",
      documentIds: ["doc_1"],
      stepName: "금액 추출",
      fieldTitle: "currency",
      pointer: "/currency",
      before: "USD",
      after: "KRW",
    });
    expect(session.nextSeq).toBe(2);
    expect(
      findResult(job(session.current), "occ_extract_1")!.content,
    ).toMatchObject({
      currency: "KRW",
    });
    expect(session.base).toBe(doc);
  });

  it("schema title 을 fieldTitle 로", () => {
    const outcome = addChange(createSession(doc), value(["amount"], 1));
    expect(outcome.ok && outcome.entry!.description.fieldTitle).toBe("Amount");
  });

  it("전제가 맞지 않으면 거부하고 세션은 그대로", () => {
    const session = createSession(doc);
    expect(
      addChange(session, {
        ...value(["currency"], "KRW"),
        resultId: "occ_extract_2",
      }),
    ).toEqual({ ok: false, reason: "result_not_editable" });
    expect(
      addChange(session, { ...value(["currency"], "KRW"), jobId: "job_Z" }),
    ).toEqual({
      ok: false,
      reason: "target_missing",
    });
  });

  it("알 수 없는 kind 는 target_missing 으로 거부한다", () => {
    const draft = { kind: "zzz", jobId: J } as unknown as ChangeDraft;
    expect(addChange(createSession(doc), draft)).toEqual({
      ok: false,
      reason: "target_missing",
    });
  });

  it("같은 결과·경로의 연속 set_value 는 합치고, 처음 값으로 돌아오면 항목을 지운다", () => {
    let session = add(createSession(doc), value(["invoice_no"], "INV-2"));
    session = add(session, value(["invoice_no"], "INV-3"));
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0]!.description).toMatchObject({
      before: "INV-1",
      after: "INV-3",
    });
    expect(session.entries[0]).toMatchObject({ value: "INV-3" });
    const back = addChange(session, value(["invoice_no"], "INV-1"));
    expect(back.ok && back.entry).toBeNull();
    expect(back.ok && back.session.entries).toEqual([]);
    // 사이에 다른 필드의 항목이 끼어도 처음 항목에 합친다
    let other = add(createSession(doc), value(["invoice_no"], "A"));
    other = add(other, value(["currency"], "KRW"));
    other = add(other, value(["invoice_no"], "B"));
    expect(other.entries).toHaveLength(2);
    expect(other.entries[0]).toMatchObject({
      seq: 1,
      value: "B",
      description: { before: "INV-1", after: "B" },
    });
    expect(other.entries[1]).toMatchObject({ path: ["currency"] });
  });

  it("합칠 항목이 없고 지금 값과 같은 set_value 는 세션을 바꾸지 않는다", () => {
    const fresh = createSession(doc);
    const same = addChange(fresh, value(["invoice_no"], "INV-1"));
    expect(same).toEqual({ ok: true, session: fresh, entry: null });
    // 원래 값으로 돌려 항목이 지워진 뒤 같은 값이 한 번 더 확정돼도 항목이 생기지 않는다
    const edited = add(fresh, value(["invoice_no"], "INV-2"));
    const back = add(edited, value(["invoice_no"], "INV-1"));
    expect(back.entries).toEqual([]);
    const again = addChange(back, value(["invoice_no"], "INV-1"));
    expect(again.ok && again.session).toBe(back);
    expect(again.ok && again.entry).toBeNull();
  });

  it("증분 current ≡ replay(base, entries)", () => {
    let session = createSession(doc);
    session = add(session, value(["currency"], "KRW"));
    session = add(session, {
      kind: "split_document",
      jobId: J,
      stepId: S,
      documentId: "doc_2",
      afterPage: p(0, 3),
      newDocumentId: "review-doc-1",
    });
    session = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "review-doc-1",
      label: "contract",
    });
    session = add(session, {
      kind: "exclude_pages",
      jobId: J,
      stepId: S,
      fromDocumentId: "doc_3",
      pages: [p(1, 2)],
    });
    const replayed = replay(doc, session.entries);
    expect(replayed.dropped).toEqual([]);
    expect(stringifyJson(replayed.current)).toBe(
      stringifyJson(session.current),
    );
    // 결정적
    expect(stringifyJson(replay(doc, session.entries).current)).toBe(
      stringifyJson(replayed.current),
    );
  });
});

describe("revertChange", () => {
  const { doc } = singleJob();

  it("독립 항목은 그것만 되돌린다", () => {
    let session = add(createSession(doc), value(["currency"], "KRW"));
    session = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "receipt",
    });
    const { session: next, alsoReverted } = revertChange(session, "change-1");
    expect(alsoReverted).toEqual([]);
    expect(next.entries.map(e => e.id)).toEqual(["change-2"]);
    expect(
      findResult(job(next.current), "occ_extract_1")!.content,
    ).toMatchObject({
      currency: "USD",
    });
    expect(findDocument(job(next.current), S, "doc_1")!.label).toBe("receipt");
  });

  it("분리를 되돌리면 새 문서의 set_label 이 document_missing 으로 함께 빠진다", () => {
    let session = add(createSession(doc), {
      kind: "split_document",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      afterPage: p(0, 1),
      newDocumentId: "review-doc-2",
    });
    session = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "review-doc-2",
      label: "contract",
    });
    const { session: next, alsoReverted } = revertChange(session, "change-1");
    expect(alsoReverted.map(d => [d.entry.id, d.reason])).toEqual([
      ["change-2", "document_missing"],
    ]);
    expect(next.entries).toEqual([]);
    expect(stringifyJson(next.current)).toBe(stringifyJson(doc));
  });

  it("옮기기를 되돌리면 옮긴 페이지의 reorder 는 빠지고 무관한 set_value 는 남는다", () => {
    let session = add(createSession(doc), {
      kind: "move_pages",
      jobId: J,
      stepId: S,
      fromDocumentId: "doc_3",
      pages: [p(1, 2)],
      to: { documentId: "doc_1", index: 2 },
    });
    session = add(session, {
      kind: "reorder_pages",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      page: p(1, 2),
      toIndex: 0,
    });
    session = add(session, value(["currency"], "KRW"));
    const { session: next, alsoReverted } = revertChange(session, "change-1");
    expect(alsoReverted.map(d => [d.entry.id, d.reason])).toEqual([
      ["change-2", "page_not_in_document"],
    ]);
    expect(next.entries.map(e => e.id)).toEqual(["change-3"]);
    expect(
      flattenPages(findDocument(job(next.current), S, "doc_1")!).map(pageKey),
    ).toEqual(["job_A#0:1", "job_A#0:2"]);
  });

  it("replay 는 설명을 다시 계산한다(앞 라벨 변경을 되돌리면 before 가 바뀐다)", () => {
    let session = add(createSession(doc), {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "receipt",
    });
    // 사이에 문서 구성 변경이 있으면 같은 문서의 라벨 변경도 합치지 않는다.
    session = add(session, {
      kind: "exclude_document",
      jobId: J,
      documentId: "doc_2",
    });
    session = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "contract",
    });
    expect(session.entries).toHaveLength(3);
    expect(session.entries[2]!.description.before).toBe("receipt");
    const { session: next } = revertChange(session, "change-1");
    expect(next.entries.at(-1)!.description.before).toBe("invoice");
  });

  it("같은 문서의 라벨 변경은 한 항목으로 합치고, 처음 라벨로 돌아오면 지운다", () => {
    let session = add(createSession(doc), {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "receipt",
    });
    session = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "contract",
    });
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0]!.description).toMatchObject({
      before: "invoice",
      after: "contract",
    });
    session = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "invoice",
    });
    expect(session.entries).toEqual([]);
    expect(jsonEquals(session.current, session.base)).toBe(true);
  });

  it("처음에 null 이던 값을 넣었다가 null 로 되돌리면 변경이 사라진다", () => {
    const typed = add(createSession(doc), value(["memo"], "abc"));
    expect(typed.entries[0]?.description.before).toBeNull();
    const back = addChange(typed, {
      kind: "set_value",
      jobId: J,
      resultId: "occ_extract_1",
      path: ["memo"],
      value: null,
    });
    expect(back.ok && back.session.entries).toEqual([]);
  });

  it("값은 넘어온 그대로 적용한다(JSON 가져오기의 빈 글자는 null 과 다른 변경)", () => {
    const session = add(createSession(doc), value(["memo"], ""));
    expect(session.entries).toHaveLength(1);
    expect(session.entries[0]!.description).toMatchObject({
      before: null,
      after: "",
    });
  });

  it("다른 변경을 거쳐 문서 전체가 처음과 같아지면 값 변경 뒤에도 항목을 비운다", () => {
    let session = add(createSession(doc), value(["currency"], "KRW"));
    session = add(session, {
      kind: "exclude_document",
      jobId: J,
      documentId: "doc_2",
    });
    session = add(session, {
      kind: "restore_document",
      jobId: J,
      documentId: "doc_2",
    });
    expect(session.entries.length).toBeGreaterThan(0);
    session = add(session, value(["currency"], "USD"));
    expect(session.entries).toEqual([]);
    expect(jsonEquals(session.current, session.base)).toBe(true);
  });

  it("되돌린 뒤 문서 전체가 처음과 같아지면 남은 항목도 비운다", () => {
    let session = add(createSession(doc), {
      kind: "exclude_document",
      jobId: J,
      documentId: "doc_2",
    });
    session = add(session, value(["currency"], "KRW"));
    session = add(session, {
      kind: "restore_document",
      jobId: J,
      documentId: "doc_2",
    });
    const valueEntry = session.entries.find(
      entry => entry.kind === "set_value",
    );
    expect(valueEntry).toBeDefined();
    const { session: next } = revertChange(session, valueEntry!.id);
    expect(next.entries).toEqual([]);
    expect(jsonEquals(next.current, next.base)).toBe(true);
  });

  it("라벨 변경 사이에 값 변경이 있어도 같은 문서의 라벨은 합쳐 지운다", () => {
    let session = add(createSession(doc), {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "receipt",
    });
    session = add(session, value(["currency"], "KRW"));
    session = add(session, {
      kind: "set_label",
      jobId: J,
      stepId: S,
      documentId: "doc_1",
      label: "invoice",
    });
    expect(session.entries.map(entry => entry.kind)).toEqual(["set_value"]);
  });

  it("없는 id 는 그대로, resetSession 은 base 로", () => {
    const session = add(createSession(doc), value(["currency"], "KRW"));
    expect(revertChange(session, "nope").session).toBe(session);
    const reset = resetSession(session);
    expect(reset.entries).toEqual([]);
    expect(reset.current).toBe(doc);
  });
});

describe("entryTargets·applyEntry", () => {
  const { doc } = singleJob();

  it("문서·결과 id", () => {
    let session = add(createSession(doc), value(["currency"], "KRW"));
    session = add(session, {
      kind: "merge_documents",
      jobId: J,
      stepId: S,
      intoDocumentId: "doc_1",
      fromDocumentId: "doc_3",
    });
    expect(entryTargets(session.entries[0]!)).toEqual({
      documentIds: ["doc_1"],
      resultIds: ["occ_extract_1"],
    });
    expect(entryTargets(session.entries[1]!)).toEqual({
      documentIds: ["doc_1", "doc_3"],
      resultIds: [],
    });
    expect(session.entries[1]!.description).toMatchObject({
      documentLabel: "invoice",
      otherDocumentLabel: "contract",
    });
  });

  it("applyEntry 는 입력을 바꾸지 않는다", () => {
    const before = stringifyJson(doc);
    const outcome = applyEntry(doc, value(["currency"], "KRW"));
    expect(outcome.ok).toBe(true);
    expect(stringifyJson(doc)).toBe(before);
  });
});

describe("toDraft", () => {
  const { doc } = singleJob();

  it("세션 전용 키(id·seq·description)만 떼어 원래 draft 로 되돌린다", () => {
    const draft = value(["currency"], "KRW");
    const entry = add(createSession(doc), draft).entries[0]!;
    const back = toDraft(entry);
    expect(back).toEqual(draft);
    for (const key of CHANGE_ENTRY_ONLY_KEYS) {
      expect(entry).toHaveProperty(key);
      expect(back).not.toHaveProperty(key);
    }
  });
});

describe("commitSession", () => {
  const { doc } = singleJob();

  it("version 을 채택하고 항목을 비운다 — 값만 + 파생 Step 있으면 reload 권장", () => {
    const session = add(createSession(doc), value(["currency"], "KRW"));
    const committed = commitSession(session, [
      {
        status: "applied",
        applied_versions: { "v:occ_extract_1": 3 },
        copy_id_map: null,
      },
    ]);
    expect(committed.current).toBe(true);
    expect(committed.session.entries).toEqual([]);
    expect(committed.session.base).toBe(committed.session.current);
    expect(
      findResult(job(committed.session.base), "occ_extract_1")!.base_version,
    ).toBe(3);
    // single-job 에는 Validate·Merge 결과가 있어 서버가 다시 계산한다
    expect(committed.reloadRecommended).toBe(true);
    expect(
      jsonEquals(
        findResult(job(committed.session.base), "occ_extract_1")!.content,
        findResult(job(session.current), "occ_extract_1")!.content,
      ),
    ).toBe(true);
  });

  it("미적용 unit 이면 current false·reload 권장", () => {
    const session = add(createSession(doc), value(["currency"], "KRW"));
    const committed = commitSession(session, [{ status: "conflict" }]);
    expect(committed.current).toBe(false);
    expect(committed.reloadRecommended).toBe(true);
    expect(committed.session.entries).toEqual([]);
  });
});
