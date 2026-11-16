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

function call(collectionId: string) {
  const request = new NextRequest(
    `http://localhost:3000/api/search-collections/${collectionId}/review-capabilities`,
  );
  return GET(request, { params: Promise.resolve({ collectionId }) });
}

describe("GET review-capabilities", () => {
  it("upstream 응답을 no-store 로 전달한다", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        object: "search_collection.review_capabilities",
        result_source_supported: true,
      }),
    );
    const res = await call("scol_1");

    const [input, init] = fetchMock.mock.calls.at(-1)!;
    expect(new URL(String(input)).pathname).toBe(
      "/v2/search-collections/scol_1/review-capabilities",
    );
    expect(new Headers(init?.headers).get("authorization")).toBe(
      "Bearer test-key",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect((await res.json()).result_source_supported).toBe(true);
  });

  it("upstream 오류 envelope 을 같은 status 로 전달한다", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "collection_review_disabled", message: "disabled" } },
        { status: 404 },
      ),
    );
    const res = await call("scol_1");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("collection_review_disabled");
  });

  it("collectionId 가 잘못되면 400", async () => {
    const res = await call("scol%2F1");
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
