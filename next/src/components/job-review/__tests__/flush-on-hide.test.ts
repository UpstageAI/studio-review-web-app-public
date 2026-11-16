import { describe, expect, it, vi } from "vitest";

import { subscribeHide } from "../flush-on-hide";

function fakeTarget() {
  const listeners = new Map<string, Set<() => void>>();
  return {
    visibilityState: "visible",
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
    count(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

describe("subscribeHide", () => {
  it("pagehide 와 visibilitychange 를 하나씩 등록한다", () => {
    const win = fakeTarget();
    const doc = fakeTarget();
    subscribeHide(win, doc, () => {});
    expect(win.count("pagehide")).toBe(1);
    expect(doc.count("visibilitychange")).toBe(1);
  });

  it("pagehide 에서 onHide 를 부른다", () => {
    const win = fakeTarget();
    const doc = fakeTarget();
    const onHide = vi.fn();
    subscribeHide(win, doc, onHide);
    win.fire("pagehide");
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("visibilitychange 는 숨겨질 때만 onHide 를 부른다", () => {
    const win = fakeTarget();
    const doc = fakeTarget();
    const onHide = vi.fn();
    subscribeHide(win, doc, onHide);
    doc.fire("visibilitychange");
    expect(onHide).not.toHaveBeenCalled();
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    expect(onHide).toHaveBeenCalledTimes(1);
  });

  it("돌려준 함수가 두 리스너를 모두 푼다", () => {
    const win = fakeTarget();
    const doc = fakeTarget();
    const onHide = vi.fn();
    const unsubscribe = subscribeHide(win, doc, onHide);
    unsubscribe();
    expect(win.count("pagehide")).toBe(0);
    expect(doc.count("visibilitychange")).toBe(0);
    doc.visibilityState = "hidden";
    win.fire("pagehide");
    doc.fire("visibilitychange");
    expect(onHide).not.toHaveBeenCalled();
  });
});
