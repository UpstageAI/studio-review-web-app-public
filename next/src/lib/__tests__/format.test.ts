import { describe, expect, it } from "vitest";

import { formatBytes, formatDateTime, sumPages, toTimestamp } from "../format";

describe("formatDateTime", () => {
  const iso = "2026-10-21T03:04:05Z";
  const expected = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(iso));

  it("ISO 문자열·epoch 초·epoch 밀리초를 같은 시각으로 읽는다", () => {
    const ms = Date.parse(iso);
    expect(formatDateTime(iso, "en")).toBe(expected);
    expect(formatDateTime(ms / 1000, "en")).toBe(expected);
    expect(formatDateTime(ms, "en")).toBe(expected);
    expect(formatDateTime(String(ms / 1000), "en")).toBe(expected);
  });

  it("값이 없거나 읽을 수 없으면 null", () => {
    expect(formatDateTime(null, "en")).toBeNull();
    expect(formatDateTime(undefined, "en")).toBeNull();
    expect(formatDateTime("", "en")).toBeNull();
    expect(formatDateTime("yesterday", "en")).toBeNull();
  });
});

describe("toTimestamp", () => {
  const iso = "2026-10-21T03:04:05Z";
  const ms = Date.parse(iso);

  it("epoch 초를 밀리초로 바꾼다", () => {
    expect(toTimestamp(ms / 1000)).toBe(ms);
    expect(toTimestamp(String(ms / 1000))).toBe(ms);
  });

  it("epoch 밀리초는 그대로 둔다", () => {
    expect(toTimestamp(ms)).toBe(ms);
  });

  it("ISO 문자열을 읽는다", () => {
    expect(toTimestamp(iso)).toBe(ms);
  });

  it("값이 없거나 읽을 수 없으면 null", () => {
    expect(toTimestamp(null)).toBeNull();
    expect(toTimestamp(undefined)).toBeNull();
    expect(toTimestamp("")).toBeNull();
    expect(toTimestamp("yesterday")).toBeNull();
    expect(toTimestamp(Number.NaN)).toBeNull();
  });
});

describe("formatBytes", () => {
  it("1024 단위로 올린다", () => {
    expect(formatBytes(512, "en")).toBe("512 byte");
    expect(formatBytes(1536, "en")).toBe("1.5 kB");
    expect(formatBytes(5 * 1024 * 1024, "en")).toBe("5 MB");
  });

  it("값이 없거나 음수면 null", () => {
    expect(formatBytes(null, "en")).toBeNull();
    expect(formatBytes(-1, "en")).toBeNull();
    expect(formatBytes(Number.NaN, "en")).toBeNull();
  });
});

describe("sumPages", () => {
  it("페이지 수를 더한다", () => {
    expect(sumPages([{ num_pages: 3 }, { num_pages: 2 }])).toBe(5);
  });

  it("하나라도 모르거나 파일이 없으면 null", () => {
    expect(sumPages([{ num_pages: 3 }, { num_pages: null }])).toBeNull();
    expect(sumPages([{ num_pages: 3 }, {}])).toBeNull();
    expect(sumPages([])).toBeNull();
    expect(sumPages(undefined)).toBeNull();
  });
});
