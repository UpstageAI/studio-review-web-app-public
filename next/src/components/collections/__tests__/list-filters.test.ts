import { describe, expect, it } from "vitest";

import type { SearchCollectionSummary } from "@/lib/review-api/types";
import {
  ALL_SOURCES,
  filterBySource,
  hasActiveFilter,
  normalizeSourceFilter,
  parseSourceFilter,
  sameSourceFilter,
  toggleSource,
} from "../list-filters";

const rows: SearchCollectionSummary[] = [
  { id: "a", source: { type: "agent_export", label: "A" } },
  { id: "b", source: { type: "file_upload", label: "b.pdf" } },
  { id: "c", source: null },
  { id: "d", source: { type: "future_type", label: "D" } },
  { id: "e", source: { type: "agent_export", label: "E" } },
  { id: "f", source: { type: "standalone", label: "F" } },
];

describe("filterBySource", () => {
  it("빈 선택(전체)이면 입력 배열을 그대로 돌려준다", () => {
    expect(filterBySource(rows, ALL_SOURCES)).toBe(rows);
  });

  it("출처 유형이 같은 행만 순서대로 남긴다", () => {
    expect(filterBySource(rows, ["agent_export"]).map(row => row.id)).toEqual([
      "a",
      "e",
    ]);
    expect(filterBySource(rows, ["file_upload"]).map(row => row.id)).toEqual([
      "b",
    ]);
  });

  it("여러 유형을 고르면 그 합집합을 원래 순서대로 남긴다", () => {
    expect(
      filterBySource(rows, ["agent_export", "standalone"]).map(row => row.id),
    ).toEqual(["a", "e", "f"]);
  });

  it("출처가 없거나 모르는 유형인 행은 필터가 켜져 있으면 빠진다", () => {
    expect(filterBySource(rows, ["result_import"])).toEqual([]);
    expect(
      filterBySource(rows, ["agent_export", "file_upload", "standalone"]).map(
        row => row.id,
      ),
    ).toEqual(["a", "b", "e", "f"]);
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const copy = [...rows];
    filterBySource(rows, ["agent_export"]);
    expect(rows).toEqual(copy);
  });
});

describe("normalizeSourceFilter", () => {
  it("아는 유형만 정해진 순서로 한 번씩 남긴다", () => {
    expect(
      normalizeSourceFilter(["standalone", "agent_link", "standalone", "x"]),
    ).toEqual(["agent_link", "standalone"]);
  });

  it("남는 값이 없으면 전체(같은 참조)다", () => {
    expect(normalizeSourceFilter([])).toBe(ALL_SOURCES);
    expect(normalizeSourceFilter(["all", "zzz"])).toBe(ALL_SOURCES);
  });
});

describe("parseSourceFilter", () => {
  it("값 하나짜리 옛 형식을 그대로 읽는다", () => {
    expect(parseSourceFilter("agent_link")).toEqual(["agent_link"]);
  });

  it("쉼표 목록을 정규화해 읽는다", () => {
    expect(parseSourceFilter("standalone,agent_export")).toEqual([
      "agent_export",
      "standalone",
    ]);
    expect(parseSourceFilter("file_upload,,nope,file_upload")).toEqual([
      "file_upload",
    ]);
  });

  it("all·빈 값·모르는 값뿐이면 전체", () => {
    expect(parseSourceFilter("all")).toBe(ALL_SOURCES);
    expect(parseSourceFilter("AGENT_LINK")).toBe(ALL_SOURCES);
    expect(parseSourceFilter("zzz,yyy")).toBe(ALL_SOURCES);
    expect(parseSourceFilter("")).toBe(ALL_SOURCES);
    expect(parseSourceFilter(null)).toBe(ALL_SOURCES);
    expect(parseSourceFilter(undefined)).toBe(ALL_SOURCES);
  });
});

describe("toggleSource", () => {
  it("없는 유형은 정해진 자리에 더하고, 있는 유형은 뺀다", () => {
    const one = toggleSource(ALL_SOURCES, "standalone");
    expect(one).toEqual(["standalone"]);
    const two = toggleSource(one, "agent_export");
    expect(two).toEqual(["agent_export", "standalone"]);
    expect(toggleSource(two, "standalone")).toEqual(["agent_export"]);
  });

  it("마지막 하나를 빼면 전체로 돌아간다", () => {
    expect(toggleSource(["file_upload"], "file_upload")).toBe(ALL_SOURCES);
  });

  it("입력 선택을 바꾸지 않는다", () => {
    const filter = ["agent_link"] as const;
    toggleSource(filter, "standalone");
    expect(filter).toEqual(["agent_link"]);
  });
});

describe("sameSourceFilter", () => {
  it("내용이 같으면 true", () => {
    expect(sameSourceFilter(["agent_link"], ["agent_link"])).toBe(true);
    expect(sameSourceFilter(ALL_SOURCES, [])).toBe(true);
    expect(sameSourceFilter(["agent_link"], ["standalone"])).toBe(false);
    expect(sameSourceFilter(["agent_link"], [])).toBe(false);
  });
});

describe("hasActiveFilter", () => {
  it("하나라도 고르면 true", () => {
    expect(hasActiveFilter(ALL_SOURCES)).toBe(false);
    expect(hasActiveFilter(["standalone"])).toBe(true);
  });
});
