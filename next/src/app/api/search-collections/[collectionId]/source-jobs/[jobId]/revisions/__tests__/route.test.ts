import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../route";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("UPSTAGE_API_KEY", "test-key");
  vi.stubEnv("UPSTAGE_CONSOLE_API_URL", "https://example.test");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  fetchMock.mockReset();
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

function call({
  collectionId = "scol_1",
  jobId = "job_1",
  search = "",
  headers = {} as Record<string, string>,
} = {}) {
  return GET(
    new NextRequest(
      `http://localhost:3000/api/search-collections/${collectionId}/source-jobs/${jobId}/revisions${search}`,
      { headers },
    ),
    { params: Promise.resolve({ collectionId, jobId }) },
  );
}

const PAGE = {
  object: "list",
  data: [],
  first_id: null,
  last_id: null,
  has_more: false,
};

describe("GET search-collections/{collectionId}/source-jobs/{jobId}/revisions", () => {
  it("upstream revisions 경로를 Bearer 키로 부른다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAGE));
    const res = await call();
    const { url, headers } = upstreamCall();
    expect(url.pathname).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/revisions",
    );
    expect(url.search).toBe("");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("허용한 쿼리 8 종을 전달하고 모르는 쿼리는 버린다", async () => {
    fetchMock.mockResolvedValue(jsonResponse(PAGE));
    await call({
      search:
        "?type=result&occurrence_id=occ_1&job_result_id=jres_1&operation_id=rvop_1" +
        "&include=content&after=rvn_9&limit=100&order=asc&sort=asc&x=1",
    });
    const params = Object.fromEntries(upstreamCall().url.searchParams);
    expect(params).toEqual({
      type: "result",
      occurrence_id: "occ_1",
      job_result_id: "jres_1",
      operation_id: "rvop_1",
      include: "content",
      after: "rvn_9",
      limit: "100",
      order: "asc",
    });
  });

  it.each([
    ["limit=0", "limit"],
    ["limit=101", "limit"],
    ["type=x", "type"],
    ["include=all", "include"],
    ["order=up", "order"],
    ["occurrence_id=a%20b", "occurrence_id"],
  ])("%s 이면 400 이고 upstream 을 부르지 않는다", async (search, param) => {
    const res = await call({ search: `?${search}` });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_value",
      param,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ collectionId: "a b" }, "collection_id"],
    [{ jobId: "../x" }, "job_id"],
  ])("잘못된 id 는 400 (%o)", async (ids, param) => {
    const res = await call(ids);
    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe(param);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("다른 사이트에서 온 요청은 403 이고 upstream 을 부르지 않는다", async () => {
    const res = await call({ headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("429 와 Retry-After 를 전달한다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "operation_capacity_exceeded", message: "busy" } },
        429,
        { "Retry-After": "2" },
      ),
    );
    const res = await call();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("2");
    expect((await res.json()).error.code).toBe("operation_capacity_exceeded");
  });

  it("invalid_cursor 를 전달한다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "invalid_cursor",
            message: "unknown cursor",
            param: "after",
          },
        },
        400,
      ),
    );
    const res = await call({ search: "?after=nope" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_cursor",
      param: "after",
    });
  });

  it("200 본문을 바이트 그대로 전달한다(큰 수 보존)", async () => {
    const text =
      '{"object":"list","data":[{"id":"rvn_1","content":{"n":12345678901234567890,"total":1.10}}],"has_more":false}';
    fetchMock.mockResolvedValue(
      new Response(text, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await call({ search: "?include=content" });
    expect(await res.text()).toBe(text);
  });

  it("fetch 가 실패하면 502 api_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });
});
