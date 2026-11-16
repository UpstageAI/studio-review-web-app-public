import { describe, expect, it } from "vitest";

import { LOCKED_RESULT_STATES } from "../diff";
import {
  isClassifyStepType,
  isExtractStepType,
  isMergeStepType,
  isParseStepType,
  isValidateStepType,
  stepDisplayName,
  stepTypeKey,
} from "../step-names";
import { isVerdictValue } from "../validate";

describe("stepTypeKey", () => {
  it("응답·카탈로그 타입을 배지 키로 바꾼다", () => {
    expect(stepTypeKey("document-parse")).toBe("parse");
    expect(stepTypeKey("document-classify")).toBe("classify");
    expect(stepTypeKey("document-split")).toBe("split");
    expect(stepTypeKey("split")).toBe("split");
    expect(stepTypeKey("information-extract")).toBe("extract");
    expect(stepTypeKey("instruct")).toBe("instruct");
    expect(stepTypeKey("instruct-generate")).toBe("instruct");
    for (const type of ["validate", "match", "merge", "export"]) {
      expect(stepTypeKey(type)).toBe(type);
    }
  });

  it("모르는 타입은 null", () => {
    expect(stepTypeKey("custom-step")).toBeNull();
    expect(stepTypeKey("")).toBeNull();
    expect(stepTypeKey("toString")).toBeNull();
  });
});

describe("stepDisplayName", () => {
  it("타입에 맞는 접두사를 뗀다", () => {
    const cases: [string, string][] = [
      ["document-classify", "Classify - 진료비영수증 분류"],
      ["information-extract", "Information Extract - 영수증"],
      ["instruct", "Instruct - 요약"],
      ["instruct-generate", "Instruct - 요약"],
      ["validate", "Validate - 금액 검증"],
      ["export", "Export - 내보내기"],
      ["match", "Match - 대조"],
    ];
    expect(
      cases.map(([type, name]) => stepDisplayName({ name, type })),
    ).toEqual([
      "진료비영수증 분류",
      "영수증",
      "요약",
      "요약",
      "금액 검증",
      "내보내기",
      "대조",
    ]);
  });

  it("타입이 다른 접두사는 그대로 둔다", () => {
    expect(
      stepDisplayName({ name: "Classify - 분류", type: "information-extract" }),
    ).toBe("Classify - 분류");
  });

  it("위치 이름은 null", () => {
    for (const name of [
      "step_2_classify",
      "step_3_information-extract",
      "step_10_validate",
      "step_1_document-parse",
    ]) {
      expect(stepDisplayName({ name, type: "document-classify" })).toBeNull();
    }
    expect(
      stepDisplayName({ name: "step_2_Classify", type: "document-classify" }),
    ).toBe("step_2_Classify");
  });

  it("접두사만 있는 이름은 원래 이름", () => {
    expect(
      stepDisplayName({
        name: "Information Extract - ",
        type: "information-extract",
      }),
    ).toBe("Information Extract - ");
  });

  it("merge 는 원래 이름", () => {
    expect(stepDisplayName({ name: "Merge - 합계", type: "merge" })).toBe(
      "Merge - 합계",
    );
  });

  it("customName 이 공백이 아니면 우선한다", () => {
    const step = { name: "step_2_classify", type: "document-classify" };
    expect(stepDisplayName({ ...step, customName: "내 분류" })).toBe("내 분류");
    expect(stepDisplayName({ ...step, customName: "  " })).toBeNull();
    expect(stepDisplayName({ ...step, customName: null })).toBeNull();
    expect(stepDisplayName({ ...step, customName: undefined })).toBeNull();
  });
});

describe("Step 타입 술어", () => {
  const cases: readonly [
    string,
    (type: unknown) => boolean,
    string,
    readonly string[],
  ][] = [
    [
      "isClassifyStepType",
      isClassifyStepType,
      "document-classify",
      ["classify"],
    ],
    ["isValidateStepType", isValidateStepType, "validate", ["Validate"]],
    ["isMergeStepType", isMergeStepType, "merge", ["Merge"]],
    [
      "isExtractStepType",
      isExtractStepType,
      "information-extract",
      ["extract"],
    ],
    ["isParseStepType", isParseStepType, "document-parse", ["parse"]],
  ];

  it.each(cases)("%s 는 긴 이름만 정확히 맞춘다", (_, is, full, aliases) => {
    expect(is(full)).toBe(true);
    for (const alias of aliases) expect(is(alias)).toBe(false);
    expect(is(` ${full}`)).toBe(false);
    expect(is(null)).toBe(false);
    expect(is(undefined)).toBe(false);
    expect(is("")).toBe(false);
  });

  it("서로 다른 Step 을 맞추지 않는다", () => {
    for (const [, is, full] of cases) {
      const hits = cases.filter(([, other]) => other(full));
      expect(hits.map(([, other]) => other)).toEqual([is]);
    }
  });
});

describe("isVerdictValue · LOCKED_RESULT_STATES", () => {
  it("판정값 세 개만 받는다", () => {
    for (const value of ["green", "yellow", "red"]) {
      expect(isVerdictValue(value)).toBe(true);
    }
    for (const value of ["Green", "", "unknown", null, undefined, 1, {}]) {
      expect(isVerdictValue(value)).toBe(false);
    }
  });

  it("이유 이름이 따로 있는 잠금 상태", () => {
    expect(LOCKED_RESULT_STATES).toEqual([
      "input_changed",
      "unlinked",
      "missing",
    ]);
  });
});
