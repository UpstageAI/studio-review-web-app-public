import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MAX_INLINE_IMPORT_BYTES } from "@/lib/upstage/review";

import { POST } from "../route";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("UPSTAGE_API_KEY", "test-key");
  vi.stubEnv("UPSTAGE_CONSOLE_API_URL", "https://example.test");
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const URL_BASE =
  "http://localhost:3000/api/search-collections/scol_1/review-imports";

function call(body: BodyInit | null, headers: Record<string, string> = {}) {
  const request = new NextRequest(URL_BASE, {
    method: "POST",
    headers: { host: "localhost:3000", "Idempotency-Key": "key-1", ...headers },
    body,
  });
  return POST(request, { params: Promise.resolve({ collectionId: "scol_1" }) });
}

describe("POST review-imports", () => {
  it("Idempotency-Key 가 없으면 400", async () => {
    const request = new NextRequest(URL_BASE, { method: "POST", body: "{}" });
    const res = await POST(request, {
      params: Promise.resolve({ collectionId: "scol_1" }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatchObject({
      code: "invalid_value",
      param: "Idempotency-Key",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Idempotency-Key 가 200 자를 넘으면 400", async () => {
    const res = await call("{}", { "Idempotency-Key": "k".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("Content-Length 가 한도를 넘으면 본문을 읽기 전에 413", async () => {
    const request = new NextRequest(URL_BASE, {
      method: "POST",
      headers: {
        "Idempotency-Key": "key-1",
        "Content-Length": String(9 * 1024 * 1024),
      },
      body: "{}",
    });
    const res = await POST(request, {
      params: Promise.resolve({ collectionId: "scol_1" }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("package_limit_exceeded");
    expect(request.bodyUsed).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("실제 본문이 8 MiB + 1 바이트면 413", async () => {
    const res = await call(new Uint8Array(MAX_INLINE_IMPORT_BYTES + 1));
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("Content-Length 없는 스트림 본문이 8 MiB 를 넘으면 읽는 도중 취소하고 413", async () => {
    const chunk = 1024 * 1024;
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 64) controller.close();
        else controller.enqueue(new Uint8Array(chunk));
      },
      cancel() {
        cancelled = true;
      },
    });
    const request = new NextRequest(URL_BASE, {
      method: "POST",
      headers: { "Idempotency-Key": "key-1" },
      body: stream,
      duplex: "half",
    });
    expect(request.headers.get("content-length")).toBeNull();
    const res = await POST(request, {
      params: Promise.resolve({ collectionId: "scol_1" }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).error.code).toBe("package_limit_exceeded");
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(64);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("본문이 정확히 8 MiB 면 upstream 으로 보낸다", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ id: "rvop_1", status: "pending" }, { status: 202 }),
    );
    const res = await call(new Uint8Array(MAX_INLINE_IMPORT_BYTES));
    expect(res.status).toBe(202);
    const [, init] = fetchMock.mock.calls.at(-1)!;
    expect((init?.body as Uint8Array).byteLength).toBe(MAX_INLINE_IMPORT_BYTES);
  });

  it("빈 본문은 400", async () => {
    const res = await call(new Uint8Array(0));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("다른 사이트에서 온 요청은 403", async () => {
    const res = await call("{}", { origin: "https://evil.test" });
    expect(res.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("upstream 에 apply=auto · octet-stream 으로 바이트를 보내고 202 + Retry-After 를 전달한다", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { id: "rvop_1", status: "pending" },
        {
          status: 202,
          headers: {
            "Retry-After": "2",
            Location:
              "https://example.test/v2/search-collections/scol_1/review-imports/rvop_1",
          },
        },
      ),
    );
    const raw = '{"format":"collection-results/11"}';
    const res = await call(raw, {
      origin: "http://localhost:3000",
      "Content-Type": "application/json",
    });

    const [input, init] = fetchMock.mock.calls.at(-1)!;
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    expect(url.pathname).toBe("/v2/search-collections/scol_1/review-imports");
    expect(url.searchParams.get("apply")).toBe("auto");
    expect(init?.method).toBe("POST");
    expect(headers.get("authorization")).toBe("Bearer test-key");
    expect(headers.get("idempotency-key")).toBe("key-1");
    expect(headers.get("content-type")).toBe("application/octet-stream");
    expect(new TextDecoder().decode(init?.body as ArrayBuffer)).toBe(raw);

    expect(res.status).toBe(202);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.has("location")).toBe(false);
    expect((await res.json()).id).toBe("rvop_1");
  });
});
