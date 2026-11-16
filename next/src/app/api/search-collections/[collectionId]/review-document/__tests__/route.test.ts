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

function call(
  query: string,
  { collectionId = "scol_1", headers = {} as Record<string, string> } = {},
) {
  const request = new NextRequest(
    `http://localhost:3000/api/search-collections/${collectionId}/review-document${query}`,
    { headers },
  );
  return GET(request, { params: Promise.resolve({ collectionId }) });
}

function upstreamCall(): { url: URL; headers: Headers } {
  const [input, init] = fetchMock.mock.calls.at(-1)!;
  return { url: new URL(String(input)), headers: new Headers(init?.headers) };
}

describe("GET review-document", () => {
  it("job_ids 가 없으면 400", async () => {
    const res = await call("");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_value",
      param: "job_ids",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("job_ids 가 100 개를 넘으면 400", async () => {
    const query = Array.from(
      { length: 101 },
      (_, i) => `job_ids=job_${i}`,
    ).join("&");
    const res = await call(`?${query}`);
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("job_id 에 허용하지 않는 문자가 있으면 400", async () => {
    const res = await call("?job_ids=job_1&job_ids=..%2Fx");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("collectionId 가 잘못되면 400", async () => {
    const res = await call("?job_ids=job_1", { collectionId: "a.b" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe("collection_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upstream 에 job_ids 반복 쿼리·Bearer 키를 보내고 본문을 그대로 전달한다", async () => {
    const raw = '{"format":"collection-results/11","n":12345678901234567890}';
    fetchMock.mockResolvedValue(
      new Response(raw, {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: 'W/"v1"' },
      }),
    );
    const res = await call("?job_ids=job_a&job_ids=job_b", {
      headers: { "If-None-Match": 'W/"v0"' },
    });

    const { url, headers } = upstreamCall();
    expect(url.origin).toBe("https://example.test");
    expect(url.pathname).toBe("/v2/search-collections/scol_1/review-document");
    expect(url.searchParams.getAll("job_ids")).toEqual(["job_a", "job_b"]);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("if-none-match")).toBe('W/"v0"');

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(raw);
    expect(res.headers.get("etag")).toBe('W/"v1"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("304 를 본문 없이 전달한다", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 304, headers: { ETag: 'W/"v1"' } }),
    );
    const res = await call("?job_ids=job_a", {
      headers: { "If-None-Match": 'W/"v1"' },
    });
    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
    expect(res.headers.get("etag")).toBe('W/"v1"');
  });

  it("fetch 가 실패하면 502 api_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call("?job_ids=job_a");
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });

  it("UPSTAGE_API_KEY 가 없으면 500 server_misconfigured 이고 변수명을 노출하지 않는다", async () => {
    vi.stubEnv("UPSTAGE_API_KEY", "");
    const res = await call("?job_ids=job_a");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("server_misconfigured");
    expect(text).not.toContain("UPSTAGE_API_KEY");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
