import { describe, expect, it } from "vitest";

import {
  VISITED_MAX,
  parseVisited,
  readVisited,
  serializeVisited,
  visitedStorageKey,
  withVisited,
  writeVisited,
} from "../visited-documents";

describe("visitedStorageKey", () => {
  it("Collection·Job 마다 다른 키", () => {
    expect(visitedStorageKey("scol_1", "job_1")).toBe(
      "review-visited:scol_1:job_1",
    );
    expect(visitedStorageKey("scol_1", "job_2")).not.toBe(
      visitedStorageKey("scol_1", "job_1"),
    );
  });
});

describe("parseVisited", () => {
  it("문자열 배열만, 중복과 빈 문자열은 뺀다", () => {
    expect(parseVisited('["a","b","a","",3,null]')).toEqual(["a", "b"]);
  });

  it("없음·깨진 JSON·배열이 아닌 값은 빈 목록", () => {
    expect(parseVisited(null)).toEqual([]);
    expect(parseVisited("{")).toEqual([]);
    expect(parseVisited('{"a":1}')).toEqual([]);
  });
});

describe("serializeVisited", () => {
  it("되읽으면 같은 목록", () => {
    expect(parseVisited(serializeVisited(["x", "y"]))).toEqual(["x", "y"]);
  });

  it("상한을 넘으면 최근 것만 남긴다", () => {
    const keys = Array.from({ length: VISITED_MAX + 3 }, (_, i) => `d${i}`);
    const out = parseVisited(serializeVisited(keys));
    expect(out).toHaveLength(VISITED_MAX);
    expect(out[0]).toBe("d3");
    expect(out.at(-1)).toBe(`d${VISITED_MAX + 2}`);
  });
});

describe("withVisited", () => {
  it("없는 키는 끝에 더하고, 있는 키는 같은 목록을 돌려준다", () => {
    const keys = ["a"];
    expect(withVisited(keys, "b")).toEqual(["a", "b"]);
    expect(withVisited(keys, "a")).toBe(keys);
  });
});

describe("readVisited·writeVisited", () => {
  const memory = () => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => void map.set(key, value),
      map,
    };
  };

  it("저장한 목록을 다시 읽는다", () => {
    const storage = memory();
    writeVisited(storage, "k", ["a", "b"]);
    expect(readVisited(storage, "k")).toEqual(["a", "b"]);
  });

  it("빈 목록은 쓰지 않는다", () => {
    const storage = memory();
    writeVisited(storage, "k", []);
    expect(storage.map.size).toBe(0);
  });

  it("저장소가 없거나 던져도 조용히 넘어간다", () => {
    expect(readVisited(null, "k")).toEqual([]);
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    expect(readVisited(throwing, "k")).toEqual([]);
    expect(() => writeVisited(throwing, "k", ["a"])).not.toThrow();
  });
});
