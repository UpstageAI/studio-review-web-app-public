import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET } from "../route";

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

function call(collectionId: string, importId: string) {
  const request = new NextRequest(
    `http://localhost:3000/api/search-collections/${collectionId}/review-imports/${importId}`,
  );
  return GET(request, { params: Promise.resolve({ collectionId, importId }) });
}

describe("GET review-imports/[importId]", () => {
  it("가져오기 상태를 Retry-After·ETag 와 함께 전달한다", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { id: "rvop_1", status: "applying" },
        { status: 200, headers: { "Retry-After": "2", ETag: '"g1"' } },
      ),
    );
    const res = await call("scol_1", "rvop_1");

    const [input, init] = fetchMock.mock.calls.at(-1)!;
    expect(new URL(String(input)).pathname).toBe(
      "/v2/search-collections/scol_1/review-imports/rvop_1",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-key",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(res.headers.get("etag")).toBe('"g1"');
    expect((await res.json()).status).toBe("applying");
  });

  it("importId 가 잘못되면 400", async () => {
    const res = await call("scol_1", "rvop 1");
    expect(res.status).toBe(400);
    expect((await res.json()).error.param).toBe("import_id");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("collectionId 가 잘못되면 400", async () => {
    const res = await call("../x", "rvop_1");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
