import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { upstageFetch } from "../client";
import { upstageEndpoints } from "../endpoints";
import {
  UpstageConfigError,
  UpstreamNetworkError,
  UpstreamRedirectError,
} from "../errors";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("UPSTAGE_API_KEY", "test-key");
  vi.stubEnv("UPSTAGE_CONSOLE_API_URL", "https://example.test/");
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function lastCall(): { url: URL; init: RequestInit } {
  const [input, init] = fetchMock.mock.calls.at(-1)!;
  return { url: new URL(String(input)), init: init ?? {} };
}

const documentPath =
  upstageEndpoints.searchCollections.reviewDocument("scol_1");

describe("upstageFetch", () => {
  it("base URL + path 에 배열 쿼리를 반복 키로 붙인다", async () => {
    await upstageFetch(documentPath, {
      query: { job_ids: ["a", "b"], apply: "auto", skip: undefined },
    });
    const { url } = lastCall();
    expect(url.origin).toBe("https://example.test");
    expect(url.pathname).toBe(documentPath);
    expect(url.searchParams.getAll("job_ids")).toEqual(["a", "b"]);
    expect(url.searchParams.get("apply")).toBe("auto");
    expect(url.searchParams.has("skip")).toBe(false);
  });

  it("base URL 의 경로 prefix 를 유지한다", async () => {
    vi.stubEnv("UPSTAGE_CONSOLE_API_URL", "https://example.test/gateway");
    await upstageFetch(documentPath);
    expect(lastCall().url.pathname).toBe(`/gateway${documentPath}`);
  });

  it("Bearer 키를 넣고 호출자의 Authorization 은 무시한다", async () => {
    await upstageFetch(documentPath, {
      headers: { Authorization: "Bearer other", "If-None-Match": '"v1"' },
    });
    const headers = new Headers(lastCall().init.headers);
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("if-none-match")).toBe('"v1"');
  });

  it("no-store · redirect manual · timeout signal 로 호출한다", async () => {
    await upstageFetch(documentPath, { method: "POST", body: "x" });
    const { init } = lastCall();
    expect(init.method).toBe("POST");
    expect(init.cache).toBe("no-store");
    expect(init.redirect).toBe("manual");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(init.body).toBe("x");
  });

  it.each(["/v1/search-collections", "v2/files/x", "https://evil.test/v2/x"])(
    "/v2/ 로 시작하지 않는 path %j 는 throw",
    async path => {
      await expect(upstageFetch(path)).rejects.toThrow(/\/v2\//);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("인코딩되지 않은 `..` 로 base 를 벗어나면 throw", async () => {
    vi.stubEnv("UPSTAGE_CONSOLE_API_URL", "https://example.test/gateway");
    await expect(upstageFetch("/v2/../../admin")).rejects.toThrow(/escapes/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("키가 없으면 fetch 전에 UpstageConfigError", async () => {
    vi.stubEnv("UPSTAGE_API_KEY", "");
    await expect(upstageFetch(documentPath)).rejects.toBeInstanceOf(
      UpstageConfigError,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("3xx 응답은 UpstreamRedirectError", async () => {
    fetchMock.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { Location: "https://other.test/" },
      }),
    );
    const err = await upstageFetch(documentPath).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamRedirectError);
    expect((err as UpstreamRedirectError).status).toBe(302);
  });

  it("304 는 redirect 가 아니므로 그대로 반환한다", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 304 }));
    const res = await upstageFetch(documentPath);
    expect(res.status).toBe(304);
  });

  it("fetch reject 는 UpstreamNetworkError(timedOut: false)", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const err = await upstageFetch(documentPath).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamNetworkError);
    expect((err as UpstreamNetworkError).timedOut).toBe(false);
  });

  it("TimeoutError 는 UpstreamNetworkError(timedOut: true)", async () => {
    fetchMock.mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    const err = await upstageFetch(documentPath).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UpstreamNetworkError);
    expect((err as UpstreamNetworkError).timedOut).toBe(true);
  });

  it("4xx 응답은 그대로 반환한다", async () => {
    const upstream = new Response('{"error":{"code":"not_found"}}', {
      status: 404,
    });
    fetchMock.mockResolvedValue(upstream);
    const res = await upstageFetch(documentPath);
    expect(res).toBe(upstream);
    expect(res.status).toBe(404);
  });
});
