import { describe, expect, it } from "vitest";

import {
  contentLeaves,
  type JsonValue,
  type Result,
  type ReviewStep,
  type SchemaNode,
} from "@/lib/review-model";
import {
  NO_FIELD_CHOICES,
  fieldHighlightFilter,
  isFieldPathShown,
  leafPointersInFields,
  parseFieldChoices,
  savedFieldsFor,
  stepFieldKeys,
  toggleField,
  topFieldKey,
  visibleFieldList,
  withErrorFields,
  withStepFields,
} from "../field-filter";
import {
  countHidden,
  visibleNodeSet,
  visiblePointerFor,
  NO_VALUE_FILTER,
} from "../value-filter";
import { emptyLeafPointers } from "../value-fields";

const SCHEMA: SchemaNode = {
  type: "object",
  properties: {
    amount: { type: "number", title: "Amount" },
    date: { type: "string" },
    vendor: { type: "string" },
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { name: { type: "string" }, price: { type: "number" } },
      },
    },
  },
};

function result(id: string, stepId: string, content: JsonValue): Result {
  return { id, step_id: stepId, content } as unknown as Result;
}

describe("parseFieldChoices", () => {
  it("없음, 깨진 JSON, 객체가 아닌 값은 고른 것 없음(공유 상수)", () => {
    expect(parseFieldChoices(null)).toBe(NO_FIELD_CHOICES);
    expect(parseFieldChoices("{oops")).toBe(NO_FIELD_CHOICES);
    expect(parseFieldChoices("[]")).toBe(NO_FIELD_CHOICES);
    expect(parseFieldChoices("null")).toBe(NO_FIELD_CHOICES);
    expect(parseFieldChoices('"amount"')).toBe(NO_FIELD_CHOICES);
    expect(parseFieldChoices('{"s1":"amount"}')).toBe(NO_FIELD_CHOICES);
  });

  it("배열인 Step 만 읽고 문자열이 아닌 값과 중복은 뺀다", () => {
    const choices = parseFieldChoices(
      '{"s1":["amount",1,"date","amount",null],"s2":true,"s3":[]}',
    );
    expect({ ...choices }).toEqual({ s1: ["amount", "date"], s3: [] });
  });

  it("`__proto__` Step id 도 프로토타입을 바꾸지 않고 키로 읽는다", () => {
    const choices = parseFieldChoices('{"__proto__":["amount"]}');
    expect(savedFieldsFor(choices, "__proto__")).toEqual(["amount"]);
    expect(Object.getPrototypeOf(choices)).toBeNull();
  });
});

describe("withStepFields", () => {
  it("Step 하나만 바꾸고 `null` 이면 지운다(원본은 그대로)", () => {
    const base = parseFieldChoices('{"s1":["amount"],"s2":["date"]}');
    const next = withStepFields(base, "s1", ["vendor", "date"]);
    expect(JSON.parse(JSON.stringify(next))).toEqual({
      s1: ["vendor", "date"],
      s2: ["date"],
    });
    expect(
      JSON.parse(JSON.stringify(withStepFields(next, "s1", null))),
    ).toEqual({ s2: ["date"] });
    expect(savedFieldsFor(base, "s1")).toEqual(["amount"]);
  });

  it("쓴 값을 다시 읽으면 같다", () => {
    const next = withStepFields(NO_FIELD_CHOICES, "s1", ["amount", "date"]);
    expect({ ...parseFieldChoices(JSON.stringify(next)) }).toEqual({
      s1: ["amount", "date"],
    });
  });
});

describe("stepFieldKeys", () => {
  it("schema 순서 뒤에 schema 에 없는 결과 키를 붙인다(래퍼는 벗긴다)", () => {
    expect(
      stepFieldKeys(SCHEMA, [
        [{ date: "2026-01-01", extra: 1, amount: 3 }],
        [{ other: true }],
      ]),
    ).toEqual(["amount", "date", "vendor", "items", "extra", "other"]);
  });

  it("schema 가 없으면 결과 키(처음 나온 순서)", () => {
    expect(
      stepFieldKeys(null, [
        { b: 1, a: 2 },
        { c: 3, a: 4 },
      ]),
    ).toEqual(["b", "a", "c"]);
  });

  it("맨 위가 객체인 결과가 없으면(판정, 루트 배열) 필드가 없다", () => {
    expect(stepFieldKeys({ type: "string" }, ["green"])).toEqual([]);
    expect(stepFieldKeys(SCHEMA, [])).toEqual([]);
    expect(
      stepFieldKeys({ type: "array", items: { type: "object" } }, [[{ a: 1 }]]),
    ).toEqual([]);
  });
});

describe("visibleFieldList", () => {
  const available = ["amount", "date", "vendor", "items"];

  it("저장이 없으면 모두 보임", () => {
    expect(visibleFieldList(available, undefined)).toBeNull();
  });

  it("저장한 순서와 무관하게 필드 순서로, 없어진 키는 무시한다", () => {
    expect(visibleFieldList(available, ["vendor", "gone", "amount"])).toEqual([
      "amount",
      "vendor",
    ]);
  });

  it("남는 키가 없거나 모든 필드가 남으면 모두 보임", () => {
    expect(visibleFieldList(available, [])).toBeNull();
    expect(visibleFieldList(available, ["gone"])).toBeNull();
    expect(visibleFieldList(available, [...available, "gone"])).toBeNull();
  });
});

