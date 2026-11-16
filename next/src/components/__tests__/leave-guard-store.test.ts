import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmAppLeave,
  getLeaveGuard,
  needsLeaveConfirm,
  publishLeaveGuard,
} from "../leave-guard-store";

// 확인 창 host 가 마운트되지 않은 환경이라 `@/lib/leave-confirm` 은 브라우저 기본 확인 창으로 답한다.
describe("leave-guard-store", () => {
  const disposers: (() => void)[] = [];
  const publish = (dirty: boolean, message = "leave?") => {
    const dispose = publishLeaveGuard({ dirty, message });
    disposers.push(dispose);
    return dispose;
  };

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.unstubAllGlobals();
  });

  it("올린 상태가 없으면 묻지 않고 떠난다", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    expect(getLeaveGuard()).toBeNull();
    expect(needsLeaveConfirm()).toBe(false);
    await expect(confirmAppLeave()).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("변경이 없으면 묻지 않는다", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    publish(false);
    expect(needsLeaveConfirm()).toBe(false);
    await expect(confirmAppLeave()).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("변경이 있으면 올린 문구로 묻고 그 답을 따른다", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    publish(true, "저장하지 않은 변경이 있습니다");
    expect(needsLeaveConfirm()).toBe(true);
    await expect(confirmAppLeave()).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith("저장하지 않은 변경이 있습니다");
    confirm.mockReturnValue(true);
    await expect(confirmAppLeave()).resolves.toBe(true);
  });

  it("지난 상태를 지워도 새로 올린 상태는 남는다", () => {
    const disposeOld = publish(true, "old");
    publish(false, "new");
    disposeOld();
    expect(getLeaveGuard()).toEqual({ dirty: false, message: "new" });
  });

  it("최신 상태를 지우면 비워진다", () => {
    const dispose = publish(true);
    dispose();
    expect(getLeaveGuard()).toBeNull();
    expect(needsLeaveConfirm()).toBe(false);
  });
});
