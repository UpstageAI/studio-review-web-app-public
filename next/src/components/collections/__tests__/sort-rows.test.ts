import { describe, expect, it } from "vitest";

import type { SearchCollectionSummary } from "@/lib/review-api/types";
import { nextSortState, sortRows, type SortState } from "../sort-rows";

const labels = { untitled: "Untitled" };

function ids(rows: readonly SearchCollectionSummary[]): string[] {
  return rows.map(row => row.id);
}

function sorted(
  rows: SearchCollectionSummary[],
  sort: SortState | null,
): string[] {
  return ids(sortRows(rows, sort, "en", labels));
}

const rows: SearchCollectionSummary[] = [
  {
    id: "a",
    name: "Invoice 10",
    source: { type: "agent_link", label: "Zeta" },
    total_job_count: 3,
    updated_at: 1_700_000_300,
    last_result_at: null,
  },
  {
    id: "b",
    name: "invoice 2",
    source: { type: "agent_export", label: "alpha" },
    total_job_count: null,
    updated_at: 1_700_000_100,
    last_result_at: 1_700_000_500,
  },
  {
    id: "c",
    name: null,
    source: null,
    total_job_count: 10,
    updated_at: null,
    last_result_at: 1_700_000_400,
  },
  {
    id: "d",
    name: "Receipt",
    source: { type: "standalone", label: "Receipt" },
    total_job_count: 3,
    updated_at: "2023-11-14T22:13:20Z",
    last_result_at: "not a time",
  },
];

describe("sortRows", () => {
  it("정렬이 없으면 입력 배열을 그대로 돌려준다", () => {
    expect(sortRows(rows, null, "en", labels)).toBe(rows);
  });

  it("이름 오름차순: 숫자는 크기순, 대소문자 무시, 이름 없음은 untitled 문구로", () => {
    expect(sorted(rows, { column: "name", direction: "asc" })).toEqual([
      "b",
      "a",
      "d",
      "c",
    ]);
  });

  it("이름 내림차순", () => {
    expect(sorted(rows, { column: "name", direction: "desc" })).toEqual([
      "c",
      "d",
      "a",
      "b",
    ]);
  });

  it("Workflow: workflow 출처의 label 로 정렬, 다른 출처·없음은 항상 뒤", () => {
    expect(sorted(rows, { column: "workflow", direction: "asc" })).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
    expect(sorted(rows, { column: "workflow", direction: "desc" })).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
  });

  it("Job 수 오름차순: 동값은 입력 순서 유지, null 은 뒤", () => {
    expect(sorted(rows, { column: "jobs", direction: "asc" })).toEqual([
      "a",
      "d",
      "c",
      "b",
    ]);
  });

  it("Job 수 내림차순: 동값은 입력 순서 유지, null 은 뒤", () => {
    expect(sorted(rows, { column: "jobs", direction: "desc" })).toEqual([
      "c",
      "a",
      "d",
      "b",
    ]);
  });

  it("수정일 오름차순: epoch 초와 ISO 를 같은 축으로 비교, null 은 뒤", () => {
    // d = 1_700_000_000 초
    expect(sorted(rows, { column: "updated", direction: "asc" })).toEqual([
      "d",
      "b",
      "a",
      "c",
    ]);
  });

  it("수정일 내림차순: null 은 뒤", () => {
    expect(sorted(rows, { column: "updated", direction: "desc" })).toEqual([
      "a",
      "b",
      "d",
      "c",
    ]);
  });

  it("마지막 결과: 읽을 수 없는 시각도 값 없음으로 뒤", () => {
    expect(sorted(rows, { column: "lastResult", direction: "asc" })).toEqual([
      "c",
      "b",
      "a",
      "d",
    ]);
    expect(sorted(rows, { column: "lastResult", direction: "desc" })).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  it("값이 모두 같으면 입력 순서를 지킨다", () => {
    const same = ["x", "y", "z"].map(id => ({ id, total_job_count: 1 }));
    expect(sorted(same, { column: "jobs", direction: "desc" })).toEqual([
      "x",
      "y",
      "z",
    ]);
  });

  it("입력 배열을 바꾸지 않는다", () => {
    const copy = [...rows];
    sortRows(rows, { column: "name", direction: "desc" }, "en", labels);
    expect(rows).toEqual(copy);
  });
});

describe("nextSortState", () => {
  it("같은 열은 asc → desc → 해제로 돈다", () => {
    const asc = nextSortState(null, "updated");
    expect(asc).toEqual({ column: "updated", direction: "asc" });
    const desc = nextSortState(asc, "updated");
    expect(desc).toEqual({ column: "updated", direction: "desc" });
    expect(nextSortState(desc, "updated")).toBeNull();
  });

  it("다른 열을 누르면 그 열 오름차순부터", () => {
    expect(
      nextSortState({ column: "name", direction: "desc" }, "jobs"),
    ).toEqual({ column: "jobs", direction: "asc" });
  });
});
