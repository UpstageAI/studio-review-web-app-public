import { describe, expect, it } from "vitest";

import {
  isExactNumber,
  parseJson,
  stringifyJson,
  type ChangeEntry,
  type DocumentChange,
  type Result,
  type SchemaNode,
} from "@/lib/review-model";

import {
  changedContainerPointers,
  changedLeafPointers,
  emptyContainerPointers,
  emptyLeafPointers,
  isEmptyValue,
  coerceNumber,
  displayValue,
  fieldEntryIds,
  firstLeafPointer,
  isHiddenWrapper,
  lineColumn,
  lockReasonFor,
  schemaPath,
  valueAt,
} from "../value-fields";

const SCHEMA = parseJson(
  JSON.stringify({
    type: "object",
    properties: {
      supplier: { type: "string", title: "공급자" },
      lines: {
        type: "array",
        title: "품목",
        items: {
          type: "object",
          properties: { qty: { type: "integer", title: "수량" } },
        },
      },
    },
  }),
) as SchemaNode;

function result(state: string, content = "{}"): Result {
  return {
    id: "occ_1",
    step_id: "st",
    base_version: 1,
    content: parseJson(content),
    state,
    link: { kind: "documents", document_ids: ["doc_1"] },
  };
}

function change(pageSetChanged: boolean): DocumentChange {
  return {
    jobId: "job_1",
    documentId: "doc_1",
    stepId: null,
    status: "changed",
    pageSetChanged,
    orderOnly: !pageSetChanged,
    labelOnly: false,
    positionChanged: false,
  };
}

describe("valueAt · isHiddenWrapper · schemaPath", () => {
  const content = parseJson('{"supplier":"A","lines":[{"qty":2}]}');

  it("경로의 값을 찾고 없으면 undefined", () => {
    expect(valueAt(content, ["lines", "0", "qty"])).toBe(2);
    expect(valueAt(content, ["lines", "x"])).toBeUndefined();
    expect(valueAt(content, ["nope"])).toBeUndefined();
  });

  it("유효한 JSON 의 경계 입력", () => {
    const doc = parseJson(
      '{"a":[10,null,{"b":null}],"n":null,"o":{"__proto__":1}}',
    );
    expect(valueAt(doc, [])).toBe(doc);
    // 범위 밖·비정규 index
    expect(valueAt(doc, ["a", "3"])).toBeUndefined();
    expect(valueAt(doc, ["a", "01"])).toBeUndefined();
    expect(valueAt(doc, ["a", "-1"])).toBeUndefined();
    expect(valueAt(doc, ["a", "1.0"])).toBeUndefined();
    expect(valueAt(doc, ["a", "length"])).toBeUndefined();
    expect(valueAt(doc, ["a", "0"])).toBe(10);
    // 없는 키·prototype 키
    expect(valueAt(doc, ["missing"])).toBeUndefined();
    expect(valueAt(doc, ["toString"])).toBeUndefined();
    expect(valueAt(doc, ["constructor"])).toBeUndefined();
    expect(valueAt(doc, ["o", "__proto__"])).toBe(1);
    // 중첩 null
    expect(valueAt(doc, ["n"])).toBeNull();
    expect(valueAt(doc, ["a", "1"])).toBeNull();
    expect(valueAt(doc, ["a", "2", "b"])).toBeNull();
    expect(valueAt(doc, ["n", "x"])).toBeUndefined();
    expect(valueAt(doc, ["a", "1", "0"])).toBeUndefined();
    // 원시값 아래
    expect(valueAt(doc, ["a", "0", "x"])).toBeUndefined();
  });

  it("루트 schema 가 객체인데 항목 하나짜리 배열이면 래퍼로 본다", () => {
    const wrapped = parseJson('[{"supplier":"A"}]');
    expect(isHiddenWrapper(SCHEMA, wrapped)).toBe(true);
    expect(isHiddenWrapper(null, wrapped)).toBe(true);
    expect(schemaPath(true, ["0", "supplier"])).toEqual(["supplier"]);
    expect(schemaPath(false, ["0", "supplier"])).toEqual(["0", "supplier"]);
  });

  it("루트 schema 가 배열이거나 항목이 하나가 아니면 보통 배열", () => {
    const arraySchema = parseJson(
      '{"type":"array","items":{"type":"object"}}',
    ) as SchemaNode;
    expect(isHiddenWrapper(arraySchema, parseJson('[{"a":1}]'))).toBe(false);
    expect(isHiddenWrapper(SCHEMA, parseJson('[{"a":1},{"a":2}]'))).toBe(false);
    expect(isHiddenWrapper(SCHEMA, content)).toBe(false);
  });
});

