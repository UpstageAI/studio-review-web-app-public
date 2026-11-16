import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  UpstageConfigError,
  UpstreamNetworkError,
  UpstreamRedirectError,
} from "@/lib/upstage/errors";

import {
  errorResponse,
  invalidValue,
  mapClientError,
  relayUpstream,
} from "../upstream-relay";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("relayUpstream", () => {
  it("성공 본문을 바이트 그대로 전달하고 허용 헤더만 남긴다", async () => {
    const raw = '{"value":12345678901234567890,"score":0.10000000000000000001}';
    const upstream = new Response(raw, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ETag: 'W/"v1"',
        "Cache-Control": "private, no-cache",
        Location: "https://upstream.test/v2/x",
        "X-Internal": "secret",
      },
    });
    const res = await relayUpstream(upstream);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(raw);
    expect(res.headers.get("content-type")).toBe("application/json");
    expect(res.headers.get("etag")).toBe('W/"v1"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.has("location")).toBe(false);
    expect(res.headers.has("x-internal")).toBe(false);
  });

  it("압축된 upstream 응답의 Content-Length 를 전달하지 않는다", async () => {
    const raw = JSON.stringify({ text: "x".repeat(5000) });
    const upstream = new Response(raw, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "Content-Length": "50",
      },
    });
    const res = await relayUpstream(upstream);
    expect(res.headers.has("content-length")).toBe(false);
    expect(res.headers.has("content-encoding")).toBe(false);
    expect(await res.text()).toBe(raw);
  });

  it("202 의 Retry-After 를 전달한다", async () => {
    const res = await relayUpstream(
      new Response('{"id":"rvop_1"}', {
        status: 202,
        headers: { "Retry-After": "2", "Content-Type": "application/json" },
      }),
    );
    expect(res.status).toBe(202);
    expect(res.headers.get("retry-after")).toBe("2");
  });

  it("304 는 본문 없이 ETag 만 전달한다", async () => {
    const res = await relayUpstream(
      new Response(null, { status: 304, headers: { ETag: 'W/"v1"' } }),
    );
    expect(res.status).toBe(304);
    expect(res.body).toBeNull();
    expect(res.headers.get("etag")).toBe('W/"v1"');
  });

  it("오류 envelope 은 허용 필드만 다시 만든다", async () => {
    const res = await relayUpstream(
      Response.json(
        {
          error: {
            code: "review_target_not_found",
            type: "not_found",
            message: "Job not found",
            param: "job_ids",
            details: { job_ids: ["job_x"] },
            stack: "Traceback …",
          },
          debug: { host: "internal" },
        },
        { status: 404 },
      ),
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      error: {
        code: "review_target_not_found",
        type: "not_found",
        message: "Job not found",
        param: "job_ids",
        details: { job_ids: ["job_x"] },
      },
    });
  });

  it("429 의 Retry-After 를 유지한다", async () => {
    const res = await relayUpstream(
      Response.json(
        { error: { code: "operation_capacity_exceeded", message: "busy" } },
        { status: 429, headers: { "Retry-After": "5" } },
      ),
    );
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("5");
    expect((await res.json()).error.code).toBe("operation_capacity_exceeded");
  });

  it("JSON 이 아닌 오류는 upstream_error 로 감싸고 태그를 지우고 자른다", async () => {
    const html = `<html><body><h1>Bad Gateway</h1>${"x".repeat(2000)}</body></html>`;
    const res = await relayUpstream(
      new Response(html, {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(res.status).toBe(502);
    const { error } = await res.json();
    expect(error.code).toBe("upstream_error");
    expect(error.message).not.toContain("<");
    expect(error.message.startsWith("Bad Gateway")).toBe(true);
    expect(error.message.length).toBeLessThanOrEqual(801);
  });

  it("오류 본문이 64 KiB 를 넘으면 읽기를 멈추고 상태 코드 문구만 쓴다", async () => {
    const limit = 64 * 1024;
    let sent = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent > limit * 4) {
          controller.close();
          return;
        }
        const chunk = new TextEncoder().encode(`<p>${"x".repeat(8189)}</p>`);
        sent += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      },
    });
    const res = await relayUpstream(
      new Response(stream, {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(res.status).toBe(502);
    const { error } = await res.json();
    expect(error.code).toBe("upstream_error");
    expect(error.message).toBe("Upstream responded with status 502");
    expect(cancelled).toBe(true);
    expect(sent).toBeLessThan(limit * 2);
  });

  it("64 KiB 이하의 JSON 아닌 오류 본문은 앞부분을 메시지로 쓴다", async () => {
    const text = `<p>${"y".repeat(64 * 1024 - 7)}</p>`;
    expect(new TextEncoder().encode(text).byteLength).toBe(64 * 1024);
    const res = await relayUpstream(
      new Response(text, {
        status: 503,
        headers: { "Content-Type": "text/html" },
      }),
    );
    const { error } = await res.json();
    expect(error.code).toBe("upstream_error");
    expect(error.message).toBe(`${"y".repeat(800)}…`);
  });

  it("JSON 이라도 envelope 모양이 아니면 upstream_error 로 감싼다", async () => {
    const res = await relayUpstream(
      Response.json({ detail: "boom" }, { status: 500 }),
    );
    expect((await res.json()).error.code).toBe("upstream_error");
  });
});

describe("errorResponse", () => {
  it("envelope 모양과 no-store 헤더를 쓴다", async () => {
    const res = errorResponse(503, "x_code", "msg", { retryAfter: "3" });
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("retry-after")).toBe("3");
    expect(await res.json()).toEqual({
      error: { code: "x_code", type: "x_code", message: "msg", param: null },
    });
  });

  it("invalidValue 는 400 invalid_value 다", async () => {
    const res = invalidValue("bad", "job_ids");
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_value",
      param: "job_ids",
    });
  });
});

describe("mapClientError", () => {
  it("설정 오류는 500 server_misconfigured 이고 변수명을 노출하지 않는다", async () => {
    const res = mapClientError(new UpstageConfigError("UPSTAGE_API_KEY"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("server_misconfigured");
    expect(text).not.toContain("UPSTAGE_API_KEY");
  });

  it("네트워크 오류는 502 api_unreachable", async () => {
    const res = mapClientError(new UpstreamNetworkError(new TypeError("x")));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });

  it("시간 초과는 504 upstream_timeout", async () => {
    const timeout = new DOMException("timed out", "TimeoutError");
    const res = mapClientError(new UpstreamNetworkError(timeout));
    expect(res.status).toBe(504);
    expect((await res.json()).error.code).toBe("upstream_timeout");
  });

  it.each(["TimeoutError", "AbortError"])(
    "본문 읽기 중 %s 는 504 upstream_timeout",
    async name => {
      const res = mapClientError(new DOMException("aborted", name));
      expect(res.status).toBe(504);
      expect((await res.json()).error.code).toBe("upstream_timeout");
    },
  );

  it("이름이 다른 DOMException 은 500 internal_error", async () => {
    const res = mapClientError(new DOMException("x", "DataCloneError"));
    expect(res.status).toBe(500);
  });

  it("redirect 는 502 upstream_redirect", async () => {
    const res = mapClientError(new UpstreamRedirectError(302));
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("upstream_redirect");
  });

  it("그 외는 500 internal_error 이고 메시지를 노출하지 않는다", async () => {
    const res = mapClientError(new Error("secret detail"));
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text).error.code).toBe("internal_error");
    expect(text).not.toContain("secret detail");
  });
});
