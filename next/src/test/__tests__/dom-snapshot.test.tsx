import { describe, expect, it } from "vitest";
import { snapshotHtml } from "../dom-snapshot";

describe("snapshotHtml", () => {
  it("개행·탭·CR 을 뺀 C0 제어 문자를 \\uXXXX 글자 표기로 바꾼다", () => {
    const element = document.createElement("div");
    element.setAttribute("data-value", "\u0000none");
    element.textContent = "a\u0001b\u001fc\td\ne";
    expect(snapshotHtml(element)).toBe(
      '<div data-value="\\u0000none">a\\u0001b\\u001fc\td\ne</div>',
    );
  });
});
