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

function call(collectionId = "scol_1") {
  return GET(
    new NextRequest(
      `http://localhost:3000/api/search-collections/${collectionId}`,
    ),
    { params: Promise.resolve({ collectionId }) },
  );
}

describe("GET search-collections/{collectionId}", () => {
  it("collectionId 가 잘못되면 400", async () => {
    const res = await call("a.b");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_value",
      param: "collection_id",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upstream 상세를 Bearer 키로 조회하고 본문을 전달한다", async () => {
    const body = {
      id: "scol_1",
      total_job_count: 3,
      latest_config_ids: ["cfg_1"],
    };
    fetchMock.mockResolvedValue(jsonResponse(body, 200, { ETag: 'W/"d1"' }));
    const res = await call();

    const { url, headers } = upstreamCall();
    expect(url.pathname).toBe("/v2/search-collections/scol_1");
    expect(url.search).toBe("");
    expect(headers.get("authorization")).toBe("Bearer test-key");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    expect(res.headers.get("etag")).toBe('W/"d1"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("upstream 404 envelope 을 전달한다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "not_found", message: "Collection not found" } },
        404,
      ),
    );
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error).toMatchObject({
      code: "not_found",
      message: "Collection not found",
    });
  });

  it("fetch 가 실패하면 502 api_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });
});
