// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createStoredValue,
  type StoredValueNotify,
} from "@/lib/browser-storage";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});

let seq = 0;
function stored(
  notify: StoredValueNotify,
  area: "local" | "session" = "local",
) {
  seq += 1;
  const key = `test-key-${seq}`;
  const parses: (string | null)[] = [];
  const value = createStoredValue<{ n: number }>({
    key,
    area,
    parse: text => {
      parses.push(text);
      const n = Number(text);
      return { n: text !== null && Number.isFinite(n) ? n : -1 };
    },
    serialize: ({ n }) => String(n),
    notify,
  });
  return { key, value, parses };
}

function storageEvent(key: string | null) {
  window.dispatchEvent(new StorageEvent("storage", { key }));
}

describe("createStoredValue", () => {
  it("read 는 저장소 글을 parse 하고, 없으면 parse(null) 이다", () => {
    const { key, value } = stored("none");
    expect(value.read()).toEqual({ n: -1 });
    localStorage.setItem(key, "3");
    expect(value.read()).toEqual({ n: 3 });
  });

  it("write 는 serialize 한 글을 그대로 쓴다", () => {
    const { key, value } = stored("none");
    value.write({ n: 7 });
    expect(localStorage.getItem(key)).toBe("7");
  });

  it('area "session" 은 sessionStorage 를 쓴다', () => {
    const { key, value } = stored("tab", "session");
    value.write({ n: 2 });
    expect(sessionStorage.getItem(key)).toBe("2");
    expect(localStorage.getItem(key)).toBeNull();
    expect(value.read()).toEqual({ n: 2 });
  });

  it("저장소 읽기가 throw 하면 read 는 parse(null) 이다", () => {
    const { key, value, parses } = stored("tab+storage");
    localStorage.setItem(key, "5");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(value.read()).toEqual({ n: -1 });
    expect(parses.at(-1)).toBeNull();
  });

  it("저장소 쓰기가 throw 하면 조용히 무시하고 알림은 그대로 보낸다", () => {
    const { value } = stored("tab");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    const listener = vi.fn();
    value.subscribe(listener);
    expect(() => value.write({ n: 1 })).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("window 저장소 접근 자체가 throw 해도 read·write 가 동작한다", () => {
    const { value } = stored("none");
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(value.read()).toEqual({ n: -1 });
    expect(() => value.write({ n: 1 })).not.toThrow();
  });

  it('notify "none": write 가 알리지 않고 subscribe 는 아무것도 듣지 않는다', () => {
    const { key, value } = stored("none");
    const added = vi.spyOn(window, "addEventListener");
    const listener = vi.fn();
    const unsubscribe = value.subscribe(listener);
    value.write({ n: 1 });
    storageEvent(key);
    storageEvent(null);
    expect(listener).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('notify "tab": 같은 탭의 write 만 알리고 storage 이벤트는 듣지 않는다', () => {
    const { key, value } = stored("tab");
    const added = vi.spyOn(window, "addEventListener");
    const first = vi.fn();
    const second = vi.fn();
    const unsubscribeFirst = value.subscribe(first);
    value.subscribe(second);
    value.write({ n: 1 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    storageEvent(key);
    storageEvent(null);
    expect(first).toHaveBeenCalledTimes(1);
    expect(added).not.toHaveBeenCalled();
    unsubscribeFirst();
    value.write({ n: 2 });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it('notify "tab+storage": write, 같은 키·key null 의 storage 이벤트를 알리고 다른 키는 무시한다', () => {
    const { key, value } = stored("tab+storage");
    const listener = vi.fn();
    const unsubscribe = value.subscribe(listener);
    value.write({ n: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    storageEvent(key);
    storageEvent(null);
    expect(listener).toHaveBeenCalledTimes(3);
    storageEvent(`${key}-other`);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    value.write({ n: 2 });
    storageEvent(key);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("구독을 풀면 등록한 storage 리스너를 그대로 뗀다", () => {
    const { value } = stored("tab+storage");
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    const unsubscribe = value.subscribe(() => {});
    const handler = added.mock.calls.find(([type]) => type === "storage")?.[1];
    expect(handler).toBeDefined();
    unsubscribe();
    expect(removed).toHaveBeenCalledWith("storage", handler);
  });

  it("useValue 는 같은 글이면 같은 값(참조)을 돌려주고 write 에 다시 그린다", () => {
    const { value } = stored("tab+storage");
    const view = renderHook(() => value.useValue());
    const first = view.result.current;
    expect(first).toEqual({ n: -1 });
    view.rerender();
    expect(view.result.current).toBe(first);
    act(() => value.write({ n: 4 }));
    expect(view.result.current).toEqual({ n: 4 });
    view.unmount();
  });
});
