import { describe, expect, it } from "vitest";
import { isSaving, type SaveStatus } from "../job-review-state";
import { saveReadiness, type SaveReadiness } from "../save-readiness";

const idle: SaveStatus = { phase: "idle" };
const uploading: SaveStatus = { phase: "uploading" };
const conflict = {
  phase: "conflict",
  importId: "imp_1",
  conflict: {},
} as unknown as SaveStatus;

/** 헤더 저장 버튼·⌘S 의 조합: 차단 문제를 보지 않는다. */
function headerCanSave(r: SaveReadiness) {
  return r.hasChanges && !r.saving && !r.conflicted;
}

/** 트레이 저장 버튼의 조합: 차단 문제가 있으면 끈다. */
function trayCanSave(r: SaveReadiness) {
  return r.hasChanges && !r.saving && !r.blocking && !r.conflicted;
}

describe("saveReadiness", () => {
  it("변경 수·저장 상태·차단 여부를 부품으로 돌려준다", () => {
    expect(
      saveReadiness({ changeCount: 0, save: idle, saving: false }),
    ).toEqual({
      hasChanges: false,
      saving: false,
      conflicted: false,
      blocking: false,
    });
    expect(
      saveReadiness({
        changeCount: 2,
        save: conflict,
        saving: false,
        blocking: true,
      }),
    ).toEqual({
      hasChanges: true,
      saving: false,
      conflicted: true,
      blocking: true,
    });
  });

  it("saving 은 받은 값을 그대로 쓴다", () => {
    expect(
      saveReadiness({
        changeCount: 1,
        save: uploading,
        saving: isSaving(uploading),
      }).saving,
    ).toBe(true);
    expect(
      saveReadiness({ changeCount: 1, save: idle, saving: false }).saving,
    ).toBe(false);
  });

  it("blocking 을 주지 않으면 false 다", () => {
    expect(
      saveReadiness({ changeCount: 1, save: idle, saving: false }).blocking,
    ).toBe(false);
  });

  describe("진리표(변경 × 저장 중 × 충돌 × 차단)", () => {
    const cases: Array<[number, boolean, boolean, boolean]> = [];
    for (const changeCount of [0, 3])
      for (const saving of [false, true])
        for (const conflicted of [false, true])
          for (const blocking of [false, true])
            cases.push([changeCount, saving, conflicted, blocking]);

    it.each(cases)(
      "변경 %i · 저장 중 %s · 충돌 %s · 차단 %s",
      (changeCount, saving, conflicted, blocking) => {
        const r = saveReadiness({
          changeCount,
          save: conflicted ? conflict : saving ? uploading : idle,
          saving,
          blocking,
        });
        expect(r).toEqual({
          hasChanges: changeCount > 0,
          saving,
          conflicted,
          blocking,
        });
        expect(headerCanSave(r)).toBe(
          changeCount > 0 && !saving && !conflicted,
        );
        expect(trayCanSave(r)).toBe(
          changeCount > 0 && !saving && !conflicted && !blocking,
        );
      },
    );
  });

  it("헤더식은 blocking 이 true 여도 참이다", () => {
    const r = saveReadiness({
      changeCount: 3,
      save: idle,
      saving: false,
      blocking: true,
    });
    expect(headerCanSave(r)).toBe(true);
  });

  it("트레이식은 blocking 이 true 면 거짓이다", () => {
    const r = saveReadiness({
      changeCount: 3,
      save: idle,
      saving: false,
      blocking: true,
    });
    expect(trayCanSave(r)).toBe(false);
  });
});
