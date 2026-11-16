import {
  isRangeWithin,
  parsePositiveInt,
} from "@/components/studio-ui-kit/move-pages-dialog/numbers";

describe("isRangeWithin", () => {
  it("1-based 양끝 포함 범위", () => {
    expect(isRangeWithin(5, 1, 5)).toBe(true);
    expect(isRangeWithin(5, 2, 3)).toBe(true);
    expect(isRangeWithin(5, 5, 5)).toBe(true);
  });

  it("경계 밖·역순·정수 아님·빈 문서는 false", () => {
    expect(isRangeWithin(5, 0, 1)).toBe(false);
    expect(isRangeWithin(5, 1, 6)).toBe(false);
    expect(isRangeWithin(5, 3, 2)).toBe(false);
    expect(isRangeWithin(5, 1.5, 2)).toBe(false);
    expect(isRangeWithin(0, 1, 1)).toBe(false);
  });
});

describe("parsePositiveInt", () => {
  it("1 이상의 정수만(공백 허용)", () => {
    expect(parsePositiveInt("3")).toBe(3);
    expect(parsePositiveInt(" 12 ")).toBe(12);
    expect(parsePositiveInt("0")).toBeNull();
    expect(parsePositiveInt("-1")).toBeNull();
    expect(parsePositiveInt("1e3")).toBeNull();
    expect(parsePositiveInt("a")).toBeNull();
    expect(parsePositiveInt("")).toBeNull();
    expect(parsePositiveInt("1.5")).toBeNull();
  });
});
