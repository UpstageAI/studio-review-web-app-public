import { afterEach, describe, expect, it, vi } from "vitest";

const { findMany, groupBy } = vi.hoisted(() => ({
  findMany: vi.fn(),
  groupBy: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = { jobReviewStatus: { findMany, groupBy } };
  return { prisma, default: prisma };
});

import {
  countReviewProgress,
  readReviewActivity,
  toReviewActivityRow,
} from "../review-status-aggregate";

afterEach(() => {
  findMany.mockReset();
  groupBy.mockReset();
});

const DB_ROW = {
  collectionId: "scol_1",
  jobId: "job_1",
  state: "DONE" as const,
  startedAt: new Date("2026-11-01T00:00:00.000Z"),
  completedAt: new Date("2026-11-02T00:00:00.000Z"),
  updatedAt: new Date("2026-11-02T00:00:00.000Z"),
};

describe("toReviewActivityRow", () => {
  it("DONE 은 done 과 ISO 시각들", () => {
    expect(toReviewActivityRow(DB_ROW)).toEqual({
      collection_id: "scol_1",
      job_id: "job_1",
      review_status: "done",
      started_at: "2026-11-01T00:00:00.000Z",
      completed_at: "2026-11-02T00:00:00.000Z",
      updated_at: "2026-11-02T00:00:00.000Z",
    });
  });

  it("IN_PROGRESS 는 완료 시각이 남아 있어도 null", () => {
    expect(
      toReviewActivityRow({ ...DB_ROW, state: "IN_PROGRESS" }),
    ).toMatchObject({ review_status: "in_progress", completed_at: null });
  });
});

describe("readReviewActivity", () => {
  it("최근 행은 updatedAt 내림차순 limit 개, 물은 Job 은 OR 로 찾는다", async () => {
    findMany.mockResolvedValueOnce([DB_ROW]).mockResolvedValueOnce([DB_ROW]);
    const result = await readReviewActivity(5, [
      { collectionId: "scol_1", jobId: "job_1" },
      { collectionId: "scol_2", jobId: "job_2" },
    ]);
    expect(findMany).toHaveBeenCalledTimes(2);
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      orderBy: [
        { updatedAt: "desc" },
        { collectionId: "asc" },
        { jobId: "asc" },
      ],
      take: 5,
    });
    expect(findMany.mock.calls[1]?.[0]).toMatchObject({
      where: {
        OR: [
          { collectionId: "scol_1", jobId: "job_1" },
          { collectionId: "scol_2", jobId: "job_2" },
        ],
      },
    });
    expect(result.recent).toHaveLength(1);
    expect(result.jobs[0]?.review_status).toBe("done");
  });

  it("물은 Job 이 없으면 최근 행만 읽는다", async () => {
    findMany.mockResolvedValueOnce([]);
    const result = await readReviewActivity(8, []);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ recent: [], jobs: [] });
  });
});

describe("countReviewProgress", () => {
  it("상태별로 센다", async () => {
    groupBy.mockResolvedValue([
      { state: "DONE", _count: { _all: 4 } },
      { state: "IN_PROGRESS", _count: { _all: 2 } },
    ]);
    expect(await countReviewProgress("scol_1")).toEqual({
      done: 4,
      in_progress: 2,
    });
    expect(groupBy.mock.calls[0][0]).toMatchObject({
      by: ["state"],
      where: { collectionId: "scol_1" },
    });
  });

  it("기록이 없으면 0", async () => {
    groupBy.mockResolvedValue([]);
    expect(await countReviewProgress("scol_1")).toEqual({
      done: 0,
      in_progress: 0,
    });
  });
});
