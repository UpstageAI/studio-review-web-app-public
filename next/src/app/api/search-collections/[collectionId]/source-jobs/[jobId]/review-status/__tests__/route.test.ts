import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { applyReviewStatusAction } = vi.hoisted(() => ({
  applyReviewStatusAction: vi.fn(),
}));

vi.mock("@/lib/review-status", () => ({
  REVIEW_STATUS_ACTIONS: ["start", "complete", "reopen"],
  applyReviewStatusAction,
}));

import { PUT } from "../route";

const URL_BASE =
  "http://localhost:3000/api/search-collections/scol_1/source-jobs/job_1/review-status";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  applyReviewStatusAction.mockReset();
  vi.restoreAllMocks();
});

function call(
  body: BodyInit | null,
  opts: {
    headers?: Record<string, string>;
    collectionId?: string;
    jobId?: string;
  } = {},
) {
  const request = new NextRequest(URL_BASE, {
    method: "PUT",
    headers: {
      host: "localhost:3000",
      "Content-Type": "application/json",
      ...opts.headers,
    },
    body,
  });
  return PUT(request, {
    params: Promise.resolve({
      collectionId: opts.collectionId ?? "scol_1",
      jobId: opts.jobId ?? "job_1",
    }),
  });
}

describe("PUT source-jobs/{jobId}/review-status", () => {
  it("다른 origin 에서 온 요청은 403", async () => {
    const res = await call('{"action":"start"}', {
      headers: { origin: "https://evil.test" },
    });
    expect(res.status).toBe(403);
    expect(applyReviewStatusAction).not.toHaveBeenCalled();
  });

  it("id 가 잘못되면 400", async () => {
    for (const [opts, param] of [
      [{ collectionId: ".." }, "collection_id"],
      [{ jobId: "a/b" }, "job_id"],
    ] as const) {
      const res = await call('{"action":"start"}', opts);
      expect(res.status).toBe(400);
      expect((await res.json()).error.param).toBe(param);
    }
    expect(applyReviewStatusAction).not.toHaveBeenCalled();
  });

  it("action 이 없거나 모르는 값이면 400 param action", async () => {
    for (const body of [
      "",
      "not json",
      "null",
      "{}",
      '{"action":"done"}',
      '{"state":"done"}',
    ]) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatchObject({
        code: "invalid_value",
        param: "action",
      });
    }
    expect(applyReviewStatusAction).not.toHaveBeenCalled();
  });

  it("본문이 1 KiB 를 넘으면 400 param body", async () => {
    const res = await call(
      JSON.stringify({ action: "start", pad: "x".repeat(2000) }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_value",
      param: "body",
    });
    expect(applyReviewStatusAction).not.toHaveBeenCalled();
  });

  it("상태를 바꾸고 기록을 돌려준다", async () => {
    const record = {
      job_id: "job_1",
      review_status: "done",
      review_completed_at: "2026-10-29T00:00:00.000Z",
    };
    applyReviewStatusAction.mockResolvedValue(record);
    const res = await call('{"action":"complete","extra":1}');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(record);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(applyReviewStatusAction).toHaveBeenCalledWith(
      "scol_1",
      "job_1",
      "complete",
    );
  });

  it("DB 오류는 503 review_status_unavailable 이고 오류 내용을 넣지 않는다", async () => {
    applyReviewStatusAction.mockRejectedValue(new Error("secret dsn"));
    const res = await call('{"action":"reopen"}');
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe("review_status_unavailable");
    expect(JSON.stringify(json)).not.toContain("secret");
    expect(console.error).toHaveBeenCalled();
  });
});
