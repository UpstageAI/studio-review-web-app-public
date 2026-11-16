import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { countReviewProgress } = vi.hoisted(() => ({
  countReviewProgress: vi.fn(),
}));

vi.mock("@/lib/review-status-aggregate", () => ({ countReviewProgress }));

import { GET } from "../route";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  countReviewProgress.mockReset();
  vi.restoreAllMocks();
});

function call(collectionId = "scol_1") {
  return GET(
    new NextRequest(
      `http://localhost:3000/api/search-collections/${collectionId}/review-progress`,
    ),
    { params: Promise.resolve({ collectionId }) },
  );
}

describe("GET search-collections/{collectionId}/review-progress", () => {
  it("collectionId 가 잘못되면 400", async () => {
    const res = await call("..");
    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe("collection_id");
    expect(countReviewProgress).not.toHaveBeenCalled();
  });

  it("상태별 수를 돌려준다", async () => {
    countReviewProgress.mockResolvedValue({ done: 3, in_progress: 1 });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ done: 3, in_progress: 1 });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(countReviewProgress).toHaveBeenCalledWith("scol_1");
  });

  it("DB 오류는 503 review_status_unavailable", async () => {
    countReviewProgress.mockRejectedValue(new Error("down"));
    const res = await call();
    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe("review_status_unavailable");
  });
});
