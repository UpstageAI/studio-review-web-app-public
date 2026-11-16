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

function call(query = "") {
  return GET(
    new NextRequest(`http://localhost:3000/api/search-collections${query}`),
  );
}

describe("GET search-collections", () => {
  it("쿼리 값이 틀리면 400 이고 param 에 쿼리 이름을 담는다", async () => {
    for (const [query, param] of [
      ["?limit=0", "limit"],
      ["?kind=images", "kind"],
      ["?include_default=yes", "include_default"],
      ["?is_default=1", "is_default"],
      ["?listed=yes", "listed"],
      ["?q=a", "q"],
      ["?order=up", "order"],
      ["?after=a%20b", "after"],
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

  it("허용한 쿼리만 upstream 으로 보내고 본문·ETag 를 전달한다", async () => {
    const body = { object: "list", data: [{ id: "scol_1" }], has_more: false };
    fetchMock.mockResolvedValue(jsonResponse(body, 200, { ETag: 'W/"l1"' }));
    const res = await call(
      "?kind=documents&include_default=true&limit=20&order=desc&after=cur_1&project_id=p_1",
    );

    const { url, headers } = upstreamCall();
    expect(url.origin).toBe("https://example.test");
    expect(url.pathname).toBe("/v2/search-collections");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      kind: "documents",
      include_default: "true",
      limit: "20",
      order: "desc",
      after: "cur_1",
    });
    expect(headers.get("authorization")).toBe("Bearer test-key");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(body);
    expect(res.headers.get("etag")).toBe('W/"l1"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is_default 를 upstream 으로 전달한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ object: "list", data: [] }));
    await call("?kind=documents&include_default=true&is_default=false");

    expect(Object.fromEntries(upstreamCall().url.searchParams)).toEqual({
      kind: "documents",
      include_default: "true",
      is_default: "false",
    });
  });

  it("listed 를 upstream 으로 전달한다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ object: "list", data: [] }));
    await call("?kind=documents&listed=true");

    expect(Object.fromEntries(upstreamCall().url.searchParams)).toEqual({
      kind: "documents",
      listed: "true",
    });
  });

  it("upstream 오류 envelope 을 상태 코드와 함께 전달한다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error: {
            code: "invalid_cursor",
            type: "invalid_request_error",
            message: "bad cursor",
            param: "after",
          },
        },
        400,
      ),
    );
    const res = await call("?after=stale");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({
      code: "invalid_cursor",
      type: "invalid_request_error",
      message: "bad cursor",
      param: "after",
    });
  });

  it("fetch 가 실패하면 502 api_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });

  it("UPSTAGE_API_KEY 가 없으면 500 server_misconfigured", async () => {
    vi.stubEnv("UPSTAGE_API_KEY", "");
    const res = await call();
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe("server_misconfigured");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
