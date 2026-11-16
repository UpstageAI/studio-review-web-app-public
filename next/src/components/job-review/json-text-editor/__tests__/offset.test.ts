import { offsetOf } from "../offset";

const text = '{\n  "a": 1,\n  "b": 2\n}';

describe("offsetOf", () => {
  it("줄·열이 범위 안이면 그 자리", () => {
    expect(offsetOf(text, 1, 1)).toBe(0);
    expect(offsetOf(text, 2, 3)).toBe(4);
    expect(text[offsetOf(text, 3, 4)]).toBe("b");
  });

  it("열이 그 줄 길이를 넘으면 다음 줄로 넘어가지 않고 그 줄 끝", () => {
    // 2 번째 줄 `  "a": 1,` 은 9 자 — 끝은 줄바꿈 바로 앞.
    expect(offsetOf(text, 2, 50)).toBe(text.indexOf("\n", 2));
    expect(offsetOf(text, 4, 9)).toBe(text.length);
    expect(offsetOf(text, 1, 0)).toBe(0);
  });

  it("줄이 텍스트보다 많으면 텍스트 끝", () => {
    expect(offsetOf(text, 9, 1)).toBe(text.length);
    expect(offsetOf("", 3, 3)).toBe(0);
  });
});
