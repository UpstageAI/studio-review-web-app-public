import {
  clampIndex,
  indexAtRatio,
  mergeMarks,
  parsePageInput,
  ratioOfIndex,
  stepIndex,
  type PageMark,
} from "@/components/studio-ui-kit/page-position-bar/position";

describe("clampIndex", () => {
  it("범위 안으로 자르고, 페이지가 없거나 숫자가 아니면 0", () => {
    expect(clampIndex(5, 10)).toBe(5);
    expect(clampIndex(-1, 10)).toBe(0);
    expect(clampIndex(10, 10)).toBe(9);
    expect(clampIndex(3.7, 10)).toBe(3);
    expect(clampIndex(Number.NaN, 10)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
  });
});

describe("parsePageInput", () => {
  it("1-based 정수를 뷰어 위치로 바꾸고 공백을 무시한다", () => {
    expect(parsePageInput("1", 200)).toBe(0);
    expect(parsePageInput(" 200 ", 200)).toBe(199);
    expect(parsePageInput("087", 200)).toBe(86);
  });

  it("범위 밖·정수 아님·빈 값은 null", () => {
    expect(parsePageInput("0", 200)).toBeNull();
    expect(parsePageInput("201", 200)).toBeNull();
    expect(parsePageInput("-3", 200)).toBeNull();
    expect(parsePageInput("1.5", 200)).toBeNull();
    expect(parsePageInput("1e2", 200)).toBeNull();
    expect(parsePageInput("abc", 200)).toBeNull();
    expect(parsePageInput("", 200)).toBeNull();
    expect(parsePageInput("1", 0)).toBeNull();
  });
});

describe("ratioOfIndex · indexAtRatio", () => {
  it("왕복하면 같은 위치가 된다", () => {
    for (const count of [1, 2, 3, 7, 13, 200]) {
      for (let index = 0; index < count; index += 1) {
        expect(indexAtRatio(ratioOfIndex(index, count), count)).toBe(index);
      }
    }
  });

  it("비율은 칸 가운데를 가리키고 양끝은 0·1 안쪽이다", () => {
    expect(ratioOfIndex(0, 4)).toBeCloseTo(0.125);
    expect(ratioOfIndex(3, 4)).toBeCloseTo(0.875);
    expect(ratioOfIndex(9, 4)).toBeCloseTo(0.875);
  });

  it("count 가 1 이하면 비율 0.5·위치 0", () => {
    expect(ratioOfIndex(0, 1)).toBe(0.5);
    expect(ratioOfIndex(0, 0)).toBe(0);
    expect(indexAtRatio(0.9, 1)).toBe(0);
    expect(indexAtRatio(0.2, 0)).toBe(0);
  });

  it("비율이 범위를 벗어나거나 숫자가 아니면 양끝·0", () => {
    expect(indexAtRatio(-0.5, 10)).toBe(0);
    expect(indexAtRatio(1, 10)).toBe(9);
    expect(indexAtRatio(1.7, 10)).toBe(9);
    expect(indexAtRatio(Number.NaN, 10)).toBe(0);
    expect(indexAtRatio(0.5, 10)).toBe(5);
  });
});

describe("stepIndex", () => {
  it("화살표는 한 쪽(오른쪽·아래 = 다음), PageUp·PageDown 은 10 쪽, Home·End 는 양끝", () => {
    expect(stepIndex(5, 200, "ArrowRight")).toBe(6);
    expect(stepIndex(5, 200, "ArrowDown")).toBe(6);
    expect(stepIndex(5, 200, "ArrowLeft")).toBe(4);
    expect(stepIndex(5, 200, "ArrowUp")).toBe(4);
    expect(stepIndex(5, 200, "PageDown")).toBe(15);
    expect(stepIndex(25, 200, "PageUp")).toBe(15);
    expect(stepIndex(5, 200, "Home")).toBe(0);
    expect(stepIndex(5, 200, "End")).toBe(199);
    expect(stepIndex(5, 200, "PageDown", 25)).toBe(30);
  });

  it("경계에서는 양끝으로 자른다", () => {
    expect(stepIndex(0, 200, "ArrowLeft")).toBe(0);
    expect(stepIndex(199, 200, "ArrowRight")).toBe(199);
    expect(stepIndex(3, 200, "PageUp")).toBe(0);
    expect(stepIndex(195, 200, "PageDown")).toBe(199);
  });

  it("모르는 키·페이지 없음은 null", () => {
    expect(stepIndex(5, 200, "a")).toBeNull();
    expect(stepIndex(5, 200, "Enter")).toBeNull();
    expect(stepIndex(5, 200, "Tab")).toBeNull();
    expect(stepIndex(0, 0, "ArrowRight")).toBeNull();
  });
});

describe("mergeMarks", () => {
  it("종류별 연속 구간을 합치고 noImage → issue → changed 순으로 돌려준다", () => {
    const marks: PageMark[] = [
      { index: 3, kind: "changed" },
      { index: 1, kind: "changed" },
      { index: 2, kind: "changed" },
      { index: 7, kind: "changed" },
      { index: 4, kind: "issue" },
      { index: 10, kind: "noImage" },
      { index: 11, kind: "noImage" },
      { index: 12, kind: "noImage" },
    ];
    expect(mergeMarks(marks, 20)).toEqual([
      { kind: "noImage", start: 10, end: 12 },
      { kind: "issue", start: 4, end: 4 },
      { kind: "changed", start: 1, end: 3 },
      { kind: "changed", start: 7, end: 7 },
    ]);
  });

  it("같은 위치의 중복은 하나로, 범위 밖·정수 아닌 위치는 버린다", () => {
    const marks: PageMark[] = [
      { index: 2, kind: "issue" },
      { index: 2, kind: "issue" },
      { index: -1, kind: "issue" },
      { index: 20, kind: "issue" },
      { index: 1.5, kind: "issue" },
    ];
    expect(mergeMarks(marks, 20)).toEqual([
      { kind: "issue", start: 2, end: 2 },
    ]);
  });

  it("전부 이미지 없음이면 구간 하나", () => {
    const marks = Array.from({ length: 200 }, (_, index) => ({
      index,
      kind: "noImage" as const,
    }));
    expect(mergeMarks(marks, 200)).toEqual([
      { kind: "noImage", start: 0, end: 199 },
    ]);
  });

  it("표식이 없으면 빈 배열", () => {
    expect(mergeMarks([], 10)).toEqual([]);
  });
});