describe("changedLeafPointers", () => {
  const base = parseJson(
    '{"supplier":"A","total":1.50,"lines":[{"qty":2},{"qty":3}]}',
  );

  it("원본과 다른 leaf 와 원본에 없던 leaf 의 pointer", () => {
    const content = parseJson(
      '{"supplier":"B","total":1.50,"lines":[{"qty":2},{"qty":4},{"qty":5}],"memo":"x"}',
    );
    expect([...changedLeafPointers(content, base)].sort()).toEqual([
      "/lines/1/qty",
      "/lines/2/qty",
      "/memo",
      "/supplier",
    ]);
  });

  it("같으면 비어 있고, ExactNumber 는 수가 같으면(1.50 = 1.5) 같은 값", () => {
    expect(changedLeafPointers(base, base).size).toBe(0);
    const same = parseJson(
      '{"supplier":"A","total":1.5,"lines":[{"qty":2},{"qty":3}]}',
    );
    expect(changedLeafPointers(same, base).size).toBe(0);
    const other = parseJson(
      '{"supplier":"A","total":1.51,"lines":[{"qty":2},{"qty":3}]}',
    );
    expect([...changedLeafPointers(other, base)]).toEqual(["/total"]);
  });

  it("원본이 없으면 모든 leaf", () => {
    expect([...changedLeafPointers(base, undefined)].sort()).toEqual([
      "/lines/0/qty",
      "/lines/1/qty",
      "/supplier",
      "/total",
    ]);
  });

  it("없어진 leaf 는 세지 않는다(값 쪽 pointer 만)", () => {
    const content = parseJson('{"supplier":"A"}');
    expect(changedLeafPointers(content, base).size).toBe(0);
  });
});

describe("isEmptyValue · emptyLeafPointers · emptyContainerPointers", () => {
  it("null·빈 문자열·공백 문자열만 빈 값이다", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue("")).toBe(true);
    expect(isEmptyValue(" \n\t")).toBe(true);
    expect(isEmptyValue("0")).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue(false)).toBe(false);
    expect(isEmptyValue(undefined)).toBe(false);
  });

  it("빈 leaf 는 배열 항목 안까지 pointer 로 모은다", () => {
    const content = {
      a: "",
      b: "x",
      c: null,
      items: [
        { qty: 1, name: " " },
        { qty: null, name: "y" },
      ],
    };
    expect([...emptyLeafPointers(content)].sort()).toEqual([
      "/a",
      "/c",
      "/items/0/name",
      "/items/1/qty",
    ]);
  });

  it("빈 배열·객체 컨테이너를 모으고 루트는 뺀다", () => {
    expect([
      ...emptyContainerPointers({ items: [], meta: {}, x: [1] }),
    ]).toEqual(["/items", "/meta"]);
    expect(emptyContainerPointers([]).size).toBe(0);
    expect([...emptyContainerPointers([{ tags: [] }])]).toEqual(["/0/tags"]);
  });
});

describe("changedContainerPointers", () => {
  const base = parseJson(
    '{"supplier":"A","meta":{},"lines":[{"qty":2},{"qty":3}],"tags":["x"]}',
  );

  it("항목을 모두 지운 배열은 바뀐 컨테이너다(leaf 로는 안 보인다)", () => {
    const content = parseJson(
      '{"supplier":"A","meta":{},"lines":[],"tags":["x"]}',
    );
    expect(changedLeafPointers(content, base).size).toBe(0);
    expect([...changedContainerPointers(content, base)]).toEqual(["/lines"]);
  });

  it("빈 객체를 채우면 그 객체, 바뀐 leaf 의 조상 컨테이너도 들어간다(루트 제외)", () => {
    const content = parseJson(
      '{"supplier":"A","meta":{"k":1},"lines":[{"qty":2},{"qty":4}],"tags":["x"]}',
    );
    expect([...changedContainerPointers(content, base)].sort()).toEqual([
      "/lines",
      "/lines/1",
      "/meta",
    ]);
  });

  it("변화가 없으면 비어 있다", () => {
    expect(changedContainerPointers(base, base).size).toBe(0);
    const reordered = parseJson(
      '{"tags":["x"],"lines":[{"qty":2},{"qty":3}],"meta":{},"supplier":"A"}',
    );
    expect(changedContainerPointers(reordered, base).size).toBe(0);
  });

  it("원본이 없으면 루트를 뺀 모든 컨테이너", () => {
    expect([...changedContainerPointers(base, undefined)].sort()).toEqual([
      "/lines",
      "/lines/0",
      "/lines/1",
      "/meta",
      "/tags",
    ]);
  });

  it("scalar 결과에는 컨테이너가 없다", () => {
    expect(changedContainerPointers(parseJson('"a"'), undefined).size).toBe(0);
  });
});

describe("firstLeafPointer", () => {
  it("객체 템플릿은 첫 필드 pointer", () => {
    expect(
      firstLeafPointer(["lines", "2"], parseJson('{"qty":null,"name":null}')),
    ).toBe("/lines/2/qty");
  });

  it("scalar 템플릿은 항목 pointer", () => {
    expect(firstLeafPointer(["tags", "1"], null)).toBe("/tags/1");
  });

  it("leaf 가 없는 템플릿(빈 객체·배열)은 항목 pointer", () => {
    expect(firstLeafPointer(["lines", "0"], parseJson("{}"))).toBe("/lines/0");
    expect(firstLeafPointer(["m", "0"], parseJson('{"a":[]}'))).toBe("/m/0");
  });

  it("중첩 템플릿은 깊은 첫 leaf, pointer 토큰은 이스케이프한다", () => {
    expect(firstLeafPointer(["a/b", "0"], parseJson('{"x":{"y~z":1}}'))).toBe(
      "/a~1b/0/x/y~0z",
    );
  });
});

