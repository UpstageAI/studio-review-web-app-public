import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FILE_JSON_CACHE_MAX_BYTES,
  FILE_JSON_MAX_BYTES,
  fileJsonCache,
  loadFileJson,
} from "../file-source";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fileJsonCache.clear();
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

function upstreamFile(
  status = "READY",
  imageUrl: string | null = "https://storage.test/p1.png?sig=1",
) {
  return Response.json({
    id: "file_1",
    status,
    num_pages: 1,
    pages: [{ image_url: imageUrl, elements: "[]" }],
  });
}

describe("loadFileJson", () => {
  it("첫 조회는 upstream 을 부르고, 준비된 파일은 캐시해 다음 조회에 upstream 을 부르지 않는다", async () => {
    fetchMock.mockImplementation(async () => upstreamFile());
    const first = await loadFileJson("file_1", { refresh: false });
    expect(first).toMatchObject({ ok: true, cached: false });
    const second = await loadFileJson("file_1", { refresh: false });
    expect(second).toMatchObject({ ok: true, cached: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fileJsonCache.size).toBe(1);
    expect(fileJsonCache.bytes).toBeGreaterThan(0);
  });

  it("refresh 면 캐시가 있어도 다시 조회하고 캐시를 바꾼다", async () => {
    fetchMock.mockImplementation(async () => upstreamFile());
    await loadFileJson("file_1", { refresh: false });
    const refreshed = await loadFileJson("file_1", { refresh: true });
    expect(refreshed).toMatchObject({ ok: true, cached: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("READY 가 아니고 이미지가 빠진 파일은 캐시하지 않는다(있던 캐시도 지운다)", async () => {
    fetchMock.mockImplementationOnce(async () => upstreamFile());
    await loadFileJson("file_1", { refresh: false });
    expect(fileJsonCache.size).toBe(1);
    fetchMock.mockImplementation(async () => upstreamFile("PROCESSING", null));
    await loadFileJson("file_1", { refresh: true });
    expect(fileJsonCache.size).toBe(0);
    await loadFileJson("file_1", { refresh: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("upstream 오류는 relay 한 응답으로 돌려준다", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "file_not_found", message: "no file" } },
        { status: 404 },
      ),
    );
    const result = await loadFileJson("file_1", { refresh: false });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(404);
    expect((await result.response.json()).error.code).toBe("file_not_found");
    expect(fileJsonCache.size).toBe(0);
  });

  it("본문이 JSON 이 아니면 502 upstream_error", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }));
    const result = await loadFileJson("file_1", { refresh: false });
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(502);
    expect((await result.response.json()).error.code).toBe("upstream_error");
  });

  it("네트워크 예외는 그대로 던진다", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expect(loadFileJson("file_1", { refresh: false })).rejects.toThrow();
  });

  it("원문이 64 MiB 를 넘으면 읽는 도중 멈추고 502 response_too_large, 캐시하지 않는다", async () => {
    const chunk = 1024 * 1024;
    let pulls = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 100) controller.close();
        else controller.enqueue(new Uint8Array(chunk).fill(0x20));
      },
      cancel() {
        cancelled = true;
      },
    });
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }));
    const result = await loadFileJson("file_1", { refresh: false });
    if (result.ok) throw new Error("expected failure");
    expect(result.response.status).toBe(502);
    expect((await result.response.json()).error.code).toBe(
      "response_too_large",
    );
    expect(cancelled).toBe(true);
    expect(pulls).toBeLessThan(100);
    expect(FILE_JSON_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(fileJsonCache.size).toBe(0);
  });

  it("캐시 항목의 크기는 원문 바이트 × 3 이고 상한은 256 MiB", async () => {
    const body = JSON.stringify({
      id: "file_1",
      status: "READY",
      num_pages: 1,
      pages: [{ image_url: "https://storage.test/p1.png", elements: "[]" }],
    });
    fetchMock.mockResolvedValue(
      new Response(body, { headers: { "Content-Type": "application/json" } }),
    );
    await loadFileJson("file_1", { refresh: false });
    expect(fileJsonCache.bytes).toBe(
      new TextEncoder().encode(body).byteLength * 3,
    );
    expect(FILE_JSON_CACHE_MAX_BYTES).toBe(256 * 1024 * 1024);
  });

  it("같은 파일의 동시 조회는 upstream 을 한 번만 부른다", async () => {
    fetchMock.mockImplementation(async () => upstreamFile());
    const results = await Promise.all([
      loadFileJson("file_1", { refresh: false }),
      loadFileJson("file_1", { refresh: false }),
      loadFileJson("file_1", { refresh: false }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const result of results) expect(result.ok).toBe(true);
  });

  it("refresh 요청도 진행 중인 조회에 합류한다", async () => {
    fetchMock.mockImplementation(async () => upstreamFile());
    const [a, b] = await Promise.all([
      loadFileJson("file_1", { refresh: true }),
      loadFileJson("file_1", { refresh: false }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(a.ok && b.ok).toBe(true);
  });

  it("다른 파일은 묶지 않는다", async () => {
    fetchMock.mockImplementation(async () => upstreamFile());
    await Promise.all([
      loadFileJson("file_1", { refresh: false }),
      loadFileJson("file_2", { refresh: false }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("동시 조회가 함께 받은 오류 응답은 각자 본문을 읽을 수 있다", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json(
        { error: { code: "internal_error", message: "boom" } },
        { status: 500 },
      ),
    );
    const results = await Promise.all([
      loadFileJson("file_1", { refresh: false }),
      loadFileJson("file_1", { refresh: false }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const result of results) {
      if (result.ok) throw new Error("expected failure");
      expect(result.response.status).toBe(500);
      expect((await result.response.json()).error.code).toBe("internal_error");
    }
  });

  it("동시 조회 중 네트워크 예외는 합류한 호출 모두에 던지고, 끝난 뒤에는 다시 조회한다", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const settled = await Promise.allSettled([
      loadFileJson("file_1", { refresh: false }),
      loadFileJson("file_1", { refresh: false }),
    ]);
    expect(settled.map(s => s.status)).toEqual(["rejected", "rejected"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockImplementation(async () => upstreamFile());
    expect(await loadFileJson("file_1", { refresh: false })).toMatchObject({
      ok: true,
      cached: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("앞 조회가 끝난 뒤의 오류 재조회는 upstream 을 다시 부른다", async () => {
    fetchMock.mockImplementation(async () =>
      Response.json({ error: { code: "x", message: "y" } }, { status: 500 }),
    );
    await loadFileJson("file_1", { refresh: false });
    await loadFileJson("file_1", { refresh: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
