import { describe, expect, it } from "vitest";

import {
  addChange,
  createSession,
  describeChange,
  entryTargets,
  isValueEntry,
  replay,
  revertChange,
  toDraft,
  type ChangeDraft,
  type ChangeOrigin,
  type ReviewSession,
} from "../changes";
import type { JsonValue } from "../json";
import { findResult } from "../layout";
import { readReviewDocument } from "../normalize";
import type { ReviewDocument } from "../types";
import { buildUploadBody } from "../upload";
import { singleJob } from "./fixtures/builders";
import { SINGLE_JOB } from "./fixtures/fixtures";

const J = "job_A";
const R = "occ_extract_1";
const base = { jobId: J, resultId: R } as const;

function add(session: ReviewSession, draft: ChangeDraft): ReviewSession {
  const outcome = addChange(session, draft);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.session;
}

function build(drafts: readonly ChangeDraft[]): ReviewSession {
  return drafts.reduce(add, createSession(singleJob().doc));
}

function content(doc: ReviewDocument, id = R): Record<string, JsonValue> {
  return findResult(doc.jobs[0]!, id)!.content as Record<string, JsonValue>;
}

const setValue = (path: string[], value: JsonValue): ChangeDraft => ({
  kind: "set_value",
  ...base,
  path,
  value,
});

const insertLine = (index: number, qty: number): ChangeDraft => ({
  kind: "insert_item",
  ...base,
  path: ["lines"],
  index,
  value: { qty, price: 0 },
});

describe("describeChange — 값 종류", () => {
  const { doc } = singleJob();

  it("insert_item: 배열 제목·pointer·1-based index·after", () => {
    expect(describeChange(doc, insertLine(1, 5))).toMatchObject({
      documentLabel: "invoice",
      documentIds: ["doc_1"],
      stepName: "금액 추출",
      fieldTitle: "lines",
      pointer: "/lines",
      index: 2,
      after: { qty: 5, price: 0 },
    });
  });

  it("remove_item·move_item", () => {
    expect(
      describeChange(doc, {
        kind: "remove_item",
        ...base,
        path: ["lines"],
        index: 0,
      }),
    ).toMatchObject({
      pointer: "/lines",
      index: 1,
      before: { qty: 2, price: 10.5 },
    });
    expect(
      describeChange(doc, {
        kind: "move_item",
        ...base,
        path: ["lines"],
        from: 0,
        to: 1,
      }),
    ).toMatchObject({ pointer: "/lines", from: 1, to: 2 });
  });

  it("set_key 는 추가 키의 제목, remove_key 는 지우기 전 값", () => {
    expect(
      describeChange(doc, {
        kind: "set_key",
        ...base,
        path: [],
        key: "amount",
        value: 1,
      }),
    ).toMatchObject({ fieldTitle: "Amount", pointer: "/amount", after: 1 });
    expect(
      describeChange(doc, {
        kind: "remove_key",
        ...base,
        path: [],
        key: "currency",
      }),
    ).toMatchObject({
      fieldTitle: "currency",
      pointer: "/currency",
      before: "USD",
    });
  });

  it("replace_subtree [] 는 content 전체가 before", () => {
    const description = describeChange(doc, {
      kind: "replace_subtree",
      ...base,
      path: [],
      value: {},
    });
    expect(description.pointer).toBe("");
    expect(description.before).toBe(findResult(doc.jobs[0]!, R)!.content);
    expect(description.after).toEqual({});
  });
});

describe("describeChange — 배열 위치(fieldPath)", () => {
  const { doc } = singleJob();

  it("경로에 배열 위치가 있으면 단계마다 제목 또는 1-based 위치", () => {
    expect(
      describeChange(doc, setValue(["lines", "0", "qty"], 3)),
    ).toMatchObject({
      fieldTitle: "qty",
      fieldPath: [
        { kind: "key", title: "lines" },
        { kind: "index", index: 1 },
        { kind: "key", title: "qty" },
      ],
      pointer: "/lines/0/qty",
    });
    // 배열 연산은 배열 자리까지의 경로.
    expect(
      describeChange(doc, {
        kind: "insert_item",
        ...base,
        path: ["lines", "0", "tags"],
        index: 0,
        value: "a",
      }).fieldPath,
    ).toEqual([
      { kind: "key", title: "lines" },
      { kind: "index", index: 1 },
      { kind: "key", title: "tags" },
    ]);
  });

  it("배열 위치가 없으면 fieldPath 키가 없다", () => {
    expect(describeChange(doc, setValue(["memo"], "x"))).not.toHaveProperty(
      "fieldPath",
    );
    expect(describeChange(doc, insertLine(0, 1))).not.toHaveProperty(
      "fieldPath",
    );
  });

  it("래퍼 결과([{…}])는 맨 앞 0 을 위치로 보지 않고 schema 제목을 래퍼를 뺀 경로로 찾는다", () => {
    const raw = JSON.parse(SINGLE_JOB) as {
      jobs: { output: { id?: string; content: unknown }[] }[];
    };
    const output = raw.jobs[0]!.output.find(item => item.id === R)!;
    output.content = [{ amount: 1, lines: [{ qty: 2, price: 1 }] }];
    const wrapped = readReviewDocument(JSON.stringify(raw));

    const amount = describeChange(wrapped, setValue(["0", "amount"], 2));
    expect(amount).toMatchObject({
      fieldTitle: "Amount",
      pointer: "/0/amount",
    });
    expect(amount).not.toHaveProperty("fieldPath");
    expect(
      describeChange(wrapped, setValue(["0", "lines", "0", "qty"], 3))
        .fieldPath,
    ).toEqual([
      { kind: "key", title: "lines" },
      { kind: "index", index: 1 },
      { kind: "key", title: "qty" },
    ]);
  });
});

