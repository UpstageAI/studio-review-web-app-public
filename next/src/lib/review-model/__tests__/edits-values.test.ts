import { describe, expect, it } from "vitest";

import {
  insertItem,
  moveItem,
  nodeAt,
  parentOf,
  removeItem,
  removeKey,
  replaceSubtree,
  setKey,
  type EditResult,
} from "../edits";
import { isExactNumber, stringifyJson, type JsonValue } from "../json";
import { findResult } from "../layout";
import type { ReviewJob } from "../types";
import { singleJob } from "./fixtures/builders";

const R = "occ_extract_1";

function ok(result: EditResult): ReviewJob {
  if (!result.ok) throw new Error(`expected ok, got ${result.reason}`);
  return result.job;
}

function content(job: ReviewJob, id = R): Record<string, JsonValue> {
  return findResult(job, id)!.content as Record<string, JsonValue>;
}

const failed = (reason: string) => ({ ok: false, reason });

/** `lines` 를 qty 1·2·3 세 항목으로 만든 Job. */
function threeLines(job: ReviewJob): ReviewJob {
  return ok(
    replaceSubtree(job, R, ["lines"], [{ qty: 1 }, { qty: 2 }, { qty: 3 }]),
  );
}

const qtys = (job: ReviewJob) =>
  (content(job).lines as { qty: number }[]).map(line => line.qty);

describe("nodeAt·parentOf", () => {
  const { job } = singleJob();
  const value = findResult(job, R)!.content;

  it("있는 경로의 값(컨테이너 포함), 없으면 undefined", () => {
    expect(nodeAt(value, ["lines", "0", "qty"])).toBe(2);
    expect(nodeAt(value, ["lines"])).toEqual([{ qty: 2, price: 10.5 }]);
    expect(nodeAt(value, ["memo"])).toBeNull();
    expect(nodeAt(value, [])).toBe(value);
    for (const path of [
      ["nope"],
      ["lines", "1"],
      ["lines", "01"],
      ["x", "y"],
    ]) {
      expect(nodeAt(value, path)).toBeUndefined();
    }
  });

  it("parentOf 는 부모 경로와 마지막 토큰", () => {
    expect(parentOf(["a", "0", "b"])).toEqual({
      parent: ["a", "0"],
      token: "b",
    });
    expect(parentOf([])).toBeNull();
  });
});

describe("replaceSubtree", () => {
  const { job } = singleJob();

  it("컨테이너를 통째로 바꾸고 나머지는 공유한다", () => {
    const next = ok(replaceSubtree(job, R, ["lines"], []));
    expect(content(next).lines).toEqual([]);
    expect(isExactNumber(content(next).amount)).toBe(true);
    expect(content(job).lines).toEqual([{ qty: 2, price: 10.5 }]);
    expect(findResult(next, "occ_merge_1")).toBe(
      findResult(job, "occ_merge_1"),
    );
  });

  it("경로 [] 는 content 전체", () => {
    const next = ok(replaceSubtree(job, R, [], [{ amount: 1 }]));
    expect(findResult(next, R)!.content).toEqual([{ amount: 1 }]);
  });

  it("없는 경로는 path_missing, 편집 불가·없는 결과는 그 사유", () => {
    expect(replaceSubtree(job, R, ["nope"], 1)).toEqual(failed("path_missing"));
    expect(replaceSubtree(job, "occ_extract_2", [], {})).toEqual(
      failed("result_not_editable"),
    );
    expect(replaceSubtree(job, "occ_none", [], {})).toEqual(
      failed("result_missing"),
    );
  });
});

describe("insertItem", () => {
  const { job } = singleJob();

  it("index 자리(0..length)에 넣는다", () => {
    const base = threeLines(job);
    expect(qtys(ok(insertItem(base, R, ["lines"], 3, { qty: 9 })))).toEqual([
      1, 2, 3, 9,
    ]);
    expect(qtys(ok(insertItem(base, R, ["lines"], 0, { qty: 9 })))).toEqual([
      9, 1, 2, 3,
    ]);
  });

  it("빈 배열에도 넣는다", () => {
    const empty = ok(replaceSubtree(job, R, ["lines"], []));
    expect(
      content(ok(insertItem(empty, R, ["lines"], 0, { qty: 1 }))).lines,
    ).toEqual([{ qty: 1 }]);
  });

  it("범위 밖 index 는 index_out_of_range, 배열이 아니면 path_missing", () => {
    for (const index of [-1, 2, 0.5, Number.NaN]) {
      expect(insertItem(job, R, ["lines"], index, {})).toEqual(
        failed("index_out_of_range"),
      );
    }
    expect(insertItem(job, R, ["currency"], 0, "x")).toEqual(
      failed("path_missing"),
    );
    expect(insertItem(job, R, ["nope"], 0, "x")).toEqual(
      failed("path_missing"),
    );
  });

  it("편집 불가 상태", () => {
    expect(insertItem(job, "occ_extract_2", [], 0, 1)).toEqual(
      failed("result_not_editable"),
    );
  });
});

