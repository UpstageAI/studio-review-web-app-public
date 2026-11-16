import { describe, expect, it } from "vitest";

import { isNewTabClick } from "../links";

const plain = {
  button: 0,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
};

describe("isNewTabClick", () => {
  it("수정 키 없는 왼쪽 단추 클릭은 이 탭에서 이동한다", () => {
    expect(isNewTabClick(plain)).toBe(false);
  });

  it("가운데 단추나 ⌘·Ctrl·Shift·Alt 를 누른 클릭은 새 탭·새 창이다", () => {
    expect(isNewTabClick({ ...plain, button: 1 })).toBe(true);
    expect(isNewTabClick({ ...plain, metaKey: true })).toBe(true);
    expect(isNewTabClick({ ...plain, ctrlKey: true })).toBe(true);
    expect(isNewTabClick({ ...plain, shiftKey: true })).toBe(true);
    expect(isNewTabClick({ ...plain, altKey: true })).toBe(true);
  });
});
