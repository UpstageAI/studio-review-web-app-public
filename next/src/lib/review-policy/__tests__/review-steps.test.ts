import { describe, expect, it } from "vitest";
import {
  REVIEW_STEP_DEFAULTS,
  filterStepTabs,
  parseReviewSteps,
} from "../review-steps";

const tab = (id: string, type: string) => ({ id, type });

describe("parseReviewSteps", () => {
  it("저장된 값이 없으면 보기 전용 단계(Parse, Instruct)만 끈 기본값이다", () => {
    expect(parseReviewSteps(null)).toEqual(REVIEW_STEP_DEFAULTS);
    expect(REVIEW_STEP_DEFAULTS.parse).toBe(false);
    expect(REVIEW_STEP_DEFAULTS.instruct).toBe(false);
    expect(REVIEW_STEP_DEFAULTS.extract).toBe(true);
  });

  it("저장된 종류만 덮고 깨진 값은 기본값으로 둔다", () => {
    expect(parseReviewSteps('{"parse":true,"extract":false}')).toEqual({
      ...REVIEW_STEP_DEFAULTS,
      parse: true,
      extract: false,
    });
    expect(parseReviewSteps("{oops")).toEqual(REVIEW_STEP_DEFAULTS);
    expect(parseReviewSteps("[1]")).toEqual(REVIEW_STEP_DEFAULTS);
  });
});

describe("filterStepTabs 로 탭 고르기", () => {
  const tabs = [
    tab("p", "document-parse"),
    tab("c", "document-classify"),
    tab("e", "information-extract"),
    tab("i", "instruct"),
    tab("x", "custom-step"),
  ];

  it("끈 종류의 탭을 빼고, 모르는 종류는 남긴다", () => {
    expect(
      filterStepTabs(tabs, REVIEW_STEP_DEFAULTS).tabs.map(item => item.id),
    ).toEqual(["c", "e", "x"]);
  });

  it("남는 탭이 없으면 모든 탭을 그대로 돌려준다", () => {
    const only = [tab("p", "document-parse"), tab("i", "instruct")];
    expect(filterStepTabs(only, REVIEW_STEP_DEFAULTS).tabs).toEqual(only);
  });
});

describe("filterStepTabs", () => {
  it("켠 단계가 하나도 없으면 모든 탭과 fallback 을 돌려준다", () => {
    const only = [tab("p", "document-parse"), tab("i", "instruct")];
    expect(filterStepTabs(only, REVIEW_STEP_DEFAULTS)).toEqual({
      tabs: only,
      fallback: true,
    });
    expect(
      filterStepTabs([tab("c", "document-classify")], REVIEW_STEP_DEFAULTS),
    ).toEqual({ tabs: [tab("c", "document-classify")], fallback: false });
    expect(filterStepTabs([], REVIEW_STEP_DEFAULTS)).toEqual({
      tabs: [],
      fallback: false,
    });
  });
});
