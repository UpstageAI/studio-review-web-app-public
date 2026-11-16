import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { figureCache, figureCacheKey } from "@/app/api/_lib/figure-cache";
import { JOB_RESPONSE_MAX_BYTES } from "@/app/api/_lib/job-response-figures";

import { GET } from "../route";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  figureCache.clear();
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
      `http://localhost:3000/api/search-collections/${collectionId}/source-jobs/${jobId}/response`,
    ),
    { params: Promise.resolve({ collectionId, jobId }) },
  );
}

describe("GET search-collections/{collectionId}/source-jobs/{jobId}/response", () => {
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

  it("upstream Job 응답을 Bearer 키로 조회하고 그림이 없는 본문은 바꾸지 않고 전달한다", async () => {
    // 숫자 토큰(큰 정수)이 그대로 오가는지 문자열로 비교한다.
    const text =
      '{"id":"job_1","output":[{"id":"r1","step_type":"information-extract","content":[{"type":"output_text","text":"{\\"n\\":12345678901234567890}"}]}],"n":12345678901234567890}';
    fetchMock.mockResolvedValue(
      new Response(text, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "session=1",
        },
      }),
    );
    const res = await call();

    const { url, headers } = upstreamCall();
    expect(url.pathname).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/response",
    );
    expect(headers.get("authorization")).toBe("Bearer test-key");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(text);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(figureCache.size).toBe(0);
  });

  it("Parse 그림의 base64_encoding 을 캐시에 넣고 figure_url 로 바꾸며 ETag 는 넘기지 않는다", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const parseText = JSON.stringify({
      elements: [
        {
          id: 0,
          page: 1,
          category: "figure",
          base64_encoding: png.toString("base64"),
        },
        { id: 1, page: 1, category: "paragraph", base64_encoding: null },
      ],
    });
    const text = JSON.stringify({
      id: "job_1",
      output: [
        {
          step_type: "document-parse",
          content: [{ type: "output_text", text: parseText }],
        },
      ],
    }).replace('"id":"job_1"', '"id":"job_1","n":12345678901234567890');
    fetchMock.mockResolvedValue(
      new Response(text, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          ETag: '"abc"',
        },
      }),
    );
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toBeNull();
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(res.headers.get("cache-control")).toBe("private, no-store");

    const body = await res.text();
    // 문자열 값의 base64_encoding 쌍은 사라지고 null 은 남는다.
    expect(body).not.toMatch(/base64_encoding\\?"\s*:\s*\\?"/);
    expect(body).toContain('"n":12345678901234567890');
    const parsed = JSON.parse(body);
    const elements = JSON.parse(parsed.output[0].content[0].text).elements;
    expect(elements[0].figure_url).toBe(
      "/api/search-collections/scol_1/source-jobs/job_1/figures/f1",
    );
    expect(elements[1]).toEqual({
      id: 1,
      page: 1,
      category: "paragraph",
      base64_encoding: null,
    });

    const cached = figureCache.get(figureCacheKey("scol_1", "job_1", "f1"));
    expect(cached?.contentType).toBe("image/png");
    expect(Buffer.from(cached!.bytes).equals(png)).toBe(true);
    expect(figureCache.size).toBe(1);
  });

  it("content-length 가 상한을 넘으면 본문을 읽지 않고 502 response_too_large", async () => {
    const seen = { pulls: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        seen.pulls += 1;
        controller.enqueue(new Uint8Array(1024).fill(0x20));
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    fetchMock.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "content-length": String(JOB_RESPONSE_MAX_BYTES + 1),
        },
      }),
    );
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("response_too_large");
    // 스트림은 만들어질 때 한 chunk 를 미리 당길 수 있지만 라우트가 읽지는 않는다.
    expect(seen.pulls).toBeLessThanOrEqual(1);
    expect(seen.cancelled).toBe(true);
  });

  it("스트림으로 읽은 본문이 상한을 넘으면 거기서 멈추고 502", async () => {
    const chunk = 4 * 1024 * 1024;
    const seen = { pulls: 0, cancelled: false };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        seen.pulls += 1;
        controller.enqueue(new Uint8Array(chunk).fill(0x20));
      },
      cancel() {
        seen.cancelled = true;
      },
    });
    fetchMock.mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("response_too_large");
    expect(seen.cancelled).toBe(true);
    expect(seen.pulls).toBeGreaterThan(JOB_RESPONSE_MAX_BYTES / chunk);
    expect(seen.pulls).toBeLessThan(JOB_RESPONSE_MAX_BYTES / chunk + 4);
  });

  it("upstream 304 는 본문 없이 그대로 전달한다", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, { status: 304, headers: { ETag: '"abc"' } }),
    );
    const res = await call();
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe('"abc"');
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

  it("upstream 502 는 envelope 로 전달한다", async () => {
    fetchMock.mockResolvedValue(
      new Response("<html>bad gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("upstream_error");
  });

  it("fetch 가 실패하면 502 api_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });
});

describe("GET search-collections/{collectionId}/source-jobs/{jobId}/response — 다른 사이트 요청", () => {
  function siteRequest(headers: Record<string, string>) {
    return GET(
      new NextRequest(
        "http://localhost:3000/api/search-collections/scol_1/source-jobs/job_1/response",
        { headers },
      ),
      { params: Promise.resolve({ collectionId: "scol_1", jobId: "job_1" }) },
    );
  }

  it.each(["cross-site", "same-site"])(
    "Sec-Fetch-Site 가 %s 면 upstream 을 부르지 않고 403",
    async site => {
      const res = await siteRequest({ "Sec-Fetch-Site": site });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("forbidden");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each<Record<string, string>>([{}, { "Sec-Fetch-Site": "same-origin" }])(
    "Sec-Fetch-Site 가 없거나 same-origin 이면 조회한다 (%j)",
    async headers => {
      fetchMock.mockImplementation(async () => jsonResponse({ id: "job_1" }));
      const res = await siteRequest(headers);
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
