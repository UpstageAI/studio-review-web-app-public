import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createReviewImport,
  getReviewCapabilities,
  getReviewDocument,
  getReviewImport,
  getSourceJobRevision,
  listSourceJobRevisions,
} from "../review";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("UPSTAGE_API_KEY", "test-key");
  vi.stubEnv("UPSTAGE_CONSOLE_API_URL", "https://example.test");
  fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function lastCall(): { url: URL; init: RequestInit; headers: Headers } {
  const [input, init] = fetchMock.mock.calls.at(-1)!;
  return {
    url: new URL(String(input)),
    init: init ?? {},
    headers: new Headers(init?.headers),
  };
}

describe("getReviewCapabilities", () => {
  it("review-capabilities 를 GET 한다", async () => {
    await getReviewCapabilities("scol_1");
    const { url, init, headers } = lastCall();
    expect(url.pathname).toBe(
      "/v2/search-collections/scol_1/review-capabilities",
    );
    expect(init.method).toBe("GET");
    expect(headers.get("authorization")).toBe("Bearer test-key");
  });
});

describe("getReviewDocument", () => {
  it("job_ids 를 반복 쿼리로 보낸다", async () => {
    await getReviewDocument("scol_1", ["job_a", "job_b"]);
    const { url, headers } = lastCall();
    expect(url.pathname).toBe("/v2/search-collections/scol_1/review-document");
    expect(url.searchParams.getAll("job_ids")).toEqual(["job_a", "job_b"]);
    expect(headers.has("if-none-match")).toBe(false);
  });

  it("If-None-Match 를 전달한다", async () => {
    await getReviewDocument("scol_1", ["job_a"], { ifNoneMatch: 'W/"abc"' });
    expect(lastCall().headers.get("if-none-match")).toBe('W/"abc"');
  });
});

describe("createReviewImport", () => {
  it("apply=auto · Idempotency-Key · octet-stream 으로 본문 바이트를 POST 한다", async () => {
    const body = new TextEncoder().encode('{"format":"collection-results/11"}');
    await createReviewImport("scol_1", body, { idempotencyKey: "key-1" });
    const { url, init, headers } = lastCall();
    expect(url.pathname).toBe("/v2/search-collections/scol_1/review-imports");
    expect(url.searchParams.get("apply")).toBe("auto");
    expect(init.method).toBe("POST");
    expect(headers.get("idempotency-key")).toBe("key-1");
    expect(headers.get("content-type")).toBe("application/octet-stream");
    expect(init.body).toBe(body);
  });

  it("apply 를 지정하면 그 값을 쓴다", async () => {
    await createReviewImport("scol_1", new ArrayBuffer(1), {
      idempotencyKey: "key-1",
      apply: "manual",
    });
    expect(lastCall().url.searchParams.get("apply")).toBe("manual");
  });
});

describe("getReviewImport", () => {
  it("가져오기 한 건을 GET 한다", async () => {
    await getReviewImport("scol_1", "rvop_1");
    expect(lastCall().url.pathname).toBe(
      "/v2/search-collections/scol_1/review-imports/rvop_1",
    );
  });
});

describe("listSourceJobRevisions", () => {
  it("revisions 경로에 정의된 쿼리만 보낸다", async () => {
    await listSourceJobRevisions("scol_1", "job_1", {
      type: "result",
      occurrence_id: "occ_1",
      limit: 100,
      order: "asc",
      after: undefined,
    });
    const { url, init } = lastCall();
    expect(url.pathname).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/revisions",
    );
    expect(init.method).toBe("GET");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      type: "result",
      occurrence_id: "occ_1",
      limit: "100",
      order: "asc",
    });
  });
});

describe("getSourceJobRevision", () => {
  it("revision 한 건을 GET 한다", async () => {
    await getSourceJobRevision("scol_1", "job_1", "rvn_1");
    const { url, headers } = lastCall();
    expect(url.pathname).toBe(
      "/v2/search-collections/scol_1/source-jobs/job_1/revisions/rvn_1",
    );
    expect(headers.has("if-none-match")).toBe(false);
  });
});
