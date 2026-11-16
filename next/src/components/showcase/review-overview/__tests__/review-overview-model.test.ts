import { describe, expect, it } from "vitest";
import type { SearchCollectionSummary } from "@/lib/review-api/types";
import { reviewableJobs, reviewSortValue } from "../review-overview-model";

const row = (
  id: string,
  extra: Partial<SearchCollectionSummary> = {},
): SearchCollectionSummary => ({ id, ...extra });

describe("reviewableJobs", () => {
  it("전체에서 진행 중과 실패를 뺀다", () => {
    expect(
      reviewableJobs(
        row("a", {
          total_job_count: 10,
          pending_job_count: 2,
          failed_job_count: 1,
        }),
      ),
    ).toBe(7);
  });

  it("전체 수를 모르면 null, 음수는 0", () => {
    expect(reviewableJobs(row("a"))).toBeNull();
    expect(
      reviewableJobs(row("a", { total_job_count: 1, failed_job_count: 3 })),
    ).toBe(0);
  });
});

describe("reviewSortValue", () => {
  const counts = { a: { done: 3, in_progress: 1 } };

  it("완료 비율, 기록이 없으면 0, 분모를 모르거나 0 이면 null", () => {
    expect(reviewSortValue(row("a", { total_job_count: 6 }), counts)).toBe(0.5);
    expect(reviewSortValue(row("b", { total_job_count: 4 }), counts)).toBe(0);
    expect(reviewSortValue(row("a"), counts)).toBeNull();
    expect(
      reviewSortValue(row("a", { total_job_count: 0 }), counts),
    ).toBeNull();
  });

  it("아직 세는 중이면 null", () => {
    expect(reviewSortValue(row("a"), null)).toBeNull();
  });
});
