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
  revisionId = "rvn_1",
  headers = {} as Record<string, string>,
} = {}) {
  return GET(
    new NextRequest(
      `http://localhost:3000/api/search-collections/${collectionId}/source-jobs/${jobId}/revisions/${revisionId}`,
      { headers },
    ),
    { params: Promise.resolve({ collectionId, jobId, revisionId }) },
  );
}

describe("GET search-collections/{collectionId}/source-jobs/{jobId}/revisions/{revisionId}", () => {
  it("upstream 단건 경로를 부르고 본문·ETag 를 전달한다", async () => {
    const text =
      '{"id":"rvn_1","content":{"n":12345678901234567890},"base_content":null}';
    fetchMock.mockResolvedValue(
      new Response(text, {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: '"rev-rvn_1"' },
      }),
    );
    const res = await call();
    expect(upstreamCall().url.pathname).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/revisions/rvn_1",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBe('"rev-rvn_1"');
    expect(await res.text()).toBe(text);
  });

  it("요청의 If-None-Match 를 upstream 으로 넘기지 않는다", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ id: "rvn_1" }));
    await call({ headers: { "If-None-Match": '"rev-rvn_1"' } });
    expect(upstreamCall().headers.has("if-none-match")).toBe(false);
  });

  it("404 revision_not_found 를 전달한다", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "revision_not_found", message: "no revision" } },
        404,
      ),
    );
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("revision_not_found");
  });

  it.each([
    [{ collectionId: "a b" }, "collection_id"],
    [{ jobId: "../x" }, "job_id"],
    [{ revisionId: "r/1" }, "revision_id"],
  ])("잘못된 id 는 400 (%o)", async (ids, param) => {
    const res = await call(ids);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_value",
      param,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("다른 사이트에서 온 요청은 403 이고 upstream 을 부르지 않는다", async () => {
    const res = await call({ headers: { "Sec-Fetch-Site": "cross-site" } });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
