import { describe, expect, it } from "vitest";
import { reviewShortcutOf, type ShortcutKeyEvent } from "../review-shortcuts";

function key(overrides: Partial<ShortcutKeyEvent>): ShortcutKeyEvent {
  return {
    key: "",
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...overrides,
  };
}

const outside = { inDialog: false };

describe("reviewShortcutOf", () => {
  it("⌘S 와 Ctrl+S 는 저장", () => {
    expect(reviewShortcutOf(key({ key: "s", metaKey: true }), outside)).toBe(
      "save",
    );
    expect(reviewShortcutOf(key({ key: "S", ctrlKey: true }), outside)).toBe(
      "save",
    );
  });

  it("⌘Enter 와 Ctrl+Enter 는 주 동작", () => {
    expect(
      reviewShortcutOf(key({ key: "Enter", metaKey: true }), outside),
    ).toBe("complete");
    expect(
      reviewShortcutOf(key({ key: "Enter", ctrlKey: true }), outside),
    ).toBe("complete");
  });

  it("수정 키가 없거나 Shift·Alt 가 섞이면 무시", () => {
    expect(reviewShortcutOf(key({ key: "s" }), outside)).toBeNull();
    expect(
      reviewShortcutOf(
        key({ key: "s", metaKey: true, shiftKey: true }),
        outside,
      ),
    ).toBeNull();
    expect(
      reviewShortcutOf(
        key({ key: "Enter", ctrlKey: true, altKey: true }),
        outside,
      ),
    ).toBeNull();
  });

  it("입력 요소가 이미 처리했거나 조합 중이면 무시", () => {
    expect(
      reviewShortcutOf(
        key({ key: "Enter", metaKey: true, defaultPrevented: true }),
        outside,
      ),
    ).toBeNull();
    expect(
      reviewShortcutOf(
        key({ key: "s", metaKey: true, isComposing: true }),
        outside,
      ),
    ).toBeNull();
  });

  it("대화상자 안에서는 저장만 받고 주 동작은 받지 않는다", () => {
    const inside = { inDialog: true };
    expect(reviewShortcutOf(key({ key: "s", metaKey: true }), inside)).toBe(
      "save",
    );
    expect(
      reviewShortcutOf(key({ key: "Enter", metaKey: true }), inside),
    ).toBeNull();
  });

  it("입력칸 안에서는 저장만 받고 주 동작은 받지 않는다", () => {
    const editing = { inDialog: false, inEditable: true };
    expect(reviewShortcutOf(key({ key: "s", metaKey: true }), editing)).toBe(
      "save",
    );
    expect(
      reviewShortcutOf(key({ key: "Enter", ctrlKey: true }), editing),
    ).toBeNull();
  });
});
