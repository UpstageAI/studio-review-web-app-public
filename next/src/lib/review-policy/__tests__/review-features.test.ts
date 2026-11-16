import { describe, expect, it } from "vitest";
import {
  REVIEW_FEATURE_DEFAULTS,
  parseReviewFeatures,
} from "../review-features";

describe("parseReviewFeatures", () => {
  it("저장된 값이 없으면 페이지 썸네일만 켜진 기본값이다", () => {
    // 기본값 상수와 비교하면 기본값이 바뀌어도 잡지 못하므로 리터럴로 고정한다.
    expect(parseReviewFeatures(null)).toEqual({
      pageTools: false,
      filmstrip: true,
      organizer: false,
      jsonMenu: false,
      history: false,
    });
  });

  it("저장된 기능만 덮고 나머지는 기본값이다", () => {
    expect(parseReviewFeatures('{"organizer":true}')).toEqual({
      ...REVIEW_FEATURE_DEFAULTS,
      organizer: true,
    });
  });

  it("모르는 기능과 참거짓이 아닌 값은 무시한다", () => {
    // 참거짓이 아닌 "filmstrip" 은 무시되어 기본값(켜짐)이 그대로 남는다.
    expect(
      parseReviewFeatures('{"filmstrip":"yes","unknown":true,"jsonMenu":true}'),
    ).toEqual({ ...REVIEW_FEATURE_DEFAULTS, jsonMenu: true });
  });

  it("깨진 값은 기본값으로 둔다", () => {
    expect(parseReviewFeatures("{not json")).toEqual(REVIEW_FEATURE_DEFAULTS);
    expect(parseReviewFeatures("[true]")).toEqual(REVIEW_FEATURE_DEFAULTS);
    expect(parseReviewFeatures("true")).toEqual(REVIEW_FEATURE_DEFAULTS);
  });
});
