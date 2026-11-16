import { describe, expect, it } from "vitest";

import {
  FILMSTRIP_OPEN_KEY,
  parseFilmstripOpen,
  readFilmstripOpen,
  writeFilmstripOpen,
} from "../filmstrip-open";

describe("parseFilmstripOpen", () => {
  it('"open" 은 펼침, "closed" 는 접힘, 나머지는 기억 없음(null)', () => {
    expect(parseFilmstripOpen("open")).toBe(true);
    expect(parseFilmstripOpen("closed")).toBe(false);
    expect(parseFilmstripOpen(null)).toBeNull();
    expect(parseFilmstripOpen("yes")).toBeNull();
  });
});

describe("readFilmstripOpen / writeFilmstripOpen", () => {
  it("쓴 값을 그대로 읽는다", () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    };
    expect(readFilmstripOpen(storage)).toBeNull();
    writeFilmstripOpen(storage, true);
    expect(data.get(FILMSTRIP_OPEN_KEY)).toBe("open");
    expect(readFilmstripOpen(storage)).toBe(true);
    writeFilmstripOpen(storage, false);
    expect(readFilmstripOpen(storage)).toBe(false);
  });

  it("저장소가 없거나 던져도 기억 없음(null)으로 읽고 쓰기는 조용히 넘어간다", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readFilmstripOpen(null)).toBeNull();
    expect(readFilmstripOpen(throwing)).toBeNull();
    expect(() => writeFilmstripOpen(throwing, true)).not.toThrow();
    expect(() => writeFilmstripOpen(null, true)).not.toThrow();
  });
});
