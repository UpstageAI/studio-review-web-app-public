import { describe, expect, it } from "vitest";
import type { SaveStatus } from "../job-review-state";
import {
  saveAndCompleteStep,
  type PendingComplete,
} from "../save-and-complete";

const idle: SaveStatus = { phase: "idle" };
const pending: PendingComplete = { requestKey: "job-1", from: idle };

function saved(
  overrides: Partial<Extract<SaveStatus, { phase: "saved" }>> = {},
) {
  return {
    phase: "saved",
    importId: "imp_1",
    revision: 2,
    partial: false,
    reloadFailed: null,
    ...overrides,
  } as const satisfies SaveStatus;
}

function step(
  save: SaveStatus,
  extra: Partial<{
    requestKey: string;
    changeCount: number;
    statusBusy: boolean;
  }> = {},
) {
  return saveAndCompleteStep(pending, {
    requestKey: "job-1",
    save,
    changeCount: 0,
    statusBusy: false,
    ...extra,
  });
}

describe("saveAndCompleteStep", () => {
  it("저장이 아직 시작되지 않았거나 진행 중이면 기다린다", () => {
    expect(step(idle)).toBe("wait");
    expect(step({ phase: "uploading" })).toBe("wait");
    expect(step({ phase: "polling", importId: "imp_1" })).toBe("wait");
    expect(
      step({
        phase: "reloading",
        importId: "imp_1",
        revision: 2,
        partial: false,
      }),
    ).toBe("wait");
  });

  it("모두 반영되고 다시 불러왔으면 완료로 이어 간다", () => {
    expect(step(saved())).toBe("complete");
  });

  it("반영 뒤에도 변경 정리나 검수 상태 요청이 남아 있으면 기다린다", () => {
    expect(step(saved(), { changeCount: 1 })).toBe("wait");
    expect(step(saved(), { statusBusy: true })).toBe("wait");
  });

  it("일부만 반영, 다시 불러오기 실패면 멈춘다", () => {
    expect(step(saved({ partial: true }))).toBe("stop");
    expect(step(saved({ reloadFailed: "network_error" }))).toBe("stop");
  });

  it("충돌, 실패, 검증 막힘, 변경 없음이면 멈춘다", () => {
    expect(
      step({
        phase: "conflict",
        importId: "imp_1",
        conflict: {} as Extract<SaveStatus, { phase: "conflict" }>["conflict"],
      }),
    ).toBe("stop");
    expect(
      step({
        phase: "failed",
        code: "network_error",
        importId: null,
        message: null,
        resultId: null,
        fieldPointer: null,
        entryIds: [],
      }),
    ).toBe("stop");
    expect(step({ phase: "blocked", reason: "issues" })).toBe("stop");
    expect(step({ phase: "no_change", importId: null })).toBe("stop");
  });

  it("다른 Job 으로 옮겼으면 멈춘다", () => {
    expect(step(saved(), { requestKey: "job-2" })).toBe("stop");
  });
});
