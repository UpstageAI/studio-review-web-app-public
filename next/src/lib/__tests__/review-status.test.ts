import { afterEach, describe, expect, it, vi } from "vitest";

const { findMany, upsert } = vi.hoisted(() => ({
  findMany: vi.fn(),
  upsert: vi.fn(),
}));

vi.mock("@/lib/prisma", () => {
  const prisma = { jobReviewStatus: { findMany, upsert } };
  return { prisma, default: prisma };
});

import {
  REVIEW_STATUS_ACTIONS,
  applyReviewStatusAction,
  readReviewStatuses,
  toReviewStatusRecord,
} from "../review-status";

afterEach(() => {
  findMany.mockReset();
  upsert.mockReset();
  vi.useRealTimers();
});

const KEY = { collectionId_jobId: { collectionId: "scol_1", jobId: "job_1" } };
const SELECT = { state: true, completedAt: true };

describe("toReviewStatusRecord", () => {
  it("행이 없으면 pending", () => {
    expect(toReviewStatusRecord("job_1", null)).toEqual({
      job_id: "job_1",
      review_status: "pending",
      review_completed_at: null,
    });
  });

  it("DONE 은 done 과 ISO 완료 시각", () => {
    expect(
      toReviewStatusRecord("job_1", {
        state: "DONE",
        completedAt: new Date("2026-10-29T01:02:03.000Z"),
      }),
    ).toEqual({
      job_id: "job_1",
      review_status: "done",
      review_completed_at: "2026-10-29T01:02:03.000Z",
    });
  });

  it("IN_PROGRESS 는 완료 시각이 남아 있어도 null", () => {
    expect(
      toReviewStatusRecord("job_1", {
        state: "IN_PROGRESS",
        completedAt: new Date(),
      }).review_completed_at,
    ).toBeNull();
  });
});

describe("readReviewStatuses", () => {
  it("빈 목록이면 DB 를 부르지 않는다", async () => {
    expect((await readReviewStatuses("scol_1", [])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("한 번에 조회하고 없는 id 는 pending 으로 채운다", async () => {
    findMany.mockResolvedValue([
      {
        jobId: "job_2",
        state: "DONE",
        completedAt: new Date("2026-10-29T00:00:00.000Z"),
      },
      { jobId: "job_3", state: "IN_PROGRESS", completedAt: null },
    ]);
    const result = await readReviewStatuses("scol_1", [
      "job_1",
      "job_2",
      "job_3",
      "job_1",
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany.mock.calls[0][0]).toMatchObject({
      where: {
        collectionId: "scol_1",
        jobId: { in: ["job_1", "job_2", "job_3"] },
      },
    });
    expect([...result.values()].map(r => r.review_status)).toEqual([
      "pending",
      "done",
      "in_progress",
    ]);
    expect(result.get("job_2")?.review_completed_at).toBe(
      "2026-10-29T00:00:00.000Z",
    );
  });
});

describe("applyReviewStatusAction", () => {
  it("동작 목록", () => {
    expect(REVIEW_STATUS_ACTIONS).toEqual(["start", "complete", "reopen"]);
  });

  it("start 는 없을 때만 만들고 있으면 바꾸지 않는다", async () => {
    upsert.mockResolvedValue({ state: "DONE", completedAt: new Date(0) });
    const record = await applyReviewStatusAction("scol_1", "job_1", "start");
    expect(upsert).toHaveBeenCalledWith({
      where: KEY,
      create: { collectionId: "scol_1", jobId: "job_1", state: "IN_PROGRESS" },
      update: {},
      select: SELECT,
    });
    expect(record.review_status).toBe("done");
  });

  it("complete 는 DONE 과 지금 시각", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-10-29T05:00:00.000Z");
    vi.setSystemTime(now);
    upsert.mockResolvedValue({ state: "DONE", completedAt: now });
    const record = await applyReviewStatusAction("scol_1", "job_1", "complete");
    expect(upsert).toHaveBeenCalledWith({
      where: KEY,
      create: {
        collectionId: "scol_1",
        jobId: "job_1",
        state: "DONE",
        completedAt: now,
      },
      update: { state: "DONE", completedAt: now },
      select: SELECT,
    });
    expect(record).toEqual({
      job_id: "job_1",
      review_status: "done",
      review_completed_at: "2026-10-29T05:00:00.000Z",
    });
  });

  it("reopen 은 IN_PROGRESS 로 바꾸고 완료 시각을 지운다", async () => {
    upsert.mockResolvedValue({ state: "IN_PROGRESS", completedAt: null });
    const record = await applyReviewStatusAction("scol_1", "job_1", "reopen");
    expect(upsert).toHaveBeenCalledWith({
      where: KEY,
      create: { collectionId: "scol_1", jobId: "job_1", state: "IN_PROGRESS" },
      update: { state: "IN_PROGRESS", completedAt: null },
      select: SELECT,
    });
    expect(record.review_status).toBe("in_progress");
  });
});
