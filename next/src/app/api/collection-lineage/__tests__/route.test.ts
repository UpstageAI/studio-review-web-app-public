import { beforeEach, describe, expect, it, vi } from "vitest";

const readCollectionLineage = vi.hoisted(() => vi.fn());

vi.mock("@/app/api/_lib/collection-lineage", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@/app/api/_lib/collection-lineage")
  >()),
  readCollectionLineage,
}));

import { LineageListError } from "@/app/api/_lib/collection-lineage";
import { UpstreamNetworkError } from "@/lib/upstage/errors";

import { GET } from "../route";

function lineageRequest(headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/collection-lineage", {
    headers,
  });
}

beforeEach(() => {
  readCollectionLineage.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("GET /api/collection-lineage", () => {
  it("연결을 돌려주고 캐시하지 않는다", async () => {
    const lineage = {
      nodes: [],
      edges: [],
      unrelated_count: 0,
      unverified_count: 0,
      partial: false,
    };
    readCollectionLineage.mockResolvedValue(lineage);
    const response = await GET(lineageRequest());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual(lineage);
  });

  it("목록 오류는 upstream 응답대로 전달한다", async () => {
    readCollectionLineage.mockRejectedValue(
      new LineageListError(
        new Response(
          JSON.stringify({ error: { code: "unauthorized", message: "no" } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const response = await GET(lineageRequest());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("unauthorized");
  });

  it("동시 요청이 같은 목록 오류를 받아도 오류 내용을 잃지 않는다", async () => {
    readCollectionLineage.mockRejectedValue(
      new LineageListError(
        new Response(
          JSON.stringify({ error: { code: "unauthorized", message: "no" } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    const responses = await Promise.all([
      GET(lineageRequest()),
      GET(lineageRequest()),
    ]);
    const bodies = await Promise.all(responses.map(item => item.json()));
    expect(bodies.map(body => body.error.code)).toEqual([
      "unauthorized",
      "unauthorized",
    ]);
  });

  it("네트워크 실패는 502 다", async () => {
    readCollectionLineage.mockRejectedValue(
      new UpstreamNetworkError(new Error("boom")),
    );
    const response = await GET(lineageRequest());
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("api_unreachable");
  });

  it.each(["cross-site", "same-site"])(
    "Sec-Fetch-Site 가 %s 면 탐색하지 않고 403",
    async site => {
      const response = await GET(lineageRequest({ "Sec-Fetch-Site": site }));
      expect(response.status).toBe(403);
      expect((await response.json()).error.code).toBe("forbidden");
      expect(readCollectionLineage).not.toHaveBeenCalled();
    },
  );

  it.each<Record<string, string>>([{}, { "Sec-Fetch-Site": "same-origin" }])(
    "Sec-Fetch-Site 가 없거나 same-origin 이면 탐색한다 (%j)",
    async headers => {
      readCollectionLineage.mockResolvedValue({
        nodes: [],
        edges: [],
        unrelated_count: 0,
        unverified_count: 0,
        partial: false,
      });
      const response = await GET(lineageRequest(headers));
      expect(response.status).toBe(200);
      expect(readCollectionLineage).toHaveBeenCalledTimes(1);
    },
  );
});