describe("isValueEntry·entryTargets", () => {
  it("resultId 를 가진 종류만 값 항목", () => {
    expect(isValueEntry(insertLine(0, 1))).toBe(true);
    expect(isValueEntry(setValue(["paid"], false))).toBe(true);
    expect(
      isValueEntry({
        kind: "set_label",
        jobId: J,
        stepId: "st_classify",
        documentId: "doc_1",
        label: null,
      }),
    ).toBe(false);
  });

  it("값 항목은 결과 id 를 대상으로 싣는다", () => {
    const session = build([insertLine(0, 1)]);
    expect(entryTargets(session.entries[0]!)).toEqual({
      documentIds: ["doc_1"],
      resultIds: [R],
    });
  });

  it("새 종류는 같은 경로여도 합치지 않는다", () => {
    expect(build([insertLine(1, 1), insertLine(1, 2)]).entries).toHaveLength(2);
  });
});

describe("addChange — 같은 필드 set_value 합치기", () => {
  it("사이에 다른 필드 항목이 있어도 처음 항목에 합친다", () => {
    const session = build([
      setValue(["invoice_no"], "A"),
      setValue(["currency"], "KRW"),
      setValue(["invoice_no"], "B"),
    ]);
    expect(session.entries).toHaveLength(2);
    expect(session.entries[0]).toMatchObject({
      seq: 1,
      value: "B",
      description: { before: "INV-1", after: "B" },
    });
    expect(session.entries[1]).toMatchObject({ seq: 2, path: ["currency"] });
    expect(session.nextSeq).toBe(3);
    expect(session.current).toEqual(
      replay(session.base, session.entries).current,
    );
  });

  it("처음 값으로 돌아오면 그 항목을 지운다", () => {
    let session = build([
      setValue(["invoice_no"], "A"),
      setValue(["currency"], "KRW"),
    ]);
    const outcome = addChange(session, setValue(["invoice_no"], "INV-1"));
    expect(outcome.ok && outcome.entry).toBeNull();
    if (!outcome.ok) throw new Error(outcome.reason);
    session = outcome.session;
    expect(session.entries).toMatchObject([{ path: ["currency"] }]);
    expect(content(session.current).invoice_no).toBe("INV-1");
  });

  it("사이에 그 필드의 상위를 바꾼 항목이 있으면 합치지 않는다", () => {
    expect(
      build([
        setValue(["lines", "0", "qty"], 3),
        insertLine(0, 1),
        setValue(["lines", "0", "qty"], 4),
      ]).entries,
    ).toHaveLength(3);
    expect(
      build([
        setValue(["lines", "0", "qty"], 3),
        {
          kind: "replace_subtree",
          ...base,
          path: [],
          value: { lines: [{ qty: 1, price: 0 }] },
        },
        setValue(["lines", "0", "qty"], 4),
      ]).entries.map(entry => entry.kind),
    ).toEqual(["set_value", "replace_subtree", "set_value"]);
  });
});

