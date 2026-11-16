import { describe, expect, it } from "vitest";

import {
  ORGANIZER_OPEN_KEY,
  ORGANIZER_SIZE_KEY,
  parseOrganizerOpen,
  parseOrganizerSize,
  readOrganizerView,
  showsFilmstripBand,
  showsOrganizer,
  writeOrganizerOpen,
  writeOrganizerSize,
} from "../organizer-view";

function mapStorage() {
  const data = new Map<string, string>();
  return {
    data,
    storage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    },
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("parseOrganizerOpen", () => {
  it('"open" 만 열림, 나머지는 닫힘', () => {
    expect(parseOrganizerOpen("open")).toBe(true);
    expect(parseOrganizerOpen("closed")).toBe(false);
    expect(parseOrganizerOpen(null)).toBe(false);
    expect(parseOrganizerOpen("yes")).toBe(false);
    expect(parseOrganizerOpen("")).toBe(false);
  });
});

describe("parseOrganizerSize", () => {
  it('"m" 만 M, 나머지(없음·모르는 값·대문자)는 S', () => {
    expect(parseOrganizerSize("m")).toBe("m");
    expect(parseOrganizerSize("s")).toBe("s");
    expect(parseOrganizerSize(null)).toBe("s");
    expect(parseOrganizerSize("")).toBe("s");
    expect(parseOrganizerSize("M")).toBe("s");
    expect(parseOrganizerSize("l")).toBe("s");
  });
});

describe("readOrganizerView / writeOrganizerOpen / writeOrganizerSize", () => {
  it("아무것도 없으면 닫힘·S", () => {
    expect(readOrganizerView(mapStorage().storage)).toEqual({
      open: false,
      size: "s",
    });
  });

  it("쓴 값을 그대로 읽고 두 키는 서로 영향이 없다", () => {
    const { data, storage } = mapStorage();
    writeOrganizerOpen(storage, true);
    expect(data.get(ORGANIZER_OPEN_KEY)).toBe("open");
    expect(readOrganizerView(storage)).toEqual({ open: true, size: "s" });

    writeOrganizerSize(storage, "m");
    expect(data.get(ORGANIZER_SIZE_KEY)).toBe("m");
    expect(readOrganizerView(storage)).toEqual({ open: true, size: "m" });

    writeOrganizerOpen(storage, false);
    expect(data.get(ORGANIZER_OPEN_KEY)).toBe("closed");
    expect(readOrganizerView(storage)).toEqual({ open: false, size: "m" });

    writeOrganizerSize(storage, "s");
    expect(readOrganizerView(storage)).toEqual({ open: false, size: "s" });
  });

  it("키 이름은 필름스트립 키와 다르다", () => {
    expect(ORGANIZER_OPEN_KEY).toBe("review-organizer");
    expect(ORGANIZER_SIZE_KEY).toBe("review-organizer-size");
    expect(ORGANIZER_OPEN_KEY).not.toBe("review-filmstrip");
  });

  it("저장소가 없거나 던져도 닫힘·S 로 읽고 쓰기는 조용히 넘어간다", () => {
    expect(readOrganizerView(null)).toEqual({ open: false, size: "s" });
    expect(readOrganizerView(throwing)).toEqual({ open: false, size: "s" });
    expect(() => writeOrganizerOpen(throwing, true)).not.toThrow();
    expect(() => writeOrganizerSize(throwing, "m")).not.toThrow();
    expect(() => writeOrganizerOpen(null, true)).not.toThrow();
    expect(() => writeOrganizerSize(null, "m")).not.toThrow();
  });
});

describe("showsFilmstripBand", () => {
  it("구성 탭에서는 띠를 펼쳤고 정리 화면이 닫혀 있을 때만", () => {
    expect(showsFilmstripBand("structure", true, false)).toBe(true);
    expect(showsFilmstripBand("structure", true, true)).toBe(false);
    expect(showsFilmstripBand("structure", false, false)).toBe(false);
    expect(showsFilmstripBand("structure", false, true)).toBe(false);
  });

  it("구성 탭이 아니면 늘 그린다", () => {
    expect(showsFilmstripBand("values", true, false)).toBe(true);
    expect(showsFilmstripBand("values", true, true)).toBe(true);
    expect(showsFilmstripBand("values", false, false)).toBe(true);
    expect(showsFilmstripBand("values", false, true)).toBe(true);
  });
});

describe("showsOrganizer", () => {
  it("구성 탭에서 열어 두었을 때만", () => {
    expect(showsOrganizer("structure", true)).toBe(true);
    expect(showsOrganizer("structure", false)).toBe(false);
    expect(showsOrganizer("values", true)).toBe(false);
    expect(showsOrganizer("values", false)).toBe(false);
  });
});