describe("removeItem", () => {
  const { job } = singleJob();

  it("index 항목을 뺀다", () => {
    expect(qtys(ok(removeItem(threeLines(job), R, ["lines"], 1)))).toEqual([
      1, 3,
    ]);
  });

  it("범위 밖은 index_out_of_range, 배열이 아니면 path_missing", () => {
    expect(removeItem(job, R, ["lines"], 1)).toEqual(
      failed("index_out_of_range"),
    );
    expect(removeItem(job, R, ["paid"], 0)).toEqual(failed("path_missing"));
  });
});

describe("moveItem", () => {
  const { job } = singleJob();
  const base = threeLines(job);

  it("to 는 뺀 뒤 기준", () => {
    expect(qtys(ok(moveItem(base, R, ["lines"], 0, 2)))).toEqual([2, 3, 1]);
    expect(qtys(ok(moveItem(base, R, ["lines"], 2, 0)))).toEqual([3, 1, 2]);
    expect(qtys(ok(moveItem(base, R, ["lines"], 1, 1)))).toEqual([1, 2, 3]);
  });

  it("from·to 가 범위 밖이면 index_out_of_range", () => {
    expect(moveItem(base, R, ["lines"], 3, 0)).toEqual(
      failed("index_out_of_range"),
    );
    expect(moveItem(base, R, ["lines"], 0, 3)).toEqual(
      failed("index_out_of_range"),
    );
    expect(moveItem(base, R, ["amount"], 0, 0)).toEqual(failed("path_missing"));
  });
});

describe("setKey·removeKey", () => {
  const { job } = singleJob();

  it("setKey 는 없던 키를 끝에 더하고 키 순서를 지킨다", () => {
    const removed = ok(removeKey(job, R, [], "memo"));
    const next = ok(setKey(removed, R, [], "memo", "note"));
    expect(Object.keys(content(next)).at(-1)).toBe("memo");
    expect(content(next).memo).toBe("note");
    expect(isExactNumber(content(next).amount)).toBe(true);
  });

  it("중첩 객체에도 더한다", () => {
    const next = ok(setKey(job, R, ["lines", "0"], "note", ""));
    expect((content(next).lines as JsonValue[])[0]).toEqual({
      qty: 2,
      price: 10.5,
      note: "",
    });
  });

  it("있는 키는 path_exists, 객체가 아니면 path_missing", () => {
    expect(setKey(job, R, [], "currency", "KRW")).toEqual(
      failed("path_exists"),
    );
    expect(setKey(job, R, ["lines"], "x", 1)).toEqual(failed("path_missing"));
    expect(setKey(job, R, ["nope"], "x", 1)).toEqual(failed("path_missing"));
  });

  it("removeKey 는 키를 지우고, 없으면 path_missing", () => {
    const next = ok(removeKey(job, R, [], "invoice_no"));
    expect(Object.hasOwn(content(next), "invoice_no")).toBe(false);
    expect(Object.keys(content(next))).toHaveLength(8);
    expect(removeKey(job, R, [], "nope")).toEqual(failed("path_missing"));
    expect(removeKey(job, "occ_extract_2", [], "amount")).toEqual(
      failed("result_not_editable"),
    );
  });

  it("__proto__ 키도 데이터로 더하고 지운다", () => {
    const next = ok(setKey(job, R, [], "__proto__", 1));
    expect(Object.hasOwn(content(next), "__proto__")).toBe(true);
    expect(stringifyJson(content(next))).toContain('"__proto__":1');
    const back = ok(removeKey(next, R, [], "__proto__"));
    expect(Object.hasOwn(content(back), "__proto__")).toBe(false);
  });
});
