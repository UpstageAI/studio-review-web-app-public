import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTtlCache } from "../ttl-cache";

const TTL_MS = 10 * 60 * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createTtlCache", () => {
  it("TTL 안에서는 같은 값을, 지나면 undefined 를 돌려준다", () => {
    const cache = createTtlCache<string>({ ttlMs: TTL_MS, maxEntries: 10 });
    cache.set("file_1", "a");
    vi.advanceTimersByTime(TTL_MS - 1);
    expect(cache.get("file_1")).toBe("a");
    vi.advanceTimersByTime(1);
    expect(cache.get("file_1")).toBeUndefined();
    expect(cache.size).toBe(0);
  });

  it("다시 넣으면 만료 시각이 갱신된다", () => {
    const cache = createTtlCache<string>({ ttlMs: TTL_MS, maxEntries: 10 });
    cache.set("file_1", "a");
    vi.advanceTimersByTime(TTL_MS - 1000);
    cache.set("file_1", "b");
    vi.advanceTimersByTime(5000);
    expect(cache.get("file_1")).toBe("b");
  });

  it("최대 건수를 넘으면 가장 오래된 것부터 지운다", () => {
    const cache = createTtlCache<string>({ ttlMs: TTL_MS, maxEntries: 3 });
    for (let i = 0; i <= 3; i += 1) cache.set(`file_${i}`, String(i));
    expect(cache.size).toBe(3);
    expect(cache.get("file_0")).toBeUndefined();
    expect(cache.get("file_1")).toBe("1");
    expect(cache.get("file_3")).toBe("3");
  });

  it("바이트 합계가 상한을 넘으면 가장 오래된 것부터 지운다", () => {
    const cache = createTtlCache<string>({
      ttlMs: TTL_MS,
      maxEntries: 100,
      maxBytes: 10,
      sizeOf: value => value.length,
    });
    cache.set("a", "1234");
    cache.set("b", "1234");
    expect(cache.bytes).toBe(8);
    cache.set("c", "1234");
    expect(cache.size).toBe(2);
    expect(cache.bytes).toBe(8);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("1234");
    expect(cache.get("c")).toBe("1234");
  });

  it("한 항목이 상한보다 크면 넣지 않고, 있던 같은 키도 지운다", () => {
    const cache = createTtlCache<string>({
      ttlMs: TTL_MS,
      maxEntries: 100,
      maxBytes: 10,
      sizeOf: value => value.length,
    });
    cache.set("a", "123");
    cache.set("a", "12345678901");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });

  it("지우거나 만료되면 바이트 합계에서 뺀다", () => {
    const cache = createTtlCache<string>({
      ttlMs: TTL_MS,
      maxEntries: 100,
      maxBytes: 100,
      sizeOf: value => value.length,
    });
    cache.set("a", "123");
    cache.set("b", "12");
    expect(cache.bytes).toBe(5);
    cache.delete("a");
    expect(cache.bytes).toBe(2);
    vi.advanceTimersByTime(TTL_MS);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.bytes).toBe(0);
    cache.set("c", "1");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.bytes).toBe(0);
  });
});