describe("toggleField", () => {
  const available = ["amount", "date", "vendor"];

  it("모두 보일 때 하나를 끄면 나머지가 남는다", () => {
    expect(toggleField(available, null, "date", false)).toEqual([
      "amount",
      "vendor",
    ]);
  });

  it("다시 켜서 모두 보이게 되면 `null`", () => {
    expect(toggleField(available, ["amount", "vendor"], "date", true)).toBe(
      null,
    );
  });

  it("켠 키는 필드 순서에 맞춰 넣는다", () => {
    expect(toggleField(available, ["vendor"], "amount", true)).toEqual([
      "amount",
      "vendor",
    ]);
  });

  it("마지막 남은 필드는 끄지 않는다", () => {
    expect(toggleField(available, ["date"], "date", false)).toEqual(["date"]);
  });
});

describe("topFieldKey, isFieldPathShown", () => {
  it("래퍼가 있으면 두 번째 토큰, 없으면 첫 토큰. 루트는 `null`", () => {
    expect(topFieldKey(["0", "items", "2", "name"], true)).toBe("items");
    expect(topFieldKey(["0"], true)).toBeNull();
    expect(topFieldKey([], true)).toBeNull();
    expect(topFieldKey(["amount"], false)).toBe("amount");
    expect(topFieldKey([], false)).toBeNull();
  });

  it("고른 필드와 그 아래, 루트만 보인다", () => {
    const shown = new Set(["amount"]);
    expect(isFieldPathShown(shown, ["0", "amount"], true)).toBe(true);
    expect(isFieldPathShown(shown, ["0", "items", "0", "name"], true)).toBe(
      false,
    );
    expect(isFieldPathShown(shown, ["0"], true)).toBe(true);
    expect(isFieldPathShown(null, ["0", "items"], true)).toBe(true);
  });
});

describe("withErrorFields", () => {
  it("저장을 막는 오류가 있는 숨긴 필드를 더하고 경고는 무시한다", () => {
    const shown = new Set(["amount"]);
    const out = withErrorFields(
      shown,
      new Map([
        ["/0/items/1/price", { severity: "error" as const }],
        ["/0/vendor", { severity: "warning" as const }],
        ["/0", { severity: "error" as const }],
      ]),
      true,
    );
    expect(out && [...out].sort()).toEqual(["amount", "items"]);
    expect(shown.has("items")).toBe(false);
  });

  it("더할 것이 없으면 같은 집합, 고른 필드가 없으면 `null`", () => {
    const shown = new Set(["amount"]);
    const errors = new Map([["/amount", { severity: "error" as const }]]);
    expect(withErrorFields(shown, errors, false)).toBe(shown);
    expect(withErrorFields(null, errors, false)).toBeNull();
  });
});

describe("필드와 값 필터 함께 쓰기", () => {
  const content: JsonValue = [
    {
      amount: 10,
      date: "",
      vendor: "",
      items: [{ name: "", price: 1 }],
    },
  ];
  const leaves = contentLeaves(content);

  it("보이는 필드의 leaf 만 값 필터에 넘기고 숨김 수도 그 안에서 센다", () => {
    const shown = new Set(["amount", "date"]);
    const pointers = leafPointersInFields(leaves, shown, true);
    expect(pointers).toEqual(["/0/amount", "/0/date"]);
    const empty = emptyLeafPointers(content);
    const visible = visiblePointerFor({
      filter: { ...NO_VALUE_FILTER, emptyOnly: true },
      changed: new Set(),
      empty,
      highlights: new Map(),
      pageIndex: -1,
    });
    expect(visible).toBeDefined();
    const nodes = visibleNodeSet(pointers, visible!);
    expect([...nodes].sort()).toEqual(["/0", "/0/date"]);
    // 숨긴 필드(vendor, items)의 빈 값은 "n개 숨김" 에 들어가지 않는다.
    expect(countHidden(pointers, pointer => nodes.has(pointer))).toBe(1);
  });

  it("필드를 고르지 않으면 모든 leaf", () => {
    expect(leafPointersInFields(leaves, null, true)).toEqual([
      "/0/amount",
      "/0/date",
      "/0/vendor",
      "/0/items/0/name",
      "/0/items/0/price",
    ]);
  });
});

describe("fieldHighlightFilter", () => {
  const steps = {
    s1: { config_id: "c", name: "Extract", type: "x", schema: SCHEMA },
    s2: { config_id: "c", name: "Other", type: "x" },
  } as unknown as Record<string, ReviewStep>;
  const results = [
    result("r1", "s1", [{ amount: 1, date: "d", items: [{ name: "a" }] }]),
    result("r2", "s2", { amount: 1, note: "n" }),
  ];

  it("고른 필드가 없으면 거르지 않는다", () => {
    expect(fieldHighlightFilter(results, steps, NO_FIELD_CHOICES)).toBeNull();
    // 이 Job 에 없는 Step 과 모든 필드를 고른 Step 만 있으면 거를 것이 없다.
    expect(
      fieldHighlightFilter(
        results,
        steps,
        parseFieldChoices('{"gone":["amount"],"s2":["amount","note"]}'),
      ),
    ).toBeNull();
  });

  it("숨긴 필드의 추출값만 빼고 다른 Step 과 pointer 없는 하이라이트는 둔다", () => {
    const keep = fieldHighlightFilter(
      results,
      steps,
      parseFieldChoices('{"s1":["amount"]}'),
    );
    expect(keep).not.toBeNull();
    const ids = [
      { id: "r1#/0/amount", pointer: "/0/amount" },
      { id: "r1#/0/date", pointer: "/0/date" },
      { id: "r1#/0/items/0/name", pointer: "/0/items/0/name" },
      { id: "r2#/note", pointer: "/note" },
      { id: "parse-element-1" },
      { id: "unknown#/date", pointer: "/date" },
    ]
      .filter(keep!)
      .map(highlight => highlight.id);
    expect(ids).toEqual([
      "r1#/0/amount",
      "r2#/note",
      "parse-element-1",
      "unknown#/date",
    ]);
  });
});