describe("revertChange — 되돌리기 연쇄", () => {
  it("배열 항목 추가를 되돌리면 그 항목의 값 수정도 빠지고, 다른 필드 수정은 남는다", () => {
    const session = build([
      insertLine(1, 5),
      setValue(["lines", "1", "qty"], 7),
      setValue(["currency"], "KRW"),
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted.map(item => [item.entry.id, item.reason])).toEqual([
      [session.entries[1]!.id, "depends_on_reverted"],
    ]);
    expect(next.entries.map(entry => entry.kind)).toEqual(["set_value"]);
    expect(content(next.current).lines).toEqual([{ qty: 2, price: 10.5 }]);
    expect(content(next.current).currency).toBe("KRW");
  });

  it("다른 배열·다른 결과의 수정은 남는다", () => {
    const session = build([
      {
        kind: "set_key",
        ...base,
        path: ["lines", "0"],
        key: "tags",
        value: [],
      },
      insertLine(0, 5),
      {
        kind: "insert_item",
        ...base,
        path: ["lines", "1", "tags"],
        index: 0,
        value: "a",
      },
      setValue(["memo"], "x"),
      {
        kind: "set_value",
        jobId: J,
        resultId: "occ_merge_1",
        path: ["total"],
        value: 1,
      },
    ]);
    // `lines` 접두 아래가 아닌 `memo`·다른 결과는 남고, `lines/1/tags` 는 함께 빠진다.
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[1]!.id,
    );
    expect(alsoReverted.map(item => item.reason)).toEqual([
      "depends_on_reverted",
    ]);
    expect(next.entries.map(entry => entry.seq)).toEqual([1, 4, 5]);
    expect(content(next.current, "occ_merge_1").total).toBe(1);
  });

  it("항목 삭제를 되돌리면 뒤 항목(자리가 당겨진)의 수정도 빠진다", () => {
    const session = build([
      insertLine(1, 5),
      { kind: "remove_item", ...base, path: ["lines"], index: 0 },
      setValue(["lines", "0", "qty"], 9),
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[1]!.id,
    );
    expect(alsoReverted.map(item => item.entry.seq)).toEqual([3]);
    expect(
      (content(next.current).lines as { qty: number }[]).map(line => line.qty),
    ).toEqual([2, 5]);
  });

  it("이동을 되돌리면 그 배열 안 뒤 수정도 빠진다", () => {
    const session = build([
      insertLine(1, 5),
      { kind: "move_item", ...base, path: ["lines"], from: 1, to: 0 },
      setValue(["lines", "0", "qty"], 9),
    ]);
    const { alsoReverted } = revertChange(session, session.entries[1]!.id);
    expect(alsoReverted.map(item => item.entry.seq)).toEqual([3]);
  });

  it("replace_subtree [] 를 되돌리면 같은 결과의 뒤 항목 전부가 빠진다", () => {
    const session = build([
      setValue(["paid"], false),
      {
        kind: "replace_subtree",
        ...base,
        path: [],
        value: { amount: 1, lines: [] },
      },
      setValue(["amount"], 2),
      insertLine(0, 1),
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[1]!.id,
    );
    expect(alsoReverted.map(item => item.entry.seq)).toEqual([3, 4]);
    expect(next.entries.map(entry => entry.seq)).toEqual([1]);
    expect(content(next.current).paid).toBe(false);
  });

  it("키 추가를 되돌리면 그 키 아래 수정이, 키 삭제를 되돌리면 같은 키 재추가가 빠진다", () => {
    const added = build([
      {
        kind: "set_key",
        ...base,
        path: ["lines", "0"],
        key: "note",
        value: "",
      },
      setValue(["lines", "0", "note"], "hi"),
    ]);
    expect(
      revertChange(added, added.entries[0]!.id).alsoReverted.map(
        item => item.reason,
      ),
    ).toEqual(["depends_on_reverted"]);

    const removed = build([
      { kind: "remove_key", ...base, path: [], key: "memo" },
      { kind: "set_key", ...base, path: [], key: "memo", value: "x" },
    ]);
    const { session: next, alsoReverted } = revertChange(
      removed,
      removed.entries[0]!.id,
    );
    expect(alsoReverted.map(item => item.reason)).toEqual([
      "depends_on_reverted",
    ]);
    expect(content(next.current).memo).toBeNull();
  });

  it("뒤에서 결과를 통째로 덮어쓴 항목은 앞 수정을 되돌리면 함께 빠지고 base 로 돌아간다", () => {
    const session = build([
      setValue(["currency"], "KRW"),
      {
        kind: "replace_subtree",
        ...base,
        path: [],
        value: { ...content(singleJob().doc), currency: "KRW", memo: "x" },
      },
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted.map(item => [item.entry.id, item.reason])).toEqual([
      [session.entries[1]!.id, "depends_on_reverted"],
    ]);
    expect(next.entries).toEqual([]);
    expect(next.current).toBe(session.base);
  });

  it("뒤에서 상위 키를 지운 항목은 앞 수정을 되돌리면 함께 빠진다", () => {
    const session = build([
      setValue(["lines", "0", "price"], 1),
      { kind: "remove_key", ...base, path: [], key: "lines" },
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted.map(item => item.entry.seq)).toEqual([2]);
    expect(next.entries).toEqual([]);
    expect(content(next.current).lines).toEqual([{ qty: 2, price: 10.5 }]);
  });

  it("뒤에서 그 배열 항목을 지운 항목은 함께 빠지고, 다른 항목 삭제는 남는다", () => {
    const removedSame = build([
      setValue(["lines", "0", "qty"], 9),
      { kind: "remove_item", ...base, path: ["lines"], index: 0 },
    ]);
    const same = revertChange(removedSame, removedSame.entries[0]!.id);
    expect(same.alsoReverted.map(item => item.entry.seq)).toEqual([2]);
    expect(same.session.current).toBe(removedSame.base);

    const removedOther = build([
      insertLine(1, 5),
      setValue(["lines", "1", "qty"], 7),
      { kind: "remove_item", ...base, path: ["lines"], index: 0 },
    ]);
    const other = revertChange(removedOther, removedOther.entries[1]!.id);
    expect(other.alsoReverted).toEqual([]);
    expect(other.session.entries.map(entry => entry.seq)).toEqual([1, 3]);
    expect(content(other.session.current).lines).toEqual([
      { qty: 5, price: 0 },
    ]);
  });

  it("덮어쓰기 연쇄는 같은 결과 안에서만 따진다", () => {
    const session = build([
      setValue(["currency"], "KRW"),
      {
        kind: "replace_subtree",
        jobId: J,
        resultId: "occ_merge_1",
        path: [],
        value: { total: 1 },
      },
      setValue(["memo"], "x"),
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted).toEqual([]);
    expect(next.entries.map(entry => entry.seq)).toEqual([2, 3]);
  });

  it("덮어쓴 항목이 함께 빠지면 그 항목 아래의 뒤 수정도 이어서 빠진다", () => {
    const session = build([
      setValue(["currency"], "KRW"),
      {
        kind: "replace_subtree",
        ...base,
        path: [],
        value: { ...content(singleJob().doc), currency: "KRW" },
      },
      setValue(["memo"], "x"),
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[0]!.id,
    );
    expect(alsoReverted.map(item => item.entry.seq)).toEqual([2, 3]);
    expect(next.current).toBe(session.base);
  });

  it("덮어쓴 항목 자체를 되돌리면 앞 항목은 남고 아래 뒤 수정만 함께 빠진다", () => {
    const session = build([
      setValue(["paid"], false),
      { kind: "replace_subtree", ...base, path: ["lines"], value: [] },
      setValue(["currency"], "KRW"),
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[1]!.id,
    );
    expect(alsoReverted).toEqual([]);
    expect(next.entries.map(entry => entry.seq)).toEqual([1, 3]);
    expect(content(next.current).lines).toEqual([{ qty: 2, price: 10.5 }]);
  });

  it("set_value 를 되돌리면 연쇄가 없고, 앞 항목은 건드리지 않는다", () => {
    const session = build([
      insertLine(1, 5),
      setValue(["lines", "1", "qty"], 7),
      setValue(["lines", "1", "price"], 3),
    ]);
    const { session: next, alsoReverted } = revertChange(
      session,
      session.entries[1]!.id,
    );
    expect(alsoReverted).toEqual([]);
    expect(next.entries.map(entry => entry.seq)).toEqual([1, 3]);
  });
});

describe("출처(origin) — 표시 전용", () => {
  const replace = (origin?: ChangeOrigin): ChangeDraft => ({
    kind: "replace_subtree",
    ...base,
    path: ["currency"],
    value: "KRW",
    ...(origin ? { origin } : {}),
  });
  const fromRevision = {
    kind: "revision",
    revisionId: "rev_3",
    version: 3,
  } as const;

  it("addChange 로 만든 항목이 origin 을 갖고 toDraft 가 보존한다", () => {
    const session = build([replace(fromRevision)]);
    const entry = session.entries[0]!;
    expect(entry).toMatchObject({
      kind: "replace_subtree",
      origin: fromRevision,
    });
    expect(toDraft(entry)).toEqual(replace(fromRevision));
  });

  it("앞 항목을 되돌려 replay 해도 뒤 항목의 origin 이 남는다", () => {
    const session = build([
      setValue(["invoice_no"], "A"),
      replace({ kind: "original" }),
    ]);
    const { session: next } = revertChange(session, session.entries[0]!.id);
    expect(next.entries).toHaveLength(1);
    expect(next.entries[0]).toMatchObject({
      kind: "replace_subtree",
      origin: { kind: "original" },
    });
  });

  it("설명·적용 결과·저장 본문은 origin 유무와 무관하다", () => {
    const plain = build([replace()]);
    const tagged = build([replace(fromRevision)]);
    expect(tagged.entries[0]!.description).toEqual(
      plain.entries[0]!.description,
    );
    expect(content(tagged.current)).toEqual(content(plain.current));
    expect(buildUploadBody(tagged.base, tagged.current).text).toBe(
      buildUploadBody(plain.base, plain.current).text,
    );
  });
});
