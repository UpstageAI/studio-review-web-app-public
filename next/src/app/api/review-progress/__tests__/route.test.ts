import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { countReviewOverview, countReviewProgressMany } = vi.hoisted(() => ({
  countReviewOverview: vi.fn(),
  countReviewProgressMany: vi.fn(),
}));

vi.mock("@/lib/review-status-aggregate", () => ({
  countReviewOverview,
  countReviewProgressMany,
}));

import { GET } from "../route";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  countReviewOverview.mockReset();
  countReviewProgressMany.mockReset();
  vi.restoreAllMocks();
});

function call(query = "") {
  return GET(
    new NextRequest(`http://localhost:3000/api/review-progress${query}`),
  );
}

const OVERVIEW = { done: 3, in_progress: 2, collections_in_progress: 1 };

describe("GET /api/review-progress", () => {
  it("Collection 별 수와 앱 전체 요약을 돌려주고 캐시하지 않는다", async () => {
    countReviewProgressMany.mockResolvedValue({
      scol_a: { done: 1, in_progress: 2 },
    });
    countReviewOverview.mockResolvedValue(OVERVIEW);
    const response = await call("?collection_ids=scol_a,scol_b,scol_a");
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      collections: { scol_a: { done: 1, in_progress: 2 } },
      overview: OVERVIEW,
    });
    // 같은 id 는 한 번만 센다.
    expect(countReviewProgressMany).toHaveBeenCalledWith(["scol_a", "scol_b"]);
  });

  it("id 가 없어도 앱 전체 요약은 돌려준다", async () => {
    countReviewProgressMany.mockResolvedValue({});
    countReviewOverview.mockResolvedValue(OVERVIEW);
    const response = await call();
    expect(response.status).toBe(200);
    expect(countReviewProgressMany).toHaveBeenCalledWith([]);
    expect((await response.json()).overview).toEqual(OVERVIEW);
  });

  it("id 가 100 개를 넘거나 형식이 틀리면 400", async () => {
    const many = Array.from({ length: 101 }, (_, i) => `scol_${i}`).join(",");
    expect((await call(`?collection_ids=${many}`)).status).toBe(400);
    expect((await call("?collection_ids=bad%20id")).status).toBe(400);
    expect(countReviewProgressMany).not.toHaveBeenCalled();
  });

  it("DB 를 읽지 못하면 503", async () => {
    countReviewProgressMany.mockRejectedValue(new Error("db down"));
    countReviewOverview.mockResolvedValue(OVERVIEW);
    const response = await call("?collection_ids=scol_a");
    expect(response.status).toBe(503);
  });
});
