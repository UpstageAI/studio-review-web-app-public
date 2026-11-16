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

function call({ collectionId = "scol_1", jobId = "job_1" } = {}) {
  return GET(
    new NextRequest(
      `http://localhost:3000/api/search-collections/${collectionId}/source-jobs/${jobId}/files`,
    ),
    { params: Promise.resolve({ collectionId, jobId }) },
  );
}

describe("GET search-collections/{collectionId}/source-jobs/{jobId}/files", () => {
  it("collectionId 가 잘못되면 400", async () => {
    const res = await call({ collectionId: "a b" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe("collection_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("jobId 가 잘못되면 400", async () => {
    const res = await call({ jobId: "../x" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_value",
      param: "job_id",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upstream 파일 목록을 Bearer 키로 조회하고 본문을 전달한다", async () => {
    const body = {
      object: "list",
      data: [{ id: "file_1", filename: "a.pdf", num_pages: 3 }],
    };
    fetchMock.mockResolvedValue(jsonResponse(body));
    const res = await call();

    const { url, headers } = upstreamCall();
    expect(url.pathname).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/files",
    );
    expect(headers.get("authorization")).toBe("Bearer test-key");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("다른 Collection 의 Job 이면 upstream 404 를 전달한다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "job_not_found", message: "no job" } },
        404,
      ),
    );
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("job_not_found");
  });

  it("fetch 가 실패하면 502 api_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });
});
