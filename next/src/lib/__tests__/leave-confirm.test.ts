import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmLeave,
  getLeaveConfirmRequest,
  registerLeaveConfirmHost,
  requestLeaveConfirm,
  settleLeaveConfirm,
  subscribeLeaveConfirm,
} from "../leave-confirm";

describe("leave-confirm", () => {
  const disposers: (() => void)[] = [];
  const host = () => {
    const dispose = registerLeaveConfirmHost();
    disposers.push(dispose);
    return dispose;
  };
  const opened = () => {
    const request = getLeaveConfirmRequest();
    if (!request) throw new Error("열린 요청이 없다");
    return request;
  };

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
    vi.unstubAllGlobals();
  });

  it("host 가 없으면 브라우저 기본 확인 창의 답을 따른다", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    await expect(confirmLeave(true, "leave?")).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith("leave?");
    confirm.mockReturnValue(true);
    await expect(requestLeaveConfirm("again?")).resolves.toBe(true);
    expect(getLeaveConfirmRequest()).toBeNull();
  });

  it("변경이 없으면 묻지 않고 요청도 만들지 않는다", async () => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("window", { confirm });
    host();
    await expect(confirmLeave(false, "leave?")).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
    expect(getLeaveConfirmRequest()).toBeNull();
  });

  it("host 가 있으면 요청을 올리고 답할 때 resolve 한다", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal("window", { confirm });
    host();
    const listener = vi.fn();
    const unsubscribe = subscribeLeaveConfirm(listener);
    const answer = requestLeaveConfirm("reload?", {
      title: "Reload",
      confirmLabel: "Reload now",
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledTimes(1);
    const request = opened();
    expect(request).toMatchObject({
      message: "reload?",
      title: "Reload",
      confirmLabel: "Reload now",
    });
    // 답하기 전에는 같은 스냅샷을 돌려준다(useSyncExternalStore).
    expect(getLeaveConfirmRequest()).toBe(request);
    settleLeaveConfirm(request.id, true);
    await expect(answer).resolves.toBe(true);
    expect(getLeaveConfirmRequest()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("겹친 요청은 앞 요청을 머무르기로 닫고 새 요청으로 바꾼다", async () => {
    host();
    const first = requestLeaveConfirm("first");
    const firstId = opened().id;
    const second = requestLeaveConfirm("second");
    await expect(first).resolves.toBe(false);
    expect(opened().message).toBe("second");
    // 지난 요청 id 로 답해도 지금 요청은 그대로다.
    settleLeaveConfirm(firstId, true);
    expect(opened().message).toBe("second");
    settleLeaveConfirm(opened().id, true);
    await expect(second).resolves.toBe(true);
  });

  it("이미 답한 요청에 다시 답해도 무시한다", async () => {
    host();
    const answer = requestLeaveConfirm("once");
    const { id } = opened();
    settleLeaveConfirm(id, false);
    settleLeaveConfirm(id, true);
    await expect(answer).resolves.toBe(false);
  });

  it("마지막 host 가 사라지면 남은 요청은 머무르기로 닫힌다", async () => {
    const disposeA = host();
    const disposeB = host();
    const answer = requestLeaveConfirm("pending");
    disposeA();
    disposeA();
    expect(getLeaveConfirmRequest()).not.toBeNull();
    disposeB();
    await expect(answer).resolves.toBe(false);
    expect(getLeaveConfirmRequest()).toBeNull();
  });
});
