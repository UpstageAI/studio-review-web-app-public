import { describe, expect, it, vi } from "vitest";

import {
  browserStorage,
  createDraftStorage,
  type DraftStorageBackend,
} from "../draft-storage";

function mapBackend(map: Map<string, string>): DraftStorageBackend {
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: key => void map.delete(key),
  };
}

describe("createDraftStorage", () => {
  it("읽기·쓰기·지우기를 backend 에 그대로 넘긴다", () => {
    const map = new Map<string, string>();
    const storage = createDraftStorage(mapBackend(map));
    expect(storage.read("k")).toBeNull();
    expect(storage.write("k", "v")).toBe("ok");
    expect(storage.read("k")).toBe("v");
    expect(map.get("k")).toBe("v");
    storage.clear("k");
    expect(storage.read("k")).toBeNull();
    expect(map.has("k")).toBe(false);
  });

  it("backend 가 던지면 읽기 null · 쓰기 failed · 지우기 무시", () => {
    const throwing: DraftStorageBackend = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    const storage = createDraftStorage(throwing);
    expect(storage.read("k")).toBeNull();
    expect(storage.write("k", "v")).toBe("failed");
    expect(() => storage.clear("k")).not.toThrow();
  });

  it("backend 가 없으면 읽기 null · 쓰기 unavailable 이고 던지지 않는다", () => {
    const storage = createDraftStorage(null);
    expect(storage.read("k")).toBeNull();
    expect(storage.write("k", "v")).toBe("unavailable");
    expect(() => storage.clear("k")).not.toThrow();
  });

  it("쓰기는 setItem 이 돌아오면 ok", () => {
    const setItem = vi.fn();
    const storage = createDraftStorage({
      getItem: () => null,
      setItem,
      removeItem: () => {},
    });
    expect(storage.write("k", "v")).toBe("ok");
    expect(setItem).toHaveBeenCalledWith("k", "v");
  });
});

describe("browserStorage", () => {
  it("window 가 없는 환경에서는 비어 있는 저장소처럼 동작한다", () => {
    const storage = browserStorage();
    expect(storage.read("k")).toBeNull();
    expect(storage.write("k", "v")).toBe("unavailable");
    expect(() => storage.clear("k")).not.toThrow();
  });
});
