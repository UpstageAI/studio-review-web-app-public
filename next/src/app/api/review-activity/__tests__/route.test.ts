import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { countReviewOverview, readReviewActivity } = vi.hoisted(() => ({
  countReviewOverview: vi.fn(),
  readReviewActivity: vi.fn(),
}));

vi.mock("@/lib/review-status-aggregate", () => ({
  countReviewOverview,
  readReviewActivity,
}));

import { GET } from "../route";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  countReviewOverview.mockReset();
  readReviewActivity.mockReset();
  vi.restoreAllMocks();
});

function call(query = "") {
  return GET(
    new NextRequest(`http://localhost:3000/api/review-activity${query}`),
  );
}

const OVERVIEW = { done: 2, in_progress: 1, collections_in_progress: 1 };
const ROW = {
  collection_id: "scol_1",
  job_id: "job_1",
  review_status: "in_progress",
  started_at: "2026-11-03T00:00:00.000Z",
  completed_at: null,
  updated_at: "2026-11-03T00:00:00.000Z",
};

describe("GET /api/review-activity", () => {
  it("잘못된 limit 는 400 이고 DB 를 읽지 않는다", async () => {
    const res = await call("?limit=21");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_value",
      param: "limit",
    });
    expect(readReviewActivity).not.toHaveBeenCalled();
    expect(countReviewOverview).not.toHaveBeenCalled();
  });

  it("잘못된 jobs 는 400", async () => {
    const res = await call("?jobs=scol_1");
    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe("jobs");
  });

  it("최근 행, 물은 Job 의 행, 앱 전체 요약을 돌려준다", async () => {
    readReviewActivity.mockResolvedValue({ recent: [ROW], jobs: [ROW] });
    countReviewOverview.mockResolvedValue(OVERVIEW);
    const res = await call("?limit=5&jobs=scol_1:job_1");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      data: [ROW],
      jobs: [ROW],
      overview: OVERVIEW,
    });
    expect(readReviewActivity).toHaveBeenCalledWith(5, [
      { collectionId: "scol_1", jobId: "job_1" },
    ]);
  });

  it("limit 가 없으면 8 행", async () => {
    readReviewActivity.mockResolvedValue({ recent: [], jobs: [] });
    countReviewOverview.mockResolvedValue(OVERVIEW);
    await call();
    expect(readReviewActivity).toHaveBeenCalledWith(8, []);
  });

  it("DB 오류는 503 review_status_unavailable", async () => {
    readReviewActivity.mockRejectedValue(new Error("down"));
    countReviewOverview.mockResolvedValue(OVERVIEW);
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("review_status_unavailable");
  });
});
