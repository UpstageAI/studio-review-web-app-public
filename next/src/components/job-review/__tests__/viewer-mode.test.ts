import { describe, expect, it, vi } from "vitest";

import {
  VIEWER_MODE_KEY,
  parseViewerMode,
  readViewerMode,
  writeViewerMode,
} from "../viewer-mode";

describe("parseViewerMode", () => {
  it("paged 만 한 장씩, 그 밖은 연속 스크롤", () => {
    expect(parseViewerMode("paged")).toBe("paged");
    expect(parseViewerMode("continuous")).toBe("continuous");
    expect(parseViewerMode(null)).toBe("continuous");
    expect(parseViewerMode("")).toBe("continuous");
    expect(parseViewerMode("PAGED")).toBe("continuous");
  });
});

describe("readViewerMode", () => {
  it("저장소 값을 읽고, 저장소가 없거나 던지면 연속 스크롤", () => {
    const store = new Map<string, string>([[VIEWER_MODE_KEY, "paged"]]);
    expect(readViewerMode({ getItem: key => store.get(key) ?? null })).toBe(
      "paged",
    );
    expect(readViewerMode({ getItem: () => null })).toBe("continuous");
    expect(readViewerMode(null)).toBe("continuous");
    expect(
      readViewerMode({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("continuous");
  });
});

describe("writeViewerMode", () => {
  it("모드를 키에 쓰고, 저장소가 없거나 던져도 예외가 나지 않는다", () => {
    const setItem = vi.fn();
    writeViewerMode({ setItem }, "paged");
    expect(setItem).toHaveBeenCalledWith(VIEWER_MODE_KEY, "paged");
    expect(() => writeViewerMode(null, "continuous")).not.toThrow();
    expect(() =>
      writeViewerMode(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        "continuous",
      ),
    ).not.toThrow();
  });
});
