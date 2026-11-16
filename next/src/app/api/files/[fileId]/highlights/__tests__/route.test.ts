import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fileJsonCache } from "@/app/api/_lib/file-source";

import { GET as getFilePages } from "../../route";
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

const element = (id: number) => ({
  id,
  category: "paragraph",
  content: { text: `e${id}` },
  coordinates: box,
});

/** 페이지 `count` 개짜리 READY 파일. 페이지 n 에는 요소 n 개. */
function upstreamFile(count: number) {
  return Response.json({
    id: "file_1",
    status: "READY",
    num_pages: count,
    pages: Array.from({ length: count }, (_, i) => ({
      image_url: `https://storage.test/p${i + 1}.png?sig=1`,
      elements: JSON.stringify(
        Array.from({ length: i + 1 }, (_, n) => element(n)),
      ),
    })),
  });
}

function call(fileId = "file_1", search = "") {
  return GET(
    new NextRequest(
      `http://localhost:3000/api/files/${fileId}/highlights${search}`,
    ),
    { params: Promise.resolve({ fileId }) },
  );
}

async function expect400(res: Response, param: string) {
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("invalid_value");
  expect(body.error.param).toBe(param);
}

describe("GET /api/files/{fileId}/highlights", () => {
  it("fileId 가 잘못되면 400", async () => {
    await expect400(await call("../x", "?pages=1-2"), "file_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pages 가 없으면 400", async () => {
    await expect400(await call(), "pages");
    await expect400(await call("file_1", "?pages="), "pages");
  });

  it("pages 가 a-b 모양이 아니면 400", async () => {
    await expect400(await call("file_1", "?pages=0-5"), "pages");
    await expect400(await call("file_1", "?pages=1"), "pages");
    await expect400(await call("file_1", "?pages=a-b"), "pages");
    await expect400(await call("file_1", "?pages=1-2-3"), "pages");
    await expect400(await call("file_1", "?pages=100000-100001"), "pages");
  });

  it("시작이 끝보다 크면 400", async () => {
    await expect400(await call("file_1", "?pages=5-4"), "pages");
  });

  it("범위가 50 쪽을 넘으면 400", async () => {
    await expect400(await call("file_1", "?pages=1-51"), "pages");
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockResolvedValue(upstreamFile(60));
    expect((await call("file_1", "?pages=1-50")).status).toBe(200);
  });

  it("범위 안 페이지의 하이라이트를 페이지 순서로 돌려준다", async () => {
    fetchMock.mockResolvedValue(upstreamFile(5));
    const res = await call("file_1", "?pages=2-3");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = await res.json();
    expect(body.id).toBe("file_1");
    expect(body.pages.map((page: { page: number }) => page.page)).toEqual([
      2, 3,
    ]);
    expect(body.pages[0].highlights).toHaveLength(2);
    expect(body.pages[0].highlights[0]).toMatchObject({
      id: "p2-0",
      page: 2,
      _value: "e0",
    });
    expect(body.pages[1].highlights).toHaveLength(3);
    expect(JSON.stringify(body)).not.toContain("image_url");
  });

  it("이미지 응답 뒤의 범위 조회는 upstream 을 다시 부르지 않는다", async () => {
    fetchMock.mockImplementation(async () => upstreamFile(3));
    const images = await getFilePages(
      new NextRequest("http://localhost:3000/api/files/file_1"),
      { params: Promise.resolve({ fileId: "file_1" }) },
    );
    expect(images.status).toBe(200);
    expect((await call("file_1", "?pages=1-3")).status).toBe(200);
    expect((await call("file_1", "?pages=1-2")).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("파일에 없는 페이지는 빼고 있는 것만 돌려준다", async () => {
    fetchMock.mockResolvedValue(upstreamFile(3));
    const body = await (await call("file_1", "?pages=2-20")).json();
    expect(body.pages.map((page: { page: number }) => page.page)).toEqual([
      2, 3,
    ]);
    const none = await (await call("file_1", "?pages=10-12")).json();
    expect(none.pages).toEqual([]);
  });

  it("upstream 404 는 오류 envelope 그대로 전달한다", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "file_not_found", message: "no file" } },
        { status: 404 },
      ),
    );
    const res = await call("file_1", "?pages=1-20");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("file_not_found");
  });

  it("fetch 가 실패하면 502 api_unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const res = await call("file_1", "?pages=1-20");
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe("api_unreachable");
  });
});

describe("GET /api/files/{fileId}/highlights — 다른 사이트 요청", () => {
  function siteRequest(headers: Record<string, string>) {
    return GET(
      new NextRequest(
        "http://localhost:3000/api/files/file_1/highlights?pages=1-1",
        { headers },
      ),
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
      fetchMock.mockImplementation(async () => upstreamFile(1));
      const res = await siteRequest(headers);
      expect(res.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );
});