describe("displayValue", () => {
  it("숫자 원문을 지키고 길면 자른다", () => {
    expect(displayValue(parseJson("12345678901234567890"))).toBe(
      "12345678901234567890",
    );
    expect(displayValue("abc")).toBe("abc");
    expect(displayValue(null)).toBe("null");
    expect(displayValue("x".repeat(70), 10)).toBe("xxxxxxxxx…");
  });

  it("아주 긴 문자열도 앞부분만 보고 자른다", () => {
    expect(displayValue("가".repeat(1_000_000), 5)).toBe("가가가가…");
    expect(displayValue("😀".repeat(20), 10)).toBe(`${"😀".repeat(9)}…`);
    expect(displayValue("😀".repeat(10), 10)).toBe("😀".repeat(10));
  });
});

describe("coerceNumber", () => {
  it("왕복되는 수는 number, 아니면 ExactNumber", () => {
    expect(coerceNumber(" 12.5 ", false)).toEqual({ ok: true, value: 12.5 });
    const big = coerceNumber("12345678901234567890", true);
    expect(big.ok && isExactNumber(big.value)).toBe(true);
    expect(big.ok && stringifyJson(big.value)).toBe("12345678901234567890");
    const precise = coerceNumber("1.50", false);
    expect(precise.ok && stringifyJson(precise.value)).toBe("1.50");
  });

  it("숫자가 아니거나 정수 schema 에 소수면 거부", () => {
    expect(coerceNumber("1,000", false)).toEqual({
      ok: false,
      reason: "invalid_number",
    });
    expect(coerceNumber("", false).ok).toBe(false);
    expect(coerceNumber("1.5", true)).toEqual({
      ok: false,
      reason: "not_integer",
    });
    expect(coerceNumber("1e3", true).ok).toBe(true);
  });
});

describe("fieldEntryIds", () => {
  it("같은 결과·경로의 값 변경 항목만", () => {
    const entries = [
      { kind: "set_value", id: "c1", resultId: "occ_1", path: ["a"] },
      { kind: "set_value", id: "c2", resultId: "occ_1", path: ["b"] },
      { kind: "set_label", id: "c3" },
      { kind: "set_value", id: "c4", resultId: "occ_1", path: ["a"] },
    ] as unknown as ChangeEntry[];
    expect(fieldEntryIds(entries, "occ_1", ["a"])).toEqual(["c1", "c4"]);
  });

  it("같은 경로의 하위 트리 교체는 넣고, 그 행을 만든 배열·키 추가는 뺀다", () => {
    const entries = [
      {
        kind: "insert_item",
        id: "c1",
        resultId: "occ_1",
        path: ["lines"],
        index: 0,
      },
      {
        kind: "set_value",
        id: "c2",
        resultId: "occ_1",
        path: ["lines", "0", "qty"],
      },
      {
        kind: "set_key",
        id: "c3",
        resultId: "occ_1",
        path: ["lines", "0"],
        key: "qty",
      },
      {
        kind: "replace_subtree",
        id: "c4",
        resultId: "occ_1",
        path: ["lines", "0", "qty"],
      },
      {
        kind: "set_value",
        id: "c5",
        resultId: "occ_2",
        path: ["lines", "0", "qty"],
      },
      { kind: "remove_key", id: "c6", resultId: "occ_1", path: [], key: "x" },
    ] as unknown as ChangeEntry[];
    expect(fieldEntryIds(entries, "occ_1", ["lines", "0", "qty"])).toEqual([
      "c2",
      "c4",
    ]);
  });
});

describe("lockReasonFor", () => {
  it("서버 상태가 먼저, 그다음 페이지 집합 변화", () => {
    expect(lockReasonFor(result("input_changed"), [])).toBe("input_changed");
    expect(lockReasonFor(result("present"), [change(true)])).toBe(
      "structure_changed",
    );
    expect(lockReasonFor(result("stale"), [change(false)])).toBeNull();
  });

  it("editable_states 가 있으면 그 목록으로 상태를 판단한다", () => {
    expect(lockReasonFor(result("stale"), [], ["present"])).toBe(
      "unsupported_state",
    );
    expect(lockReasonFor(result("present"), [change(true)], ["present"])).toBe(
      "structure_changed",
    );
    expect(lockReasonFor(result("present"), [], ["present"])).toBeNull();
  });
});

describe("lineColumn", () => {
  it("위치를 1 부터 센 줄·열로", () => {
    expect(lineColumn('{\n  "a": x\n}', 0)).toEqual({ line: 1, column: 1 });
    expect(lineColumn('{\n  "a": x\n}', 9)).toEqual({ line: 2, column: 8 });
    expect(lineColumn("ab", 99)).toEqual({ line: 1, column: 3 });
  });
});
