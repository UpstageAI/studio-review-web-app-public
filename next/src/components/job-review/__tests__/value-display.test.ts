import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_VALUE_DISPLAY,
  VALUE_DISPLAY_KEY,
  parseValueDisplay,
  readValueDisplay,
  writeValueDisplay,
} from "../value-display";

describe("parseValueDisplay", () => {
  it("없음·깨진 JSON·모르는 모양은 둘 다 꺼짐(공유 상수)", () => {
    expect(DEFAULT_VALUE_DISPLAY).toEqual({ description: false, rules: false });
    expect(parseValueDisplay(null)).toBe(DEFAULT_VALUE_DISPLAY);
    expect(parseValueDisplay("{oops")).toBe(DEFAULT_VALUE_DISPLAY);
    expect(parseValueDisplay("[true]")).toBe(DEFAULT_VALUE_DISPLAY);
    expect(parseValueDisplay("null")).toBe(DEFAULT_VALUE_DISPLAY);
    expect(parseValueDisplay('"description"')).toBe(DEFAULT_VALUE_DISPLAY);
    expect(parseValueDisplay('{"description":false}')).toBe(
      DEFAULT_VALUE_DISPLAY,
    );
  });

  it("boolean true 만 켠 것으로 읽고 다른 타입은 끈다", () => {
    expect(parseValueDisplay('{"description":true}')).toEqual({
      description: true,
      rules: false,
    });
    expect(parseValueDisplay('{"description":"true","rules":1}')).toBe(
      DEFAULT_VALUE_DISPLAY,
    );
    expect(
      parseValueDisplay('{"description":true,"rules":true,"x":1}'),
    ).toEqual({ description: true, rules: true });
  });
});

describe("readValueDisplay · writeValueDisplay", () => {
  it("저장소 값을 읽고, 저장소가 없거나 던지면 둘 다 꺼짐", () => {
    const store = new Map<string, string>([
      [VALUE_DISPLAY_KEY, '{"rules":true}'],
    ]);
    expect(
      readValueDisplay({ getItem: key => store.get(key) ?? null }),
    ).toEqual({ description: false, rules: true });
    expect(readValueDisplay({ getItem: () => null })).toBe(
      DEFAULT_VALUE_DISPLAY,
    );
    expect(readValueDisplay(null)).toBe(DEFAULT_VALUE_DISPLAY);
    expect(
      readValueDisplay({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe(DEFAULT_VALUE_DISPLAY);
  });

  it("두 플래그만 JSON 으로 쓰고, 저장소가 없거나 던져도 예외가 나지 않는다", () => {
    const setItem = vi.fn();
    writeValueDisplay({ setItem }, { description: true, rules: false });
    expect(setItem).toHaveBeenCalledWith(
      VALUE_DISPLAY_KEY,
      '{"description":true,"rules":false}',
    );
    expect(() => writeValueDisplay(null, DEFAULT_VALUE_DISPLAY)).not.toThrow();
    expect(() =>
      writeValueDisplay(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        DEFAULT_VALUE_DISPLAY,
      ),
    ).not.toThrow();
  });

  it("쓴 값을 다시 읽으면 같다", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    const display = { description: true, rules: true };
    writeValueDisplay(storage, display);
    expect(readValueDisplay(storage)).toEqual(display);
  });
});
