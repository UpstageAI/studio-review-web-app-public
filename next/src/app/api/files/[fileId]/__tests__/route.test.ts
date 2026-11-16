import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fileJsonCache } from "@/app/api/_lib/file-source";

import { GET } from "../route";

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

const box = [
  { x: 0.1, y: 0.1 },
  { x: 0.5, y: 0.1 },
  { x: 0.5, y: 0.2 },
];

function upstreamFile(
  status = "READY",
  imageUrl: string | null = "https://storage.test/p1.png?sig=1",
) {
  return Response.json({
    id: "file_1",
    status,
    filename: "a.pdf",
    num_pages: 1,
    file_url: "https://storage.test/original.pdf?sig=1",
    pages: [
      {
        image_url: imageUrl,
        elements: JSON.stringify([
          {
            id: 0,
            category: "paragraph",
            content: { text: "x" },
            coordinates: box,
          },
        ]),
      },
    ],
  });
}

function call(fileId = "file_1", search = "") {
  return GET(
    new NextRequest(`http://localhost:3000/api/files/${fileId}${search}`),
    { params: Promise.resolve({ fileId }) },
  );
}

describe("GET /api/files/{fileId}", () => {
  it("fileId 가 잘못되면 400", async () => {
    const res = await call("../x");
    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe("file_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refresh 값이 1 이 아니면 400", async () => {
    const res = await call("file_1", "?refresh=yes");
    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe("refresh");
  });

  it("view=all·pages=all 로 조회해 이미지 URL 만 담은 본문을 돌려준다", async () => {
    fetchMock.mockResolvedValue(upstreamFile());
    const res = await call();

    const [input, init] = fetchMock.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.pathname).toBe("/v2/files/file_1");
    expect(url.searchParams.get("view")).toBe("all");
    expect(url.searchParams.get("pages")).toBe("all");
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-key",
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body).toEqual({
      id: "file_1",
      status: "READY",
      filename: "a.pdf",
      num_pages: 1,
      pages: [{ image_url: "https://storage.test/p1.png?sig=1" }],
    });
    expect(JSON.stringify(body)).not.toContain("original.pdf");
    expect(JSON.stringify(body)).not.toContain("highlights");
  });

  it("READY 면 캐시해 upstream 을 한 번만 부르고, refresh=1 이면 다시 부른다", async () => {
    fetchMock.mockImplementation(async () => upstreamFile());
    expect((await call()).status).toBe(200);
    expect((await call()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect((await call("file_1", "?refresh=1")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("READY 가 아니어도 모든 페이지에 이미지가 있으면 캐시한다", async () => {
    fetchMock.mockImplementation(async () => upstreamFile("UPLOADED"));
    await call();
    await call();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("이미지가 빠진 페이지가 있고 READY 가 아니면 캐시하지 않는다", async () => {
    fetchMock.mockImplementation(async () => upstreamFile("PROCESSING", null));
    await call();
    await call();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("upstream 404 는 오류 envelope 그대로 전달한다", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "file_not_found", message: "no file" } },
        { status: 404 },
      ),
    );
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("file_not_found");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("fetch 가 실패하면 502 api_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call();
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });
});

describe("GET /api/files/{fileId} — 다른 사이트 요청", () => {
  function siteRequest(headers: Record<string, string>) {
    return GET(
      new NextRequest("http://localhost:3000/api/files/file_1", { headers }),
      { params: Promise.resolve({ fileId: "file_1" }) },
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
      fetchMock.mockImplementation(async () => upstreamFile());
      const res = await siteRequest(headers);
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
