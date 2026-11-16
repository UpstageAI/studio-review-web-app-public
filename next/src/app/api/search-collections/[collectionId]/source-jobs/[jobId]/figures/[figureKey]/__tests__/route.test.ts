import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { figureCache, figureCacheKey } from "@/app/api/_lib/figure-cache";

import { GET } from "../route";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  figureCache.clear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function call({
  collectionId = "scol_1",
  jobId = "job_1",
  figureKey = "f1",
} = {}) {
  return GET(
    new NextRequest(
      `http://localhost:3000/api/search-collections/${collectionId}/source-jobs/${jobId}/figures/${figureKey}`,
    ),
    { params: Promise.resolve({ collectionId, jobId, figureKey }) },
  );
}

async function expect400(res: Response, param: string) {
  expect(res.status).toBe(400);
  const body = await res.json();
  expect(body.error.code).toBe("invalid_value");
  expect(body.error.param).toBe(param);
}

describe("GET search-collections/{collectionId}/source-jobs/{jobId}/figures/{figureKey}", () => {
  it("id 나 키가 잘못되면 400", async () => {
    await expect400(await call({ collectionId: "a b" }), "collection_id");
    await expect400(await call({ jobId: "../x" }), "job_id");
    await expect400(await call({ figureKey: "g1" }), "figure_key");
    await expect400(await call({ figureKey: "f" }), "figure_key");
    await expect400(await call({ figureKey: "f1234567" }), "figure_key");
    await expect400(await call({ figureKey: "f1.png" }), "figure_key");
  });

  it("캐시에 없으면 404 figure_not_found(upstream 호출 없음)", async () => {
    const res = await call();
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("figure_not_found");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("캐시에 있으면 바이트와 Content-Type·Content-Length·nosniff 를 돌려준다", async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    figureCache.set(figureCacheKey("scol_1", "job_1", "f1"), {
      bytes: png,
      contentType: "image/png",
    });
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(png);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("다른 Collection·Job 의 같은 키는 보이지 않는다", async () => {
    figureCache.set(figureCacheKey("scol_1", "job_1", "f1"), {
      bytes: new Uint8Array([1, 2, 3]),
      contentType: "image/jpeg",
    });
    expect((await call({ collectionId: "scol_2" })).status).toBe(404);
    expect((await call({ jobId: "job_2" })).status).toBe(404);
    expect((await call({ figureKey: "f2" })).status).toBe(404);
    expect((await call()).status).toBe(200);
  });
});
