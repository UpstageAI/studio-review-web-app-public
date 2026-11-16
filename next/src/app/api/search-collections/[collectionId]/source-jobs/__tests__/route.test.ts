import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReviewStatusRecord } from "@/lib/review-api/types";

const { readReviewStatuses } = vi.hoisted(() => ({
  readReviewStatuses: vi.fn(),
}));

vi.mock("@/lib/review-status", () => ({ readReviewStatuses }));

import { GET } from "../route";

const fetchMock = vi.fn<typeof fetch>();

/** 저장된 상태(job_id → 상태). 없는 id 는 pending 으로 채운다(실제 모듈과 같은 규칙). */
function storeStatuses(stored: Record<string, "in_progress" | "done">) {
  readReviewStatuses.mockImplementation(
    async (_collectionId: string, jobIds: readonly string[]) =>
      new Map<string, ReviewStatusRecord>(
        jobIds.map(jobId => [
          jobId,
          {
            job_id: jobId,
            review_status: stored[jobId] ?? "pending",
            review_completed_at:
              stored[jobId] === "done" ? "2026-10-29T00:00:00.000Z" : null,
          },
        ]),
      ),
  );
}

function row(jobId: string) {
  return { object: "search_collection.job_row", job_id: jobId };
}

function page(
  jobIds: string[],
  next: string | null,
  extra: Record<string, unknown> = {},
) {
  return {
    object: "list",
    data: jobIds.map(row),
    has_more: next !== null,
    first_id: jobIds[0] ?? null,
    last_id: jobIds.at(-1) ?? null,
    first_cursor: jobIds.length ? `first:${jobIds[0]}` : null,
    last_cursor: next,
    ...extra,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("UPSTAGE_API_KEY", "test-key");
  vi.stubEnv("UPSTAGE_CONSOLE_API_URL", "https://example.test");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
  readReviewStatuses.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function upstreamCall(): { url: URL; headers: Headers } {
  const [input, init] = fetchMock.mock.calls.at(-1)!;
  return { url: new URL(String(input)), headers: new Headers(init?.headers) };
}

function jsonResponse(body: unknown, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function call(query = "", collectionId = "scol_1") {
  return GET(
    new NextRequest(
      `http://localhost:3000/api/search-collections/${collectionId}/source-jobs${query}`,
    ),
    { params: Promise.resolve({ collectionId }) },
  );
}

describe("GET search-collections/{collectionId}/source-jobs", () => {
  it("collectionId 가 잘못되면 400", async () => {
    const res = await call("", "..");
    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe("collection_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("쿼리 값이 틀리면 400 이고 param 에 쿼리 이름을 담는다", async () => {
    for (const [query, param] of [
      ["?status=done", "status"],
      ["?group_by=config", "group_by"],
      ["?latest=1", "latest"],
      ["?limit=101", "limit"],
      ["?q=x", "q"],
      ["?config_id=a%2Fb", "config_id"],
      ["?before=%00", "before"],
      ["?review_status=reviewed", "review_status"],
      ["?review_status=done&before=cur_1", "before"],
    ]) {
      const res = await call(query);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatchObject({
        code: "invalid_value",
        param,
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("허용한 쿼리만 upstream 으로 보내고 행에 검수 상태를 붙여 돌려준다", async () => {
    const body = {
      object: "list",
      data: [
        {
          object: "search_collection.job_row",
          job_id: "job_1",
          status: "completed",
          files: [{ id: "file_1", filename: "a.pdf", num_pages: 2 }],
        },
      ],
      has_more: true,
      first_id: "job_1",
      last_id: "job_1",
      first_cursor: "cur_1",
      last_cursor: "cur_2",
    };
    fetchMock.mockResolvedValue(jsonResponse(body, 200, { ETag: '"e1"' }));
    storeStatuses({ job_1: "done" });
    const res = await call(
      `?status=completed&group_by=input_files&order=desc&limit=20&latest=true&q=${encodeURIComponent("보고서")}&config_id=cfg_1&shape_id=s_1&apply=auto`,
    );

    const { url, headers } = upstreamCall();
    expect(url.pathname).toBe("/v2/search-collections/scol_1/source-jobs");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "보고서",
      config_id: "cfg_1",
      latest: "true",
      status: "completed",
      limit: "20",
      order: "desc",
      group_by: "input_files",
    });
    expect(headers.get("authorization")).toBe("Bearer test-key");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ...body,
      data: [
        {
          ...body.data[0],
          review_status: "done",
          review_completed_at: "2026-10-29T00:00:00.000Z",
        },
      ],
    });
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("etag")).toBeNull();
    expect(readReviewStatuses).toHaveBeenCalledWith("scol_1", ["job_1"]);
  });

  it("review_status 는 upstream 으로 보내지 않고 상태로 거른다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(page(["j1", "j2", "j3"], null)));
    storeStatuses({ j1: "done", j2: "in_progress" });

    const res = await call("?review_status=done&limit=20");
    expect(Object.fromEntries(upstreamCall().url.searchParams)).toEqual({
      limit: "20",
    });
    const json = await res.json();
    expect(json.data.map((r: { job_id: string }) => r.job_id)).toEqual(["j1"]);
    expect(json).toMatchObject({
      has_more: false,
      first_id: "j1",
      last_id: "j1",
      first_cursor: "first:j1",
      last_cursor: null,
    });
  });

  it("unfinished 는 검수 전과 검수 중을 남기고 pending 은 기록 없는 행만", async () => {
    storeStatuses({ j1: "done", j2: "in_progress" });
    fetchMock.mockResolvedValue(jsonResponse(page(["j1", "j2", "j3"], null)));
    const unfinished = await (await call("?review_status=unfinished")).json();
    expect(unfinished.data.map((r: { job_id: string }) => r.job_id)).toEqual([
      "j2",
      "j3",
    ]);

    fetchMock.mockResolvedValue(jsonResponse(page(["j1", "j2", "j3"], null)));
    const pending = await (await call("?review_status=pending")).json();
    expect(pending.data.map((r: { job_id: string }) => r.job_id)).toEqual([
      "j3",
    ]);
  });

  it("거른 행이 limit 보다 적으면 다음 페이지를 이어 받아 합친다", async () => {
    storeStatuses({ a1: "done", b2: "done", c1: "done", c2: "done" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(page(["a1", "a2"], "cur_a")))
      .mockResolvedValueOnce(jsonResponse(page(["b1", "b2"], "cur_b")))
      .mockResolvedValueOnce(jsonResponse(page(["c1", "c2"], "cur_c")));

    const res = await call("?review_status=done&limit=3&order=desc");
    const json = await res.json();
    expect(json.data.map((r: { job_id: string }) => r.job_id)).toEqual([
      "a1",
      "b2",
      "c1",
      "c2",
    ]);
    expect(json).toMatchObject({
      has_more: true,
      first_cursor: "first:a1",
      last_cursor: "cur_c",
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const afters = fetchMock.mock.calls.map(([input]) =>
      new URL(String(input)).searchParams.get("after"),
    );
    expect(afters).toEqual([null, "cur_a", "cur_b"]);
    expect(upstreamCall().url.searchParams.get("order")).toBe("desc");
    expect(upstreamCall().url.searchParams.get("review_status")).toBeNull();
  });

  it("5 페이지까지만 이어 받고 마지막 커서를 남긴다", async () => {
    storeStatuses({});
    for (let i = 1; i <= 7; i += 1) {
      fetchMock.mockResolvedValueOnce(
        jsonResponse(page([`j${i}`], `cur_${i}`)),
      );
    }
    const json = await (await call("?review_status=done")).json();
    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(json).toMatchObject({
      data: [],
      has_more: true,
      first_id: null,
      last_id: null,
      last_cursor: "cur_5",
    });
  });

  it("다음 페이지가 실패하면 받은 데까지 돌려주고 직전 커서로 이어 받게 한다", async () => {
    storeStatuses({ j1: "done" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(page(["j1", "j2"], "cur_1")))
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: "rate_limited" } }, 429),
      );
    const res = await call("?review_status=done");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      data: [{ job_id: "j1", review_status: "done" }],
      has_more: true,
      last_cursor: "cur_1",
    });
  });

  it("has_more 여도 커서가 없으면 이어 받지 않는다", async () => {
    storeStatuses({});
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ ...page(["j1"], null), has_more: true }),
    );
    const json = await (await call("?review_status=done")).json();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(json.has_more).toBe(false);
  });

  it("DB 를 읽지 못하면 필터가 없을 때는 상태 없이 목록을 돌려준다", async () => {
    readReviewStatuses.mockRejectedValue(new Error("db down"));
    fetchMock.mockResolvedValue(jsonResponse(page(["j1"], null)));
    const res = await call();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toEqual([row("j1")]);
    expect(console.error).toHaveBeenCalled();
  });

  it("DB 를 읽지 못하면 필터가 있을 때는 503 review_status_unavailable", async () => {
    readReviewStatuses.mockRejectedValue(new Error("db down"));
    fetchMock.mockResolvedValue(jsonResponse(page(["j1"], null)));
    const res = await call("?review_status=done");
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error.code).toBe("review_status_unavailable");
    expect(JSON.stringify(json)).not.toContain("db down");
  });

  it("200 본문이 목록 JSON 이 아니면 502 upstream_error", async () => {
    for (const body of ["not json", JSON.stringify({ object: "list" })]) {
      fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
      const res = await call();
      expect(res.status).toBe(502);
      expect((await res.json()).error.code).toBe("upstream_error");
    }
    expect(readReviewStatuses).not.toHaveBeenCalled();
  });

  it("200 본문이 상한을 넘으면 502 response_too_large", async () => {
    fetchMock.mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "Content-Length": String(9 * 1024 * 1024) },
      }),
    );
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("response_too_large");
  });

  it("지원하지 않는 Collection 의 409 envelope 을 전달한다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "collection_source_type_unsupported",
            type: "invalid_request_error",
            message: "Source jobs are not available for this collection",
            param: null,
          },
        },
        409,
      ),
    );
    const res = await call("?status=completed");
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatchObject({
      code: "collection_source_type_unsupported",
      param: null,
    });
  });

  it("fetch 가 실패하면 502 api_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });
});
